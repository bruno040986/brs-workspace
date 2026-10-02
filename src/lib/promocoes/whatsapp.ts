import { createAdminClient } from '@/lib/supabase/server'
import { engine, EngineEnvioIncertoError, EngineErro } from '@/lib/central-conversas/engine'
import { normalizarTelefoneDestino, type ResultadoEnvio } from '@/lib/central-conversas/envio-intencao'

export type TipoEnvioPromocao =
  | 'otp'
  | 'comprovante_indicacao'
  | 'link_numeros_servidor'
  | 'link_numeros_indicador'
  | 'comprovante_numeros'
  | 'aviso_pagamento'

export type EnvioPromocao = {
  campanhaId: string
  chave: string
  tipo: TipoEnvioPromocao
  telefone: string
  texto: string
  imagemBase64?: string
}

export type { ResultadoEnvio }

async function instanciaDaCampanha(admin: any, campanhaId: string): Promise<{ id: string; status: string } | null> {
  const { data: camp } = await admin.from('promocao_campanhas').select('instancia_id').eq('id', campanhaId).maybeSingle()
  if (!camp?.instancia_id) return null
  const { data: inst } = await admin.from('chat_instancias').select('id, status').eq('id', camp.instancia_id).is('deleted_at', null).maybeSingle()
  return inst ? { id: String(inst.id), status: String(inst.status) } : null
}

export async function instanciaPromocaoDisponivel(campanhaId: string): Promise<boolean> {
  const admin: any = await createAdminClient()
  return (await instanciaDaCampanha(admin, campanhaId))?.status === 'conectada'
}

/**
 * Envio transacional idempotente pela instância dedicada da promoção.
 * `chave` identifica a intenção; o `operation_id` nasce UMA vez em
 * promocao_envios e é reaproveitado em qualquer retentativa (nunca gerar outro).
 */
export async function enviarWhatsappPromocao(e: EnvioPromocao): Promise<ResultadoEnvio> {
  const admin: any = await createAdminClient()

  await admin
    .from('promocao_envios')
    .upsert(
      { campanha_id: e.campanhaId, chave: e.chave, tipo: e.tipo, telefone: e.telefone, texto: e.texto, tem_imagem: Boolean(e.imagemBase64) },
      { onConflict: 'chave', ignoreDuplicates: true },
    )
  const { data: envio, error } = await admin.from('promocao_envios').select('id, operation_id, status, tentativas').eq('chave', e.chave).maybeSingle()
  if (error || !envio) return { resultado: 'incerto', mensagem: 'Não foi possível registrar o envio (promocao_envios).' }
  if (envio.status === 'enviado') return { resultado: 'confirmado', conversationId: null }

  const inst = await instanciaDaCampanha(admin, e.campanhaId)
  if (!inst || inst.status !== 'conectada') return { resultado: 'rejeitado', mensagem: 'INSTANCIA_OFFLINE' }

  const marcar = (patch: Record<string, unknown>) =>
    admin.from('promocao_envios').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', envio.id)

  await marcar({ tentativas: Number(envio.tentativas || 0) + 1 })
  try {
    const r = await engine.enviar(inst.id, normalizarTelefoneDestino(e.telefone), e.texto, {
      operationId: String(envio.operation_id),
      imagemBase64: e.imagemBase64,
    })
    await marcar({ status: 'enviado', engine_message_id: String(r.messageId || r.id), enviado_em: new Date().toISOString(), erro: null })
    return { resultado: 'confirmado', conversationId: r.conversationId ?? null }
  } catch (err) {
    if (err instanceof EngineEnvioIncertoError) {
      await marcar({ status: 'incerto', erro: err.message })
      return { resultado: 'incerto', mensagem: err.message }
    }
    if (err instanceof EngineErro) {
      await marcar({ status: 'rejeitado', erro: `${err.codigo}: ${err.message}` })
      return { resultado: 'rejeitado', mensagem: err.codigo }
    }
    const msg = err instanceof Error ? err.message : 'Falha de validação do envio.'
    await marcar({ status: 'rejeitado', erro: msg })
    return { resultado: 'rejeitado', mensagem: msg }
  }
}
