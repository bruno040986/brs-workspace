/**
 * Tipos e constantes do módulo Projetos — módulo NEUTRO (sem 'use server'):
 * arquivo de server actions só pode exportar funções async.
 */

export type ProjetoStatus = 'rascunho' | 'escrita_tecnica' | 'brainstorm' | 'planejamento' | 'execucao' | 'concluido' | 'arquivado'
export type TarefaStatus = 'pendente' | 'em_andamento' | 'bloqueado' | 'em_revisao' | 'concluido'
export type TarefaPrioridade = 'baixa' | 'media' | 'alta'
export type MensagemTipo = 'mensagem' | 'contribuicao' | 'decisao' | 'registro_direto' | 'status' | 'escrita_tecnica'

export const PROJETO_STATUS_LABEL: Record<ProjetoStatus, string> = {
  rascunho: 'Rascunho',
  escrita_tecnica: 'Escrita técnica',
  brainstorm: 'Brainstorm',
  planejamento: 'Planejamento',
  execucao: 'Execução',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
}

/** Ordem do fluxo (arquivado fica no fim, fora do fluxo normal). */
export const PROJETO_STATUS_ORDEM: ProjetoStatus[] = [
  'rascunho',
  'escrita_tecnica',
  'brainstorm',
  'planejamento',
  'execucao',
  'concluido',
  'arquivado',
]

export const TAREFA_STATUS_LABEL: Record<TarefaStatus, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  bloqueado: 'Bloqueado',
  em_revisao: 'Em revisão',
  concluido: 'Concluído',
}

export const TAREFA_PRIORIDADE_LABEL: Record<TarefaPrioridade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
}

export const MENSAGEM_TIPO_LABEL: Record<MensagemTipo, string> = {
  mensagem: 'Mensagem',
  contribuicao: 'Contribuição',
  decisao: 'Decisão',
  registro_direto: 'Conversa direta',
  status: 'Mudança de status',
  escrita_tecnica: 'Escrita técnica',
}

export type Agente = { id: string; slug: string; nome: string; ativo: boolean; temToken: boolean }

export type ProjetoResumo = {
  id: string
  codigo: string
  numero: number
  titulo: string
  status: ProjetoStatus
  redator: Agente | null
  participantes: Agente[]
  criadoPorNome: string
  createdAt: string
  updatedAt: string
  totalTarefas: number
  tarefasConcluidas: number
}

export type Tarefa = {
  id: string
  projetoId: string
  numero: number
  titulo: string
  descricao: string
  status: TarefaStatus
  prioridade: TarefaPrioridade
  prazo: string | null
  responsavel: Agente | null
  ordem: number
  createdAt: string
  updatedAt: string
  concluidaEm: string | null
}

export type Mensagem = {
  id: string
  projetoId: string
  tarefaId: string | null
  tarefaNumero: number | null
  tipo: MensagemTipo
  conteudo: string
  meta: Record<string, unknown> | null
  autorNome: string
  autorTipo: 'usuario' | 'agente'
  createdAt: string
}

export type Commit = {
  id: string
  repo: string
  sha: string
  mensagem: string
  autor: string
  url: string
  branch: string
  tarefaNumero: number | null
  commitEm: string
}

export type ProjetoDetalhe = ProjetoResumo & {
  objetivo: string
  ideiaPrincipal: string
  escritaTecnica: string | null
  tarefas: Tarefa[]
  mensagens: Mensagem[]
  commits: Commit[]
}

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string }
