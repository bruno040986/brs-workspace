/**
 * Cadastro de Leads em lote — tela ÚNICA e SEPARADA da Importações
 * (decisão 02/09/2026): SÓ CADASTRA. CPF que já existe no WeSales é
 * IGNORADO — esta rota NUNCA atualiza nem sobrescreve um contato existente
 * (ao contrário de Margem/REFIN/Elegibilidade, que nunca criam/atualizam
 * cadastro, só oportunidade). É o oposto complementar de Importações.
 *
 * Duas fases, igual ao padrão de Importações:
 * - fase=analisar: lê cabeçalhos + amostra e devolve a sugestão de mapeamento.
 * - fase=importar: por linha, CPF/Nome/Sobrenome/Telefone/Convênio
 *   obrigatórios (linha sem algum deles é descartada); cria o contato só se
 *   o CPF ainda não existir.
 *
 * Exige alvoconsig-gestao (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { addContactTags, createContact, customFieldEntry, ensureCustomField, findContactByCpf } from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { cleanDigits, normalizeCpfCell } from '@/lib/alvoconsig/import'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 20 * 1024 * 1024
const LIMITE_LINHAS_API = 2000
const CONCORRENCIA = 5

type Workbook = { headers: string[]; rows: unknown[][] }

// Helpers duplicados de propósito a partir de src/app/api/alvoconsig/upload/route.ts
// (são locais/não exportados por lá) — telas com regras opostas (cadastro
// nunca atualiza; oportunidades nunca cadastram), não vale a pena acoplar.
function lerPlanilha(buffer: Buffer): Workbook {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  const [headerRow, ...rows] = linhas
  const headers = Array.isArray(headerRow) ? headerRow.map((h) => String(h ?? '').trim()) : []
  return { headers, rows: rows.filter((r) => Array.isArray(r) && r.some((c) => c !== null && c !== '')) }
}

function celula(row: unknown[], idx: number | undefined) {
  if (idx === undefined || idx === null || idx < 0) return null
  return row[idx] ?? null
}

function slugSegmento(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x'
}

function phoneToE164(telefone: string | null | undefined): string | null {
  const d = String(telefone || '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  if (d.startsWith('55') && d.length >= 12) return `+${d}`
  if (d.length === 10 || d.length === 11) return `+55${d}`
  return `+${d}`
}

async function comConcorrenciaLimitada<T>(tarefas: Array<() => Promise<T>>, limite: number): Promise<T[]> {
  const resultados: T[] = []
  for (let i = 0; i < tarefas.length; i += limite) {
    resultados.push(...(await Promise.all(tarefas.slice(i, i + limite).map((t) => t()))))
  }
  return resultados
}

type CampoCadastro = { key: string; label: string; obrigatorio?: boolean }
const CAMPOS_CADASTRO: CampoCadastro[] = [
  { key: 'cpf', label: 'CPF', obrigatorio: true },
  { key: 'nome', label: 'Nome', obrigatorio: true },
  { key: 'sobrenome', label: 'Sobrenome', obrigatorio: true },
  { key: 'telefone', label: 'Telefone', obrigatorio: true },
  { key: 'email', label: 'E-mail' },
  { key: 'matricula', label: 'Matrícula' },
]

function sugerirMapeamentoCadastro(headers: string[]): Record<string, number> {
  const ALIASES: Record<string, string[]> = {
    cpf: ['cpf', 'documento', 'doc', 'cpf_cliente'],
    nome: ['nome', 'primeiro_nome', 'first_name', 'firstname'],
    sobrenome: ['sobrenome', 'ultimo_nome', 'last_name', 'lastname'],
    telefone: ['telefone', 'fone', 'celular', 'telefone1', 'tel', 'phone', 'whatsapp'],
    email: ['email', 'e-mail', 'mail'],
    matricula: ['matricula', 'matr', 'matricula_servidor'],
  }
  const normalizados = headers.map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())
  const sugestao: Record<string, number> = {}
  for (const campo of CAMPOS_CADASTRO) {
    const aliases = ALIASES[campo.key] || []
    const idx = normalizados.findIndex((h) => aliases.some((a) => h === a || h.includes(a)))
    if (idx >= 0) sugestao[campo.key] = idx
  }
  return sugestao
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    const allowed = await hasPermissionForUser(user.id, 'alvoconsig-gestao', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const fase = String(formData.get('fase') || 'analisar')
    const file = formData.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie um arquivo CSV ou XLSX.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Arquivo acima de 20MB.' }, { status: 400 })

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
    if (planilha.rows.length > LIMITE_LINHAS_API) {
      return NextResponse.json({ error: `O arquivo tem ${planilha.rows.length.toLocaleString('pt-BR')} linhas — acima de ${LIMITE_LINHAS_API.toLocaleString('pt-BR')} use a importação de CSV nativa direto na interface do WeSales.` }, { status: 400 })
    }

    if (fase === 'analisar') {
      return NextResponse.json({
        headers: planilha.headers,
        totalLinhas: planilha.rows.length,
        amostra: planilha.rows.slice(0, 5),
        sugestao: sugerirMapeamentoCadastro(planilha.headers),
        campos: CAMPOS_CADASTRO,
      })
    }

    // fase=importar
    let mapeamento: Record<string, number>
    try {
      mapeamento = JSON.parse(String(formData.get('mapeamento') || '{}'))
    } catch {
      return NextResponse.json({ error: 'Mapeamento de colunas inválido.' }, { status: 400 })
    }
    const convenioId = String(formData.get('convenio_id') || '').trim() || null
    if (!convenioId) return NextResponse.json({ error: 'Selecione o convênio.' }, { status: 400 })
    for (const campo of CAMPOS_CADASTRO) {
      if (campo.obrigatorio && mapeamento[campo.key] === undefined) {
        return NextResponse.json({ error: `Mapeie a coluna de ${campo.label}.` }, { status: 400 })
      }
    }

    const admin = await createAdminClient()
    const { data: convenio } = await admin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo_sistema')
      .eq('id', convenioId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (!convenio) return NextResponse.json({ error: 'Convênio não encontrado ou inativo.' }, { status: 400 })

    const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const inicioDoDiaIso = new Date(`${hojeBr}T00:00:00-03:00`).toISOString()
    const { count: cadastrosHoje } = await admin
      .from('crm_imports')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', 'cadastro')
      .eq('convenio_id', convenioId)
      .gte('created_at', inicioDoDiaIso)
    const baseTagSlug = `cadastro-${slugSegmento(convenio.nome_reduzido || convenio.nome)}-${hojeBr.replace(/-/g, '')}-${(cadastrosHoje || 0) + 1}`

    const { data: importRow, error: importError } = await admin
      .from('crm_imports')
      .insert({
        tipo: 'cadastro',
        arquivo_nome: String(file.name || 'cadastro').slice(0, 200),
        mapeamento: { ...mapeamento, _base_tag: baseTagSlug },
        convenio_id: convenioId,
        total_linhas: planilha.rows.length,
        criado_por: user.id,
      })
      .select('id')
      .single()
    if (importError || !importRow) return NextResponse.json({ error: 'Falha ao registrar o cadastro.' }, { status: 500 })

    const temMatricula = mapeamento.matricula !== undefined
    const fieldsAGarantir: Array<[string, string]> = [
      [WESALES_FIELD_KEYS.cpf, 'CPF'],
      [WESALES_FIELD_KEYS.convenioCodigo, 'Convênio (Código Workspace)'],
    ]
    if (convenio.nome_reduzido) fieldsAGarantir.push([WESALES_FIELD_KEYS.nomeConvenio, 'Convênio (Nome)'])
    if (temMatricula) fieldsAGarantir.push([WESALES_FIELD_KEYS.matricula, 'Matrícula Funcional'])

    let fieldDefs: Record<string, { id: string }>
    try {
      const resolved = await Promise.all(fieldsAGarantir.map(([key, name]) => ensureCustomField(key, name, 'contact')))
      fieldDefs = Object.fromEntries(fieldsAGarantir.map(([key], i) => [key, resolved[i]]))
    } catch (error: any) {
      await admin.from('crm_imports').update({ status: 'erro', erro: `Falha ao preparar campos no WeSales: ${error?.message || error}`, concluido_em: new Date().toISOString() }).eq('id', importRow.id)
      return NextResponse.json({ error: `Não foi possível preparar o WeSales: ${error?.message || error}` }, { status: 502 })
    }

    const tags = [tagBase(baseTagSlug), TAG_DISPONIVEL]
    let cadastrados = 0
    let ignoradosPorJaExistir = 0
    let descartados = 0
    const erros: string[] = []
    const vistos = new Set<string>()

    await comConcorrenciaLimitada(
      planilha.rows.map((row) => async () => {
        if (!Array.isArray(row)) return
        const cpf = normalizeCpfCell(celula(row, mapeamento.cpf))
        const nome = String(celula(row, mapeamento.nome) ?? '').trim()
        const sobrenome = String(celula(row, mapeamento.sobrenome) ?? '').trim()
        const telefone = phoneToE164(cleanDigits(celula(row, mapeamento.telefone)))
        if (!cpf || !nome || !sobrenome || !telefone || vistos.has(cpf)) {
          descartados += 1
          return
        }
        vistos.add(cpf)

        try {
          const existente = await findContactByCpf(cpf)
          if (existente) {
            // Regra de ouro desta tela: CPF que já existe é IGNORADO — nunca
            // atualiza/sobrescreve (diferente de Margem/REFIN/Elegibilidade).
            ignoradosPorJaExistir += 1
            return
          }
          const email = mapeamento.email !== undefined ? String(celula(row, mapeamento.email) ?? '').trim() || undefined : undefined
          const customFields: Array<{ id: string; fieldValue: string | number }> = [
            { id: fieldDefs[WESALES_FIELD_KEYS.cpf].id, fieldValue: cpf },
            { id: fieldDefs[WESALES_FIELD_KEYS.convenioCodigo].id, fieldValue: convenio.codigo_sistema as string },
          ]
          if (fieldDefs[WESALES_FIELD_KEYS.nomeConvenio]) {
            customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.nomeConvenio].id, fieldValue: String(convenio.nome_reduzido || convenio.nome) })
          }
          if (temMatricula) {
            const matricula = String(celula(row, mapeamento.matricula) ?? '').trim()
            if (matricula) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.matricula].id, fieldValue: matricula })
          }
          const { contact, duplicateOfId } = await createContact({
            firstName: nome,
            lastName: sobrenome,
            phone: telefone,
            email,
            tags,
            source: 'AlvoConsig — Cadastro de Leads',
            customFields,
          })
          const contactId = contact?.id || duplicateOfId
          if (!contactId) throw new Error('Criação bloqueada pela location (duplicado sem contactId).')
          if (contact) {
            cadastrados += 1
          } else {
            // Telefone já pertencia a outro contato (CPF não bateu, mas telefone sim) — não sobrescreve, só conta como ignorado.
            ignoradosPorJaExistir += 1
          }
        } catch (error: any) {
          erros.push(`CPF ${cpf}: ${error?.message || error}`)
        }
      }),
      CONCORRENCIA,
    )

    const status = erros.length > 0 && cadastrados === 0 ? 'erro' : 'concluido'
    await admin
      .from('crm_imports')
      .update({
        status,
        importadas: cadastrados,
        descartadas: descartados + ignoradosPorJaExistir + erros.length,
        erro: erros.length ? erros.slice(0, 20).join(' | ') : null,
        concluido_em: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    return NextResponse.json({
      importId: importRow.id,
      cadastrados,
      ignoradosPorJaExistir,
      descartados: descartados + erros.length,
      total: planilha.rows.length,
      baseTag: tagBase(baseTagSlug),
    })
  } catch (error) {
    console.error('Erro no cadastro de leads em lote:', error)
    return NextResponse.json({ error: 'Erro inesperado ao cadastrar os leads.' }, { status: 500 })
  }
}
