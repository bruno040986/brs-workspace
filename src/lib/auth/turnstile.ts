// Cloudflare Turnstile — gancho de servidor PRONTO e DESLIGADO por padrão.
// Liga com TURNSTILE_ENFORCE=true. Ligado sem TURNSTILE_SECRET_KEY => falha fechado (nunca bypass silencioso).
export type ResultadoTurnstile = { ok: boolean; aplicado: boolean; motivo?: 'desligado' | 'sem_segredo' | 'token_ausente' | 'invalido' | 'indisponivel' }

export async function verificarTurnstile(token: string | undefined | null, ip?: string | null, env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Promise<ResultadoTurnstile> {
  if (env.TURNSTILE_ENFORCE !== 'true') return { ok: true, aplicado: false, motivo: 'desligado' }
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, aplicado: true, motivo: 'sem_segredo' }
  if (!token) return { ok: false, aplicado: true, motivo: 'token_ausente' }
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, aplicado: true, motivo: 'indisponivel' }
    const j = (await res.json()) as { success?: boolean }
    return j.success === true ? { ok: true, aplicado: true } : { ok: false, aplicado: true, motivo: 'invalido' }
  } catch {
    return { ok: false, aplicado: true, motivo: 'indisponivel' }
  }
}
