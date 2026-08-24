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
  customFieldValue,
  ensureCustomField,
  findContactByCpf,
  normalizeCpfDigits,
  updateContact,
  type WesalesContact,
} from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MAX_OFERTAS_REFIN, digitsOrRaw, refinSlotFieldKey, refinSlotFieldName, todosOsSlotsECampos } from '@/lib/alvoconsig/refin-slots'
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
// Reduzido de 10 pra 5 após incidente de 429 (24/08/2026) — o client já tenta
// de novo com backoff (src/lib/wesales/client.ts), mas menos rajada = menos
// tempo perdido em retry.
const CONCORRENCIA = 5

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
    const instituicaoId = String(formData.get('instituicao_id') || '').trim() || null

    if (!baseTagSlug) {
      return NextResponse.json({ error: 'Informe a base (tag) que os leads vão receber no WeSales.' }, { status: 400 })
    }
    if (!convenioIdPadrao) {
      return NextResponse.json({ error: 'Selecione o convênio — obrigatório para margem e REFIN.' }, { status: 400 })
    }
    if (mapeamento.cpf === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna de CPF.' }, { status: 400 })
    }
    if (tipo === 'refin' && mapeamento.refin_troco === undefined) {
      return NextResponse.json({ error: 'Mapeie a coluna do Valor do Troco (REFIN).' }, { status: 400 })
    }
    if (tipo === 'refin' && !instituicaoId) {
      return NextResponse.json({ error: 'Importação de REFIN exige a Instituição Financeira — a planilha não traz banco por linha, então é informada uma vez para o arquivo inteiro.' }, { status: 400 })
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

    // Normaliza o código do convênio antes de gravar no WeSales: a busca por
    // convênio (campanha sem base) compara por igualdade exata contra
    // convenios.codigo — gravar o texto cru da planilha (zeros à esquerda,
    // espaço, .0 de Excel etc.) faz essa comparação nunca bater.
    const { data: conveniosParaNormalizar } = await admin.from('convenios').select('codigo').is('deleted_at', null)
    const codigoCanonicoPorDigitos = new Map<string, string>()
    for (const conv of conveniosParaNormalizar || []) {
      if (conv.codigo) codigoCanonicoPorDigitos.set(cleanDigits(conv.codigo) || conv.codigo, conv.codigo)
    }
    function normalizarCodigoConvenio(bruto: string): string {
      if (!bruto) return bruto
      return codigoCanonicoPorDigitos.get(cleanDigits(bruto) || bruto) || bruto
    }

    const { data: importRow, error: importError } = await admin
      .from('crm_imports')
      .insert({
        tipo,
        arquivo_nome: String(file.name || 'mailing').slice(0, 200),
        // _base_tag: sem coluna/migration nova — o seletor de Campanhas lê daqui
        // (getBasesImportadas) pra oferecer as bases já conhecidas sem digitação livre.
        mapeamento: { ...mapeamento, _base_tag: baseTagSlug },
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
      // REFIN: até MAX_OFERTAS_REFIN ofertas por CPF, cada uma em seu "slot" de
      // 6 campos (troco/parcela/prazo/taxa/tabela/instituição) — nunca sobrescreve
      // outra oferta do mesmo CPF. Ver src/lib/alvoconsig/refin-slots.ts.
      for (const { slot, campo } of todosOsSlotsECampos()) {
        fieldsAGarantir.push([refinSlotFieldKey(slot, campo), refinSlotFieldName(slot, campo)])
      }
    }

    let fieldDefs: Record<string, { id: string }>
    try {
      const resolved = await Promise.all(fieldsAGarantir.map(([key, name]) => ensureCustomField(key, name)))
      fieldDefs = Object.fromEntries(fieldsAGarantir.map(([key], i) => [key, resolved[i]]))
    } catch (error: any) {
      await admin.from('crm_imports').update({ status: 'erro', erro: `Falha ao preparar campos no WeSales: ${error?.message || error}`, concluido_em: new Date().toISOString() }).eq('id', importRow.id)
      return NextResponse.json({ error: `Não foi possível preparar os campos no WeSales: ${error?.message || error}` }, { status: 502 })
    }

    const tags = [tagBase(baseTagSlug), TAG_DISPONIVEL]
    let importadas = 0
    let descartadas = 0
    const erros: string[] = []

    /** Escreve os campos comuns (matrícula/convênio) + nome/telefone + tags no contato (cria se preciso). */
    async function gravarContato(cpf: string, row: unknown[], customFields: Array<{ id: string; fieldValue: string }>, existente: WesalesContact | null) {
      customFields.unshift({ id: fieldDefs[WESALES_FIELD_KEYS.cpf].id, fieldValue: normalizeCpfDigits(cpf) })
      if (temMatricula) {
        const valor = String(celula(row, mapeamento.matricula) ?? '').trim()
        if (valor) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.matricula].id, fieldValue: valor })
      }
      if (temConvenio) {
        const codigo = normalizarCodigoConvenio(String(celula(row, mapeamento.codigo_convenio) ?? '').trim() || codigoConvenioPadrao || '')
        if (codigo) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.convenioCodigo].id, fieldValue: codigo })
      }
      const nome = temNome ? String(celula(row, mapeamento.nome) ?? '').trim() : undefined
      const telefone = temTelefone ? cleanDigits(celula(row, mapeamento.telefone)) : ''

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
    }

    if (tipo === 'margem') {
      // 1 oferta por pessoa — mantém o comportamento antigo (primeira linha do CPF ganha).
      const vistos = new Set<string>()
      const linhasValidas: Array<{ cpf: string; row: unknown[] }> = []
      for (const row of planilha.rows) {
        if (!Array.isArray(row)) continue
        const cpf = normalizeCpfCell(celula(row, mapeamento.cpf))
        if (!cpf || vistos.has(cpf)) {
          descartadas += 1
          continue
        }
        const algumaMargem = margensMapeadas.some((key) => parseMoney(celula(row, mapeamento[key])) !== null)
        if (!algumaMargem) {
          descartadas += 1
          continue
        }
        vistos.add(cpf)
        linhasValidas.push({ cpf, row })
      }

      await comConcorrenciaLimitada(
        linhasValidas.map(({ cpf, row }) => async () => {
          try {
            const customFields: Array<{ id: string; fieldValue: string }> = []
            for (const key of margensMapeadas) {
              const valor = parseMoney(celula(row, mapeamento[key]))
              const fieldKey = key === 'margem_novo' ? WESALES_FIELD_KEYS.margemNovo : key === 'margem_cartao_rmc' ? WESALES_FIELD_KEYS.margemCartaoRmc : WESALES_FIELD_KEYS.margemCartaoRcc
              if (valor !== null) customFields.push({ id: fieldDefs[fieldKey].id, fieldValue: String(valor) })
            }
            const existente = await findContactByCpf(cpf)
            await gravarContato(cpf, row, customFields, existente)
            importadas += 1
          } catch (error: any) {
            erros.push(`CPF ${cpf}: ${error?.message || error}`)
          }
        }),
        CONCORRENCIA,
      )
    } else {
      // REFIN: agrupa por CPF (até MAX_OFERTAS_REFIN linhas/ofertas), aloca slot
      // por (instituição, tabela) — reimportação da MESMA oferta atualiza o slot
      // em vez de duplicar.
      type OfertaLinha = { tabela: string | null; troco: number; parcela: number | null; prazo: number | null; taxa: string | null }
      const gruposPorCpf = new Map<string, { row: unknown[]; ofertas: OfertaLinha[] }>()
      for (const row of planilha.rows) {
        if (!Array.isArray(row)) continue
        const cpf = normalizeCpfCell(celula(row, mapeamento.cpf))
        const troco = parseMoney(celula(row, mapeamento.refin_troco))
        if (!cpf || troco === null || troco <= 0) {
          descartadas += 1
          continue
        }
        const grupo = gruposPorCpf.get(cpf) || { row, ofertas: [] }
        if (grupo.ofertas.length >= MAX_OFERTAS_REFIN) {
          descartadas += 1
          continue
        }
        grupo.ofertas.push({
          tabela: mapeamento.refin_tabela !== undefined ? String(celula(row, mapeamento.refin_tabela) ?? '').trim() || null : null,
          troco,
          parcela: mapeamento.refin_parcela !== undefined ? parseMoney(celula(row, mapeamento.refin_parcela)) : null,
          prazo: mapeamento.refin_prazo !== undefined ? parseIntSafe(celula(row, mapeamento.refin_prazo)) : null,
          taxa: mapeamento.refin_taxa !== undefined ? String(celula(row, mapeamento.refin_taxa) ?? '').trim() || null : null,
        })
        gruposPorCpf.set(cpf, grupo)
      }

      await comConcorrenciaLimitada(
        [...gruposPorCpf.entries()].map(([cpf, { row, ofertas }]) => async () => {
          try {
            const existente = await findContactByCpf(cpf)

            // Slots já ocupados (instituição + tabela) neste contato, se já existir.
            const slotsOcupados = Array.from({ length: MAX_OFERTAS_REFIN }, (_, i) => i + 1).map((slot) => ({
              slot,
              instituicaoId: existente ? customFieldValue(existente, fieldDefs[refinSlotFieldKey(slot, 'instituicao')].id) : null,
              tabelaCodigo: existente ? customFieldValue(existente, fieldDefs[refinSlotFieldKey(slot, 'tabela')].id) : null,
            }))
            const usadosNestaImportacao = new Set<number>()

            const customFields: Array<{ id: string; fieldValue: string }> = []
            let algumaOfertaGravada = 0
            for (const oferta of ofertas) {
              let alvo = slotsOcupados.find(
                (s) =>
                  !usadosNestaImportacao.has(s.slot) &&
                  s.instituicaoId === instituicaoId &&
                  s.tabelaCodigo &&
                  oferta.tabela &&
                  digitsOrRaw(s.tabelaCodigo) === digitsOrRaw(oferta.tabela),
              )
              if (!alvo) alvo = slotsOcupados.find((s) => !usadosNestaImportacao.has(s.slot) && !s.tabelaCodigo)
              if (!alvo) {
                erros.push(`CPF ${cpf}: sem slot livre (5 ofertas já ocupadas) para a oferta da tabela "${oferta.tabela || '(sem código)'}"`)
                continue
              }
              usadosNestaImportacao.add(alvo.slot)
              customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'troco')].id, fieldValue: String(oferta.troco) })
              if (oferta.parcela !== null) customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'parcela')].id, fieldValue: String(oferta.parcela) })
              if (oferta.prazo !== null) customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'prazo')].id, fieldValue: String(oferta.prazo) })
              if (oferta.taxa) customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'taxa')].id, fieldValue: oferta.taxa })
              if (oferta.tabela) customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'tabela')].id, fieldValue: oferta.tabela })
              customFields.push({ id: fieldDefs[refinSlotFieldKey(alvo.slot, 'instituicao')].id, fieldValue: instituicaoId! })
              algumaOfertaGravada += 1
            }
            if (algumaOfertaGravada === 0) {
              descartadas += ofertas.length
              return
            }
            await gravarContato(cpf, row, customFields, existente)
            importadas += algumaOfertaGravada
          } catch (error: any) {
            erros.push(`CPF ${cpf}: ${error?.message || error}`)
          }
        }),
        CONCORRENCIA,
      )
    }

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
