/**
 * Macros do Chatwoot (D1, lote 2): sequência de ações executada em 1 clique numa conversa.
 * Rotas (fonte do Chatwoot, config/routes.rb): /macros CRUD e POST /macros/:id/execute {conversation_ids};
 * a execução é ASSÍNCRONA (a API só enfileira e responde 200).
 * Visibilidade só 'global': o token do Workspace é de UM usuário do Chatwoot, então "pessoal"
 * seria pessoal desse usuário técnico, não de quem clica.
 */
import { ACOES, montarAcoes, type AcaoEntrada, type CorpoRegra } from './automacoes.ts'

export const ACOES_MACRO = [...ACOES, { nome: 'add_private_note', rotulo: 'Adicionar nota privada', param: 'texto' }] as const

export type MacroEntrada = { nome: string; acoes: AcaoEntrada[] }
export type CorpoMacro = { name: string; visibility: 'global'; actions: CorpoRegra['actions'] }

export function montarCorpoMacro(e: MacroEntrada): { ok: true; corpo: CorpoMacro } | { ok: false; error: string } {
  const nome = String(e.nome || '').trim()
  if (!nome) return { ok: false, error: 'Dê um nome à macro.' }
  if (!e.acoes?.length) return { ok: false, error: 'Adicione ao menos uma ação.' }
  const a = montarAcoes(e.acoes, ACOES_MACRO)
  if (!a.ok) return a
  return { ok: true, corpo: { name: nome, visibility: 'global', actions: a.actions } }
}

export function macroParaEntrada(m: { name?: string; actions?: Array<{ action_name: string; action_params?: unknown[] }> }): MacroEntrada {
  return { nome: m.name || '', acoes: (m.actions || []).map((a) => ({ nome: a.action_name, valor: (a.action_params || []).join(', ') })) }
}
