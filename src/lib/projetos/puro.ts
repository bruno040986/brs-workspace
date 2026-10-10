/**
 * Funções puras do módulo Projetos (sem Supabase/Next) — testadas em
 * src/lib/__tests__/projetos.test.ts.
 */
import {
  PROJETO_STATUS_LABEL,
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type Commit,
  type Mensagem,
  type MensagemTipo,
  type ProjetoStatus,
  type Tarefa,
  type TarefaPrioridade,
  type TarefaStatus,
} from './tipos.ts'

/** 'PRJ-3', 'prj-3', 'PRJ3' ou '3' → 3. Qualquer outra coisa → null. */
export function parseCodigoProjeto(codigo: unknown): number | null {
  const m = /^\s*(?:PRJ-?)?(\d{1,9})\s*$/i.exec(String(codigo ?? ''))
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

export function codigoProjeto(numero: number): string {
  return `PRJ-${numero}`
}

/**
 * Referências numa mensagem de commit. `PRJ-3` liga ao projeto; `PRJ-3/T-2`
 * liga à tarefa; `T-2` solto só vale quando a mensagem cita UM projeto.
 * Vários projetos citados → vale o primeiro.
 */
export function extrairRefsCommit(mensagem: string): { projetoNumero: number | null; tarefaNumero: number | null } {
  const texto = String(mensagem || '')
  const projetos: number[] = []
  let tarefaComProjeto: { projeto: number; tarefa: number } | null = null
  for (const m of texto.matchAll(/\bPRJ-(\d+)(?:\/T-(\d+))?\b/gi)) {
    const p = Number(m[1])
    if (!projetos.includes(p)) projetos.push(p)
    if (m[2] && !tarefaComProjeto) tarefaComProjeto = { projeto: p, tarefa: Number(m[2]) }
  }
  if (!projetos.length) return { projetoNumero: null, tarefaNumero: null }
  if (tarefaComProjeto) return { projetoNumero: tarefaComProjeto.projeto, tarefaNumero: tarefaComProjeto.tarefa }
  if (projetos.length === 1) {
    const solta = /(?<![\w/-])T-(\d+)\b/i.exec(texto)
    return { projetoNumero: projetos[0], tarefaNumero: solta ? Number(solta[1]) : null }
  }
  return { projetoNumero: projetos[0], tarefaNumero: null }
}

export const ehProjetoStatus = (s: unknown): s is ProjetoStatus => typeof s === 'string' && Object.hasOwn(PROJETO_STATUS_LABEL, s)
export const ehTarefaStatus = (s: unknown): s is TarefaStatus => typeof s === 'string' && Object.hasOwn(TAREFA_STATUS_LABEL, s)
export const ehPrioridade = (s: unknown): s is TarefaPrioridade => typeof s === 'string' && Object.hasOwn(TAREFA_PRIORIDADE_LABEL, s)

/**
 * Regra de transição de status do projeto. O fluxo é livre (Bruno pode voltar
 * etapas); só barra repetir o mesmo status, entrar em escrita técnica sem
 * redator e entrar em planejamento sem escrita técnica. Devolve o erro ou null.
 */
export function erroTransicaoProjeto(
  de: ProjetoStatus,
  para: ProjetoStatus,
  opts: { temRedator: boolean; temEscrita: boolean },
): string | null {
  if (!ehProjetoStatus(para)) return 'Status inválido.'
  if (de === para) return `O projeto já está em "${PROJETO_STATUS_LABEL[para]}".`
  if (para === 'escrita_tecnica' && !opts.temRedator) return 'Escolha a IA redatora antes de iniciar a escrita técnica.'
  if (para === 'planejamento' && !opts.temEscrita) return 'Registre a escrita técnica antes de avançar para Planejamento.'
  return null
}

export const temEscritaTecnica = (escrita: string | null | undefined) => Boolean(escrita?.trim())

/** Patch de `projetos` ao gravar a escrita técnica: texto novo e versão +1. */
export function patchEscritaTecnica(escrita: string, versaoAtual: number) {
  return { escrita_tecnica: escrita, escrita_versao: (Number(versaoAtual) || 0) + 1 }
}

/** Aviso quando a escrita técnica mudou depois da aprovação; null se não mudou ou não há aprovação. */
export function avisoEscritaAlterada(p: { escritaVersao: number; versaoEscritaAprovada: number | null }): string | null {
  if (p.versaoEscritaAprovada == null || p.escritaVersao <= p.versaoEscritaAprovada) return null
  return `Escrita técnica alterada após a aprovação (v${p.versaoEscritaAprovada} → v${p.escritaVersao}).`
}

/** concluida_em ao mudar o status da tarefa: entra ao concluir, sai ao reabrir. */
export function concluidaEmPara(status: TarefaStatus, atual: string | null, agoraIso: string): string | null {
  return status === 'concluido' ? atual || agoraIso : null
}

/** '' / null → null; 'YYYY-MM-DD' válido → ele mesmo; resto → erro. */
export function normalizarPrazo(prazo: unknown): string | null {
  const s = String(prazo ?? '').trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const d = m ? new Date(`${s}T00:00:00Z`) : null
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error('Prazo inválido: use o formato AAAA-MM-DD.')
  }
  return s
}

