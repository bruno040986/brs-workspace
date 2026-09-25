'use server'

import type { ComercialResumo } from '@/lib/comerciais-hierarquia'
import type { CatalogosArw } from '@/lib/agente-corban-onboarding'
import { EVIDENCIA_ACEITA, resolveEvidenciaTipo, type CorbanOnboardingEvidencia } from '@/lib/agente-corban-onboarding'
import { createHash, randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmailOnboarding } from '@/lib/onboarding-comunicacao'
import { getFieldByPath, normalizeFieldValue, setValueAtPath } from '@/lib/agente-corban-fields'
import {
  buildAnaliseChecklistSpec,
  buildValidacaoChecklistSpec,
  diasEmAberto,
  isValidacaoEspecial,
  itemDispensaAprovacao,
  PRESENCA_DIGITAL_CLASSIFICACAO_LABELS,
  resolveItemPortalStep,
  type ChecklistItemSpec,
  type ChecklistPortalStep,
  type CorbanOnboardingDocAnalise,
  type CorbanOnboardingEvento,
  type CorbanOnboardingItem,
  type CorbanOnboardingProcesso,
  type PresencaDigitalClassificacao,
} from '@/lib/agente-corban-onboarding'

const RESOURCE = 'agente-corban-cadastros-recebidos'
// Mesmo padrão de etapas-actions.ts (link de correção): URL pública do Portal Parceiro.
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://parceiro.brspromotora.com.br'
const RASCUNHO_LINK_COOLDOWN_MS = 60_000

/**
 * `preenchedor.nome` vem do formulário público do portal, sem autenticação.
 * Sem escapar antes de entrar no HTML do e-mail, um nome tipo
 * `<a href="...">urgente</a>` vira HTML de verdade na caixa de entrada de
 * quem recebe (injeção de HTML/phishing usando o domínio confiável do envio).
 */
function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
const BUCKET = 'partner-analise'
const SIGNED_URL_TTL_SECONDS = 3600
const PIPELINE_STATUSES = ['novo', 'aguarda_assinatura', 'assinatura_realizada', 'validacao_final']

type SupabaseAdmin = Awaited<ReturnType<typeof createAdminClient>>

async function ensureChecklistItems(admin: SupabaseAdmin, processoId: string, specs: ChecklistItemSpec[]) {
  if (specs.length === 0) return
  const rows = specs.map((spec) => ({
    processo_id: processoId,
    etapa: spec.etapa,
    chave: spec.chave,
    rotulo: spec.rotulo,
    tipo: spec.tipo,
    valor: spec.valor,
    status: 'pendente',
  }))
  const { error } = await admin
    .from('corban_onboarding_itens')
    .upsert(rows, { onConflict: 'processo_id,etapa,chave', ignoreDuplicates: true })
  if (error) throw error
}

export type CadastroRecebidoListItem = {
  hasProcesso: true
  processoId: string
  agenteParceiroId: string
  nome: string
  cpfCnpj: string
  personType: string
  etapaAtual: string
  status: string
  responsavelNome: string | null
  createdAt: string
}

export type CadastroRecebidoSemProcesso = {
  hasProcesso: false
  agenteParceiroId: string
  nome: string
  cpfCnpj: string
  personType: string
  createdAt: string
}

export async function getCadastrosRecebidosList(): Promise<
  | { success: true; items: CadastroRecebidoListItem[]; semProcesso: CadastroRecebidoSemProcesso[] }
  | { success: false; error: string; items: []; semProcesso: [] }
> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()

    const { data: processos, error: processosError } = await admin
      .from('corban_onboarding_processos')
      .select('*')
      .order('created_at', { ascending: false })
    if (processosError) throw processosError

    const agenteIds = Array.from(new Set((processos || []).map((p: any) => p.agente_parceiro_id)))
    const responsavelIds = Array.from(
      new Set((processos || []).map((p: any) => p.responsavel_id).filter(Boolean)),
    )

    const [agentesComProcessoResult, responsaveisResult, agentesSemProcessoResult] = await Promise.all([
      agenteIds.length > 0
        ? admin.from('agentes_parceiros').select('id,name,cpf_cnpj,person_type,status,created_at').in('id', agenteIds)
        : Promise.resolve({ data: [] as any[] }),
      responsavelIds.length > 0
        ? admin.from('users').select('id,name').in('id', responsavelIds)
        : Promise.resolve({ data: [] as any[] }),
      admin
        .from('agentes_parceiros')
        .select('id,name,cpf_cnpj,person_type,status,created_at')
        .in('status', PIPELINE_STATUSES),
    ])

    const agenteById = new Map((agentesComProcessoResult.data || []).map((a: any) => [a.id, a]))
    const responsavelNomeById = new Map((responsaveisResult.data || []).map((r: any) => [r.id, r.name]))
    const idsComProcesso = new Set(agenteIds)

    const items: CadastroRecebidoListItem[] = (processos || []).map((processo: any) => {
      const agente = agenteById.get(processo.agente_parceiro_id)
      return {
        hasProcesso: true,
        processoId: processo.id,
        agenteParceiroId: processo.agente_parceiro_id,
        nome: agente?.name || 'Sem nome',
        cpfCnpj: agente?.cpf_cnpj || '',
        personType: agente?.person_type || 'PJ',
        etapaAtual: processo.etapa_atual,
        status: processo.status,
        responsavelNome: processo.responsavel_id ? responsavelNomeById.get(processo.responsavel_id) || null : null,
        createdAt: processo.created_at,
      }
    })

    const semProcesso: CadastroRecebidoSemProcesso[] = (agentesSemProcessoResult.data || [])
      .filter((agente: any) => !idsComProcesso.has(agente.id))
      .map((agente: any) => ({
        hasProcesso: false,
        agenteParceiroId: agente.id,
        nome: agente.name || 'Sem nome',
        cpfCnpj: agente.cpf_cnpj || '',
        personType: agente.person_type || 'PJ',
        createdAt: agente.created_at,
      }))

    return { success: true, items, semProcesso }
  } catch (error: any) {
    console.error('Erro ao listar cadastros recebidos:', error)
    return { success: false, error: error.message, items: [], semProcesso: [] }
  }
}

