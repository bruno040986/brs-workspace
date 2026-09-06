'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import type { AgenteCorbanDraft } from '@/lib/agente-corban'
import { saveAgenteCorbanRecord } from '../actions'

const RESOURCE = 'agente-corban-solicitacoes'

/**
 * Campos que uma solicitação PODE alterar, por tipo. A aprovação NUNCA espalha
 * o jsonb cru no draft: saveAgenteCorbanRecord sincroniza a senha no Supabase
 * Auth quando temporary_password muda, então qualquer chave fora da lista
 * (bug ou inserção indevida) é descartada aqui, não gravada.
 */
const CAMPOS_BANCARIO = [
  'bank_code',
  'bank_name',
  'bank_agency',
  'bank_account',
  'bank_account_type',
  'pix_type',
  'pix_key',
] as const
const CAMPOS_CADASTRAL = [
  'name',
  'fantasy_name',
  'cep',
  'address_street',
  'address_number',
  'address_complement',
  'address_neighborhood',
  'address_city',
  'address_state',
  'phone_whatsapp',
  'email_comissao',
] as const

type CampoPermitido = (typeof CAMPOS_BANCARIO)[number] | (typeof CAMPOS_CADASTRAL)[number]

function filtrarCamposPermitidos(
  tipo: 'cadastral' | 'bancario',
  solicitados: Record<string, unknown>
): Partial<Pick<AgenteCorbanDraft, CampoPermitido>> {
  const permitidos: readonly string[] = tipo === 'bancario' ? CAMPOS_BANCARIO : CAMPOS_CADASTRAL
  const resultado: Record<string, string> = {}
  for (const chave of permitidos) {
    const valor = solicitados[chave]
    if (typeof valor === 'string') resultado[chave] = valor
  }
  return resultado as Partial<Pick<AgenteCorbanDraft, CampoPermitido>>
}

export type SolicitacaoListItem = {
  id: string
  agenteParceiroId: string
  agenteParceiroNome: string
  tipo: 'cadastral' | 'bancario'
  status: 'pendente' | 'aprovada' | 'reprovada'
  createdAt: string
}

export async function getSolicitacoesList(): Promise<{ success: boolean; items: SolicitacaoListItem[]; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('solicitacoes_atualizacao_cadastral')
      .select('id, agente_parceiro_id, tipo, status, created_at, agente:agente_parceiro_id ( name )')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error

    const items = (data ?? []).map((r) => ({
      id: r.id as string,
      agenteParceiroId: r.agente_parceiro_id as string,
      agenteParceiroNome: (r as { agente?: { name?: string } }).agente?.name ?? '—',
      tipo: r.tipo as 'cadastral' | 'bancario',
      status: r.status as 'pendente' | 'aprovada' | 'reprovada',
      createdAt: r.created_at as string,
    }))
    return { success: true, items }
  } catch (error: any) {
    return { success: false, items: [], error: error.message }
  }
}

export type SolicitacaoDetalhe = {
  id: string
  agenteParceiroId: string
  agenteParceiroNome: string
  tipo: 'cadastral' | 'bancario'
  status: 'pendente' | 'aprovada' | 'reprovada'
  dadosAtuais: Record<string, unknown>
  dadosSolicitados: Record<string, unknown>
  justificativa: string
  documentoUrl: string | null
  motivoReprovacao: string | null
  createdAt: string
}

export async function getSolicitacaoById(
  id: string
): Promise<{ success: boolean; item?: SolicitacaoDetalhe; documentoSignedUrl?: string | null; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('solicitacoes_atualizacao_cadastral')
      .select('*, agente:agente_parceiro_id ( name )')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return { success: false, error: 'Solicitação não encontrada.' }

    let documentoSignedUrl: string | null = null
    if (data.documento_url) {
      const { data: signed } = await admin.storage.from('partner-analise').createSignedUrl(data.documento_url, 3600)
      documentoSignedUrl = signed?.signedUrl ?? null
    }

    return {
      success: true,
      documentoSignedUrl,
      item: {
        id: data.id,
        agenteParceiroId: data.agente_parceiro_id,
        agenteParceiroNome: (data as { agente?: { name?: string } }).agente?.name ?? '—',
        tipo: data.tipo,
        status: data.status,
        dadosAtuais: data.dados_atuais ?? {},
        dadosSolicitados: data.dados_solicitados ?? {},
        justificativa: data.justificativa ?? '',
        documentoUrl: data.documento_url,
        motivoReprovacao: data.motivo_reprovacao,
        createdAt: data.created_at,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Aprova: aplica só os campos permitidos de `dados_solicitados` via
 * saveAgenteCorbanRecord — a MESMA função do editor manual, que já faz o merge
 * com o registro atual e o roteamento coluna física × corban_data.
 */
export async function aprovarSolicitacao(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()

    const { data: solicitacao, error: solError } = await admin
      .from('solicitacoes_atualizacao_cadastral')
      .select('*')
      .eq('id', id)
      .eq('status', 'pendente')
      .maybeSingle()
    if (solError) throw solError
    if (!solicitacao) return { success: false, error: 'Solicitação não encontrada ou já revisada.' }

    const { data: agenteRow, error: agenteError } = await admin
      .from('agentes_parceiros')
      .select('id')
      .eq('id', solicitacao.agente_parceiro_id)
      .maybeSingle()
    if (agenteError) throw agenteError
    if (!agenteRow) return { success: false, error: 'Agente Corban não encontrado.' }

    const camposAprovados = filtrarCamposPermitidos(
      solicitacao.tipo as 'cadastral' | 'bancario',
      (solicitacao.dados_solicitados ?? {}) as Record<string, unknown>
    )
    if (Object.keys(camposAprovados).length === 0) {
      return { success: false, error: 'A solicitação não contém nenhum campo permitido para alteração.' }
    }

    const saveResult = await saveAgenteCorbanRecord({ id: agenteRow.id, ...camposAprovados })
    if (!saveResult.success) return { success: false, error: saveResult.error || 'Falha ao gravar o cadastro.' }

    const { error: updError } = await admin
      .from('solicitacoes_atualizacao_cadastral')
      .update({ status: 'aprovada', revisado_por: user.id, revisado_em: new Date().toISOString() })
      .eq('id', id)
    if (updError) throw updError

    revalidatePath('/agente-corban/solicitacoes')
    revalidatePath(`/agente-corban/solicitacoes/${id}`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function reprovarSolicitacao(id: string, motivo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    if (!motivo.trim()) return { success: false, error: 'Informe o motivo da reprovação.' }
    const admin = await createAdminClient()

    const { error } = await admin
      .from('solicitacoes_atualizacao_cadastral')
      .update({
        status: 'reprovada',
        motivo_reprovacao: motivo.trim(),
        revisado_por: user.id,
        revisado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pendente')
    if (error) throw error

    revalidatePath('/agente-corban/solicitacoes')
    revalidatePath(`/agente-corban/solicitacoes/${id}`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
