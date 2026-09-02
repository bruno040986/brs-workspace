/**
 * POST /api/ia/chat — conversa com o Jarvis, resposta em streaming (texto puro).
 *
 * Body: { conversaId?: string; mensagem: string }
 * Headers de resposta: X-Ia-Conversa (id da conversa) e, ao final do stream,
 * a mensagem fica persistida com o modelo que respondeu.
 *
 * A chave do provedor NUNCA sai daqui: é lida do cofre (ia_config) e usada
 * só nesta chamada servidor→OpenRouter. Permissão: `workspace-ia`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { lerChaveProvedor, montarSystemPrompt } from '@/lib/ia/config'
import { conversarComFallback, type IaTurno } from '@/lib/ia/openrouter'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LIMITE_HISTORICO = 24 // últimas N mensagens vão de contexto

export async function POST(req: NextRequest) {
  let userId = ''
  try {
    const { user } = await requirePermission('workspace-ia')
    userId = user.id
  } catch {
    return NextResponse.json({ error: 'Sem permissão para usar a IA do Workspace.' }, { status: 403 })
  }

  let body: { conversaId?: string; mensagem?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  }
  const mensagem = String(body.mensagem || '').trim()
  if (!mensagem) return NextResponse.json({ error: 'Mensagem vazia.' }, { status: 400 })
  if (mensagem.length > 8000) return NextResponse.json({ error: 'Mensagem longa demais.' }, { status: 400 })

  const provedor = await lerChaveProvedor()
  if (!provedor) {
    return NextResponse.json(
      { error: 'A IA do Workspace ainda não foi configurada. Peça a um administrador para cadastrar a credencial em Configurações › IA do Workspace.' },
      { status: 503 },
    )
  }

  const admin = await createAdminClient()

  // Nome/cargo do usuário para o Jarvis tratar como colega (fonte: espelho users).
  const { data: perfil } = await admin.from('users').select('name, role').eq('id', userId).maybeSingle()
  const userName = String(perfil?.name || '')
  const userRole = String(perfil?.role || '')

  // Conversa: retoma a informada (do próprio usuário) ou cria uma nova.
  let conversaId = String(body.conversaId || '')
  if (conversaId) {
    const { data } = await admin.from('ia_conversas').select('id').eq('id', conversaId).eq('user_id', userId).maybeSingle()
    if (!data) conversaId = ''
  }
  if (!conversaId) {
    const { data, error } = await admin
      .from('ia_conversas')
      .insert({ user_id: userId, titulo: mensagem.slice(0, 80) })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: 'Erro ao criar a conversa.' }, { status: 500 })
    conversaId = String(data.id)
  }

  // Histórico (antes de gravar a nova mensagem do usuário).
  const { data: historico } = await admin
    .from('ia_mensagens')
    .select('role, content')
    .eq('conversa_id', conversaId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_HISTORICO)

  await admin.from('ia_mensagens').insert({ conversa_id: conversaId, role: 'user', content: mensagem })

  const turnos: IaTurno[] = [
    { role: 'system', content: montarSystemPrompt(provedor.personalidade, { nome: userName, cargo: userRole }) },
    ...(historico || [])
      .reverse()
      .map((m) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user', content: String(m.content) })),
    { role: 'user', content: mensagem },
  ]

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const resultado = await conversarComFallback(
          provedor.apiKey,
          provedor.modelos,
          turnos,
          (delta) => controller.enqueue(encoder.encode(delta)),
          req.signal,
        )
        await admin.from('ia_mensagens').insert({
          conversa_id: conversaId,
          role: 'assistant',
          content: resultado.texto,
          modelo: resultado.modeloUsado,
        })
        await admin.from('ia_conversas').update({ updated_at: new Date().toISOString() }).eq('id', conversaId)
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao consultar a IA.'
        // Erro no meio do stream: entrega como texto para o cliente exibir.
        controller.enqueue(encoder.encode(`\n\n[erro] ${msg.includes('401') || msg.includes('403') ? 'Credencial do provedor inválida — confira a chave em Configurações › IA do Workspace.' : msg}`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Ia-Conversa': conversaId,
    },
  })
}