export async function criarProcesso(
  agenteParceiroId: string,
): Promise<{ success: true; processoId: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()

    const { data: existing } = await admin
      .from('corban_onboarding_processos')
      .select('id')
      .eq('agente_parceiro_id', agenteParceiroId)
      .maybeSingle()
    if (existing) return { success: true, processoId: existing.id }

    const { data: inserted, error } = await admin
      .from('corban_onboarding_processos')
      .insert({ agente_parceiro_id: agenteParceiroId, etapa_atual: 'validacao', created_by: user.id })
      .select('id')
      .single()
    if (error) throw error

    await admin
      .from('corban_onboarding_eventos')
      .insert({ processo_id: inserted.id, tipo: 'processo_criado', detalhe: {}, actor_id: user.id })

    revalidatePath('/agente-corban/cadastros-recebidos')
    return { success: true, processoId: inserted.id }
  } catch (error: any) {
    console.error('Erro ao criar processo:', error)
    return { success: false, error: error.message }
  }
}

export type ProcessoDetalhe = {
  success: true
  processo: CorbanOnboardingProcesso
  agente: Record<string, any>
  itens: CorbanOnboardingItem[]
  docs: Array<CorbanOnboardingDocAnalise & { signedUrl: string | null }>
  evidencias: Array<CorbanOnboardingEvidencia & { signedUrl: string | null; autorNome: string | null }>
  eventos: Array<CorbanOnboardingEvento & { actorNome: string | null }>
  responsavelNome: string | null
  currentUserId: string
  /** Etapa ARW: comerciais (hierarquia) e catálogos da aba Acesso. */
  comerciais: ComercialResumo[]
  catalogos: CatalogosArw
}

