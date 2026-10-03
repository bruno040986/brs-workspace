import type { EngineJob } from '@/lib/scp-engine/decisions'
import { enviarPedidoAtendimento } from './atendimento'

const SEM_WHATSAPP = /sem_whatsapp|not.?on.?whatsapp/i

/** promocoes.atendimento_enviar — payload { pedidoId }. Confirmado conclui; sem WhatsApp descarta; o resto lança (mesmo operation_id na retentativa). */
export async function handleAtendimentoEnviar(job: EngineJob): Promise<void> {
  const pedidoId = String(job.payload?.pedidoId || '')
  if (!pedidoId) throw new Error('promocoes.atendimento_enviar sem pedidoId')
  const r = await enviarPedidoAtendimento(pedidoId)
  if (r.resultado === 'confirmado') return
  if (r.resultado === 'rejeitado' && SEM_WHATSAPP.test(r.mensagem)) return
  throw new Error(`envio ${r.resultado}: ${r.mensagem}`.slice(0, 200))
}
