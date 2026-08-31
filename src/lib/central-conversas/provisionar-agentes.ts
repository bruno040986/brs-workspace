/**
 * Agentes da conta BRS no Chatwoot — espelho dos usuários do Workspace com a
 * permissão `conversas`. O Chatwoot só deixa atribuir conversa a quem é agente
 * da conta, então cada usuário elegível é adicionado (uma vez) via API da
 * própria conta (`POST /agents` — cria o usuário no Chatwoot ou anexa um
 * existente pelo e-mail; ninguém precisa logar no Chatwoot direto, a UI é
 * sempre o Workspace) e entra em todas as inboxes.
 * NÃO usa a Platform API: a conta BRS foi criada fora do PlatformApp e o token
 * de plataforma recebe 401 "Non permissible resource" nela (visto 31/08/2026).
 * Idempotente e best-effort: roda no bootstrap do Atendimento e só faz
 * escrita quando aparece usuário novo; falha individual não derruba o resto.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import type { ChatwootConta } from './chatwoot'

export type RelatorioSincronizacaoAgentes = { criados: number; pulados: number; erros: string[] }

/**
 * Garante que todo usuário ativo do Workspace com permissão `conversas` exista
 * como agente na conta BRS do Chatwoot. Retorna o relatório do que aconteceu.
 */
export async function sincronizarAgentesBrs(cli: ChatwootConta): Promise<RelatorioSincronizacaoAgentes> {
  const admin = await createAdminClient()
  const [{ data: usuarios }, agentes] = await Promise.all([
    admin.from('users').select('id, name, nome_exibicao, email').not('email', 'is', null).neq('active', false),
    cli.agentes(),
  ])
  const emailsAgentes = new Set(agentes.map((a) => String(a.email || '').toLowerCase()))
  const faltantes = (usuarios || []).filter((u) => u.email && !emailsAgentes.has(String(u.email).toLowerCase()))
  const relatorio: RelatorioSincronizacaoAgentes = { criados: 0, pulados: 0, erros: [] }
  if (faltantes.length === 0) return relatorio

  let inboxes: Array<{ id: number }> = []
  try {
    inboxes = await cli.listarInboxes()
  } catch {
    // sem inboxes listáveis o agente ainda vale pra atribuição
  }

  for (const u of faltantes) {
    try {
      if (!(await hasPermissionForUser(String(u.id), 'conversas', 'can_view'))) {
        relatorio.pulados++
        continue
      }
      const agente = await cli.criarAgente({ nome: String(u.nome_exibicao || u.name || u.email), email: String(u.email) })
      for (const inbox of inboxes) {
        try {
          await cli.adicionarMembroInbox(inbox.id, agente.id)
        } catch {
          // membership é conveniência (auto-assign/visibilidade nativa) — não bloqueia
        }
      }
      relatorio.criados++
    } catch (err) {
      const msg = `${u.email}: ${err instanceof Error ? err.message : String(err)}`
      relatorio.erros.push(msg)
      console.error('[conversas] falha ao provisionar agente Chatwoot', msg)
    }
  }
  return relatorio
}