export async function getProcesso(
  processoId: string,
): Promise<ProcessoDetalhe | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()

    const { data: processo, error: processoError } = await admin
      .from('corban_onboarding_processos')
      .select('*')
      .eq('id', processoId)
      .single()
    if (processoError || !processo) throw processoError || new Error('Processo não encontrado.')

    const { data: agente, error: agenteError } = await admin
      .from('agentes_parceiros')
      .select('*')
      .eq('id', processo.agente_parceiro_id)
      .single()
    if (agenteError || !agente) throw agenteError || new Error('Agente não encontrado.')

    await ensureChecklistItems(
      admin,
      processoId,
      buildValidacaoChecklistSpec(agente.corban_data),
    )
    if (processo.etapa_atual !== 'validacao') {
      await ensureChecklistItems(
        admin,
        processoId,
        buildAnaliseChecklistSpec(agente.corban_data, agente.person_type, agente.cpf_cnpj),
      )
    }

    const [itensResult, docsResult, eventosResult, evidenciasResult] = await Promise.all([
      admin.from('corban_onboarding_itens').select('*').eq('processo_id', processoId).order('created_at', { ascending: true }),
      admin.from('corban_onboarding_docs_analise').select('*').eq('processo_id', processoId).order('created_at', { ascending: false }),
      admin.from('corban_onboarding_eventos').select('*').eq('processo_id', processoId).order('created_at', { ascending: false }),
      admin.from('corban_onboarding_evidencias').select('*').eq('processo_id', processoId).order('created_at', { ascending: true }),
    ])
    if (itensResult.error) throw itensResult.error
    if (docsResult.error) throw docsResult.error
    if (eventosResult.error) throw eventosResult.error
    if (evidenciasResult.error) throw evidenciasResult.error

    const docs = await Promise.all(
      (docsResult.data || []).map(async (doc: any) => {
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(doc.arquivo_url, SIGNED_URL_TTL_SECONDS)
        return { ...doc, signedUrl: signed?.signedUrl || null }
      }),
    )
    const evidenciasAssinadas = await Promise.all(
      ((evidenciasResult.data || []) as CorbanOnboardingEvidencia[]).map(async (ev) => {
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(ev.arquivo_url, SIGNED_URL_TTL_SECONDS)
        return { ...ev, signedUrl: signed?.signedUrl || null }
      }),
    )

    let responsavelNome: string | null = null
    if (processo.responsavel_id) {
      const { data: responsavel } = await admin.from('users').select('name').eq('id', processo.responsavel_id).maybeSingle()
      responsavelNome = responsavel?.name || null
    }

    // Retorno do ARW (etapa 4): comerciais e catálogos da aba Acesso.
    const [{ data: comerciaisRows }, { data: niveisRows }, { data: tiposRows }] = await Promise.all([
      admin.from('commercial_entities').select('id,name,role,status,cadastral_data').order('name', { ascending: true }),
      admin.from('agente_corban_niveis_acesso').select('id,name,is_active').is('deleted_at', null).order('name', { ascending: true }),
      admin.from('agente_corban_tipos_agente').select('id,name,is_active').is('deleted_at', null).order('name', { ascending: true }),
    ])

    const actorIds = Array.from(
      new Set([
        ...(eventosResult.data || []).map((e: any) => e.actor_id),
        ...evidenciasAssinadas.map((e) => e.created_by),
      ].filter(Boolean)),
    )
    const { data: actores } =
      actorIds.length > 0 ? await admin.from('users').select('id,name').in('id', actorIds) : { data: [] as any[] }
    const actorNomeById = new Map((actores || []).map((a: any) => [a.id, a.name]))
    const evidencias = evidenciasAssinadas.map((ev) => ({
      ...ev,
      autorNome: ev.created_by ? actorNomeById.get(ev.created_by) || null : null,
    }))
    const eventos = (eventosResult.data || []).map((evento: any) => ({
      ...evento,
      actorNome: evento.actor_id ? actorNomeById.get(evento.actor_id) || null : null,
    }))

    return {
      success: true,
      processo,
      agente,
      itens: itensResult.data || [],
      docs,
      evidencias,
      eventos,
      responsavelNome,
      currentUserId: user.id,
      comerciais: (comerciaisRows || []) as ComercialResumo[],
      catalogos: { niveis_acesso: niveisRows || [], tipos_agente: tiposRows || [] },
    }
  } catch (error: any) {
    console.error('Erro ao buscar processo de cadastro recebido:', error)
    return { success: false, error: error.message }
  }
}

function sha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function nomeArquivoSeguro(name: string): string {
  return String(name || 'arquivo').replace(/[^\w.\-]+/g, '_').slice(0, 80)
}

/**
 * Fatia 1 (25/09/2026): verificação externa só aprova com prova anexada.
 * Presença Digital / PIX → `corban_onboarding_evidencias` do item.
 * Serasa / Cartão CNPJ → upload da Análise (`docs_analise`) do mesmo alvo,
 * não reprovado. Itens sem tipo de evidência passam direto.
 */
async function exigirEvidencia(admin: SupabaseAdmin, item: { id: string; chave: string; processo_id: string }) {
  const tipo = resolveEvidenciaTipo(item.chave)
  if (!tipo) return
  if (tipo === 'serasa' || tipo === 'cartao_cnpj') {
    const m = item.chave.match(/^analise:(serasa|cartao_cnpj):(cpf|cnpj):(.+)$/)
    if (!m) return
    const { count } = await admin
      .from('corban_onboarding_docs_analise')
      .select('id', { count: 'exact', head: true })
      .eq('processo_id', item.processo_id)
      .eq('tipo_documento', m[1])
      .eq('alvo_tipo', m[2])
      .eq('alvo_valor', m[3])
      .neq('status', 'reprovado')
    if (!count) throw new Error(`Anexe o PDF do ${tipo === 'serasa' ? 'Serasa' : 'Cartão CNPJ'} deste item antes de aprovar.`)
    return
  }
  const { count } = await admin.from('corban_onboarding_evidencias').select('id', { count: 'exact', head: true }).eq('item_id', item.id)
  if (!count) throw new Error('Anexe o print da verificação antes de aprovar este item.')
}

