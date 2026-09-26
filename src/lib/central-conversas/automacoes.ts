/**
 * Regras de automação do Chatwoot (D6, lote 2) — catálogo e validação PUROS.
 * API: /api/v1/accounts/{id}/automation_rules. O Chatwoot faz o trabalho; aqui só
 * montamos e conferimos o corpo. Catálogo restrito ao que a documentação oficial
 * cita; ampliar depois de testar contra a instância (4.17.1).
 */

export const EVENTOS = [
  { valor: 'conversation_created', rotulo: 'Conversa criada' },
  { valor: 'conversation_updated', rotulo: 'Conversa atualizada' },
  { valor: 'conversation_resolved', rotulo: 'Conversa resolvida' },
  { valor: 'message_created', rotulo: 'Mensagem criada' },
] as const

export const OPERADORES = [
  { valor: 'equal_to', rotulo: 'é igual a' },
  { valor: 'not_equal_to', rotulo: 'é diferente de' },
  { valor: 'contains', rotulo: 'contém' },
  { valor: 'does_not_contain', rotulo: 'não contém' },
  { valor: 'is_present', rotulo: 'está preenchido' },
  { valor: 'is_not_present', rotulo: 'não está preenchido' },
] as const

/** `numerico`: o valor vai como número (ids). `semValor`: operadores is_present/is_not_present não levam valor. */
export const CONDICOES = [
  { chave: 'content', rotulo: 'Conteúdo da mensagem', numerico: false },
  { chave: 'message_type', rotulo: 'Tipo da mensagem (incoming/outgoing)', numerico: false },
  { chave: 'inbox_id', rotulo: 'Caixa de entrada (id)', numerico: true },
  { chave: 'status', rotulo: 'Status (open/resolved/pending/snoozed)', numerico: false },
  { chave: 'assignee_id', rotulo: 'Atendente (id)', numerico: true },
  { chave: 'team_id', rotulo: 'Time (id)', numerico: true },
  { chave: 'labels', rotulo: 'Etiqueta', numerico: false },
] as const

export const ACOES = [
  { nome: 'assign_team', rotulo: 'Atribuir ao time (id)', param: 'numero' },
  { nome: 'assign_agent', rotulo: 'Atribuir ao atendente (id)', param: 'numero' },
  { nome: 'add_label', rotulo: 'Adicionar etiqueta', param: 'texto' },
  { nome: 'remove_label', rotulo: 'Remover etiqueta', param: 'texto' },
  { nome: 'send_message', rotulo: 'Enviar mensagem', param: 'texto' },
  { nome: 'change_priority', rotulo: 'Mudar prioridade (none/low/medium/high/urgent)', param: 'texto' },
  { nome: 'mute_conversation', rotulo: 'Silenciar conversa', param: 'nenhum' },
  { nome: 'snooze_conversation', rotulo: 'Adiar conversa (soneca)', param: 'nenhum' },
  { nome: 'resolve_conversation', rotulo: 'Resolver conversa', param: 'nenhum' },
] as const

export type CondicaoEntrada = { chave: string; operador: string; valor: string }
export type AcaoEntrada = { nome: string; valor: string }
export type RegraEntrada = { nome: string; descricao?: string; evento: string; ativa: boolean; combinador: 'AND' | 'OR'; condicoes: CondicaoEntrada[]; acoes: AcaoEntrada[] }

export type CorpoRegra = {
  name: string
  description: string
  event_name: string
  active: boolean
  conditions: Array<{ attribute_key: string; filter_operator: string; query_operator: 'AND' | 'OR'; values: Array<string | number> }>
  actions: Array<{ action_name: string; action_params: Array<string | number> }>
}

const SEM_VALOR = new Set(['is_present', 'is_not_present'])

