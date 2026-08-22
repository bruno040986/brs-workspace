/**
 * Importação de mailing do AlvoConsig (REFIN pré-calculado ou margens).
 *
 * Duas fases, ambas por upload do arquivo (CSV/XLSX):
 * - fase=analisar: lê cabeçalhos + amostra e devolve a sugestão de mapeamento
 *   (o operador ajusta na tela).
 * - fase=importar: recebe o mapeamento confirmado, processa as linhas e faz
 *   upsert em crm_contatos por CPF. REFIN: só linhas com troco > 0.
 *
 * Exige alvoconsig-gestao (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  camposParaTipo,
  cleanDigits,
  normalizeCpfCell,
  parseIntSafe,
  parseMoney,
  sugerirMapeamento,
  type TipoImport,
} from '@/lib/alvoconsig/import'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_LINHAS = 200_000
const UPSERT_CHUNK = 500

type Workbook = { headers: string[]; rows: unknown[][] }

function lerPlanilha(buffer: Buffer): Workbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
  const headers = (rows[0] || []).map((cell) => String(cell ?? '').trim())
  return { headers, rows: rows.slice(1) }
}

function celula(row: unknown[], idx: number | undefined) {
  if (idx === undefined || idx === null || idx < 0) return null
  return row[idx] ?? null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'alvoconsig-gestao', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file')
    const fase = String(formData.get('fase') || 'analisar')
    const tipo = String(formData.get('tipo') || 'margem') as TipoImport

    if (tipo !== 'refin' && tipo !== 'margem') {
      return NextResponse.json({ error: 'Tipo de importação inválido.' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Envie um arquivo CSV ou XLSX.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo acima de 20MB.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let planilha: Workbook
    try {
      planilha = lerPlanilha(buffer)
    } catch {
      return NextResponse.json({ error: 'Não foi possível ler o arquivo. Use CSV ou XLSX.' }, { status: 400 })
    }

    if (!planilha.headers.length || !planilha.rows.length) {
      return NextResponse.json({ error: 'Arquivo vazio ou sem cabeçalho na primeira linha.' }, { status: 400 })
    }
    if (planilha.rows.length > MAX_LINHAS) {
      return NextResponse.json(
        { error: `O arquivo tem ${planilha.rows.length.toLocaleString('pt-BR')} linhas — o máximo é ${MAX_LINHAS.toLocaleString('pt-BR')}. Divida em arquivos menores.` },
        { status: 400 },
      )
    }

    if (fase === 'analisar') {
      return NextResponse.json({
        headers: planilha.headers,
        totalLinhas: planilha.rows.length,
        amostra: planilha.rows.slice(0, 5),
        sugestao: sugerirMapeamento(planilha.headers, tipo),
        campos: camposParaTipo(tipo),
      })
    }

    // fase=importar
    let mapeamento: Record<string, number>
    try {
      mapeamento = JSON.parse(String(formData.get('mapeamento') || '{}'))
    } catch {
      return NextResponse.json({ error: 'Mapeamento de colunas inválido.' }, { status: 400 })
    }
    const convenioIdPadrao = String(formData.get('convenio_id') || '').trim() || null

    if (mapeamento.cpf === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna de CPF.' }, { status: 400 })
    }
    if (tipo === 'refin' && mapeamento.refin_troco === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna do Valor do Troco (REFIN).' }, { status: 400 })
    }

    const admin = await createAdminClient()

    // Resolve convênios por código (coluna mapeada) uma única vez.
    const { data: conveniosData } = await admin
      .from('convenios')
      .select('id, codigo')
      .is('deleted_at', null)
    const convenioPorCodigo = new Map<string, string>()
    for (const conv of conveniosData || []) {
      if (conv.codigo) convenioPorCodigo.set(cleanDigits(conv.codigo) || String(conv.codigo), String(conv.id))
    }

    const { data: importRow, error: importError } = await admin
      .from('crm_imports')
      .insert({
        tipo,
        arquivo_nome: String(file.name || 'mailing').slice(0, 200),
        mapeamento,
        convenio_id: convenioIdPadrao,
        total_linhas: planilha.rows.length,
        criado_por: user.id,
      })
      .select('id')
      .single()
    if (importError || !importRow) {
      return NextResponse.json({ error: 'Falha ao registrar a importação.' }, { status: 500 })
    }

    let importadas = 0
    let descartadas = 0
    const vistos = new Set<string>()
    const agora = new Date().toISOString()
    type Linha = Record<string, unknown>
    let pendentes: Linha[] = []

    async function flush() {
      if (!pendentes.length) return
      const { error } = await admin
        .from('crm_contatos')
        .upsert(pendentes, { onConflict: 'cpf' })
      if (error) throw error
      pendentes = []
    }

    // O upsert em lote do PostgREST exige as MESMAS colunas em todas as linhas.
    // O conjunto de colunas é fixado pelo mapeamento (coluna não mapeada fica
    // fora do payload e portanto não sobrescreve o valor existente do contato).
    const temNome = mapeamento.nome !== undefined
    const temTelefone = mapeamento.telefone !== undefined
    const temMatricula = mapeamento.matricula !== undefined
    const temConvenio = mapeamento.codigo_convenio !== undefined || !!convenioIdPadrao
    const margensMapeadas = (['margem_novo', 'margem_cartao_rmc', 'margem_cartao_rcc'] as const)
      .filter((key) => mapeamento[key] !== undefined)

    if (tipo === 'margem' && margensMapeadas.length === 0) {
      return NextResponse.json({ error: 'Mapeie ao menos uma coluna de margem.' }, { status: 400 })
    }

    try {
      for (const row of planilha.rows) {
        if (!Array.isArray(row)) continue
        const cpf = normalizeCpfCell(celula(row, mapeamento.cpf))
        if (!cpf || vistos.has(cpf)) {
          descartadas += 1
          continue
        }

        const base: Linha = {
          cpf,
          import_id: importRow.id,
          updated_at: agora,
        }

        if (temNome) base.nome = String(celula(row, mapeamento.nome) ?? '').trim()
        if (temTelefone) base.telefone = cleanDigits(celula(row, mapeamento.telefone)) || null
        if (temMatricula) base.matricula = String(celula(row, mapeamento.matricula) ?? '').trim() || null

        if (temConvenio) {
          const codigoConvenio = String(celula(row, mapeamento.codigo_convenio) ?? '').trim()
          base.codigo_empregador = codigoConvenio || null
          base.convenio_id =
            (codigoConvenio && convenioPorCodigo.get(cleanDigits(codigoConvenio) || codigoConvenio)) ||
            convenioIdPadrao ||
            null
        }

        if (tipo === 'refin') {
          const troco = parseMoney(celula(row, mapeamento.refin_troco))
          if (troco === null || troco <= 0) {
            descartadas += 1
            continue
          }
          base.refin_troco = troco
          base.refin = {
            parcela: parseMoney(celula(row, mapeamento.refin_parcela)),
            prazo: parseIntSafe(celula(row, mapeamento.refin_prazo)),
            taxa: String(celula(row, mapeamento.refin_taxa) ?? '').trim() || null,
            tabela: String(celula(row, mapeamento.refin_tabela) ?? '').trim() || null,
            saldo_devedor: parseMoney(celula(row, mapeamento.refin_saldo_devedor)),
            importado_em: agora,
          }
        } else {
          let algumaMargem = false
          for (const key of margensMapeadas) {
            const valor = parseMoney(celula(row, mapeamento[key]))
            base[key] = valor
            if (valor !== null) algumaMargem = true
          }
          base.margens_atualizadas_em = agora
          if (!algumaMargem) {
            descartadas += 1
            continue
          }
        }

        vistos.add(cpf)
        importadas += 1
        pendentes.push(base)
        if (pendentes.length >= UPSERT_CHUNK) await flush()
      }
      await flush()
    } catch (error: any) {
      console.error('Erro ao processar importação AlvoConsig:', error)
      await admin
        .from('crm_imports')
        .update({ status: 'erro', erro: String(error?.message || error), importadas, descartadas, concluido_em: new Date().toISOString() })
        .eq('id', importRow.id)
      return NextResponse.json({ error: 'Falha ao gravar os contatos. A importação foi marcada com erro.' }, { status: 500 })
    }

    await admin
      .from('crm_imports')
      .update({ status: 'concluido', importadas, descartadas, concluido_em: new Date().toISOString() })
      .eq('id', importRow.id)

    return NextResponse.json({ importId: importRow.id, importadas, descartadas, total: planilha.rows.length })
  } catch (error) {
    console.error('Erro no upload de mailing AlvoConsig:', error)
    return NextResponse.json({ error: 'Erro inesperado ao importar o mailing.' }, { status: 500 })
  }
}