export async function avaliarItem(
  itemId: string,
  input: { status: 'aprovado' | 'reprovado'; motivo?: string; instrucoes?: string },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    if (input.status === 'reprovado' && (!input.motivo?.trim() || !input.instrucoes?.trim())) {
      throw new Error('Informe o motivo e as instruções de correção para reprovar.')
    }

    const { data: item, error: itemError } = await admin
      .from('corban_onboarding_itens')
      .select('*')
      .eq('id', itemId)
      .single()
    if (itemError || !item) throw itemError || new Error('Item não encontrado.')
    if (input.status === 'aprovado') await exigirEvidencia(admin, item)

    const { error } = await admin
      .from('corban_onboarding_itens')
      .update({
        status: input.status,
        motivo_reprovacao: input.status === 'reprovado' ? input.motivo!.trim() : null,
        instrucoes_correcao: input.status === 'reprovado' ? input.instrucoes!.trim() : null,
        avaliado_por: user.id,
        avaliado_em: new Date().toISOString(),
      })
      .eq('id', itemId)
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: item.processo_id,
      tipo: 'item_avaliado',
      detalhe: { item_id: itemId, chave: item.chave, rotulo: item.rotulo, status: input.status },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${item.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao avaliar item:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Aprova em lote todos os itens pendentes de uma etapa do formulário
 * (Empresa/Comercial/Bancário/Sociedade/Signatários) do checklist de
 * `validacao`. Bloqueado se a seção tiver algum item reprovado — o operador
 * precisa corrigir/editar antes de aprovar em lote. Itens de validação
 * própria (Presença Digital, Chave PIX) ficam de fora — eles têm fluxo de
 * classificação dedicado. Continua gerando 1 evento `item_avaliado` por item,
 * igual à aprovação individual.
 */
export async function aprovarSecao(
  processoId: string,
  passo: ChecklistPortalStep,
): Promise<{ success: true; aprovados: number } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: processo, error: processoError } = await admin
      .from('corban_onboarding_processos')
      .select('agente_parceiro_id')
      .eq('id', processoId)
      .single()
    if (processoError || !processo) throw processoError || new Error('Processo não encontrado.')

    const { data: agente, error: agenteError } = await admin
      .from('agentes_parceiros')
      .select('corban_data')
      .eq('id', processo.agente_parceiro_id)
      .single()
    if (agenteError || !agente) throw agenteError || new Error('Agente não encontrado.')

    const { data: itens, error: itensError } = await admin
      .from('corban_onboarding_itens')
      .select('*')
      .eq('processo_id', processoId)
      .eq('etapa', 'validacao')
    if (itensError) throw itensError

    const daSecao = (itens || []).filter(
      (item: any) =>
        resolveItemPortalStep(item) === passo &&
        !isValidacaoEspecial(item.chave) &&
        !itemDispensaAprovacao(item, agente.corban_data),
    )
    if (daSecao.some((item: any) => item.status === 'reprovado')) {
      throw new Error('Corrija os campos reprovados desta seção antes de aprovar.')
    }

    const pendentes = daSecao.filter((item: any) => item.status !== 'aprovado')
    if (pendentes.length === 0) return { success: true, aprovados: 0 }

    const nowIso = new Date().toISOString()
    const { error: updateError } = await admin
      .from('corban_onboarding_itens')
      .update({ status: 'aprovado', avaliado_por: user.id, avaliado_em: nowIso })
      .in('id', pendentes.map((item: any) => item.id))
    if (updateError) throw updateError

    await admin.from('corban_onboarding_eventos').insert(
      pendentes.map((item: any) => ({
        processo_id: processoId,
        tipo: 'item_avaliado',
        detalhe: { item_id: item.id, chave: item.chave, rotulo: item.rotulo, status: 'aprovado' },
        actor_id: user.id,
      })),
    )

    revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
    return { success: true, aprovados: pendentes.length }
  } catch (error: any) {
    console.error('Erro ao aprovar seção:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Correção direta de um item de informação pelo operador (ex.: typo do parceiro
 * no telefone/CEP) — sem precisar do fluxo completo de correção via magic link.
 * Sempre auditada: grava valor anterior/novo em `corban_onboarding_eventos` com
 * o `actor_id` do usuário, e volta o item para `pendente` para nova aprovação.
 */
export async function editarItemValor(
  itemId: string,
  novoValorBruto: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: item, error: itemError } = await admin
      .from('corban_onboarding_itens')
      .select('*')
      .eq('id', itemId)
      .single()
    if (itemError || !item) throw itemError || new Error('Item não encontrado.')
    if (item.tipo !== 'informacao') throw new Error('Este item não pode ser editado diretamente.')
    if (isValidacaoEspecial(item.chave)) {
      throw new Error('Este item tem fluxo de validação próprio — use a ação específica.')
    }

    const { data: processo, error: processoError } = await admin
      .from('corban_onboarding_processos')
      .select('agente_parceiro_id')
      .eq('id', item.processo_id)
      .single()
    if (processoError || !processo) throw processoError || new Error('Processo não encontrado.')

    const { data: agente, error: agenteError } = await admin
      .from('agentes_parceiros')
      .select('corban_data')
      .eq('id', processo.agente_parceiro_id)
      .single()
    if (agenteError || !agente) throw agenteError || new Error('Agente não encontrado.')

    const field = getFieldByPath(item.chave)
    const novoValor = field ? normalizeFieldValue(field, novoValorBruto) : String(novoValorBruto ?? '').trim()
    const valorAnterior = item.valor

    const novoCorbanData = setValueAtPath(agente.corban_data || {}, item.chave, novoValor)

    const { error: updateAgenteError } = await admin
      .from('agentes_parceiros')
      .update({ corban_data: novoCorbanData, updated_at: new Date().toISOString() })
      .eq('id', processo.agente_parceiro_id)
    if (updateAgenteError) throw updateAgenteError

    const { error: updateItemError } = await admin
      .from('corban_onboarding_itens')
      .update({
        valor: novoValor,
        status: 'pendente',
        avaliado_por: null,
        avaliado_em: null,
        motivo_reprovacao: null,
        instrucoes_correcao: null,
      })
      .eq('id', itemId)
    if (updateItemError) throw updateItemError

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: item.processo_id,
      tipo: 'item_editado',
      detalhe: { item_id: itemId, chave: item.chave, rotulo: item.rotulo, valor_anterior: valorAnterior, valor_novo: novoValor },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${item.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao editar item:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Classifica um campo de Presença Digital (Instagram/TikTok/Facebook/
 * LinkedIn/Site/WhatsApp de atendimento). "Verificado" aprova; qualquer outra
 * classificação reprova automaticamente com o motivo já preenchido. Permite
 * corrigir o texto do campo (typo do parceiro) no mesmo passo.
 */
export async function avaliarPresencaDigital(
  itemId: string,
  input: { classificacao: PresencaDigitalClassificacao; texto?: string },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: item, error: itemError } = await admin
      .from('corban_onboarding_itens')
      .select('*')
      .eq('id', itemId)
      .single()
    if (itemError || !item) throw itemError || new Error('Item não encontrado.')

    if (input.classificacao === 'verificado') await exigirEvidencia(admin, item)

    const textoFinal = input.texto !== undefined ? input.texto.trim() : String(item.valor?.texto || '')
    const novoValor = { texto: textoFinal, classificacao: input.classificacao }
    const status = input.classificacao === 'verificado' ? 'aprovado' : 'reprovado'
    const motivo = input.classificacao === 'verificado' ? null : PRESENCA_DIGITAL_CLASSIFICACAO_LABELS[input.classificacao]

    if (input.texto !== undefined && textoFinal !== String(item.valor?.texto || '')) {
      const { data: processo } = await admin
        .from('corban_onboarding_processos')
        .select('agente_parceiro_id')
        .eq('id', item.processo_id)
        .single()
      if (processo) {
        const { data: agente } = await admin.from('agentes_parceiros').select('corban_data').eq('id', processo.agente_parceiro_id).single()
        if (agente) {
          const novoCorbanData = setValueAtPath(agente.corban_data || {}, item.chave, textoFinal)
          await admin.from('agentes_parceiros').update({ corban_data: novoCorbanData, updated_at: new Date().toISOString() }).eq('id', processo.agente_parceiro_id)
        }
      }
    }

    const { error } = await admin
      .from('corban_onboarding_itens')
      .update({
        valor: novoValor,
        status,
        motivo_reprovacao: motivo,
        instrucoes_correcao: null,
        avaliado_por: user.id,
        avaliado_em: new Date().toISOString(),
      })
      .eq('id', itemId)
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: item.processo_id,
      tipo: 'item_avaliado',
      detalhe: { item_id: itemId, chave: item.chave, rotulo: item.rotulo, status, classificacao: input.classificacao },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${item.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao classificar presença digital:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Conferência da Chave PIX da empresa: 3 perguntas de checagem manual no app
 * bancário. Qualquer resposta "não" reprova automaticamente; todas "sim" aprova.
 */
export async function avaliarChavePix(
  itemId: string,
  respostas: { existe: boolean; pertenceCnpj: boolean; mesmaInstituicao: boolean },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: item, error: itemError } = await admin
      .from('corban_onboarding_itens')
      .select('*')
      .eq('id', itemId)
      .single()
    if (itemError || !item) throw itemError || new Error('Item não encontrado.')

    const tudoOk = respostas.existe && respostas.pertenceCnpj && respostas.mesmaInstituicao
    if (tudoOk) await exigirEvidencia(admin, item)
    const falhas = [
      !respostas.existe ? 'a chave não existe' : null,
      !respostas.pertenceCnpj ? 'a chave não pertence ao CNPJ' : null,
      !respostas.mesmaInstituicao ? 'a chave não é da mesma instituição dos dados bancários' : null,
    ].filter(Boolean)

    const { error } = await admin
      .from('corban_onboarding_itens')
      .update({
        valor: { ...(item.valor || {}), respostas },
        status: tudoOk ? 'aprovado' : 'reprovado',
        motivo_reprovacao: tudoOk ? null : `Conferência da chave PIX falhou: ${falhas.join(', ')}.`,
        instrucoes_correcao: tudoOk ? null : 'Reenvie os dados bancários corretos ou uma chave PIX válida.',
        avaliado_por: user.id,
        avaliado_em: new Date().toISOString(),
      })
      .eq('id', itemId)
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: item.processo_id,
      tipo: 'item_avaliado',
      detalhe: { item_id: itemId, chave: item.chave, rotulo: item.rotulo, status: tudoOk ? 'aprovado' : 'reprovado' },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${item.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao avaliar chave PIX:', error)
    return { success: false, error: error.message }
  }
}

export async function concluirEtapaValidacao(
  processoId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: processo, error: processoError } = await admin
      .from('corban_onboarding_processos')
      .select('etapas,agente_parceiro_id')
      .eq('id', processoId)
      .single()
    if (processoError || !processo) throw processoError || new Error('Processo não encontrado.')

    const { data: agente, error: agenteError } = await admin
      .from('agentes_parceiros')
      .select('corban_data,person_type,cpf_cnpj')
      .eq('id', processo.agente_parceiro_id)
      .single()
    if (agenteError || !agente) throw agenteError || new Error('Agente não encontrado.')

    const { data: itens, error: itensError } = await admin
      .from('corban_onboarding_itens')
      .select('id,chave,valor,status')
      .eq('processo_id', processoId)
      .eq('etapa', 'validacao')
    if (itensError) throw itensError
    if (!itens || itens.length === 0) throw new Error('Nenhum item de validação encontrado.')
    if (itens.some((item: any) => item.status !== 'aprovado' && !itemDispensaAprovacao(item, agente.corban_data))) {
      throw new Error('Ainda há itens pendentes ou reprovados na validação.')
    }

    const nowIso = new Date().toISOString()
    const etapas = {
      ...(processo.etapas || {}),
      validacao: { ...(processo.etapas?.validacao || {}), completed_at: nowIso, completed_by: user.id },
    }

    const { error: updateError } = await admin
      .from('corban_onboarding_processos')
      // Rodada de correção deixa o processo em 'correcao_recebida'; concluir a
      // Validação é o momento em que ele volta a ser um processo comum.
      .update({ etapa_atual: 'analise', status: 'em_andamento', etapas, updated_at: nowIso })
      .eq('id', processoId)
    if (updateError) throw updateError

    await ensureChecklistItems(
      admin,
      processoId,
      buildAnaliseChecklistSpec(agente.corban_data, agente.person_type, agente.cpf_cnpj),
    )

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: processoId,
      tipo: 'etapa_concluida',
      detalhe: { etapa: 'validacao' },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
    revalidatePath('/agente-corban/cadastros-recebidos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao concluir etapa de validação:', error)
    return { success: false, error: error.message }
  }
}

