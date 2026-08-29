/**
 * Conta Chatwoot do PARCEIRO — criada pelo Workspace no momento em que o
 * AlvoConsig é habilitado no Agente Corban (decisão Bruno 29/08/2026: o
 * parceiro entra no CRM e já lê os QR Codes; nada de "ativar" do lado dele).
 * Idempotente: se já existir chat_contas do parceiro, não faz nada.
 * Usa a Platform API (CHATWOOT_PLATFORM_TOKEN) e grava o token do usuário
 * técnico cifrado no formato que o CRM lê (`{ token }`).
 */
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarJson } from './cofre'

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

export async function provisionarContaChatDoParceiro(agenteParceiroId: string): Promise<{ criada: boolean; chatwootAccountId: number }> {
  const admin = await createAdminClient()
  const { data: existente } = await admin.from('chat_contas').select('chatwoot_account_id').eq('agente_parceiro_id', agenteParceiroId).maybeSingle()
  if (existente) return { criada: false, chatwootAccountId: Number(existente.chatwoot_account_id) }

  const { data: parceiro } = await admin.from('agentes_parceiros').select('arw_code, fantasy_name, name').eq('id', agenteParceiroId).maybeSingle()
  const nome = String(parceiro?.fantasy_name || parceiro?.name || 'Parceiro').trim()
  const slug = String(parceiro?.arw_code || agenteParceiroId.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '')

  const conta = await plataforma<{ id: number; name: string }>('/accounts', { name: `${nome} — AlvoConsig`, locale: 'pt_BR' })
  const usuario = await plataforma<{ id: number; access_token?: string }>('/users', {
    name: `CRM ${nome}`,
    email: `crm-${slug}@alvoconsig.brspromotora.com.br`,
    password: randomBytes(18).toString('base64url'),
    custom_attributes: { origem: 'alvoconsig', agente_parceiro_id: agenteParceiroId },
  })
  await plataforma(`/accounts/${conta.id}/account_users`, { user_id: usuario.id, role: 'administrator' })
  const token = usuario.access_token || (await plataforma<{ access_token?: string }>(`/users/${usuario.id}`, undefined)).access_token
  if (!token) throw new Error('Chatwoot não devolveu o token do usuário técnico.')

  const { error } = await admin.from('chat_contas').insert({
    owner_tipo: 'parceiro',
    agente_parceiro_id: agenteParceiroId,
    nome: conta.name,
    chatwoot_account_id: conta.id,
    token_cifrado: cifrarJson({ token }),
  })
  if (error) throw error
  return { criada: true, chatwootAccountId: conta.id }
}
