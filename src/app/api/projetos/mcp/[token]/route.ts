/**
 * MCP do módulo Projetos (Streamable HTTP, stateless, respostas JSON).
 * O token do agente vai na URL (conectores do claude.ai/ChatGPT não mandam
 * header customizado); `Authorization: Bearer <token>` também vale e tem
 * precedência. Token inválido → 401 (fail-closed).
 */
import { revalidatePath } from 'next/cache'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { agentePorToken } from '@/lib/projetos/service'
import { MCP_TOOLS_LEITURA, responderMcp } from '@/lib/projetos/mcp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const rpcErro = (code: number, message: string, status: number) =>
  Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status })

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const doHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  let token: string
  try {
    token = doHeader || decodeURIComponent((await ctx.params).token || '')
  } catch {
    return rpcErro(-32001, 'Token inválido ou IA inativa.', 401)
  }

  let admin: Awaited<ReturnType<typeof createAdminClient>>
  let agente
  try {
    admin = await createAdminClient()
    agente = await agentePorToken(admin, token)
  } catch (err) {
    console.error('MCP Projetos: falha ao validar token:', err instanceof Error ? err.message : err)
    return rpcErro(-32603, 'Serviço indisponível.', 503)
  }
  if (!agente) return rpcErro(-32001, 'Token inválido ou IA inativa.', 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return rpcErro(-32700, 'Parse error', 400)
  }

  const lote = Array.isArray(body)
  const msgs = (lote ? body : [body]) as Parameters<typeof responderMcp>[2][]
  if (!msgs.length) return rpcErro(-32600, 'Invalid Request', 400)

  const respostas = []
  let escreveu = false
  for (const m of msgs) {
    const r = await responderMcp(admin, agente, m)
    if (r) respostas.push(r)
    if (m?.method === 'tools/call' && !MCP_TOOLS_LEITURA.has(String(m.params?.name || ''))) escreveu = true
  }
  if (escreveu) revalidatePath('/projetos', 'layout')

  // Só notificações/respostas → 202 sem corpo.
  if (!respostas.length) return new Response(null, { status: 202 })
  return Response.json(lote ? respostas : respostas[0])
}

export async function GET() {
  // Sem stream SSE iniciado pelo servidor (stateless).
  return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } })
}

export async function DELETE() {
  return new Response(null, { status: 200 })
}
