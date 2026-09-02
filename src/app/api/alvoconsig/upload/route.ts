/**
 * Importação de mailing do AlvoConsig — volume PEQUENO (≤ LIMITE_IMPORTACAO_API),
 * direto no WeSales via API, SEM persistir em crm_contatos (que agora é só
 * cópia de trabalho de campanha). Volume grande: CSV nativo na interface do
 * WeSales (mapeia pra campos personalizados + tag da base na hora do upload).
 *
 * Duas fases, ambas por upload do arquivo (CSV/XLSX):
 * - fase=analisar: lê cabeçalhos + amostra e devolve a sugestão de mapeamento.
 * - fase=importar: por linha, encontra/cria o contato por CPF no WeSales,
 *   grava os campos comuns e aplica as tags base:<slug> + disponivel.
 *   REFIN: cada linha vira uma OPORTUNIDADE (uma por oferta, decisão de
 *   24/08/2026 — ver docs/SPEC-CRM-WESALES-CAMPANHAS.md), não mais campos
 *   numerados no contato. Margem: grava a "foto" (valor/data/convênio) nos
 *   campos do contato — a oferta de verdade só nasce na campanha, calculada
 *   pelo coeficiente.
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
  createOpportunity,
  customFieldValue,
  ensureCustomField,
  findContactByCpf,
  findOpportunitiesByContactDetalhadas,
  normalizeCpfDigits,
  opportunityFieldValue,
  setContactsBusiness,
  updateContact,
  updateOpportunity,
  type WesalesContact,
  type WesalesOpportunity,
} from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MARGEM_FIELD_KEYS, MARGEM_FIELD_LABELS, OFERTA_FIELD_KEYS, OFERTA_FIELD_LABELS, nomeOportunidade, resolverPipelineOfertas, ETAPA_DISPONIVEL } from '@/lib/alvoconsig/ofertas-wesales'
import { resolverOuCriarConsignante } from '@/lib/alvoconsig/consignantes-wesales'
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
// Segurança contra planilha com linha duplicada em excesso pro mesmo CPF —
// não é mais limite de "slot" (oportunidade não tem teto técnico).
const MAX_OFERTAS_POR_CPF_POR_IMPORTACAO = 20
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

/** Um segmento de tag: minúsculo, sem acento, sem espaço — pra compor tags automáticas. */
function slugSegmento(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x'
}

