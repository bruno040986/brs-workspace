/**
 * Webhook do GitHub (evento push) → projeto_commits. Liga cada commit a
 * projeto/tarefa pela referência na mensagem (PRJ-3, PRJ-3/T-2, T-2).
 * Assinatura: x-hub-signature-256 = HMAC-SHA256 do corpo bruto com
 * GITHUB_WEBHOOK_SECRET (503 sem env, 401 se não confere).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { registrarPushGithub } from '@/lib/projetos/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

function assinaturaConfere(recebida: string, esperada: string): boolean {
  const a = createHash('sha256').update(recebida).digest()
  const b = createHash('sha256').update(esperada).digest()
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const segredo = String(process.env.GITHUB_WEBHOOK_SECRET || '')
  if (!segredo) return Response.json({ ok: false, error: 'webhook secret not configured' }, { status: 503 })

  const corpo = await req.text()
  const recebida = req.headers.get('x-hub-signature-256') || ''
  const esperada = `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`
  if (!recebida || !assinaturaConfere(recebida, esperada)) return Response.json({ ok: false, error: 'invalid signature' }, { status: 401 })

  const evento = req.headers.get('x-github-event') || ''
  if (evento !== 'push') return Response.json({ ok: true, ignorado: evento || 'sem evento' })

  let payload: unknown
  try {
    payload = JSON.parse(corpo)
  } catch {
    return Response.json({ ok: false, error: 'invalid json (use content type application/json)' }, { status: 400 })
  }

  try {
    const r = await registrarPushGithub(await createAdminClient(), payload as Parameters<typeof registrarPushGithub>[1])
    return Response.json({ ok: true, ...r })
  } catch (err) {
    console.error('Webhook GitHub Projetos: falha ao gravar commits:', err instanceof Error ? err.message : (err as { message?: unknown })?.message)
    return Response.json({ ok: false, error: 'falha ao gravar' }, { status: 500 })
  }
}
