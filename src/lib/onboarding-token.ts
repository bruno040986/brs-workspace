import { createHmac, timingSafeEqual } from 'crypto'

// Token de sessão do formulário público de onboarding.
// Amarra a consulta anônima de CPF (/api/cpfhub) a um formulário público que
// realmente foi carregado, reduzindo o uso do endpoint como scraper/enumerador.
// Assinado com HMAC-SHA256 usando o service-role key como segredo (nunca sai do server).

const TOKEN_TTL_MS = 1000 * 60 * 60 // 1h
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || 'insecure-dev-secret'

function sign(expiresAt: number): string {
  return createHmac('sha256', SECRET).update(`onboarding:${expiresAt}`).digest('hex')
}

export function issueOnboardingToken(now: number = Date.now()): string {
  const expiresAt = now + TOKEN_TTL_MS
  return `${expiresAt}.${sign(expiresAt)}`
}

export function verifyOnboardingToken(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token) return false
  const [expStr, sig] = String(token).split('.')
  const expiresAt = Number(expStr)
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false
  const expected = sign(expiresAt)
  if (!sig || sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}
