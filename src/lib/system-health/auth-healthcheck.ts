/**
 * Verifica a saúde do Supabase Auth batendo direto no endpoint /auth/v1/health
 * (não exige credencial nenhuma — mede exatamente a mesma dependência de rede
 * que o proxy usa em getUserWithTimeout). Em transição ok→degradado ou
 * degradado→ok, avisa por WhatsApp via a instância Z-API padrão, pro time
 * saber do incidente antes de alguém reportar "não consigo logar".
 */

import { createAdminClient } from '@/lib/supabase/server'
import { getDefaultInstance } from '@/lib/zapi/instances'
import { ZapiClient } from '@/lib/zapi/client'
import { getAlertConfig, preencherMensagem } from './alert-config'

const FAILURE_THRESHOLD = 2
const HEALTH_CHECK_TIMEOUT_MS = 4000

async function checkSupabaseAuthHealth(): Promise<boolean> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

async function enviarAlerta(mensagem: string, telefone: string) {
  if (!telefone) {
    console.warn('Telefone de alerta não configurado (Central de Integrações > Monitoramento) — alerta não enviado:', mensagem)
    return
  }
  try {
    const instance = await getDefaultInstance()
    if (!instance) {
      console.warn('Nenhuma instância Z-API padrão configurada — alerta de saúde não enviado.')
      return
    }
    const client = ZapiClient.fromInstance(instance)
    await client.sendText({ phone: telefone, message: mensagem })
  } catch (error) {
    console.error('Erro ao enviar alerta de saúde:', error)
  }
}

export async function runAuthHealthcheck(): Promise<{ status: 'ok' | 'degradado'; alertado: boolean }> {
  const saudavel = await checkSupabaseAuthHealth()
  const admin = await createAdminClient()

  const { data: estadoAtual } = await admin
    .from('system_health_status')
    .select('*')
    .eq('chave', 'supabase_auth')
    .maybeSingle()

  const falhasConsecutivas = saudavel ? 0 : (estadoAtual?.falhas_consecutivas || 0) + 1
  const statusAnterior = estadoAtual?.status || 'ok'
  const novoStatus: 'ok' | 'degradado' = saudavel
    ? 'ok'
    : falhasConsecutivas >= FAILURE_THRESHOLD
      ? 'degradado'
      : statusAnterior

  let alertado = false
  if (novoStatus !== statusAnterior) {
    const config = await getAlertConfig()
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const template = novoStatus === 'degradado' ? config.mensagemDegradado : config.mensagemRecuperado
    await enviarAlerta(preencherMensagem(template, 'Supabase Auth', agora), config.telefone)
    alertado = true
  }

  await admin.from('system_health_status').upsert({
    chave: 'supabase_auth',
    status: novoStatus,
    falhas_consecutivas: falhasConsecutivas,
    ultimo_alerta_em: alertado ? new Date().toISOString() : estadoAtual?.ultimo_alerta_em || null,
  })

  return { status: novoStatus, alertado }
}
