/**
 * Agentes da conta BRS no Chatwoot — espelho dos usuários do Workspace com a
 * permissão `conversas`. O Chatwoot só deixa atribuir conversa a quem é agente
 * da conta, então cada usuário elegível ganha (uma vez) um usuário Chatwoot
 * via Platform API (senha aleatória — ninguém loga no Chatwoot direto, a UI é
 * sempre o Workspace com o token da conta) e entra em todas as inboxes.
 * Idempotente e best-effort: roda no bootstrap do Atendimento e só faz
 * escrita quando aparece usuário novo; falha individual não derruba o resto.
 */
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import type { ChatwootConta } from './chatwoot'

function base(): string {
  return String(process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br').replace(/\/$/, '')
}

async function plataforma<T>(path: string, body: unknown): Promise<T> {
  const token = process.env.CHATWOOT_PLATFORM_TOKEN
  if (!token) throw new Error('CHATWOOT_PLATFORM_TOKEN não configurado no Workspace.')
  const res = await fetch(`${base()}/platform/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { api_access_token: token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Chatwoot Platform HTTP ${res.status} em ${path}: ${text.slice(0, 200)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/**
 * Garante que todo usuário ativo do Workspace com permissão `conversas` exista
 * como agente na conta BRS do Chatwoot. Retorna quantos foram criados.
 */
export async function sincronizarAgentesBrs(cli: ChatwootConta): Promise<number> {
  const accountId = cli.accountId
  const admin = await createAdminClient()
  const [{ data: usuarios }, agentes] = await Promise.all([
    admin.from('users').select('id, name, nome_exibicao, email').not('email', 'is', null).neq('active', false),
    cli.agentes(),
  ])
  const emailsAgentes = new Set(agentes.map((a) => String(a.email || '').toLowerCase()))
  const faltantes = (usuarios || []).filter((u) => u.email && !emailsAgentes.has(String(u.email).toLowerCase()))
  if (faltantes.length === 0) return 0

  let criados = 0
  let inboxes: Array<{ id: number }> = []
  try {
    inboxes = await cli.listarInboxes()
  } catch {
    // sem inboxes listáveis o agente ainda vale pra atribuição
  }

  for (const u of faltantes) {
    try {
      if (!(await hasPermissionForUser(String(u.id), 'conversas', 'can_view'))) continue
      const usuario = await plataforma<{ id: number }>('/users', {
        name: String(u.nome_exibicao || u.name || u.email),
        email: String(u.email),
        password: randomBytes(18).toString('base64url'),
        custom_attributes: { origem: 'brs-workspace', workspace_user_id: String(u.id) },
      })
      await plataforma(`/accounts/${accountId}/account_users`, { user_id: usuario.id, role: 'agent' })
      for (const inbox of inboxes) {
        try {
          await cli.adicionarMembroInbox(inbox.id, usuario.id)
        } catch {
          // membership é conveniência (auto-assign/visibilidade nativa) — não bloqueia
        }
      }
      criados++
    } catch (err) {
      console.error('[conversas] falha ao provisionar agente Chatwoot', u.email, err)
    }
  }
  return criados
}
