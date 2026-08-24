/**
 * Importação de mailing do AlvoConsig — volume PEQUENO (≤ LIMITE_IMPORTACAO_API),
 * direto no WeSales via API, SEM persistir em crm_contatos (que agora é só
 * cópia de trabalho de campanha). Volume grande: CSV nativo na interface do
 * WeSales (mapeia pra campos personalizados + tag da base na hora do upload).
 *
 * Duas fases, ambas por upload do arquivo (CSV/XLSX):
 * - fase=analisar: lê cabeçalhos + amostra e devolve a sugestão de mapeamento.
 * - fase=importar: por linha, encontra/cria o contato por CPF no WeSales,
 *   grava os campos personalizados e aplica as tags base:<slug> + disponivel
 *   (aditivas — nunca removem tags existentes). REFIN: só linhas com troco > 0.
 *
 * Exige alvoconsig-gestao (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  addContactTags,
  createContact,
  ensureCustomField,
  findContactByCpf,
  normalizeCpfDigits,
  updateContact,
} from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
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
const LIMITE_LINHAS_API = 2000
const CONCORRENCIA = 10

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

/** Telefone BR de planilha (10-11 dígitos) → E.164 (+55...). */
function phoneToE164(telefone: string | null | undefined): string | null {
  const d = String(telefone || '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  if (d.startsWith('55') && d.length >= 12) return `+${d}`
  return `+55${d}`
}

/** Executa `tarefas` com no máximo `limite` em paralelo. */
async function comConcorrenciaLimitada<T>(tarefas: Array<() => Promise<T>>, limite: number): Promise<T[]> {
  const resultados: T[] = new Array(tarefas.length)
  let indice = 0
  async function worker() {
    while (indice < tarefas.length) {
      const i = indice++
      resultados[i] = await tarefas[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, worker))
  return resultados
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
    if (planilha.rows.length > LIMITE_LINHAS_API) {
      return NextResponse.json(
        {
          error: `O arquivo tem ${planilha.rows.length.toLocaleString('pt-BR')} linhas — acima de ${LIMITE_LINHAS_API.toLocaleString('pt-BR')} use a importação de CSV nativa direto na interface do WeSales (mais rápida para volume grande).`,
        },
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
    const baseTagSlug = String(formData.get('base_tag') || '').trim()
    const convenioIdPadrao = String(formData.get('convenio_id') || '').trim() || null

    if (!baseTagSlug) {
      return NextResponse.json({ error: 'Informe a base (tag) que os leads vão receber no WeSales.' }, { status: 400 })
    }
    if (mapeamento.cpf === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna de CPF.' }, { status: 400 })
    }
    if (tipo === 'refin' && mapeamento.refin_troco === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna do Valor do Troco (REFIN).' }, { status: 400 })
    }
    const margensMapeadas = (['margem_novo', 'margem_cartao_rmc', 'margem_cartao_rcc'] as const).filter((key) => mapeamento[key] !== undefined)
    if (tipo === 'margem' && margensMapeadas.length === 0) {
      return NextResponse.json({ error: 'Mapeie ao menos uma coluna de margem.' }, { status: 400 })
    }

    const admin = await createAdminClient()

    let codigoConvenioPadrao: string | null = null
    if (convenioIdPadrao) {
      const { data } = await admin.from('convenios').select('codigo').eq('id', convenioIdPadrao).maybeSingle()
      codigoConvenioPadrao = data?.codigo || null
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

    // Garante os campos personalizados que serão gravados (1x, fora do loop).
    const temNome = mapeamento.nome !== undefined
    const temTelefone = mapeamento.telefone !== undefined
    const temMatricula = mapeamento.matricula !== undefined
    const temConvenio = mapeamento.codigo_convenio !== undefined || !!codigoConvenioPadrao

    const fieldsAGarantir: Array<[string, string]> = [[WESALES_FIELD_KEYS.cpf, 'CPF']]
    if (temMatricula) fieldsAGarantir.push([WESALES_FIELD_KEYS.matricula, 'AlvoConsig — Matrícula'])
    if (temConvenio) fieldsAGarantir.push([WESALES_FIELD_KEYS.convenioCodigo, 'AlvoConsig — Código do Convênio'])
    if (tipo === 'margem') {
      if (mapeamento.margem_novo !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.margemNovo, 'AlvoConsig — Margem Novo'])
      if (mapeamento.margem_cartao_rmc !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.margemCartaoRmc, 'AlvoConsig — Margem Cartão RMC'])
      if (mapeamento.margem_cartao_rcc !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.margemCartaoRcc, 'AlvoConsig — Margem Cartão RCC'])
    } else {
      fieldsAGarantir.push([WESALES_FIELD_KEYS.refinTroco, 'AlvoConsig — Refin Troco'])
      if (mapeamento.refin_parcela !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.refinParcela, 'AlvoConsig — Refin Parcela'])
      if (mapeamento.refin_prazo !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.refinPrazo, 'AlvoConsig — Refin Prazo'])
      if (mapeamento.refin_taxa !== undefined) fieldsAGarantir.push([WESALES_FIELD_KEYS.refinTaxa, 'AlvoConsig — Refin Taxa'])
    }

    let fieldDefs: Record<string, { id: string }>
    try {
      const resolved = await Promise.all(fieldsAGarantir.map(([key, name]) => ensureCustomField(key, name)))
      fieldDefs = Object.fromEntries(fieldsAGarantir.map(([key], i) => [key, resolved[i]]))
    } catch (error: any) {
      await admin.from('crm_imports').update({ status: 'erro', erro: `Falha ao preparar campos no WeSales: ${error?.message || error}`, concluido_em: new Date().toISOString() }).eq('id', importRow.id)
      return NextResponse.json({ error: `Não foi possível preparar os campos no WeSales: ${error?.message || error}` }, { status: 502 })
    }

    const vistos = new Set<string>()
    const linhasValidas: Array<{ cpf: string; row: unknown[] }> = []
    let descartadas = 0

    for (const row of planilha.rows) {
      if (!Array.isArray(row)) continue
      const cpf = normalizeCpfCell(celula(row, mapeamento.cpf))
      if (!cpf || vistos.has(cpf)) {
        descartadas += 1
        continue
      }
      if (tipo === 'refin') {
        const troco = parseMoney(celula(row, mapeamento.refin_troco))
        if (troco === null || troco <= 0) {
          descartadas += 1
          continue
        }
      } else {
        const algumaMargem = margensMapeadas.some((key) => parseMoney(celula(row, mapeamento[key])) !== null)
        if (!algumaMargem) {
          descartadas += 1
          continue
        }
      }
      vistos.add(cpf)
      linhasValidas.push({ cpf, row })
    }

    const tags = [tagBase(baseTagSlug), TAG_DISPONIVEL]
    let importadas = 0
    const erros: string[] = []

    await comConcorrenciaLimitada(
      linhasValidas.map(({ cpf, row }) => async () => {
        try {
          const customFields = [{ id: fieldDefs[WESALES_FIELD_KEYS.cpf].id, fieldValue: normalizeCpfDigits(cpf) }]

          if (temMatricula) {
            const valor = String(celula(row, mapeamento.matricula) ?? '').trim()
            if (valor) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.matricula].id, fieldValue: valor })
          }
          if (temConvenio) {
            const codigo = String(celula(row, mapeamento.codigo_convenio) ?? '').trim() || codigoConvenioPadrao || ''
            if (codigo) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.convenioCodigo].id, fieldValue: codigo })
          }
          if (tipo === 'margem') {
            for (const key of margensMapeadas) {
              const valor = parseMoney(celula(row, mapeamento[key]))
              const fieldKey = key === 'margem_novo' ? WESALES_FIELD_KEYS.margemNovo : key === 'margem_cartao_rmc' ? WESALES_FIELD_KEYS.margemCartaoRmc : WESALES_FIELD_KEYS.margemCartaoRcc
              if (valor !== null) customFields.push({ id: fieldDefs[fieldKey].id, fieldValue: String(valor) })
            }
          } else {
            const troco = parseMoney(celula(row, mapeamento.refin_troco))
            customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.refinTroco].id, fieldValue: String(troco) })
            if (mapeamento.refin_parcela !== undefined) {
              const parcela = parseMoney(celula(row, mapeamento.refin_parcela))
              if (parcela !== null) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.refinParcela].id, fieldValue: String(parcela) })
            }
            if (mapeamento.refin_prazo !== undefined) {
              const prazo = parseIntSafe(celula(row, mapeamento.refin_prazo))
              if (prazo !== null) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.refinPrazo].id, fieldValue: String(prazo) })
            }
            if (mapeamento.refin_taxa !== undefined) {
              const taxa = String(celula(row, mapeamento.refin_taxa) ?? '').trim()
              if (taxa) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.refinTaxa].id, fieldValue: taxa })
            }
          }

          const nome = temNome ? String(celula(row, mapeamento.nome) ?? '').trim() : undefined
          const telefone = temTelefone ? cleanDigits(celula(row, mapeamento.telefone)) : ''

          const existente = await findContactByCpf(cpf)
          if (existente) {
            await updateContact(existente.id, { customFields })
            await addContactTags(existente.id, tags)
          } else {
            const { contact, duplicateOfId } = await createContact({
              name: nome || undefined,
              phone: phoneToE164(telefone),
              tags,
              source: 'AlvoConsig — Importação API',
              customFields,
            })
            const contactId = contact?.id || duplicateOfId
            if (!contactId) throw new Error('Criação bloqueada pela location (duplicado sem contactId).')
            if (!contact) {
              // Telefone já pertence a outro contato: vincula sem sobrescrever nome/telefone.
              await updateContact(contactId, { customFields })
              await addContactTags(contactId, tags)
            }
          }
          importadas += 1
        } catch (error: any) {
          erros.push(`CPF ${cpf}: ${error?.message || error}`)
        }
      }),
      CONCORRENCIA,
    )

    const status = erros.length > 0 && importadas === 0 ? 'erro' : 'concluido'
    await admin
      .from('crm_imports')
      .update({
        status,
        importadas,
        descartadas: descartadas + erros.length,
        erro: erros.length ? erros.slice(0, 20).join(' | ') : null,
        concluido_em: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    return NextResponse.json({
      importId: importRow.id,
      importadas,
      descartadas: descartadas + erros.length,
      total: planilha.rows.length,
      baseTag: tagBase(baseTagSlug),
    })
  } catch (error) {
    console.error('Erro no upload de mailing AlvoConsig:', error)
    return NextResponse.json({ error: 'Erro inesperado ao importar o mailing.' }, { status: 500 })
  }
}