/** Telefone BR de planilha (10-11 dígitos) → E.164 (+55...). */
function phoneToE164(telefone: string | null | undefined): string | null {
  const d = String(telefone || '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  if (d.startsWith('55') && d.length >= 12) return `+${d}`
  return `+55${d}`
}

/**
 * Taxa de juros pra exibição — a planilha pode trazer fração decimal
 * ("0.0238") ou já formatada ("2,38"); sempre devolve "2,38%". Incidente
 * 24/08/2026: taxa gravada crua aparecia como "0.0238" no WeSales.
 */
function formatarTaxaPercentual(bruto: string | null): string | null {
  if (!bruto) return null
  const numero = parseMoney(bruto.replace('%', '').trim())
  if (numero === null) return bruto.trim() || null
  const percentual = Math.abs(numero) < 1 ? numero * 100 : numero
  return `${percentual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`
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
    const tipo = String(formData.get('tipo') || '') as TipoImport

    if (tipo !== 'refin' && tipo !== 'margem') {
      return NextResponse.json({ error: 'Selecione o tipo de mailing.' }, { status: 400 })
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
    const convenioIdPadrao = String(formData.get('convenio_id') || '').trim() || null
    const instituicaoId = String(formData.get('instituicao_id') || '').trim() || null

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

    const { data: convenioSelecionado } = await admin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo_sistema, cnpj, razao_social, cidade, uf, cep, wesales_business_id')
      .eq('id', convenioIdPadrao)
      .maybeSingle()
    if (!convenioSelecionado) {
      return NextResponse.json({ error: 'Convênio não encontrado.' }, { status: 400 })
    }
    // Identidade do convênio gravada no WeSales: o código do sistema
    // (sequencial, sempre presente) — não o Código ARW, que é opcional e só
    // serve pro importador de comissionamento. Como o convênio já é
    // obrigatório na tela, todo contato desta importação usa o mesmo valor —
    // não há mais tentativa de casar um código por linha da planilha.
    const codigoConvenioPadrao = convenioSelecionado.codigo_sistema as string
    function codigoConvenioDaLinha(_row: unknown[]): string {
      return codigoConvenioPadrao
    }

    let instituicaoNome = ''
    if (tipo === 'refin') {
      const { data: inst } = await admin.from('financial_institutions').select('name').eq('id', instituicaoId).maybeSingle()
      instituicaoNome = inst?.name || ''
    }

    // Tag do WeSales SEMPRE gerada automaticamente (decisão 02/09/2026 —
    // deixou de ser texto livre digitado na tela): margem-<convênio>-<data>-
    // <numerador> ou refin-<convênio>-<instituição>-<data>-<numerador>. O
    // numerador desempata múltiplas importações do mesmo tipo/convênio no
    // mesmo dia — não precisa ser globalmente único, só legível nos relatórios.
    const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const inicioDoDiaIso = new Date(`${hojeBr}T00:00:00-03:00`).toISOString()
    const { count: importsHoje } = await admin
      .from('crm_imports')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', tipo)
      .eq('convenio_id', convenioIdPadrao)
      .gte('created_at', inicioDoDiaIso)
    const numerador = (importsHoje || 0) + 1
    const dataTag = hojeBr.replace(/-/g, '')
    const convenioSlug = slugSegmento(convenioSelecionado.nome_reduzido || convenioSelecionado.nome)
    const baseTagSlug = tipo === 'refin'
      ? `refin-${convenioSlug}-${slugSegmento(instituicaoNome)}-${dataTag}-${numerador}`
      : `margem-${convenioSlug}-${dataTag}-${numerador}`

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

    // Garante os campos personalizados de CONTATO que serão gravados (1x, fora do loop).
    const temNome = mapeamento.nome !== undefined
    const temTelefone = mapeamento.telefone !== undefined
    const temMatricula = mapeamento.matricula !== undefined
    const temConvenio = mapeamento.codigo_convenio !== undefined || !!codigoConvenioPadrao

    const fieldsContatoAGarantir: Array<[string, string]> = [[WESALES_FIELD_KEYS.cpf, 'CPF']]
    if (temMatricula) fieldsContatoAGarantir.push([WESALES_FIELD_KEYS.matricula, 'Matrícula Funcional'])
    if (temConvenio) {
      fieldsContatoAGarantir.push([WESALES_FIELD_KEYS.convenioCodigo, 'Convênio (Código Workspace)'])
      // nome_reduzido cadastrado no convênio — mesmo fieldKey que o CLT usa,
      // pra padronizar "nome do convênio" entre os dois fluxos (Bruno, 29/08).
      if (convenioSelecionado.nome_reduzido) {
        fieldsContatoAGarantir.push([WESALES_FIELD_KEYS.nomeConvenio, 'Convênio (Nome)'])
      }
    }
    if (tipo === 'margem') {
      // Convênio da margem NÃO é mais um campo por produto — é o mesmo
      // "Convênio (Código)"/"Convênio (Nome)" compartilhado acima (Bruno,
      // 29/08/2026): uma pessoa só tem um convênio por vez, não um por produto.
      if (mapeamento.margem_novo !== undefined) fieldsContatoAGarantir.push([MARGEM_FIELD_KEYS.novoValor, MARGEM_FIELD_LABELS.novoValor], [MARGEM_FIELD_KEYS.novoData, MARGEM_FIELD_LABELS.novoData])
      if (mapeamento.margem_cartao_rmc !== undefined) fieldsContatoAGarantir.push([MARGEM_FIELD_KEYS.rmcValor, MARGEM_FIELD_LABELS.rmcValor], [MARGEM_FIELD_KEYS.rmcData, MARGEM_FIELD_LABELS.rmcData])
      if (mapeamento.margem_cartao_rcc !== undefined) fieldsContatoAGarantir.push([MARGEM_FIELD_KEYS.rccValor, MARGEM_FIELD_LABELS.rccValor], [MARGEM_FIELD_KEYS.rccData, MARGEM_FIELD_LABELS.rccData])
    }

    let fieldDefs: Record<string, { id: string }>
    let ofertaFieldDefs: Record<string, { id: string }> = {}
    let pipelineOfertas: Awaited<ReturnType<typeof resolverPipelineOfertas>> | null = null
    try {
      const resolved = await Promise.all(fieldsContatoAGarantir.map(([key, name]) => ensureCustomField(key, name, 'contact')))
      fieldDefs = Object.fromEntries(fieldsContatoAGarantir.map(([key], i) => [key, resolved[i]]))

      if (tipo === 'refin') {
        const entradasOferta = Object.entries(OFERTA_FIELD_KEYS) as Array<[keyof typeof OFERTA_FIELD_KEYS, string]>
        const resolvedOferta = await Promise.all(entradasOferta.map(([campo, key]) => ensureCustomField(key, OFERTA_FIELD_LABELS[campo], 'opportunity')))
        ofertaFieldDefs = Object.fromEntries(entradasOferta.map(([, key], i) => [key, resolvedOferta[i]]))
        pipelineOfertas = await resolverPipelineOfertas()
      }
    } catch (error: any) {
      await admin.from('crm_imports').update({ status: 'erro', erro: `Falha ao preparar campos/pipeline no WeSales: ${error?.message || error}`, concluido_em: new Date().toISOString() }).eq('id', importRow.id)
      return NextResponse.json({ error: `Não foi possível preparar o WeSales: ${error?.message || error}` }, { status: 502 })
    }

    // Consignante/Empregador do convênio no WeSales — não bloqueia a
    // importação se falhar (contatos/ofertas continuam sendo o essencial);
    // só fica sem o vínculo de Empresa desta vez.
    let consignanteBusinessId: string | null = null
    try {
      consignanteBusinessId = await resolverOuCriarConsignante(admin, convenioSelecionado)
    } catch (error: any) {
      console.error('Falha ao resolver Consignante/Empregador no WeSales:', error?.message || error)
    }
    const contactIdsTocados: string[] = []

    const tags = [tagBase(baseTagSlug), TAG_DISPONIVEL]
    let importadas = 0
    let descartadas = 0
    const erros: string[] = []

    /** Escreve os campos comuns (matrícula/convênio) + nome/telefone + tags no contato (cria se preciso). */
    async function gravarContato(cpf: string, row: unknown[], customFields: Array<{ id: string; fieldValue: string | number }>, existente: WesalesContact | null): Promise<string> {
      customFields.unshift({ id: fieldDefs[WESALES_FIELD_KEYS.cpf].id, fieldValue: normalizeCpfDigits(cpf) })
      if (temMatricula) {
        const valor = String(celula(row, mapeamento.matricula) ?? '').trim()
        // Preenche, mas NUNCA sobrescreve matrícula já registrada (decisão
        // 02/09/2026: importação de margem/REFIN é oportunidade, não cadastro
        // — quem manda no dado do lead é o Cadastro/a Atualização NVTI).
        const matriculaAtual = existente ? customFieldValue(existente, fieldDefs[WESALES_FIELD_KEYS.matricula].id) : null
        if (valor && !String(matriculaAtual || '').trim()) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.matricula].id, fieldValue: valor })
      }
      if (temConvenio) {
        const codigo = codigoConvenioDaLinha(row)
        if (codigo) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.convenioCodigo].id, fieldValue: codigo })
        const nomeReduzido = convenioSelecionado?.nome_reduzido as string | null
        if (nomeReduzido && fieldDefs[WESALES_FIELD_KEYS.nomeConvenio]) {
          customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.nomeConvenio].id, fieldValue: nomeReduzido })
        }
      }
      const nome = temNome ? String(celula(row, mapeamento.nome) ?? '').trim() : undefined
      const telefone = temTelefone ? cleanDigits(celula(row, mapeamento.telefone)) : ''

      if (existente) {
        await updateContact(existente.id, { customFields })
        await addContactTags(existente.id, tags)
        return existente.id
      }
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
      return contactId
    }

    if (tipo === 'margem') {
      // 1 "foto" de margem por pessoa — mantém o comportamento antigo (primeira linha do CPF ganha).
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

      const hoje = new Date().toISOString().slice(0, 10)
      // Convênio da margem: NÃO é mais gravado por produto aqui — é o mesmo
      // campo único "Convênio (Código/Nome)" que gravarContato() já escreve
      // pra todo contato tocado nesta importação (Bruno, 29/08/2026).
      const DUPLAS = {
        margem_novo: { valor: MARGEM_FIELD_KEYS.novoValor, data: MARGEM_FIELD_KEYS.novoData },
        margem_cartao_rmc: { valor: MARGEM_FIELD_KEYS.rmcValor, data: MARGEM_FIELD_KEYS.rmcData },
        margem_cartao_rcc: { valor: MARGEM_FIELD_KEYS.rccValor, data: MARGEM_FIELD_KEYS.rccData },
      } as const

      await comConcorrenciaLimitada(
        linhasValidas.map(({ cpf, row }) => async () => {
          try {
            // Margem é MONETORY e data é DATE no WeSales: mandar NÚMERO e
            // AAAA-MM-DD (string com vírgula viraria 123456; data BR dá 400).
            const customFields: Array<{ id: string; fieldValue: string | number }> = []
            for (const key of margensMapeadas) {
              const valor = parseMoney(celula(row, mapeamento[key]))
              if (valor === null) continue
              const dupla = DUPLAS[key]
              customFields.push({ id: fieldDefs[dupla.valor].id, fieldValue: valor })
              customFields.push({ id: fieldDefs[dupla.data].id, fieldValue: hoje })
            }
            const existente = await findContactByCpf(cpf)
            const contactId = await gravarContato(cpf, row, customFields, existente)
            contactIdsTocados.push(contactId)
            importadas += 1
          } catch (error: any) {
            erros.push(`CPF ${cpf}: ${error?.message || error}`)
          }
        }),
        CONCORRENCIA,
      )
    } else {
      // REFIN: agrupa por CPF (cada linha = uma oferta = uma Oportunidade).
      // Reimportar a MESMA oferta (mesma instituição+tabela) atualiza a
      // Oportunidade existente sem mexer na etapa (preserva o progresso do
      // atendimento) — só cria nova quando é oferta realmente inédita.
      type OfertaLinha = {
        tabela: string | null
        troco: number
        parcela: number | null
        prazo: number | null
        taxa: string | null
        parcelasPagas: string | null
        saldoDevedor: string | null
        contrato: string | null
        contratoElegivel: string | null
        seguroValor: string | null
        seguroSimNao: string | null
      }
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
        if (grupo.ofertas.length >= MAX_OFERTAS_POR_CPF_POR_IMPORTACAO) {
          descartadas += 1
          continue
        }
        const texto = (idx: number | undefined) => (idx !== undefined ? String(celula(row, idx) ?? '').trim() || null : null)
        grupo.ofertas.push({
          tabela: texto(mapeamento.refin_tabela),
          troco,
          parcela: mapeamento.refin_parcela !== undefined ? parseMoney(celula(row, mapeamento.refin_parcela)) : null,
          prazo: mapeamento.refin_prazo !== undefined ? parseIntSafe(celula(row, mapeamento.refin_prazo)) : null,
          taxa: texto(mapeamento.refin_taxa),
          parcelasPagas: texto(mapeamento.refin_parcelas_pagas),
          saldoDevedor: texto(mapeamento.refin_saldo_devedor),
          contrato: texto(mapeamento.refin_contrato),
          contratoElegivel: texto(mapeamento.refin_contrato_elegivel),
          seguroValor: texto(mapeamento.refin_seguro_valor),
          seguroSimNao: texto(mapeamento.refin_seguro_sim_nao),
        })
        gruposPorCpf.set(cpf, grupo)
      }

      const stageDisponivelId = pipelineOfertas!.stages[ETAPA_DISPONIVEL]?.id
      const pipelineId = pipelineOfertas!.pipeline.id
      const fCampo = (campo: keyof typeof OFERTA_FIELD_KEYS) => ofertaFieldDefs[OFERTA_FIELD_KEYS[campo]].id
      const digitsOrRaw = (v: string) => v.replace(/\D/g, '') || v

      await comConcorrenciaLimitada(
        [...gruposPorCpf.entries()].map(([cpf, { row, ofertas }]) => async () => {
          try {
            const existente = await findContactByCpf(cpf)
            const contactId = await gravarContato(cpf, row, [], existente)
            contactIdsTocados.push(contactId)

            const existentesNoPipeline = await findOpportunitiesByContactDetalhadas(contactId, pipelineId)
            const usadosNestaImportacao = new Set<string>()

            for (const oferta of ofertas) {
              const alvo = existentesNoPipeline.find((op) => {
                if (usadosNestaImportacao.has(op.id)) return false
                const tipoOp = opportunityFieldValue(op, fCampo('tipoOferta'))
                if (tipoOp !== 'refin') return false
                const instOp = opportunityFieldValue(op, fCampo('instituicaoId'))
                if (instOp !== instituicaoId) return false
                const tabelaOp = opportunityFieldValue(op, fCampo('tabelaCodigo'))
                if (!tabelaOp || !oferta.tabela) return false
                return digitsOrRaw(tabelaOp) === digitsOrRaw(oferta.tabela)
              })

              const customFields: Array<{ id: string; fieldValue: string }> = [
                { id: fCampo('tipoOferta'), fieldValue: 'refin' },
                { id: fCampo('instituicaoId'), fieldValue: instituicaoId! },
                { id: fCampo('instituicao'), fieldValue: instituicaoNome },
              ]
              if (oferta.parcela !== null) customFields.push({ id: fCampo('parcela'), fieldValue: String(oferta.parcela) })
              if (oferta.prazo !== null) customFields.push({ id: fCampo('prazo'), fieldValue: String(oferta.prazo) })
              const taxaFormatada = formatarTaxaPercentual(oferta.taxa)
              if (taxaFormatada) customFields.push({ id: fCampo('taxa'), fieldValue: taxaFormatada })
              if (oferta.tabela) customFields.push({ id: fCampo('tabelaCodigo'), fieldValue: oferta.tabela })
              if (oferta.parcelasPagas) customFields.push({ id: fCampo('parcelasPagas'), fieldValue: oferta.parcelasPagas })
              if (oferta.saldoDevedor) customFields.push({ id: fCampo('saldoDevedor'), fieldValue: oferta.saldoDevedor })
              if (oferta.contrato) customFields.push({ id: fCampo('contrato'), fieldValue: oferta.contrato })
              if (oferta.contratoElegivel) customFields.push({ id: fCampo('contratoElegivel'), fieldValue: oferta.contratoElegivel })
              if (oferta.seguroValor) customFields.push({ id: fCampo('seguroValor'), fieldValue: oferta.seguroValor })
              if (oferta.seguroSimNao) customFields.push({ id: fCampo('seguroSimNao'), fieldValue: oferta.seguroSimNao })

              if (alvo) {
                usadosNestaImportacao.add(alvo.id)
                // Só valor/campos — NUNCA mexe na etapa (preserva progresso do atendimento).
                await updateOpportunity(alvo.id, { monetaryValue: oferta.troco, customFields })
              } else {
                const nova = await createOpportunity({
                  contactId,
                  pipelineId,
                  pipelineStageId: stageDisponivelId,
                  name: nomeOportunidade('refin', instituicaoNome, oferta.tabela),
                  monetaryValue: oferta.troco,
                  customFields,
                })
                existentesNoPipeline.push(nova)
                usadosNestaImportacao.add(nova.id)
              }
              importadas += 1
            }
          } catch (error: any) {
            erros.push(`CPF ${cpf}: ${error?.message || error}`)
          }
        }),
        CONCORRENCIA,
      )
    }

    // Vincula todos os contatos tocados nesta importação ao Consignante do
    // convênio — em lotes de 50 (limite da API), bem mais leve que um
    // vínculo por contato dentro do loop de concorrência acima.
    if (consignanteBusinessId && contactIdsTocados.length) {
      try {
        await setContactsBusiness(contactIdsTocados, consignanteBusinessId)
      } catch (error: any) {
        console.error('Falha ao vincular contatos ao Consignante/Empregador no WeSales:', error?.message || error)
      }
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
