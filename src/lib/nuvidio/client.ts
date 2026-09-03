/**
 * Cliente da API Nuvidio (https://docs.nuvidio.com/reference/api-nuvidio).
 *
 * Auth: API KEY + SECRET → POST /authenticate → JWT (cacheado em memória por
 * alguns minutos). Credenciais vivem cifradas em `nuvidio_config` (cofre
 * AES, mesma chave dos demais provedores) — nunca chegam ao navegador.
 *
 * OBS: os shapes de resposta foram tirados da documentação pública; o
 * botão "Testar conexão" do card valida contra a conta real na primeira
 * configuração (endpoints podem variar por plano).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

const BASE = 'https://api.nuvidio.com'

export type NuvidioConfigPublica = {
  temCredenciais: boolean
  departmentPadraoId: string
  departmentPadraoNome: string
  webhookKey: string
  isActive: boolean
  atualizadoEm: string | null
}

export type NuvidioDepartment = { id: string; nome: string }

export type NuvidioInviteCriado = {
  inviteId: string
  link: string
}

type ConfigRow = {
  id: number
  api_key_enc: string | null
  api_secret_enc: string | null
  department_padrao_id: string
  department_padrao_nome: string
  webhook_key: string
  is_active: boolean
  updated_at: string | null
}

export async function lerNuvidioConfigRow(): Promise<ConfigRow | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('nuvidio_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (String(error.message || '').includes('nuvidio_config')) return null
    throw error
  }
  return (data as ConfigRow | null) || null
}

export async function lerNuvidioConfigPublica(): Promise<NuvidioConfigPublica> {
  const row = await lerNuvidioConfigRow()
  return {
    temCredenciais: Boolean(row?.api_key_enc && row?.api_secret_enc),
    departmentPadraoId: row?.department_padrao_id || '',
    departmentPadraoNome: row?.department_padrao_nome || '',
    webhookKey: row?.webhook_key || '',
    isActive: row?.is_active !== false,
    atualizadoEm: row?.updated_at || null,
  }
}

export async function salvarNuvidioConfig(input: {
  apiKey?: string
  apiSecret?: string
  departmentPadraoId: string
  departmentPadraoNome: string
  webhookKey?: string
  isActive: boolean
  updatedBy: string
}): Promise<void> {
  const admin = await createAdminClient()
  const atual = await lerNuvidioConfigRow()
  const { error } = await admin.from('nuvidio_config').upsert(
    {
      id: 1,
      api_key_enc: input.apiKey?.trim() ? cifrarTexto(input.apiKey.trim()) : atual?.api_key_enc || null,
      api_secret_enc: input.apiSecret?.trim() ? cifrarTexto(input.apiSecret.trim()) : atual?.api_secret_enc || null,
      department_padrao_id: input.departmentPadraoId.trim(),
      department_padrao_nome: input.departmentPadraoNome.trim(),
      webhook_key: (input.webhookKey ?? atual?.webhook_key ?? '').trim(),
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Autenticação (JWT com cache em memória do runtime)
// ---------------------------------------------------------------------------

let jwtCache: { token: string; expiraEm: number } | null = null

async function obterJwt(): Promise<string> {
  if (jwtCache && Date.now() < jwtCache.expiraEm) return jwtCache.token
  const row = await lerNuvidioConfigRow()
  if (!row?.api_key_enc || !row?.api_secret_enc) {
    throw new Error('Credenciais da Nuvidio não configuradas (Provedores e APIs › Nuvidio).')
  }
  const res = await fetch(`${BASE}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: decifrarTexto(row.api_key_enc), apiSecret: decifrarTexto(row.api_secret_enc) }),
  })
  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    throw new Error(`Autenticação Nuvidio falhou (${res.status}): ${corpo.slice(0, 200)}`)
  }
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  const token = String((data as any)?.token || (data as any)?.jwt || (data as any)?.accessToken || '')
  if (!token) throw new Error('A Nuvidio autenticou mas não devolveu o token JWT.')
  jwtCache = { token, expiraEm: Date.now() + 8 * 60 * 1000 }
  return token
}

async function chamar(path: string, init?: RequestInit): Promise<any> {
  const token = await obterJwt()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const texto = await res.text()
  let data: any = null
  try {
    data = texto ? JSON.parse(texto) : null
  } catch {
    data = texto
  }
  if (!res.ok) {
    // token expirado no meio do caminho → limpa o cache pro retry seguinte
    if (res.status === 401) jwtCache = null
    throw new Error(`Nuvidio ${res.status} em ${path}: ${String(texto).slice(0, 200)}`)
  }
  return data
}

// ---------------------------------------------------------------------------
// Endpoints usados pelo Workspace
// ---------------------------------------------------------------------------

export async function testarConexaoNuvidio(): Promise<{ ok: boolean; detalhe: string; departments?: NuvidioDepartment[] }> {
  try {
    const departments = await listarDepartments()
    return { ok: true, detalhe: `Conectado — ${departments.length} departamento(s).`, departments }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Falha na conexão.' }
  }
}

export async function listarDepartments(): Promise<NuvidioDepartment[]> {
  const data = await chamar('/v1/api/department')
  const lista = Array.isArray(data) ? data : Array.isArray(data?.departments) ? data.departments : Array.isArray(data?.data) ? data.data : []
  return lista.map((d: any) => ({ id: String(d._id || d.id || ''), nome: String(d.name || d.nome || '') })).filter((d: NuvidioDepartment) => d.id)
}

export async function criarInvite(input: {
  departmentId: string
  expirationDate?: string
  initialDate?: string
  schedule?: boolean
  customerData: Array<{ value: string; label: string; type?: string; private?: boolean }>
}): Promise<NuvidioInviteCriado> {
  const data = await chamar(`/v1/api/invite/department/${encodeURIComponent(input.departmentId)}`, {
    method: 'POST',
    body: JSON.stringify({
      expirationDate: input.expirationDate,
      initialDate: input.initialDate,
      push: true,
      schedule: Boolean(input.schedule),
      customerData: input.customerData,
    }),
  })
  const inviteId = String(data?._id || data?.id || data?.inviteId || data?.invite?._id || '')
  const link = String(data?.link || data?.url || data?.inviteLink || data?.invite?.link || '')
  if (!inviteId && !link) throw new Error(`A Nuvidio criou o convite mas não devolveu id/link reconhecíveis: ${JSON.stringify(data).slice(0, 200)}`)
  return { inviteId, link }
}

export async function desabilitarInvite(inviteId: string): Promise<void> {
  await chamar(`/v1/api/invite/${encodeURIComponent(inviteId)}/disable`, { method: 'PUT' }).catch(async (err) => {
    // rota alternativa documentada como "desabilitar invite"
    await chamar(`/v1/api/invite/disable/${encodeURIComponent(inviteId)}`, { method: 'PUT' }).catch(() => {
      throw err
    })
  })
}

export async function buscarLinkGravacao(callIdOuInviteId: string): Promise<string | null> {
  try {
    const data = await chamar(`/v1/api/call/${encodeURIComponent(callIdOuInviteId)}/recording-link`)
    return String(data?.link || data?.url || data?.recordingLink || '') || null
  } catch {
    return null
  }
}

/** SSO transparente do atendente — devolve URL/token pra abrir o painel logado. */
export async function ssoAtendente(email: string): Promise<{ url: string | null; bruto: any }> {
  const data = await chamar('/v1/api/attendant/single-sign-on', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  const url = String(data?.url || data?.link || data?.ssoUrl || '') || null
  return { url, bruto: data }
}
