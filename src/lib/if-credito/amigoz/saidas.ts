/**
 * Saídas do lote de Higienização Amigoz: planilha, envio à NVTI (só quem tem
 * margem/oportunidade) e atualização do WeSales. SÓ servidor.
 *
 * IMPORTANTE (decisão de arquitetura, 15/09): "Atualizar WeSales" grava só a
 * MARGEM (valor + data), exatamente como a importação de margem por planilha
 * já faz (`src/app/api/alvoconsig/upload/route.ts`, tipo='margem') — usa os
 * MESMOS campos (`MARGEM_FIELD_KEYS`) e NÃO cria Oportunidade. A oferta real
 * (coeficiente × margem, com comissão) já nasce na campanha do AlvoConsig
 * (`src/app/api/alvoconsig/campanhas/route.ts`), que lê esses mesmos campos —
 * criar Oportunidade aqui duplicaria esse cálculo com uma regra diferente
 * (sem coeficiente/tabela). O roteiro original previa criar 1 Oportunidade
 * por item; ficou substituído por isso, que é mais consistente com o resto
 * do sistema (margem de qualquer origem se comporta igual).
 */
import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/server'
import { kickNvtiWorker } from '@/lib/nvti/worker'
import { gravarConvenioDoLoteSeVazio, type ConvenioDoLote } from '@/lib/nvti/convenio-lote'
import { WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { ETAPA_DISPONIVEL, MARGEM_FIELD_KEYS, MARGEM_FIELD_LABELS, OFERTA_FIELD_KEYS, OFERTA_FIELD_LABELS, nomeOportunidade, resolverPipelineOfertas } from '@/lib/alvoconsig/ofertas-wesales'
import {
  createOpportunity,
  customFieldEntry,
  customFieldValue,
  ensureCustomField,
  findContactByCpf,
  findOpportunitiesByContactDetalhadas,
  getContact,
  opportunityFieldValue,
  resolveCustomField,
  updateContact,
  updateOpportunity,
  type CustomFieldDef,
} from '@/lib/wesales/client'
import type { OfertaNormalizada } from '../ofertas'
import { obterLote } from './lote'

export async function gerarPlanilhaLote(loteId: string): Promise<Buffer> {
  const admin = await createAdminClient()
  const { data: itens, error } = await admin
    .from('if_higienizacao_itens')
    .select('*')
    .eq('lote_id', loteId)
    .order('ordem', { ascending: true })
  if (error) throw new Error(error.message)

  const linhas = (itens || []).map((it) => ({
    CPF: String(it.cpf),
    'Nome (entrada)': it.nome || '',
    'Nome (Amigoz)': it.nome_if || '',
    'Nascimento (Amigoz)': it.nascimento_if || '',
    'Matrícula (Amigoz)': it.matricula_if || '',
    'Margem Consignado (Cartão RMC)': it.margem_consignado ?? '',
    'Margem Benefício — Compra 30%': it.margem_beneficio_compra ?? '',
    'Margem Benefício — Saque 70%': it.margem_beneficio_saque ?? '',
    'Margem Benefício (Cartão RCC)': it.margem_beneficio ?? '',
    'Margem Empréstimo (Novo)': it.margem_emprestimo ?? '',
    'Tem oportunidade': it.tem_oportunidade === null ? '' : it.tem_oportunidade ? 'Sim' : 'Não',
    'Variante do Amigoz usada': it.convenio_externo_usado || '',
    Status: it.status,
    Erro: it.erro || '',
    'Consultado em': it.consultado_em ? new Date(String(it.consultado_em)).toLocaleString('pt-BR') : '',
  }))

  const planilha = XLSX.utils.json_to_sheet(linhas)
  const livro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(livro, planilha, 'Higienização Amigoz')
  return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Envia à NVTI só os CPFs com margem/oportunidade encontrada (a NVTI é quem cadastra no WeSales). */
export async function enviarParaNvti(loteId: string, criadoPor: string): Promise<{ enviados: number }> {
  const lote = await obterLote(loteId)
  if (!lote) throw new Error('Lote não encontrado.')
  const admin = await createAdminClient()

  const { data: itens, error } = await admin
    .from('if_higienizacao_itens')
    .select('id, cpf')
    .eq('lote_id', loteId)
    .eq('tem_oportunidade', true)
    .is('nvti_enviado_em', null)
  if (error) throw new Error(error.message)
  if (!itens || itens.length === 0) return { enviados: 0 }

  const { data: batch, error: batchError } = await admin
    .from('nvti_batches')
    .insert({
      file_name: `Higienização Amigoz — lote ${loteId.slice(0, 8)}`,
      convenio_id: lote.convenioId,
      created_by: criadoPor,
      total: itens.length,
    })
    .select('id')
    .single()
  if (batchError || !batch) throw new Error(batchError?.message || 'Falha ao criar o lote de higienização NVTI.')

  const TAMANHO_CHUNK = 500
  for (let i = 0; i < itens.length; i += TAMANHO_CHUNK) {
    const chunk = itens.slice(i, i + TAMANHO_CHUNK).map((it) => ({ batch_id: batch.id, cpf: it.cpf }))
    const { error: itemError } = await admin.from('nvti_batch_items').insert(chunk)
    if (itemError) throw new Error(`Falha ao gravar itens do lote NVTI: ${itemError.message}`)
  }

  await admin
    .from('if_higienizacao_itens')
    .update({ nvti_enviado_em: new Date().toISOString() })
    .in(
      'id',
      itens.map((it) => it.id)
    )

  await kickNvtiWorker()
  return { enviados: itens.length }
}

type CamposMargem = {
  novoValor: CustomFieldDef
  novoData: CustomFieldDef
  rmcValor: CustomFieldDef
  rmcData: CustomFieldDef
  rccValor: CustomFieldDef
  rccData: CustomFieldDef
  matricula: CustomFieldDef | null
}

async function resolverCamposMargem(): Promise<CamposMargem> {
  const [novoValor, novoData, rmcValor, rmcData, rccValor, rccData, matricula] = await Promise.all([
    resolveCustomField(MARGEM_FIELD_KEYS.novoValor),
    resolveCustomField(MARGEM_FIELD_KEYS.novoData),
    resolveCustomField(MARGEM_FIELD_KEYS.rmcValor),
    resolveCustomField(MARGEM_FIELD_KEYS.rmcData),
    resolveCustomField(MARGEM_FIELD_KEYS.rccValor),
    resolveCustomField(MARGEM_FIELD_KEYS.rccData),
    resolveCustomField(WESALES_FIELD_KEYS.matricula),
  ])
  const faltando: string[] = []
  if (!novoValor) faltando.push(MARGEM_FIELD_LABELS.novoValor)
  if (!novoData) faltando.push(MARGEM_FIELD_LABELS.novoData)
  if (!rmcValor) faltando.push(MARGEM_FIELD_LABELS.rmcValor)
  if (!rmcData) faltando.push(MARGEM_FIELD_LABELS.rmcData)
  if (!rccValor) faltando.push(MARGEM_FIELD_LABELS.rccValor)
  if (!rccData) faltando.push(MARGEM_FIELD_LABELS.rccData)
  if (faltando.length) {
    throw new Error(`Campo(s) de margem não encontrados no WeSales: ${faltando.join(', ')}. Eles já deveriam existir (mesmos campos usados pela importação de margem) — confira em Configurações › Campos Personalizados.`)
  }
  return { novoValor: novoValor!, novoData: novoData!, rmcValor: rmcValor!, rmcData: rmcData!, rccValor: rccValor!, rccData: rccData!, matricula }
}

/**
 * Grava a margem (valor + data) nos campos EXISTENTES do WeSales (Novo/RMC/RCC)
 * — nunca cria contato novo (isso é papel da NVTI); só itens já vinculados
 * (`wesales_contact_id`) ou achados por CPF. Preenche matrícula funcional só
 * se ainda estiver vazia. Best-effort por item (erro de um não trava o lote).
 */
export async function atualizarWesalesLote(loteId: string): Promise<{ atualizados: number; semContato: number }> {
  const lote = await obterLote(loteId)
  if (!lote) throw new Error('Lote não encontrado.')
  const admin = await createAdminClient()

  const { data: itens, error } = await admin
    .from('if_higienizacao_itens')
    .select('id, cpf, matricula_if, wesales_contact_id, margem_consignado, margem_beneficio, margem_emprestimo')
    .eq('lote_id', loteId)
    .in('status', ['ok', 'sem_margem'])
    .is('wesales_atualizado_em', null)
  if (error) throw new Error(error.message)
  if (!itens || itens.length === 0) return { atualizados: 0, semContato: 0 }

  const campos = await resolverCamposMargem()

  let convenioDoLote: ConvenioDoLote | null = null
  if (lote.convenioId) {
    const { data: conv } = await admin.from('convenios').select('id, nome, nome_reduzido, codigo_sistema').eq('id', lote.convenioId).maybeSingle()
    if (conv) {
      convenioDoLote = {
        id: String(conv.id),
        nome: String(conv.nome || ''),
        nomeReduzido: conv.nome_reduzido ? String(conv.nome_reduzido) : null,
        codigoSistema: conv.codigo_sistema ? String(conv.codigo_sistema) : null,
      }
    }
  }

  const hoje = new Date().toISOString().slice(0, 10)
  let atualizados = 0
  let semContato = 0

  for (const item of itens) {
    try {
      const contato = item.wesales_contact_id ? await getContact(String(item.wesales_contact_id)) : await findContactByCpf(String(item.cpf))
      if (!contato) {
        semContato += 1
        continue
      }

      const customFields = [
        customFieldEntry(campos.novoValor, Number(item.margem_emprestimo) || 0),
        customFieldEntry(campos.novoData, hoje),
        customFieldEntry(campos.rmcValor, Number(item.margem_consignado) || 0),
        customFieldEntry(campos.rmcData, hoje),
        customFieldEntry(campos.rccValor, Number(item.margem_beneficio) || 0),
        customFieldEntry(campos.rccData, hoje),
      ].filter((e): e is { id: string; fieldValue: string | number } => Boolean(e))

      if (campos.matricula && item.matricula_if) {
        const atual = customFieldValue(contato, campos.matricula.id)
        if (!atual || !atual.trim()) customFields.push({ id: campos.matricula.id, fieldValue: String(item.matricula_if) })
      }

      await updateContact(contato.id, { customFields })
      if (convenioDoLote) await gravarConvenioDoLoteSeVazio(String(item.cpf), convenioDoLote)

      await admin
        .from('if_higienizacao_itens')
        .update({ wesales_atualizado_em: new Date().toISOString(), wesales_contact_id: contato.id })
        .eq('id', item.id)
      atualizados += 1
    } catch (err) {
      console.warn(`[if-higienizacao] falha ao atualizar WeSales do item ${item.id}:`, err instanceof Error ? err.message : err)
    }
  }

  return { atualizados, semContato }
}

function formatarTaxaMes(taxaMes: number | null): string | null {
  if (taxaMes === null) return null
  return `${taxaMes.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`
}

/**
 * Ofertas encontradas (Fatia 3, `ofertas_status='ok'`) → Oportunidade no
 * pipeline "Ofertas de Crédito", MESMO mecanismo do REFIN
 * (src/app/api/alvoconsig/upload/route.ts, tipo='refin'): idempotência por
 * tipoOferta+instituicaoId+tabelaCodigo (atualiza valor/campos sem mexer na
 * etapa; cria só oferta inédita). Nunca cria contato — só itens já vinculados
 * (`wesales_contact_id`) ou achados por CPF (quem cria é a NVTI). Best-effort
 * por item: erro de um não trava o lote.
 */
export async function enviarOfertasParaWesales(loteId: string): Promise<{ enviados: number; semContato: number }> {
  const admin = await createAdminClient()

  const { data: itens, error } = await admin
    .from('if_higienizacao_itens')
    .select('id, cpf, wesales_contact_id, ofertas')
    .eq('lote_id', loteId)
    .eq('ofertas_status', 'ok')
    .is('wesales_ofertas_em', null)
  if (error) throw new Error(error.message)
  if (!itens || itens.length === 0) return { enviados: 0, semContato: 0 }

  const entradasOferta = Object.entries(OFERTA_FIELD_KEYS) as Array<[keyof typeof OFERTA_FIELD_KEYS, string]>
  const resolvidos = await Promise.all(entradasOferta.map(([campo, key]) => ensureCustomField(key, OFERTA_FIELD_LABELS[campo], 'opportunity')))
  const ofertaFieldDefs: Record<string, CustomFieldDef> = {}
  entradasOferta.forEach(([, key], i) => { ofertaFieldDefs[key] = resolvidos[i] })
  const fCampo = (campo: keyof typeof OFERTA_FIELD_KEYS) => ofertaFieldDefs[OFERTA_FIELD_KEYS[campo]].id

  const pipelineOfertas = await resolverPipelineOfertas()
  const stageDisponivelId = pipelineOfertas.stages[ETAPA_DISPONIVEL]?.id
  const pipelineId = pipelineOfertas.pipeline.id

  let enviados = 0
  let semContato = 0

  for (const item of itens) {
    const ofertas = Array.isArray(item.ofertas) ? (item.ofertas as OfertaNormalizada[]) : []
    if (ofertas.length === 0) continue

    try {
      const contato = item.wesales_contact_id ? await getContact(String(item.wesales_contact_id)) : await findContactByCpf(String(item.cpf))
      if (!contato) {
        semContato += 1
        continue
      }

      const existentesNoPipeline = await findOpportunitiesByContactDetalhadas(contato.id, pipelineId)
      const usadosNestaRodada = new Set<string>()

      for (const oferta of ofertas) {
        const alvo = existentesNoPipeline.find((op) => {
          if (usadosNestaRodada.has(op.id)) return false
          if (opportunityFieldValue(op, fCampo('tipoOferta')) !== oferta.produto) return false
          if (opportunityFieldValue(op, fCampo('instituicaoId')) !== oferta.instituicaoId) return false
          const tabelaOp = opportunityFieldValue(op, fCampo('tabelaCodigo'))
          return (tabelaOp || null) === (oferta.tabelaCodigo || null)
        })

        const customFields: Array<{ id: string; fieldValue: string }> = [
          { id: fCampo('tipoOferta'), fieldValue: oferta.produto },
          { id: fCampo('instituicaoId'), fieldValue: oferta.instituicaoId },
          { id: fCampo('instituicao'), fieldValue: oferta.instituicaoNome },
        ]
        if (oferta.numParcelas !== null) customFields.push({ id: fCampo('prazo'), fieldValue: String(oferta.numParcelas) })
        if (oferta.valorParcela !== null) customFields.push({ id: fCampo('parcela'), fieldValue: String(oferta.valorParcela) })
        const taxaFormatada = formatarTaxaMes(oferta.taxaMes)
        if (taxaFormatada) customFields.push({ id: fCampo('taxa'), fieldValue: taxaFormatada })
        if (oferta.tabelaCodigo) customFields.push({ id: fCampo('tabelaCodigo'), fieldValue: oferta.tabelaCodigo })

        const monetaryValue = oferta.valorSaque ?? 0
        if (alvo) {
          usadosNestaRodada.add(alvo.id)
          // Só valor/campos — NUNCA mexe na etapa (preserva progresso do atendimento).
          await updateOpportunity(alvo.id, { monetaryValue, customFields })
        } else {
          const nova = await createOpportunity({
            contactId: contato.id,
            pipelineId,
            pipelineStageId: stageDisponivelId,
            name: nomeOportunidade(oferta.produto, oferta.instituicaoNome, oferta.tabelaCodigo),
            monetaryValue,
            customFields,
          })
          existentesNoPipeline.push(nova)
          usadosNestaRodada.add(nova.id)
        }
      }

      await admin
        .from('if_higienizacao_itens')
        .update({ wesales_ofertas_em: new Date().toISOString(), wesales_contact_id: contato.id })
        .eq('id', item.id)
      enviados += 1
    } catch (err) {
      console.warn(`[if-higienizacao] falha ao enviar ofertas ao WeSales do item ${item.id}:`, err instanceof Error ? err.message : err)
    }
  }

  return { enviados, semContato }
}
