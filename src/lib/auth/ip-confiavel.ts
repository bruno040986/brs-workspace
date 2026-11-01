import { isIP } from 'node:net'

// IP observado so de cabecalho que a PLATAFORMA define: na Vercel, x-forwarded-for (primeiro valor) e x-real-ip sao
// sobrescritos pela borda. Fora da Vercel nenhum cabecalho e confiavel (cliente forja) => null (sem limitador por IP).
export function ipConfiavel(get: (nome: string) => string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (!env.VERCEL) return null
  const candidatos = [(get('x-forwarded-for') || '').split(',')[0].trim(), (get('x-real-ip') || '').trim()]
  for (const c of candidatos) if (c && isIP(c)) return c
  return null
}