export async function concluirEtapaAnalise(
  processoId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: itens, error: itensError } = await admin
      .from('corban_onboarding_itens')
      .select('id,status')
      .eq('processo_id', processoId)
      .eq('etapa', 'analise')
    if (itensError) throw itensError
    if (!itens || itens.length === 0) throw new Error('Nenhum item de análise encontrado.')
    if (itens.some((item: any) => item.status !== 'aprovado')) {
      throw new Error('Ainda há itens pendentes ou reprovados na análise.')
    }

    const { data: docs, error: docsError } = await admin
      .from('corban_onboarding_docs_analise')
      .select('id,status')
      .eq('processo_id', processoId)
    if (docsError) throw docsError
    if ((docs || []).some((doc: any) => doc.status !== 'aprovado')) {
      throw new Error('Ainda há documentos de análise pendentes ou reprovados.')
    }

    const { data: processo, error: processoError } = await admin
      .from('corban_onboarding_processos')
      .select('etapas')
      .eq('id', processoId)
      .single()
    if (processoError || !processo) throw processoError || new Error('Processo não encontrado.')

    const nowIso = new Date().toISOString()
    const etapas = {
      ...(processo.etapas || {}),
      analise: { ...(processo.etapas?.analise || {}), completed_at: nowIso, completed_by: user.id },
    }

    const { error: updateError } = await admin
      .from('corban_onboarding_processos')
      .update({ etapa_atual: 'nuvidio', etapas, updated_at: nowIso })
      .eq('id', processoId)
    if (updateError) throw updateError

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: processoId,
      tipo: 'etapa_concluida',
      detalhe: { etapa: 'analise' },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
    revalidatePath('/agente-corban/cadastros-recebidos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao concluir etapa de análise:', error)
    return { success: false, error: error.message }
  }
}

