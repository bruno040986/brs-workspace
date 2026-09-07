/**
 * Worker do agendamento de ação por conversa (Fase B §5 da spec). Chamado
 * pelo cron `/api/cron/messenger-agendamentos` (a cada 1 min). NÃO é
 * `'use server'` — roda dentro da rota de API, não é Server Action chamada
 * pela UI.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs, clienteChatwootBrs, assinaturaDoUsuario } from './actions'

function assinar(assinatura: string, texto: string): string {
  return assinatura ? `*${assinatura}:*\n${texto}` : texto
}

export type ResultadoWorkerAgendamentos = { processados: number; executados: number; falhas: number }

export async function rodarWorkerAgendamentos(): Promise<ResultadoWorkerAgendamentos> {
  const admin = await createAdminClient()
  const conta = await contaBrs()
  const cli = await clienteChatwootBrs()
  const resultado: ResultadoWorkerAgendamentos = { processados: 0, executados: 0, falhas: 0 }
  if (!conta || !cli) return resultado

  const { data: claimados, error: claimErro } = await admin.rpc('chat_acoes_agendadas_claim', { p_limite: 20, p_lease_segundos: 120 })
  if (claimErro) {
    console.error('[agendamento] claim falhou', claimErro)
    return resultado
  }

  for (const acao of claimados || []) {
    resultado.processados++
    try {
      if (acao.acao === 'mensagem') {
        const assinatura = await assinaturaDoUsuario(acao.criado_por)
        await cli.enviarMensagem(acao.chatwoot_conversation_id, assinar(assinatura, String(acao.texto || '')))
      } else {
        await cli.notaInterna(acao.chatwoot_conversation_id, `⏰ Lembrete: ${acao.texto || ''}`)
        const { createWorkspaceNotifications } = await import('@/lib/notifications')
        await createWorkspaceNotifications(admin, [
          {
            user_id: acao.criado_por,
            type: 'messenger_lembrete',
            title: 'Lembrete agendado',
            body: String(acao.texto || ''),
            href: '/conversas',
            entity_type: 'chat_conversa',
            entity_id: String(acao.chatwoot_conversation_id),
          },
        ])
      }
      await admin.rpc('chat_acoes_agendadas_finish', { p_id: acao.id, p_token: acao.lease_token, p_status: 'executado', p_erro: null })
      resultado.executados++
    } catch (err) {
      resultado.falhas++
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[agendamento] falha ao executar', acao.id, msg)
      try {
        await admin.rpc('chat_acoes_agendadas_finish', { p_id: acao.id, p_token: acao.lease_token, p_status: 'falhou', p_erro: msg.slice(0, 500) })
      } catch (errFinish) {
        console.error('[agendamento] falha ao marcar falhou (lease vai expirar sozinha)', errFinish)
      }
    }
  }

  return resultado
}
