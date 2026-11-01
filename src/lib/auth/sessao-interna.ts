import 'server-only'
import { cache } from 'react'
import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { calcularEtapa, type ClaimsSessao, type EstadoBanco } from './etapas'
import { registrarEventoSeguranca } from '@/lib/seguranca/registrar'

// Leitura da sessão a partir do JWT VERIFICADO (getClaims) e do estado no banco. Nunca aceita
// userId/sessionId/e-mail de parâmetro de cliente.

export async function lerClaimsVerificados(): Promise<ClaimsSessao | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return null
  return data.claims as unknown as ClaimsSessao
}

export async function obterEstadoBanco(userId: string, sessionId: string, aal: string | undefined): Promise<EstadoBanco | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.rpc('auth_estado_sessao', { p_user: userId, p_session: sessionId, p_aal: aal ?? '' })
  if (error || !data) return null
  return data as EstadoBanco
}

export async function obterEtapaSessao() {
  const claims = await lerClaimsVerificados()
  if (!claims?.sub || !claims.session_id) return { ...calcularEtapa(null, null), claims: null, estado: null }
  const estado = await obterEstadoBanco(claims.sub, claims.session_id, claims.aal)
  return { ...calcularEtapa(claims, estado), claims, estado }
}

const liberadaCache = cache(async (userId: string, sessionId: string, aal: string): Promise<boolean | 'erro'> => {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin.rpc('auth_sessao_liberada', { p_user: userId, p_session: sessionId, p_aal: aal })
    if (error) return 'erro'
    return data === true
  } catch {
    return 'erro'
  }
})

/**
 * Barreira de servidor da etapa 5 (Server Actions e handlers com service_role, onde a RLS não vale).
 * Chamada por requireCurrentUser/requirePermission. Falha (inclusive infraestrutura) => nega.
 */
export async function requireSessaoInternaCompleta(id: { userId: string; sessionId?: string; aal?: string }): Promise<void> {
  if (!id.sessionId) throw new Error('Sessao nao liberada.')
  const r = await liberadaCache(id.userId, id.sessionId, id.aal ?? '')
  if (r !== true) throw new Error('Sessao nao liberada.')
}

export type EntradaLog = {
  etapa: 'senha' | 'identidade' | 'totp' | 'email' | 'ativacao' | 'sessao' | 'logout' | 'admin' | 'permissao'
  resultado: 'sucesso' | 'falha' | 'pausa' | 'bloqueado' | 'erro_infra' | 'negado' | 'alerta'
  motivo: string // [a-z0-9_]{1,48}, vocabulário técnico controlado; nunca texto livre
  identidadeInformada?: string | null
  userId?: string | null
  sessionId?: string | null
  pausaAte?: Date | null
  bloqueioId?: string | null
  desbloqueadoPor?: string | null
  alerta?: boolean
}

export async function contextoRequisicao() {
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  return {
    ip: (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip') || '').slice(0, 64) || null, // observado, sem atribuição
    ua: (h.get('user-agent') || '').slice(0, 300) || null,
    requestId: (h.get('x-vercel-id') || h.get('x-request-id') || randomUUID()).slice(0, 80),
  }
}

function tipoEventoSeguranca(e: EntradaLog): string | null {
  if (e.etapa === 'email' && e.resultado === 'sucesso' && e.motivo === 'liberado') return 'login.concluido' // 5 etapas concluídas
  if (e.resultado === 'negado' && (e.motivo === 'sem_prova_ativacao' || e.motivo === 'fator_nao_aprovado')) return 'fator.desconhecido'
  if (e.etapa === 'admin') return null // bloqueio/desbloqueio administrativo é ação deliberada, não ataque
  if (e.resultado === 'falha') return 'login.falha'
  if (e.resultado === 'pausa') return 'login.pausa'
  if (e.resultado === 'bloqueado') return 'login.bloqueio'
  return null
}

/** Grava em acessos_log. Nunca lança e nunca recebe senha, código, segredo, cookie ou token. */
export async function registrarAcesso(e: EntradaLog): Promise<void> {
  try {
    const ctx = await contextoRequisicao()
    const admin = await createAdminClient()
    const { data: linha, error } = await admin.from('acessos_log').insert({
      etapa: e.etapa, resultado: e.resultado, motivo: e.motivo,
      identidade_informada: e.identidadeInformada ? e.identidadeInformada.slice(0, 254) : null,
      user_id_validado: e.userId ?? null, session_id: e.sessionId ?? null,
      request_id: ctx.requestId, ip_observado: ctx.ip, user_agent_observado: ctx.ua,
      pausa_ate: e.pausaAte ? e.pausaAte.toISOString() : null, bloqueio_id: e.bloqueioId ?? null,
      desbloqueado_por: e.desbloqueadoPor ?? null, alerta: e.alerta ?? false,
    }).select('id').single()
    if (error) console.error('acessos_log: falha ao gravar', error.code)
    // M05/M06: mesmo fato vira evento de segurança (idempotente por acessos_log:<id>; nunca lança, não recebe senha/código).
    const tipo = tipoEventoSeguranca(e)
    if (tipo) {
      await registrarEventoSeguranca({
        fonte: 'workspace_login', tipo, idOrigem: linha?.id ? `acessos_log:${linha.id}` : null, requestId: ctx.requestId,
        identidadeInformada: e.identidadeInformada ?? null, identidadeValidadaUserId: tipo === 'login.concluido' ? e.userId ?? null : null,
        ipObservado: ctx.ip, userAgentObservado: ctx.ua, payload: { etapa: e.etapa, resultado: e.resultado, motivo: e.motivo },
      })
    }
  } catch {
    console.error('acessos_log: falha ao gravar')
  }
}