export async function anexarEvidencia(
  itemId: string,
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
    const observacao = String(formData.get('observacao') || '').trim() || null

    const { data: item, error: itemError } = await admin
      .from('corban_onboarding_itens')
      .select('id,processo_id,chave,rotulo,status')
      .eq('id', itemId)
      .single()
    if (itemError || !item) throw itemError || new Error('Item não encontrado.')
    const tipo = resolveEvidenciaTipo(item.chave)
    if (!tipo || tipo === 'serasa' || tipo === 'cartao_cnpj') throw new Error('Este item não recebe evidência por aqui.')
    if (!EVIDENCIA_ACEITA[tipo].includes(file.type)) {
      throw new Error(`Formato não aceito (${file.type || 'desconhecido'}). Aceitos: ${EVIDENCIA_ACEITA[tipo].join(', ')}.`)
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('Arquivo acima de 20 MB.')

    const bytes = await file.arrayBuffer()
    const hash = sha256Hex(bytes)
    const path = `${item.processo_id}/evidencias/${item.id}/${Date.now()}-${nomeArquivoSeguro(file.name)}`
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false })
    if (upErr) throw upErr

    const { error } = await admin.from('corban_onboarding_evidencias').insert({
      processo_id: item.processo_id,
      item_id: item.id,
      arquivo_url: path,
      file_name: file.name,
      mime_type: file.type,
      tamanho_bytes: file.size,
      hash_sha256: hash,
      observacao,
      created_by: user.id,
    })
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: item.processo_id,
      tipo: 'evidencia_anexada',
      detalhe: { item_id: item.id, chave: item.chave, rotulo: item.rotulo, file_name: file.name, hash_sha256: hash },
      actor_id: user.id,
    })
    revalidatePath(`/agente-corban/cadastros-recebidos/${item.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao anexar evidência:', error)
    return { success: false, error: error.message }
  }
}

/** Só enquanto o item não foi aprovado — depois a evidência é registro. A remoção fica no histórico com o hash. */
export async function removerEvidencia(evidenciaId: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { data: ev, error: evError } = await admin.from('corban_onboarding_evidencias').select('*').eq('id', evidenciaId).single()
    if (evError || !ev) throw evError || new Error('Evidência não encontrada.')
    const { data: item } = await admin.from('corban_onboarding_itens').select('id,chave,rotulo,status').eq('id', ev.item_id).single()
    if (item?.status === 'aprovado') throw new Error('Item já aprovado: a evidência faz parte do registro e não pode ser removida.')

    const { error } = await admin.from('corban_onboarding_evidencias').delete().eq('id', evidenciaId)
    if (error) throw error
    await admin.storage.from(BUCKET).remove([ev.arquivo_url])
    await admin.from('corban_onboarding_eventos').insert({
      processo_id: ev.processo_id,
      tipo: 'evidencia_removida',
      detalhe: { item_id: ev.item_id, chave: item?.chave, rotulo: item?.rotulo, file_name: ev.file_name, hash_sha256: ev.hash_sha256 },
      actor_id: user.id,
    })
    revalidatePath(`/agente-corban/cadastros-recebidos/${ev.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao remover evidência:', error)
    return { success: false, error: error.message }
  }
}

