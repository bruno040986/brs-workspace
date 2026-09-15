/**
 * Upload de CSV/XLSX para a Higienização Amigoz (aba 2 — lote por arquivo).
 *
 * Colunas reconhecidas por NOME do cabeçalho (acento/caixa ignorados):
 * cpf (obrigatória), nome, telefone, matricula, senha_servidor. Sem cabeçalho
 * de CPF reconhecido, cai no mesmo truque do upload da NVTI: procura em
 * qualquer célula da linha algo que pareça CPF. Cria o lote, os itens e já
 * inicia (o worker roda 1 consulta por vez, respeitando a pausa escolhida).
 *
 * Exige alvoconsig-higienizacao-amigoz (can_include).
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { normalizeCpf, validateCpf } from '@/lib/import/columnMap'
import { listarVariantesPorConvenio } from '@/lib/if-credito/amigoz/convenios'
import { adicionarItens, criarLote, iniciarLote, type ItemEntrada } from '@/lib/if-credito/amigoz/lote'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_LINHAS = 20_000

function normalizarCabecalho(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

const ALIASES: Record<string, keyof ItemEntrada> = {
  cpf: 'cpf',
  nome: 'nome',
  nome_completo: 'nome',
  telefone: 'telefone',
  celular: 'telefone',
  matricula: 'matricula',
  matrcula: 'matricula',
  numero_matricula: 'matricula',
  senha_servidor: 'senhaServidor',
  senha: 'senhaServidor',
}

/** Procura algo com cara de CPF em qualquer célula da linha (fallback sem cabeçalho reconhecido). */
function procurarCpfNaLinha(row: unknown[]): string | null {
  for (const cell of row) {
    if (cell === null || cell === undefined || cell === '') continue
    const digitos = String(cell).replace(/\D/g, '')
    if (digitos.length < 9 || digitos.length > 11) continue
    const cpf = digitos.padStart(11, '0')
    if (validateCpf(cpf)) return cpf
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'alvoconsig-higienizacao-amigoz', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const convenioId = String(formData.get('convenio_id') || '').trim()
    const pausaMs = Number(formData.get('pausa_ms') || 1500)
    const buscarOfertas = String(formData.get('buscar_ofertas') || '') === '1'

    if (!file) return NextResponse.json({ error: 'Envie um arquivo.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Arquivo maior que 10MB.' }, { status: 400 })
    if (!convenioId) return NextResponse.json({ error: 'Selecione o convênio.' }, { status: 400 })

    const variantes = await listarVariantesPorConvenio(convenioId)
    if (variantes.length === 0) {
      return NextResponse.json({ error: 'Este convênio ainda não está vinculado a um convênio do Amigoz — configure o vínculo na tela antes de subir o arquivo.' }, { status: 400 })
    }
    if (variantes.every((v) => v.averbadoraExterna === null)) {
      return NextResponse.json({ error: 'Nenhuma variante deste convênio tem averbadora configurada — edite o vínculo antes de continuar.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
    const primeiraAba = workbook.SheetNames[0]
    if (!primeiraAba) return NextResponse.json({ error: 'Planilha vazia.' }, { status: 400 })
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[primeiraAba], { header: 1, raw: true, defval: '' })
    if (linhas.length === 0) return NextResponse.json({ error: 'Planilha vazia.' }, { status: 400 })

    const cabecalho = (linhas[0] as unknown[]).map((c) => normalizarCabecalho(String(c ?? '')))
    const indicePorCampo: Partial<Record<keyof ItemEntrada, number>> = {}
    cabecalho.forEach((nomeColuna, idx) => {
      const campo = ALIASES[nomeColuna]
      if (campo && indicePorCampo[campo] === undefined) indicePorCampo[campo] = idx
    })
    const temCabecalhoCpf = indicePorCampo.cpf !== undefined
    const linhasDeDados = temCabecalhoCpf ? linhas.slice(1) : linhas

    // Buscar ofertas exige criar o cliente no Amigoz, e isso exige telefone —
    // sem coluna reconhecida, todo item cairia em erro "sem telefone" depois
    // de gastar a consulta de margem inteira. Barra aqui, antes de criar o lote.
    if (buscarOfertas && indicePorCampo.telefone === undefined) {
      return NextResponse.json(
        {
          error:
            'Pra buscar ofertas, a planilha precisa ter uma coluna de telefone (cabeçalho "telefone" ou "celular") — é obrigatória pra criar o cliente no Amigoz. Adicione a coluna ou desmarque "Buscar ofertas após a margem".',
        },
        { status: 400 },
      )
    }

    if (linhasDeDados.length > MAX_LINHAS) {
      return NextResponse.json({ error: `Máximo de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas por lote.` }, { status: 400 })
    }

    const itens: ItemEntrada[] = []
    let semCpf = 0
    for (const linhaBruta of linhasDeDados) {
      const row = Array.isArray(linhaBruta) ? linhaBruta : []
      const cpfBruto = temCabecalhoCpf ? String(row[indicePorCampo.cpf!] ?? '') : ''
      const cpf = temCabecalhoCpf ? normalizeCpf(cpfBruto) : procurarCpfNaLinha(row)
      if (!cpf || (temCabecalhoCpf && !validateCpf(cpf))) {
        semCpf += 1
        continue
      }
      const texto = (idx: number | undefined) => (idx !== undefined ? String(row[idx] ?? '').trim() || null : null)
      itens.push({
        cpf,
        nome: texto(indicePorCampo.nome),
        telefone: texto(indicePorCampo.telefone),
        matricula: texto(indicePorCampo.matricula),
        senhaServidor: texto(indicePorCampo.senhaServidor),
      })
    }

    if (itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum CPF válido encontrado no arquivo.' }, { status: 400 })
    }

    const loteId = await criarLote({
      origem: 'csv',
      convenioId,
      convenioExternoId: variantes[0].convenioExternoId,
      averbadoraExterna: variantes[0].averbadoraExterna,
      pausaMs,
      arquivoNome: file.name.slice(0, 200),
      buscarOfertas,
      criadoPor: user.id,
    })
    const { inseridos, invalidos, duplicados } = await adicionarItens(loteId, itens)
    await iniciarLote(loteId)

    return NextResponse.json({
      ok: true,
      loteId,
      inseridos,
      invalidos: invalidos + semCpf,
      duplicados,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro ao processar o arquivo.' }, { status: 500 })
  }
}