// ---------------------------------------------------------------------------
// Chat do projeto: linhas de projeto_mensagens com tipo 'mensagem', sem tarefa
// e meta = { chat: true }. O Fórum não mostra o chat e o Chat só mostra ele.
// ---------------------------------------------------------------------------

export const MAX_CHAT = 4000

export const ehChat = (m: Pick<Mensagem, 'meta'>) => m.meta?.chat === true

/** Texto de uma mensagem de chat: obrigatório, até MAX_CHAT caracteres. */
export function textoChat(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) throw new Error('Escreva a mensagem.')
  if (s.length > MAX_CHAT) throw new Error(`Mensagem de chat passa do limite de ${MAX_CHAT} caracteres (${s.length}).`)
  return s
}

/** 'refs/heads/main' → 'main'. */
export function branchDoRef(ref: unknown): string {
  return String(ref || '').replace(/^refs\/heads\//, '')
}

// ---------------------------------------------------------------------------
// Serialização de linhas do banco → tipos da tela/MCP
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const strOuNull = (v: unknown) => (v == null ? null : String(v))

export function agenteDeLinha(r: Linha): Agente {
  return { id: str(r.id), slug: str(r.slug), nome: str(r.nome), ativo: r.ativo !== false, temToken: Boolean(r.token_hash) }
}

export function tarefaDeLinha(r: Linha, agentes: Map<string, Agente>): Tarefa {
  return {
    id: str(r.id),
    projetoId: str(r.projeto_id),
    numero: Number(r.numero),
    titulo: str(r.titulo),
    descricao: str(r.descricao),
    status: r.status as TarefaStatus,
    prioridade: r.prioridade as TarefaPrioridade,
    prazo: strOuNull(r.prazo),
    responsavel: r.responsavel_agente_id ? agentes.get(str(r.responsavel_agente_id)) || null : null,
    ordem: Number(r.ordem || 0),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    concluidaEm: strOuNull(r.concluida_em),
  }
}

export function mensagemDeLinha(
  r: Linha,
  ctx: { agentes: Map<string, Agente>; usuarios: Map<string, string>; tarefaNumeroPorId: Map<string, number> },
): Mensagem {
  const agenteId = strOuNull(r.autor_agente_id)
  const tarefaId = strOuNull(r.tarefa_id)
  return {
    id: str(r.id),
    projetoId: str(r.projeto_id),
    tarefaId,
    tarefaNumero: tarefaId ? ctx.tarefaNumeroPorId.get(tarefaId) ?? null : null,
    tipo: r.tipo as MensagemTipo,
    conteudo: str(r.conteudo),
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    autorNome: agenteId ? ctx.agentes.get(agenteId)?.nome || 'IA' : ctx.usuarios.get(str(r.autor_usuario_id)) || '—',
    autorTipo: agenteId ? 'agente' : 'usuario',
    createdAt: str(r.created_at),
  }
}

export function commitDeLinha(r: Linha, tarefaNumeroPorId: Map<string, number>): Commit {
  return {
    id: str(r.id),
    repo: str(r.repo),
    sha: str(r.sha),
    mensagem: str(r.mensagem),
    autor: str(r.autor),
    url: str(r.url),
    branch: str(r.branch),
    tarefaNumero: r.tarefa_id ? tarefaNumeroPorId.get(str(r.tarefa_id)) ?? null : null,
    commitEm: str(r.commit_em || r.created_at),
  }
}
