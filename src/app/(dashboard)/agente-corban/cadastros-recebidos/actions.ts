'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getFieldByPath, normalizeFieldValue, setValueAtPath } from '@/lib/agente-corban-fields'
import {
  buildAnaliseChecklistSpec,
  buildValidacaoChecklistSpec,
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
  eventos: Array<CorbanOnboardingEvento & { actorNome: string | null }>
  responsavelNome: string | null
  currentUserId: string
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

    const [itensResult, docsResult, eventosResult] = await Promise.all([
      admin.from('corban_onboarding_itens').select('*').eq('processo_id', processoId).order('created_at', { ascending: true }),
      admin.from('corban_onboarding_docs_analise').select('*').eq('processo_id', processoId).order('created_at', { ascending: false }),
      admin.from('corban_onboarding_eventos').select('*').eq('processo_id', processoId).order('created_at', { ascending: false }),
    ])
    if (itensResult.error) throw itensResult.error
    if (docsResult.error) throw docsResult.error
    if (eventosResult.error) throw eventosResult.error

    const docs = await Promise.all(
      (docsResult.data || []).map(async (doc: any) => {
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(doc.arquivo_url, SIGNED_URL_TTL_SECONDS)
        return { ...doc, signedUrl: signed?.signedUrl || null }
      }),
    )

    let responsavelNome: string | null = null
    if (processo.responsavel_id) {
      const { data: responsavel } = await admin.from('users').select('name').eq('id', processo.responsavel_id).maybeSingle()
      responsavelNome = responsavel?.name || null
    }

    const actorIds = Array.from(new Set((eventosResult.data || []).map((e: any) => e.actor_id).filter(Boolean)))
    const { data: actores } =
      actorIds.length > 0 ? await admin.from('users').select('id,name').in('id', actorIds) : { data: [] as any[] }
    const actorNomeById = new Map((actores || []).map((a: any) => [a.id, a.name]))
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
      eventos,
      responsavelNome,
      currentUserId: user.id,
    }
  } catch (error: any) {
    console.error('Erro ao buscar processo de cadastro recebido:', error)
    return { success: false, error: error.message }
  }
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
      .update({ etapa_atual: 'analise', etapas, updated_at: nowIso })
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