export async function uploadDocAnalise(
  processoId: string,
  formData: FormData,
): Promise<{ success: true; docId: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()

    const file = formData.get('file')
    const alvoTipo = String(formData.get('alvo_tipo') || '')
    const alvoValor = String(formData.get('alvo_valor') || '')
    const tipoDocumento = String(formData.get('tipo_documento') || '')

    if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
    if (!['cpf', 'cnpj', 'processo'].includes(alvoTipo)) throw new Error('Alvo inválido.')
    if (!['serasa', 'cartao_cnpj', 'video_nuvidio', 'outro'].includes(tipoDocumento)) {
      throw new Error('Tipo de documento inválido.')
    }
    // Fatia 1: Serasa e Cartão CNPJ são a evidência do item — só o PDF original.
    if ((tipoDocumento === 'serasa' || tipoDocumento === 'cartao_cnpj') && file.type !== 'application/pdf') {
      throw new Error('Serasa e Cartão CNPJ só aceitam o PDF original.')
    }
    const hashDoc = sha256Hex(await file.arrayBuffer())

    // Segurança (path traversal): a extensão vem do NOME do arquivo enviado —
    // só letras/números curtos entram no path do storage; o resto vira 'bin'.
    const extBruta = (file.name.split('.').pop() || '').toLowerCase()
    const ext = /^[a-z0-9]{1,8}$/.test(extBruta) ? extBruta : 'bin'
    const path = `${processoId}/${tipoDocumento}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const bytes = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadError) throw uploadError

    const { data: inserted, error: insertError } = await admin
      .from('corban_onboarding_docs_analise')
      .insert({
        processo_id: processoId,
        alvo_tipo: alvoTipo,
        alvo_valor: alvoValor,
        tipo_documento: tipoDocumento,
        arquivo_url: path,
        file_name: file.name,
        hash_sha256: hashDoc,
        tamanho_bytes: file.size,
        mime_type: file.type,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (insertError) throw insertError

    // Vídeo da Nuvidio também marca a coluna do processo (etapa 3 exige).
    if (tipoDocumento === 'video_nuvidio') {
      await admin
        .from('corban_onboarding_processos')
        .update({ nuvidio_video_url: path, updated_at: new Date().toISOString() })
        .eq('id', processoId)
    }

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: processoId,
      tipo: 'doc_analise_enviado',
      detalhe: { doc_id: inserted.id, tipo_documento: tipoDocumento, alvo_tipo: alvoTipo, alvo_valor: alvoValor },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
    return { success: true, docId: inserted.id }
  } catch (error: any) {
    console.error('Erro ao enviar documento de análise:', error)
    return { success: false, error: error.message }
  }
}

export async function avaliarDocAnalise(
  docId: string,
  input: { status: 'aprovado' | 'reprovado'; observacao?: string },
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: doc, error: docError } = await admin
      .from('corban_onboarding_docs_analise')
      .select('*')
      .eq('id', docId)
      .single()
    if (docError || !doc) throw docError || new Error('Documento não encontrado.')

    const { error } = await admin
      .from('corban_onboarding_docs_analise')
      .update({
        status: input.status,
        observacao: input.observacao?.trim() || null,
        avaliado_por: user.id,
        avaliado_em: new Date().toISOString(),
      })
      .eq('id', docId)
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: doc.processo_id,
      tipo: 'doc_analise_avaliado',
      detalhe: { doc_id: docId, status: input.status },
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${doc.processo_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao avaliar documento de análise:', error)
    return { success: false, error: error.message }
  }
}

export async function assumirResponsavel(
  processoId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { error } = await admin
      .from('corban_onboarding_processos')
      .update({ responsavel_id: user.id, updated_at: new Date().toISOString() })
      .eq('id', processoId)
    if (error) throw error

    await admin.from('corban_onboarding_eventos').insert({
      processo_id: processoId,
      tipo: 'responsavel_assumido',
      detalhe: {},
      actor_id: user.id,
    })

    revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
    revalidatePath('/agente-corban/cadastros-recebidos')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao assumir responsável:', error)
    return { success: false, error: error.message }
  }
}

// ===========================================================================
// Aba "Em preenchimento" — rascunhos do Portal Parceiro que ainda não foram
// enviados (identificação confirmada, cadastro em andamento). Só leitura +
// reenviar o link mágico; NUNCA cria agente_parceiro nem processo a partir
// daqui (isso só acontece no envio final, pelo próprio portal).
// ===========================================================================

export type RascunhoEmPreenchimento = {
  id: string
  nome: string
  email: string
  whatsapp: string | null
  funcaoNome: string | null
  cnpj: string | null
  etapaAtual: string | null
  ultimoAcessoEm: string
}

export async function getRascunhosEmPreenchimento(): Promise<
  { success: true; items: RascunhoEmPreenchimento[] } | { success: false; error: string; items: [] }
> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()

    // Expiração lazy (sem cron novo — regra dos crons da Vercel): rascunhos
    // vencidos saem da aba na próxima consulta.
    await admin
      .from('corban_cadastro_rascunhos')
      .update({ status: 'expirado' })
      .eq('status', 'em_preenchimento')
      .lt('expira_em', new Date().toISOString())

    const { data, error } = await admin
      .from('corban_cadastro_rascunhos')
      .select('id, preenchedor, email, cnpj, etapa_atual, ultimo_acesso_em')
      .eq('status', 'em_preenchimento')
      .order('ultimo_acesso_em', { ascending: false })
    if (error) throw error

    const items: RascunhoEmPreenchimento[] = (data || []).map((r: any) => ({
      id: r.id,
      nome: String(r.preenchedor?.nome || 'Sem nome'),
      email: r.email,
      whatsapp: r.preenchedor?.whatsapp || null,
      funcaoNome: r.preenchedor?.funcao_nome || null,
      cnpj: r.cnpj || null,
      etapaAtual: r.etapa_atual || null,
      ultimoAcessoEm: r.ultimo_acesso_em,
    }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar rascunhos em preenchimento:', error)
    return { success: false, error: error.message, items: [] }
  }
}

/** Rotaciona o token de retomada do rascunho e reenvia o e-mail (cooldown de 60s). */
export async function reenviarLinkRascunho(rascunhoId: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { data: r, error } = await admin
      .from('corban_cadastro_rascunhos')
      .select('email, preenchedor, status, link_enviado_em')
      .eq('id', rascunhoId)
      .maybeSingle()
    if (error) throw error
    if (!r || r.status !== 'em_preenchimento') {
      return { success: false, error: 'Este rascunho não está mais em preenchimento.' }
    }

    const enviadoEm = r.link_enviado_em ? new Date(r.link_enviado_em).getTime() : 0
    if (Date.now() - enviadoEm < RASCUNHO_LINK_COOLDOWN_MS) {
      const restam = Math.ceil((RASCUNHO_LINK_COOLDOWN_MS - (Date.now() - enviadoEm)) / 1000)
      return { success: false, error: `Aguarde ${restam}s para reenviar de novo.` }
    }

    const token = randomBytes(32).toString('hex')
    const now = new Date()
    const { error: updErr } = await admin
      .from('corban_cadastro_rascunhos')
      .update({
        token_hash: createHash('sha256').update(token).digest('hex'),
        token_expira_em: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        link_enviado_em: now.toISOString(),
      })
      .eq('id', rascunhoId)
    if (updErr) throw updErr

    const nome = String(r.preenchedor?.nome || '').trim()
    const primeiroNome = escapeHtml(nome.split(/\s+/)[0] || 'tudo bem')
    const url = `${PORTAL_URL}/cadastro/continuar/${token}`
    const urlEscapada = escapeHtml(url)
    const html = `<p>Olá, <strong>${primeiroNome}</strong>!</p><p>Aqui é da BRS Promotora. Segue o link para continuar o seu cadastro de parceiro de onde parou:</p><p><a href="${urlEscapada}">${urlEscapada}</a></p><p>O link vale por 30 dias.</p><p>Equipe BRS Promotora</p>`
    const envio = await enviarEmailOnboarding({ to: r.email, subject: 'Continue o seu cadastro na BRS Promotora', html })
    if (!envio.ok) return { success: false, error: envio.detalhe }

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao reenviar link do rascunho:', error)
    return { success: false, error: error.message }
  }
}
