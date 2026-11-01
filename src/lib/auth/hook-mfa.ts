import { createHmac, timingSafeEqual } from 'node:crypto'

// M04 I1: Auth Hook "MFA Verification Attempt" (HTTPS). Torna o contador de TOTP do banco autoritativo tambem
// para quem fala direto com o GoTrue (/factors/{id}/verify). Falha fechada: sem segredo, assinatura invalida,
// payload invalido ou erro de infraestrutura => nunca "continue" por omissao (o GoTrue trata erro do hook como negado).
// Assinatura: Standard Webhooks (headers webhook-id/-timestamp/-signature; segredo "v1,whsec_<base64>").
export type DepsHook = {
  segredo: string | undefined
  agora?: () => number
  pausaAtual: (userId: string) => Promise<number | null> // segundos; null = erro de infra
  registrarFalha: (userId: string) => Promise<{ pausaSeg: number; alerta: boolean } | null>
  registrarSucesso: (userId: string) => Promise<void>
  log?: (e: { resultado: 'falha' | 'pausa' | 'sucesso' | 'erro_infra' | 'negado'; motivo: string; userId?: string; pausaSeg?: number; alerta?: boolean }) => Promise<void>
}
export type RespostaHook = { status: number; corpo: Record<string, unknown> }

const TOLERANCIA_S = 300
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assinaturaValida(segredo: string, h: { id: string | null; timestamp: string | null; assinatura: string | null }, corpo: string, agoraMs: number): boolean {
  if (!h.id || !h.timestamp || !h.assinatura) return false
  const ts = Number(h.timestamp)
  if (!Number.isFinite(ts) || Math.abs(agoraMs / 1000 - ts) > TOLERANCIA_S) return false
  const bruto = segredo.replace(/^v1,/, '').replace(/^whsec_/, '')
  const chave = Buffer.from(bruto, 'base64')
  if (chave.length < 16) return false
  const esperado = createHmac('sha256', chave).update(`${h.id}.${h.timestamp}.${corpo}`).digest()
  return h.assinatura.split(' ').some((par) => {
    const [v, b64] = par.split(',')
    if (v !== 'v1' || !b64) return false
    const recebido = Buffer.from(b64, 'base64')
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
  })
}

const rejeita = (message: string): RespostaHook => ({ status: 200, corpo: { decision: 'reject', message } })

export async function processarHookMfa(h: { id: string | null; timestamp: string | null; assinatura: string | null }, corpo: string, d: DepsHook): Promise<RespostaHook> {
  const log = d.log ?? (async () => {})
  if (!d.segredo || d.segredo.length < 20) return { status: 503, corpo: { error: 'hook nao configurado' } } // fecha: GoTrue nega
  if (!assinaturaValida(d.segredo, h, corpo, (d.agora ?? Date.now)())) return { status: 401, corpo: { error: 'assinatura invalida' } }
  let p: { user_id?: unknown; valid?: unknown }
  try { p = JSON.parse(corpo) } catch { return { status: 400, corpo: { error: 'payload invalido' } } }
  if (typeof p.user_id !== 'string' || !UUID.test(p.user_id) || typeof p.valid !== 'boolean') return { status: 400, corpo: { error: 'payload invalido' } }
  const userId = p.user_id.toLowerCase()

  const pausa = await d.pausaAtual(userId)
  if (pausa === null) { await log({ resultado: 'erro_infra', motivo: 'hook_mfa_infra', userId }); return { status: 503, corpo: { error: 'indisponivel' } } }
  if (pausa > 0) { // em pausa nem o codigo certo vale (mesma regra da Server Action)
    await log({ resultado: 'pausa', motivo: 'hook_mfa_pausa_ativa', userId, pausaSeg: pausa })
    return rejeita('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
  }
  if (p.valid) { await d.registrarSucesso(userId); return { status: 200, corpo: { decision: 'continue' } } }

  const f = await d.registrarFalha(userId)
  if (!f) { await log({ resultado: 'erro_infra', motivo: 'hook_mfa_infra', userId }); return { status: 503, corpo: { error: 'indisponivel' } } }
  await log({ resultado: f.pausaSeg > 0 ? 'pausa' : 'falha', motivo: f.pausaSeg > 0 ? 'hook_mfa_pausa_aplicada' : 'hook_mfa_totp_invalido', userId, pausaSeg: f.pausaSeg, alerta: f.alerta })
  return f.pausaSeg > 0 ? rejeita('Muitas tentativas. Aguarde alguns minutos e tente novamente.') : { status: 200, corpo: { decision: 'continue' } } // invalido: o proprio GoTrue recusa o codigo
}
