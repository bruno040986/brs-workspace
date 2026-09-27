/**
 * Leituras (DTOs do contrato F0 §5.2) — o que as telas S1/S2 consomem. A UI
 * NUNCA deriva `obsoleto`, janela nem direitos: tudo vem calculado daqui.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { contarVariaveisBody, obsoleto } from './sync-regras'

type Admin = Awaited<ReturnType<typeof createAdminClient>>

export type SaudeNumero = {
  instanciaId: string
  qualidade: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  limiteNumero: string
  limitePortfolio: string
  status: string
  nomeVerificado: string | null
  nameStatus: string
  observadoEm: string | null
  obsoleto: boolean
}

export type TemplateYcloud = {
  nome: string
  idioma: string
  categoria: string
  status: string
  qualidade: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  componentes: unknown[]
  variaveis: number
  sincronizadoEm: string
}

export type SaldoCarteira = { moeda: string; saldo: string; observadoEm: string; obsoleto: boolean }
export type JanelaConversa = { aberta: boolean; expiraEm?: string }

const QUALIDADES = new Set(['GREEN', 'YELLOW', 'RED'])
const qualidade = (q: unknown): SaudeNumero['qualidade'] => (QUALIDADES.has(String(q)) ? (String(q) as SaudeNumero['qualidade']) : 'UNKNOWN')

export async function lerSaudeNumero(admin: Admin, instanciaId: string): Promise<SaudeNumero> {
  const { data, error } = await admin.from('ycloud_numeros_saude').select('*').eq('instancia_id', instanciaId).maybeSingle()
  if (error) throw error
  return {
    instanciaId,
    qualidade: qualidade(data?.quality_rating),
    limiteNumero: String(data?.messaging_limit || 'TIER_NOT_SET'),
    limitePortfolio: String(data?.bm_messaging_limit || 'TIER_NOT_SET'),
    status: String(data?.status || 'UNKNOWN'),
    nomeVerificado: data?.verified_name ? String(data.verified_name) : null,
    nameStatus: String(data?.name_status || 'NONE'),
    observadoEm: data?.observado_em ? String(data.observado_em) : null,
    obsoleto: obsoleto(data?.observado_em ? String(data.observado_em) : null),
  }
}

export async function listarTemplates(admin: Admin, conexaoId: string, wabaId: string, apenasAprovados = false): Promise<TemplateYcloud[]> {
  let q = admin.from('ycloud_templates').select('nome, idioma, categoria, status, quality_rating, componentes, sincronizado_em').eq('conexao_id', conexaoId).eq('waba_id', wabaId).order('nome')
  if (apenasAprovados) q = q.eq('status', 'APPROVED')
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((t) => ({
    nome: String(t.nome),
    idioma: String(t.idioma),
    categoria: String(t.categoria || ''),
    status: String(t.status || ''),
    qualidade: qualidade(t.quality_rating),
    componentes: (t.componentes as unknown[]) || [],
    variaveis: contarVariaveisBody(t.componentes as unknown[]),
    sincronizadoEm: String(t.sincronizado_em),
  }))
}

export async function lerSaldos(admin: Admin, conexaoId: string): Promise<SaldoCarteira[]> {
  const { data, error } = await admin.from('ycloud_saldos').select('moeda, saldo, observado_em').eq('conexao_id', conexaoId)
  if (error) throw error
  return (data || []).map((s) => ({ moeda: String(s.moeda), saldo: String(s.saldo), observadoEm: String(s.observado_em), obsoleto: obsoleto(String(s.observado_em)) }))
}

/** Janela de 24 h calculada no SERVIDOR pela última mensagem do cliente (ADR-6). Mesma regra do engine. */
export async function lerJanelaConversa(admin: Admin, conversaId: string, agoraMs = Date.now()): Promise<JanelaConversa> {
  const { data, error } = await admin.from('chat_conversas').select('ultima_mensagem_cliente_em').eq('id', conversaId).maybeSingle()
  if (error) throw error
  const t = data?.ultima_mensagem_cliente_em ? Date.parse(String(data.ultima_mensagem_cliente_em)) : NaN
  if (!Number.isFinite(t)) return { aberta: false }
  const expira = t + 24 * 60 * 60 * 1000
  return expira > agoraMs ? { aberta: true, expiraEm: new Date(expira).toISOString() } : { aberta: false }
}