/** Ações (regra de automação ou macro): valida nome, exige o valor quando a ação tem parâmetro e converte ids em número. */
export function montarAcoes(entrada: AcaoEntrada[], catalogo: ReadonlyArray<{ nome: string; rotulo: string; param: string }> = ACOES): { ok: true; actions: CorpoRegra['actions'] } | { ok: false; error: string } {
  const actions: CorpoRegra['actions'] = []
  for (const a of entrada) {
    const def = catalogo.find((x) => x.nome === a.nome)
    if (!def) return { ok: false, error: `Ação desconhecida: ${a.nome}.` }
    if (def.param === 'nenhum') {
      actions.push({ action_name: a.nome, action_params: [] })
      continue
    }
    const valor = String(a.valor || '').trim()
    if (!valor) return { ok: false, error: `Informe o valor da ação "${def.rotulo}".` }
    if (def.param === 'numero') {
      const n = Number(valor)
      if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `"${def.rotulo}" aceita só número inteiro positivo.` }
      actions.push({ action_name: a.nome, action_params: [n] })
    } else {
      actions.push({ action_name: a.nome, action_params: [valor] })
    }
  }
  return { ok: true, actions }
}

export function montarCorpoRegra(e: RegraEntrada): { ok: true; corpo: CorpoRegra } | { ok: false; error: string } {
  const nome = String(e.nome || '').trim()
  if (!nome) return { ok: false, error: 'Dê um nome à regra.' }
  if (!EVENTOS.some((x) => x.valor === e.evento)) return { ok: false, error: 'Evento inválido.' }
  if (!e.condicoes?.length) return { ok: false, error: 'Adicione ao menos uma condição.' }
  if (!e.acoes?.length) return { ok: false, error: 'Adicione ao menos uma ação.' }

  const conditions: CorpoRegra['conditions'] = []
  for (const c of e.condicoes) {
    const def = CONDICOES.find((x) => x.chave === c.chave)
    if (!def) return { ok: false, error: `Condição desconhecida: ${c.chave}.` }
    if (!OPERADORES.some((o) => o.valor === c.operador)) return { ok: false, error: 'Operador inválido.' }
    const bruto = SEM_VALOR.has(c.operador) ? [] : String(c.valor || '').split(',').map((v) => v.trim()).filter(Boolean)
    if (!SEM_VALOR.has(c.operador) && !bruto.length) return { ok: false, error: `Informe o valor da condição "${def.rotulo}".` }
    let values: Array<string | number> = bruto
    if (def.numerico) {
      values = bruto.map(Number)
      if (values.some((v) => !Number.isInteger(v) || (v as number) <= 0)) return { ok: false, error: `"${def.rotulo}" aceita só números inteiros positivos.` }
    }
    conditions.push({ attribute_key: c.chave, filter_operator: c.operador, query_operator: e.combinador === 'OR' ? 'OR' : 'AND', values })
  }

  const acoes = montarAcoes(e.acoes)
  if (!acoes.ok) return acoes
  const actions = acoes.actions
  return { ok: true, corpo: { name: nome, description: String(e.descricao || '').trim(), event_name: e.evento, active: Boolean(e.ativa), conditions, actions } }
}

/** Regra devolvida pela API → entrada do formulário (para editar). */
export function regraParaEntrada(r: { name?: string; description?: string; event_name?: string; active?: boolean; conditions?: Array<{ attribute_key: string; filter_operator: string; query_operator?: string | null; values?: unknown[] }>; actions?: Array<{ action_name: string; action_params?: unknown[] }> }): RegraEntrada {
  return {
    nome: r.name || '',
    descricao: r.description || '',
    evento: r.event_name || 'message_created',
    ativa: r.active !== false,
    combinador: String(r.conditions?.[0]?.query_operator || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND',
    condicoes: (r.conditions || []).map((c) => ({ chave: c.attribute_key, operador: c.filter_operator, valor: (c.values || []).join(', ') })),
    acoes: (r.actions || []).map((a) => ({ nome: a.action_name, valor: (a.action_params || []).join(', ') })),
  }
}
