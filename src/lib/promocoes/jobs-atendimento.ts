import type { EngineJob } from '@/lib/scp-engine/decisions'
import { enqueueJob } from '@/lib/scp-engine/queue'
import { enviarPedidoAtendimento } from './atendimento'
import { ehUltimaTentativa, MSG_FORA_HORARIO, MSG_INCERTO_TERMINAL, proximoInicioDeJanela } from './atendimento-regras'

const SEM_WHATSAPP = /sem_whatsapp|not.?on.?whatsapp/i

/**
 * promocoes.atendimento_enviar — payload { pedidoId }. Confirmado conclui; sem WhatsApp descarta;
 * `incerto` do engine é TERMINAL (conclui, nunca reenvia); fora do horário reagenda para as 7h SP
 * (novo job, não consome tentativa); o resto lança (pedido segue pendente; mesmo operation_id).
 */
export async function handleAtendimentoEnviar(job: EngineJob): Promise<void> {
  const pedidoId = String(job.payload?.pedidoId || '')
  if (!pedidoId) throw new Error('promocoes.atendimento_enviar sem pedidoId')
  const r = await enviarPedidoAtendimento(pedidoId, { ultimaTentativa: ehUltimaTentativa(job) })
  if (r.resultado === 'confirmado') return
  if (r.resultado === 'rejeitado' && SEM_WHATSAPP.test(r.mensagem)) return
  if (r.resultado === 'incerto' && r.mensagem.startsWith(MSG_INCERTO_TERMINAL)) return
  if (r.resultado === 'incerto' && r.mensagem === MSG_FORA_HORARIO) {
    const quando = proximoInicioDeJanela(new Date())
    await enqueueJob({
      kind: 'promocoes.atendimento_enviar',
      payload: { pedidoId },
      dedupeKey: `promo-atend:${pedidoId}:${quando.toISOString().slice(0, 13)}`,
      maxAttempts: 5,
      runAfterIso: quando.toISOString(),
    })
    return
  }
  throw new Error(`envio ${r.resultado}: ${r.mensagem}`.slice(0, 200))
}
