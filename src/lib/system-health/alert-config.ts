import { createAdminClient } from '@/lib/supabase/server'

export type AlertConfigState = {
  id: string
  telefone: string
  mensagemDegradado: string
  mensagemRecuperado: string
}

const MENSAGEM_DEGRADADO_PADRAO = '⚠️ BRS Workspace: {sistema} degradado/indisponível desde {data}.'
const MENSAGEM_RECUPERADO_PADRAO = '✅ BRS Workspace: {sistema} normalizado às {data}.'

export function createEmptyAlertConfig(): AlertConfigState {
  return {
    id: '',
    telefone: '',
    mensagemDegradado: MENSAGEM_DEGRADADO_PADRAO,
    mensagemRecuperado: MENSAGEM_RECUPERADO_PADRAO,
  }
}

function normalizeRow(row: Record<string, unknown> | null): AlertConfigState {
  if (!row) return createEmptyAlertConfig()
  return {
    id: String(row.id || ''),
    telefone: String(row.telefone || ''),
    mensagemDegradado: String(row.mensagem_degradado || MENSAGEM_DEGRADADO_PADRAO),
    mensagemRecuperado: String(row.mensagem_recuperado || MENSAGEM_RECUPERADO_PADRAO),
  }
}

export async function getAlertConfig(): Promise<AlertConfigState> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('system_alert_config').select('*').limit(1).maybeSingle()
  if (error) throw error
  return normalizeRow(data)
}

export async function saveAlertConfig(input: {
  id?: string
  telefone: string
  mensagemDegradado: string
  mensagemRecuperado: string
}): Promise<AlertConfigState> {
  const admin = await createAdminClient()
  const payload = {
    telefone: input.telefone.trim() || null,
    mensagem_degradado: input.mensagemDegradado.trim() || MENSAGEM_DEGRADADO_PADRAO,
    mensagem_recuperado: input.mensagemRecuperado.trim() || MENSAGEM_RECUPERADO_PADRAO,
  }

  if (input.id) {
    const { data, error } = await admin.from('system_alert_config').update(payload).eq('id', input.id).select('*').single()
    if (error) throw error
    return normalizeRow(data)
  }

  const { data, error } = await admin.from('system_alert_config').insert(payload).select('*').single()
  if (error) throw error
  return normalizeRow(data)
}

export function preencherMensagem(template: string, sistema: string, data: string): string {
  return template.replaceAll('{sistema}', sistema).replaceAll('{data}', data)
}
