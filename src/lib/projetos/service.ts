/**
 * Lógica do módulo Projetos, compartilhada pelas server actions (autor =
 * usuário logado) e pela rota MCP (autor = agente de IA identificado pelo
 * token). Recebe sempre o admin client (service role); permissão de usuário
 * é checada nas actions, a de agente (participante/redator) aqui.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agenteDeLinha,
  branchDoRef,
  codigoProjeto,
  commitDeLinha,
  concluidaEmPara,
  contasDeAgentes,
  ehPrioridade,
  ehTarefaStatus,
  erroTransicaoProjeto,
  extrairRefsCommit,
  mensagemDeLinha,
  normalizarPrazo,
  parseCodigoProjeto,
  patchEscritaTecnica,
  resolverContaCota,
  tarefaDeLinha,
  temEscritaTecnica,
  textoChat,
  validarCotas,
} from './puro'
import {
  PROJETO_STATUS_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type AgenteConta,
  type ContaCotas,
  type Cota,
  type Mensagem,
  type MensagemTipo,
  type ProjetoDetalhe,
  type ProjetoResumo,
  type ProjetoStatus,
  type TarefaPrioridade,
  type TarefaStatus,
} from './tipos'

type Admin = SupabaseClient
export type Autor = { usuarioId: string } | { agenteId: string }

type ProjetoRow = {
  id: string
  numero: number
  titulo: string
  objetivo: string
  ideia_principal: string
  status: ProjetoStatus
  redator_agente_id: string | null
  escrita_tecnica: string | null
  escrita_versao: number
  aprovado_por: string | null
  aprovado_em: string | null
  versao_escrita_aprovada: number | null
  criado_por: string
  created_at: string
  updated_at: string
}

const PROJETO_COLS =
  'id, numero, titulo, objetivo, ideia_principal, status, redator_agente_id, escrita_tecnica, escrita_versao, aprovado_por, aprovado_em, versao_escrita_aprovada, criado_por, created_at, updated_at'
const MAX_TITULO = 200
const MAX_TEXTO = 50_000
const MAX_ESCRITA = 200_000

const agenteDoAutor = (a: Autor): string | null => ('agenteId' in a ? a.agenteId : null)
const autorColunas = (a: Autor) =>
  'agenteId' in a ? { autor_agente_id: a.agenteId, autor_usuario_id: null } : { autor_usuario_id: a.usuarioId, autor_agente_id: null }

function texto(v: unknown, campo: string, max: number, obrigatorio = true): string {
  const s = String(v ?? '').trim()
  if (obrigatorio && !s) throw new Error(`Informe ${campo}.`)
  if (s.length > max) throw new Error(`O campo ${campo} passa do limite de ${max} caracteres.`)
  return s
}

// ---------------------------------------------------------------------------
// Leituras auxiliares
// ---------------------------------------------------------------------------

export async function carregarAgentes(admin: Admin): Promise<Map<string, Agente>> {
  const { data, error } = await admin.from('projeto_agentes').select('id, slug, nome, ativo, token_hash').order('nome')
  if (error) throw error
  return new Map((data || []).map((r) => [String(r.id), agenteDeLinha(r)]))
}

export async function listarAgentes(admin: Admin): Promise<Agente[]> {
  return [...(await carregarAgentes(admin)).values()]
}

function agenteValido(agentes: Map<string, Agente>, id: string, papel: string): Agente {
  const a = agentes.get(String(id))
  if (!a || !a.ativo) throw new Error(`${papel}: IA não encontrada ou inativa.`)
  return a
}

async function nomesUsuarios(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (!unicos.length) return new Map()
  const { data, error } = await admin.from('users').select('id, name').in('id', unicos)
  if (error) throw error
  return new Map((data || []).map((u) => [String(u.id), String(u.name || '')]))
}

async function buscarProjeto(admin: Admin, codigo: string): Promise<ProjetoRow> {
  const numero = parseCodigoProjeto(codigo)
  if (!numero) throw new Error(`Código de projeto inválido: "${codigo}". Use o formato PRJ-<número>.`)
  const { data, error } = await admin.from('projetos').select(PROJETO_COLS).eq('numero', numero).is('deleted_at', null).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Projeto ${codigoProjeto(numero)} não encontrado.`)
  return data as ProjetoRow
}

async function buscarTarefa(admin: Admin, p: ProjetoRow, numero: number) {
  const n = Number(numero)
  if (!Number.isInteger(n) || n < 1) throw new Error('Número de tarefa inválido.')
  const { data, error } = await admin
    .from('projeto_tarefas')
    .select('id, numero, status, concluida_em')
    .eq('projeto_id', p.id)
    .eq('numero', n)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Tarefa T-${n} não encontrada em ${codigoProjeto(p.numero)}.`)
  return data as { id: string; numero: number; status: TarefaStatus; concluida_em: string | null }
}

async function participantesPorProjeto(admin: Admin, projetoIds: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>()
  if (!projetoIds.length) return mapa
  const { data, error } = await admin.from('projeto_participantes').select('projeto_id, agente_id').in('projeto_id', projetoIds)
  if (error) throw error
  for (const r of data || []) {
    const lista = mapa.get(String(r.projeto_id)) || []
    lista.push(String(r.agente_id))
    mapa.set(String(r.projeto_id), lista)
  }
  return mapa
}

function montarResumo(
  p: ProjetoRow,
  agentes: Map<string, Agente>,
  participanteIds: string[],
  nomes: Map<string, string>,
  totalTarefas: number,
  tarefasConcluidas: number,
): ProjetoResumo {
  return {
    id: p.id,
    codigo: codigoProjeto(p.numero),
    numero: p.numero,
    titulo: p.titulo,
    status: p.status,
    redator: p.redator_agente_id ? agentes.get(p.redator_agente_id) || null : null,
    participantes: participanteIds.map((id) => agentes.get(id)).filter((a): a is Agente => Boolean(a)),
    criadoPorNome: nomes.get(p.criado_por) || '—',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    totalTarefas,
    tarefasConcluidas,
    escritaVersao: Number(p.escrita_versao || 0),
    aprovadoPorNome: p.aprovado_por ? nomes.get(p.aprovado_por) || '—' : null,
    aprovadoEm: p.aprovado_em,
    versaoEscritaAprovada: p.versao_escrita_aprovada,
  }
}

// ---------------------------------------------------------------------------
// Escrita: mensagens, notificação e regras de agente
// ---------------------------------------------------------------------------

/** Agente só escreve em projeto do qual participa (usuário: checado na action). */
async function exigirEscrita(admin: Admin, p: ProjetoRow, autor: Autor) {
  const agenteId = agenteDoAutor(autor)
  if (!agenteId) return
  if (p.status === 'arquivado') throw new Error(`${codigoProjeto(p.numero)} está arquivado; IAs não podem mais escrever nele.`)
  const { data, error } = await admin
    .from('projeto_participantes')
    .select('agente_id')
    .eq('projeto_id', p.id)
    .eq('agente_id', agenteId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Você não participa de ${codigoProjeto(p.numero)}; só IAs participantes podem escrever nele.`)
}

/** Avisa no sino quem criou o projeto. Falha aqui não desfaz a escrita. */
async function notificarCriador(admin: Admin, p: ProjetoRow, agenteId: string, corpo: string) {
  try {
    const { data } = await admin.from('projeto_agentes').select('nome').eq('id', agenteId).maybeSingle()
    const codigo = codigoProjeto(p.numero)
    const { error } = await admin.from('workspace_notifications').insert({
      user_id: p.criado_por,
      type: 'projetos',
      title: `${String(data?.nome || 'IA')} escreveu em ${codigo}`,
      body: corpo.slice(0, 280),
      href: `/projetos/${codigo}`,
      entity_type: 'projeto',
      entity_id: p.id,
    })
    if (error) throw error
  } catch (err) {
    console.error('Projetos: falha ao notificar', codigoProjeto(p.numero), err instanceof Error ? err.message : err)
  }
}

async function inserirMensagem(
  admin: Admin,
  p: ProjetoRow,
  m: { tarefaId?: string | null; tipo: MensagemTipo; conteudo: string; meta?: Record<string, unknown> | null },
  autor: Autor,
) {
  const { error } = await admin.from('projeto_mensagens').insert({
    projeto_id: p.id,
    tarefa_id: m.tarefaId || null,
    tipo: m.tipo,
    conteudo: m.conteudo,
    meta: m.meta ?? null,
    ...autorColunas(autor),
  })
  if (error) throw error
  const agenteId = agenteDoAutor(autor)
  // Chat não vai para o sino (viraria spam); as demais escritas de IA vão.
  if (agenteId && m.meta?.chat !== true) await notificarCriador(admin, p, agenteId, m.conteudo)
}

async function aplicarStatusProjeto(admin: Admin, p: ProjetoRow, para: ProjetoStatus, autor: Autor) {
  const erro = erroTransicaoProjeto(p.status, para, { temRedator: Boolean(p.redator_agente_id), temEscrita: temEscritaTecnica(p.escrita_tecnica) })
  if (erro) throw new Error(erro)
  // Usuário levando para planejamento = aprova a versão atual da escrita técnica.
  const aprovacao =
    para === 'planejamento' && 'usuarioId' in autor
      ? { aprovado_por: autor.usuarioId, aprovado_em: new Date().toISOString(), versao_escrita_aprovada: p.escrita_versao }
      : null
  // Trava em status E versão da escrita: a versão aprovada é exatamente a que foi lida.
  const { data, error } = await admin
    .from('projetos')
    .update({ status: para, ...aprovacao })
    .eq('id', p.id)
    .eq('status', p.status)
    .eq('escrita_versao', p.escrita_versao)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('O projeto mudou enquanto isso; recarregue e tente de novo.')
  await inserirMensagem(
    admin,
    p,
    {
      tipo: 'status',
      conteudo: `Status do projeto: ${PROJETO_STATUS_LABEL[p.status]} → ${PROJETO_STATUS_LABEL[para]}`,
      meta: { entidade: 'projeto', de: p.status, para, ...(aprovacao ? { aprovacao: { versao: p.escrita_versao } } : {}) },
    },
    autor,
  )
  p.status = para
  if (aprovacao) Object.assign(p, aprovacao)
}

// ---------------------------------------------------------------------------
// Projetos
// ---------------------------------------------------------------------------

export async function listarProjetos(admin: Admin): Promise<ProjetoResumo[]> {
  const { data, error } = await admin.from('projetos').select(PROJETO_COLS).is('deleted_at', null).order('numero', { ascending: false })
  if (error) throw error
  const rows = (data || []) as ProjetoRow[]
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  // ponytail: contagem de tarefas lê as linhas (limite padrão de 1000 do PostgREST); trocar por view/RPC de contagem se crescer.
  const [agentes, participantes, tarefasR, nomes] = await Promise.all([
    carregarAgentes(admin),
    participantesPorProjeto(admin, ids),
    admin.from('projeto_tarefas').select('projeto_id, status').in('projeto_id', ids),
    nomesUsuarios(admin, rows.flatMap((r) => [r.criado_por, r.aprovado_por || ''])),
  ])
  if (tarefasR.error) throw tarefasR.error
  const contagem = new Map<string, { total: number; feitas: number }>()
  for (const t of tarefasR.data || []) {
    const c = contagem.get(String(t.projeto_id)) || { total: 0, feitas: 0 }
    c.total += 1
    if (t.status === 'concluido') c.feitas += 1
    contagem.set(String(t.projeto_id), c)
  }
  return rows.map((p) =>
    montarResumo(p, agentes, participantes.get(p.id) || [], nomes, contagem.get(p.id)?.total || 0, contagem.get(p.id)?.feitas || 0),
  )
}

export async function lerProjeto(admin: Admin, codigo: string, opts: { limiteMensagens?: number } = {}): Promise<ProjetoDetalhe> {
  const p = await buscarProjeto(admin, codigo)
  const limite = Math.min(Math.max(opts.limiteMensagens ?? 500, 1), 1000)
  const [agentes, participantes, tarefasR, msgsR, commitsR] = await Promise.all([
    carregarAgentes(admin),
    participantesPorProjeto(admin, [p.id]),
    admin.from('projeto_tarefas').select('*').eq('projeto_id', p.id).order('ordem').order('numero'),
    // Linha do tempo sem o chat (o chat tem tela/tool próprias e não pode empurrar o fórum para fora do limite).
    admin.from('projeto_mensagens').select('*').eq('projeto_id', p.id).is('meta->>chat', null).order('created_at', { ascending: false }).limit(limite),
    admin.from('projeto_commits').select('*').eq('projeto_id', p.id).order('commit_em', { ascending: false }).limit(200),
  ])
  if (tarefasR.error) throw tarefasR.error
  if (msgsR.error) throw msgsR.error
  if (commitsR.error) throw commitsR.error

  const tarefas = (tarefasR.data || []).map((r) => tarefaDeLinha(r, agentes))
  const tarefaNumeroPorId = new Map(tarefas.map((t) => [t.id, t.numero]))
  const msgs = (msgsR.data || []).reverse()
  const nomes = await nomesUsuarios(admin, [p.criado_por, p.aprovado_por || '', ...msgs.map((m) => String(m.autor_usuario_id || ''))])

  return {
    ...montarResumo(p, agentes, participantes.get(p.id) || [], nomes, tarefas.length, tarefas.filter((t) => t.status === 'concluido').length),
    objetivo: p.objetivo,
    ideiaPrincipal: p.ideia_principal,
    escritaTecnica: p.escrita_tecnica,
    tarefas,
    mensagens: msgs.map((m) => mensagemDeLinha(m, { agentes, usuarios: nomes, tarefaNumeroPorId })),
    commits: (commitsR.data || []).map((c) => commitDeLinha(c, tarefaNumeroPorId)),
  }
}

export async function listarMensagens(
  admin: Admin,
  codigo: string,
  filtro: { tarefaNumero?: number | null; desde?: string | null; limite?: number | null } = {},
): Promise<Mensagem[]> {
  const p = await buscarProjeto(admin, codigo)
  const limite = Math.min(Math.max(Number(filtro.limite) || 100, 1), 500)
  let q = admin.from('projeto_mensagens').select('*').eq('projeto_id', p.id).is('meta->>chat', null)
  if (filtro.tarefaNumero) q = q.eq('tarefa_id', (await buscarTarefa(admin, p, filtro.tarefaNumero)).id)
  if (filtro.desde) {
    const d = new Date(filtro.desde)
    if (Number.isNaN(d.getTime())) throw new Error('Data "desde" inválida: use ISO 8601 (ex.: 2026-10-09T12:00:00Z).')
    q = q.gte('created_at', d.toISOString())
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limite)
  if (error) throw error
  const msgs = (data || []).reverse()
  const [agentes, nomes, tarefasR] = await Promise.all([
    carregarAgentes(admin),
    nomesUsuarios(admin, msgs.map((m) => String(m.autor_usuario_id || ''))),
    admin.from('projeto_tarefas').select('id, numero').eq('projeto_id', p.id),
  ])
  if (tarefasR.error) throw tarefasR.error
  const tarefaNumeroPorId = new Map((tarefasR.data || []).map((t) => [String(t.id), Number(t.numero)]))
  return msgs.map((m) => mensagemDeLinha(m, { agentes, usuarios: nomes, tarefaNumeroPorId }))
}

// ---------------------------------------------------------------------------
// Chat do projeto (projeto_mensagens com meta.chat = true)
// ---------------------------------------------------------------------------

export async function enviarChat(admin: Admin, autor: Autor, input: { codigo: string; conteudo: string }) {
  const p = await buscarProjeto(admin, input.codigo)
  await exigirEscrita(admin, p, autor)
  await inserirMensagem(admin, p, { tipo: 'mensagem', conteudo: textoChat(input.conteudo), meta: { chat: true } }, autor)
  return { codigo: codigoProjeto(p.numero) }
}

/**
 * Mensagens de chat em ordem cronológica: as com created_at > `desde`, ou as
 * últimas `limite` sem `desde`. `cursor` = maior createdAt devolvido (ou o
 * próprio `desde` quando nada novo) — passe-o como `desde` na próxima chamada.
 */
export async function ouvirChat(
  admin: Admin,
  input: { codigo: string; desde?: string | null; limite?: number | null },
): Promise<{ mensagens: Mensagem[]; cursor: string | null }> {
  const p = await buscarProjeto(admin, input.codigo)
  const limite = Math.min(Math.max(Number(input.limite) || 50, 1), 200)
  const desde = input.desde ? String(input.desde) : null
  if (desde && Number.isNaN(Date.parse(desde))) throw new Error('Cursor "desde" inválido: use o cursor devolvido pela última leitura (ISO 8601).')
  const q = admin.from('projeto_mensagens').select('*').eq('projeto_id', p.id).eq('meta->>chat', 'true')
  // `desde` vai cru (sem passar por Date): o created_at tem microssegundos e truncar para ms repetiria a última mensagem.
  // ponytail: cursor por created_at pode perder mensagem gravada no mesmo microssegundo; trocar por (created_at, id) se aparecer.
  const { data, error } = desde
    ? await q.gt('created_at', desde).order('created_at', { ascending: true }).limit(limite)
    : await q.order('created_at', { ascending: false }).limit(limite)
  if (error) throw error
  const linhas = desde ? data || [] : (data || []).reverse()
  if (!linhas.length) return { mensagens: [], cursor: desde }
  const [agentes, nomes] = await Promise.all([carregarAgentes(admin), nomesUsuarios(admin, linhas.map((m) => String(m.autor_usuario_id || '')))])
  const mensagens = linhas.map((m) => mensagemDeLinha(m, { agentes, usuarios: nomes, tarefaNumeroPorId: new Map() }))
  return { mensagens, cursor: mensagens[mensagens.length - 1].createdAt }
}

/** Grava o conjunto de participantes (sempre inclui o redator). */
async function gravarParticipantes(admin: Admin, projetoId: string, ids: string[]) {
  const unicos = [...new Set(ids)]
  let del = admin.from('projeto_participantes').delete().eq('projeto_id', projetoId)
  if (unicos.length) del = del.not('agente_id', 'in', `(${unicos.join(',')})`)
  const { error: errDel } = await del
  if (errDel) throw errDel
  if (!unicos.length) return
  const { error } = await admin
    .from('projeto_participantes')
    .upsert(unicos.map((agente_id) => ({ projeto_id: projetoId, agente_id })), { onConflict: 'projeto_id,agente_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function criarProjeto(
  admin: Admin,
  usuarioId: string,
  input: { titulo: string; objetivo: string; ideiaPrincipal: string; redatorAgenteId: string | null; participanteIds: string[]; iniciar: boolean },
): Promise<{ codigo: string }> {
  const titulo = texto(input.titulo, 'o título', MAX_TITULO)
  const objetivo = texto(input.objetivo, 'o objetivo', MAX_TEXTO)
  const ideia = texto(input.ideiaPrincipal, 'a ideia principal', MAX_TEXTO)
  const agentes = await carregarAgentes(admin)
  const redatorId = input.redatorAgenteId ? agenteValido(agentes, input.redatorAgenteId, 'Redator').id : null
  if (input.iniciar && !redatorId) throw new Error('Escolha a IA redatora para iniciar o projeto.')
  const participantes = (input.participanteIds || []).map((id) => agenteValido(agentes, id, 'Participante').id)
  if (redatorId) participantes.push(redatorId)

  const { data, error } = await admin
    .from('projetos')
    .insert({ titulo, objetivo, ideia_principal: ideia, redator_agente_id: redatorId, criado_por: usuarioId })
    .select(PROJETO_COLS)
    .single()
  if (error) throw error
  const p = data as ProjetoRow
  try {
    await gravarParticipantes(admin, p.id, participantes)
    if (input.iniciar) await aplicarStatusProjeto(admin, p, 'escrita_tecnica', { usuarioId })
  } catch (err) {
    // Compensação: não deixa projeto pela metade (participantes/mensagens caem em cascata).
    const { error: errDel } = await admin.from('projetos').delete().eq('id', p.id)
    if (errDel) console.error('Projetos: falha ao desfazer projeto incompleto', codigoProjeto(p.numero), errDel.message)
    throw err
  }
  return { codigo: codigoProjeto(p.numero) }
}

export async function atualizarProjeto(
  admin: Admin,
  codigo: string,
  input: { titulo?: string; objetivo?: string; ideiaPrincipal?: string; redatorAgenteId?: string | null; participanteIds?: string[] },
) {
  const p = await buscarProjeto(admin, codigo)
  const patch: Record<string, unknown> = {}
  if (input.titulo !== undefined) patch.titulo = texto(input.titulo, 'o título', MAX_TITULO)
  if (input.objetivo !== undefined) patch.objetivo = texto(input.objetivo, 'o objetivo', MAX_TEXTO)
  if (input.ideiaPrincipal !== undefined) patch.ideia_principal = texto(input.ideiaPrincipal, 'a ideia principal', MAX_TEXTO)

  const precisaAgentes = input.redatorAgenteId !== undefined || input.participanteIds !== undefined
  const agentes = precisaAgentes ? await carregarAgentes(admin) : new Map<string, Agente>()
  if (input.redatorAgenteId !== undefined) {
    patch.redator_agente_id = input.redatorAgenteId ? agenteValido(agentes, input.redatorAgenteId, 'Redator').id : null
  }
  const redatorFinal = (input.redatorAgenteId !== undefined ? patch.redator_agente_id : p.redator_agente_id) as string | null

  if (Object.keys(patch).length) {
    const { error } = await admin.from('projetos').update(patch).eq('id', p.id)
    if (error) throw error
  }
  if (input.participanteIds !== undefined) {
    const ids = input.participanteIds.map((id) => agenteValido(agentes, id, 'Participante').id)
    await gravarParticipantes(admin, p.id, redatorFinal ? [...ids, redatorFinal] : ids)
  } else if (redatorFinal && redatorFinal !== p.redator_agente_id) {
    const { error } = await admin
      .from('projeto_participantes')
      .upsert({ projeto_id: p.id, agente_id: redatorFinal }, { onConflict: 'projeto_id,agente_id', ignoreDuplicates: true })
    if (error) throw error
  }
  return { codigo: codigoProjeto(p.numero) }
}

export async function mudarStatusProjeto(admin: Admin, codigo: string, status: ProjetoStatus, autor: Autor) {
  const p = await buscarProjeto(admin, codigo)
  await exigirEscrita(admin, p, autor)
  await aplicarStatusProjeto(admin, p, status, autor)
  return { codigo: codigoProjeto(p.numero) }
}

/** Mensagem livre na linha do tempo (projeto ou tarefa). */
export async function registrarMensagem(
  admin: Admin,
  input: { codigo: string; tarefaNumero?: number | null; tipo: Exclude<MensagemTipo, 'status' | 'escrita_tecnica'>; conteudo: string },
  autor: Autor,
) {
  const p = await buscarProjeto(admin, input.codigo)
  await exigirEscrita(admin, p, autor)
  const conteudo = texto(input.conteudo, 'o conteúdo', MAX_TEXTO)
  const tarefaId = input.tarefaNumero ? (await buscarTarefa(admin, p, input.tarefaNumero)).id : null
  await inserirMensagem(admin, p, { tarefaId, tipo: input.tipo, conteudo }, autor)
  return { codigo: codigoProjeto(p.numero) }
}

/** Escrita técnica: só a IA redatora; cada registro sobe `escrita_versao`. Em 'escrita_tecnica' o projeto avança para 'brainstorm'. */
export async function registrarEscritaTecnica(admin: Admin, codigo: string, conteudo: string, autor: Autor) {
  const p = await buscarProjeto(admin, codigo)
  const agenteId = agenteDoAutor(autor)
  if (agenteId && p.redator_agente_id !== agenteId) {
    throw new Error(`Só a IA redatora de ${codigoProjeto(p.numero)} registra a escrita técnica. Use "contribuir" para sugerir.`)
  }
  const escrita = texto(conteudo, 'a escrita técnica', MAX_ESCRITA)
  const patch = patchEscritaTecnica(escrita, p.escrita_versao)
  // Trava na versão lida: dois registros simultâneos não podem gerar a mesma versão.
  const { data, error } = await admin.from('projetos').update(patch).eq('id', p.id).eq('escrita_versao', p.escrita_versao).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('A escrita técnica mudou enquanto isso; leia o projeto de novo e tente outra vez.')
  Object.assign(p, patch)
  await inserirMensagem(admin, p, { tipo: 'escrita_tecnica', conteudo: escrita, meta: { versao: patch.escrita_versao } }, autor)
  if (p.status === 'escrita_tecnica') await aplicarStatusProjeto(admin, p, 'brainstorm', autor)
  return { codigo: codigoProjeto(p.numero), status: p.status, versao: patch.escrita_versao }
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

export async function criarTarefa(
  admin: Admin,
  input: { codigo: string; titulo: string; descricao?: string; responsavelAgenteId?: string | null; prioridade?: TarefaPrioridade; prazo?: string | null },
  autor: Autor,
): Promise<{ codigo: string; numero: number }> {
  const p = await buscarProjeto(admin, input.codigo)
  await exigirEscrita(admin, p, autor)
  const titulo = texto(input.titulo, 'o título da tarefa', MAX_TITULO)
  const descricao = texto(input.descricao, 'a descrição', MAX_TEXTO, false)
  const prioridade = input.prioridade ?? 'media'
  if (!ehPrioridade(prioridade)) throw new Error('Prioridade inválida: use baixa, media ou alta.')
  const prazo = normalizarPrazo(input.prazo)
  const responsavel = input.responsavelAgenteId ? agenteValido(await carregarAgentes(admin), input.responsavelAgenteId, 'Responsável').id : null

  // numero = max+1 por projeto; corrida rara cai no unique(projeto_id, numero) e tenta de novo.
  let numero = 0
  for (let tentativa = 0; ; tentativa++) {
    const { data: ultima, error: errMax } = await admin
      .from('projeto_tarefas')
      .select('numero')
      .eq('projeto_id', p.id)
      .order('numero', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (errMax) throw errMax
    numero = Number(ultima?.numero || 0) + 1
    const { error } = await admin.from('projeto_tarefas').insert({
      projeto_id: p.id,
      numero,
      titulo,
      descricao,
      prioridade,
      prazo,
      responsavel_agente_id: responsavel,
      ordem: numero,
    })
    if (!error) break
    if (error.code !== '23505' || tentativa >= 2) throw error
  }
  const agenteId = agenteDoAutor(autor)
  if (agenteId) await notificarCriador(admin, p, agenteId, `Nova tarefa T-${numero}: ${titulo}`)
  return { codigo: codigoProjeto(p.numero), numero }
}

export async function atualizarTarefa(
  admin: Admin,
  input: {
    codigo: string
    numero: number
    status?: TarefaStatus
    responsavelAgenteId?: string | null
    titulo?: string
    descricao?: string
    prioridade?: TarefaPrioridade
    prazo?: string | null
    comentario?: string
  },
  autor: Autor,
) {
  const p = await buscarProjeto(admin, input.codigo)
  await exigirEscrita(admin, p, autor)
  const t = await buscarTarefa(admin, p, input.numero)
  const patch: Record<string, unknown> = {}
  if (input.titulo !== undefined) patch.titulo = texto(input.titulo, 'o título da tarefa', MAX_TITULO)
  if (input.descricao !== undefined) patch.descricao = texto(input.descricao, 'a descrição', MAX_TEXTO, false)
  if (input.prioridade !== undefined) {
    if (!ehPrioridade(input.prioridade)) throw new Error('Prioridade inválida: use baixa, media ou alta.')
    patch.prioridade = input.prioridade
  }
  if (input.prazo !== undefined) patch.prazo = normalizarPrazo(input.prazo)
  if (input.responsavelAgenteId !== undefined) {
    patch.responsavel_agente_id = input.responsavelAgenteId
      ? agenteValido(await carregarAgentes(admin), input.responsavelAgenteId, 'Responsável').id
      : null
  }
  const mudouStatus = input.status !== undefined && input.status !== t.status
  if (input.status !== undefined && !ehTarefaStatus(input.status)) {
    throw new Error('Status de tarefa inválido: use pendente, em_andamento, bloqueado, em_revisao ou concluido.')
  }
  if (mudouStatus) {
    patch.status = input.status
    patch.concluida_em = concluidaEmPara(input.status as TarefaStatus, t.concluida_em, new Date().toISOString())
  }
  const comentario = texto(input.comentario, 'o comentário', MAX_TEXTO, false)
  if (!Object.keys(patch).length && !comentario) throw new Error('Nada para atualizar.')

  if (Object.keys(patch).length) {
    const { error } = await admin.from('projeto_tarefas').update(patch).eq('id', t.id)
    if (error) throw error
  }
  if (mudouStatus) {
    const para = input.status as TarefaStatus
    await inserirMensagem(
      admin,
      p,
      {
        tarefaId: t.id,
        tipo: 'status',
        conteudo: `T-${t.numero}: ${TAREFA_STATUS_LABEL[t.status]} → ${TAREFA_STATUS_LABEL[para]}`,
        meta: { entidade: 'tarefa', de: t.status, para },
      },
      autor,
    )
  }
  if (comentario) await inserirMensagem(admin, p, { tarefaId: t.id, tipo: 'mensagem', conteudo: comentario }, autor)
  const agenteId = agenteDoAutor(autor)
  if (agenteId && !mudouStatus && !comentario) await notificarCriador(admin, p, agenteId, `Atualizou a tarefa T-${t.numero}.`)
  return { codigo: codigoProjeto(p.numero) }
}

// ---------------------------------------------------------------------------
// Cotas das IAs: a cota é da CONTA (Claude.ai e Claude Code dividem uma).
// Valor informado pelo Bruno ou por uma IA; sem histórico.
// ---------------------------------------------------------------------------

async function carregarAgentesConta(admin: Admin): Promise<AgenteConta[]> {
  const { data, error } = await admin.from('projeto_agentes').select('id, slug, nome, ativo, cota_conta, cota_conta_rotulo')
  if (error) throw error
  return (data || []).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    nome: String(r.nome),
    ativo: r.ativo !== false,
    cotaConta: r.cota_conta ? String(r.cota_conta) : null,
    cotaContaRotulo: r.cota_conta_rotulo ? String(r.cota_conta_rotulo) : null,
  }))
}

/** Contas com cota legível (IA com cota_conta), ordem pelo rótulo; conta sem IA ativa só aparece se tiver cota. */
export async function listarCotas(admin: Admin): Promise<ContaCotas[]> {
  const [agentes, cotasR] = await Promise.all([carregarAgentesConta(admin), admin.from('projeto_agente_cotas').select('*').order('nome')])
  if (cotasR.error) throw cotasR.error
  const linhas = cotasR.data || []
  const nomes = await nomesUsuarios(admin, linhas.map((r) => String(r.atualizado_por_usuario_id || '')))
  const nomeAgente = new Map(agentes.map((a) => [a.id, a.nome]))
  const porConta = new Map<string, Cota[]>()
  for (const r of linhas) {
    const porAgenteId = r.atualizado_por_agente_id ? String(r.atualizado_por_agente_id) : null
    const cota: Cota = {
      id: String(r.id),
      conta: String(r.cota_conta),
      nome: String(r.nome),
      percentualUsado: Number(r.percentual_usado),
      reiniciaEm: r.reinicia_em ? String(r.reinicia_em) : null,
      observacao: r.observacao ? String(r.observacao) : null,
      atualizadoEm: String(r.updated_at),
      atualizadoPorNome: porAgenteId ? nomeAgente.get(porAgenteId) || 'IA' : nomes.get(String(r.atualizado_por_usuario_id)) || '—',
    }
    porConta.set(cota.conta, [...(porConta.get(cota.conta) || []), cota])
  }
  return contasDeAgentes(agentes)
    .map((c) => ({ ...c, cotas: porConta.get(c.conta) || [] }))
    .filter((c) => c.agentes.length || c.cotas.length)
}

/**
 * Upsert por (conta, nome sem diferenciar maiúsculas). Cotas não listadas ficam como estão.
 * Conta: `conta` explícita > conta da IA `agenteSlug` > conta da IA `agenteId`.
 */
export async function registrarCotas(
  admin: Admin,
  autor: Autor,
  alvo: { conta?: string | null; agenteSlug?: string | null; agenteId?: string | null },
  cotas: unknown,
): Promise<{ conta: string; rotulo: string; total: number }> {
  const agentes = await carregarAgentesConta(admin)
  const conta = resolverContaCota(agentes, alvo)
  const lista = validarCotas(cotas)
  const quem =
    'agenteId' in autor
      ? { atualizado_por_agente_id: autor.agenteId, atualizado_por_usuario_id: null }
      : { atualizado_por_usuario_id: autor.usuarioId, atualizado_por_agente_id: null }
  const { error } = await admin.from('projeto_agente_cotas').upsert(
    lista.map((c) => ({
      cota_conta: conta,
      nome: c.nome,
      percentual_usado: c.percentualUsado,
      reinicia_em: c.reiniciaEm,
      observacao: c.observacao,
      ...quem,
    })),
    { onConflict: 'cota_conta,nome_chave' },
  )
  if (error) throw error
  return { conta, rotulo: contasDeAgentes(agentes).find((c) => c.conta === conta)?.rotulo || conta, total: lista.length }
}

export async function removerCota(admin: Admin, cotaId: string) {
  const { data, error } = await admin.from('projeto_agente_cotas').delete().eq('id', String(cotaId)).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Cota não encontrada.')
}

// ---------------------------------------------------------------------------
// Tokens MCP dos agentes
// ---------------------------------------------------------------------------

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Gera token novo (o anterior para de valer) e devolve o token em claro uma única vez. */
export async function gerarTokenAgente(admin: Admin, agenteId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const { data, error } = await admin.from('projeto_agentes').update({ token_hash: hashToken(token) }).eq('id', agenteId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('IA não encontrada.')
  return token
}

/** Agente ativo dono do token, ou null. Compara sha256 em tempo constante (fail-closed). */
export async function agentePorToken(admin: Admin, token: string): Promise<Agente | null> {
  if (!token || token.length > 200) return null
  const recebido = Buffer.from(hashToken(token), 'hex')
  const { data, error } = await admin.from('projeto_agentes').select('id, slug, nome, ativo, token_hash').eq('ativo', true).not('token_hash', 'is', null)
  if (error) throw error
  let achado: Record<string, unknown> | null = null
  for (const r of data || []) {
    const guardado = Buffer.from(String(r.token_hash), 'hex')
    if (guardado.length === recebido.length && timingSafeEqual(guardado, recebido)) achado = r
  }
  return achado ? agenteDeLinha(achado) : null
}

// ---------------------------------------------------------------------------
// Webhook GitHub (push)
// ---------------------------------------------------------------------------

type PushPayload = {
  ref?: string
  repository?: { full_name?: string }
  commits?: Array<{ id?: string; message?: string; timestamp?: string; url?: string; author?: { name?: string } }>
}

export async function registrarPushGithub(admin: Admin, payload: PushPayload): Promise<{ recebidos: number; ligados: number }> {
  const repo = String(payload?.repository?.full_name || '')
  const commits = (Array.isArray(payload?.commits) ? payload.commits : []).filter((c) => c?.id)
  if (!repo || !commits.length) return { recebidos: 0, ligados: 0 }
  const branch = branchDoRef(payload.ref)
  const refs = commits.map((c) => extrairRefsCommit(String(c.message || '')))

  const numerosProjeto = [...new Set(refs.map((r) => r.projetoNumero).filter((n): n is number => n != null))]
  const projetoIdPorNumero = new Map<number, string>()
  const tarefaIdPorChave = new Map<string, string>()
  if (numerosProjeto.length) {
    const { data, error } = await admin.from('projetos').select('id, numero').in('numero', numerosProjeto).is('deleted_at', null)
    if (error) throw error
    for (const r of data || []) projetoIdPorNumero.set(Number(r.numero), String(r.id))
    const numerosTarefa = [...new Set(refs.map((r) => r.tarefaNumero).filter((n): n is number => n != null))]
    if (numerosTarefa.length && projetoIdPorNumero.size) {
      const { data: tarefas, error: errT } = await admin
        .from('projeto_tarefas')
        .select('id, projeto_id, numero')
        .in('projeto_id', [...projetoIdPorNumero.values()])
        .in('numero', numerosTarefa)
      if (errT) throw errT
      for (const t of tarefas || []) tarefaIdPorChave.set(`${t.projeto_id}:${t.numero}`, String(t.id))
    }
  }

  const linhas = commits.map((c, i) => {
    const projetoId = refs[i].projetoNumero != null ? projetoIdPorNumero.get(refs[i].projetoNumero!) || null : null
    const tarefaId = projetoId && refs[i].tarefaNumero != null ? tarefaIdPorChave.get(`${projetoId}:${refs[i].tarefaNumero}`) || null : null
    return {
      repo,
      sha: String(c.id),
      mensagem: String(c.message || '').slice(0, 5000),
      autor: String(c.author?.name || '').slice(0, 200),
      url: String(c.url || '').slice(0, 500),
      branch,
      commit_em: c.timestamp || null,
      projeto_id: projetoId,
      tarefa_id: tarefaId,
    }
  })
  // Mesmo sha repetido no payload faria o upsert falhar ("affect row a second time"); vale a última ocorrência.
  const unicas = [...new Map(linhas.map((l) => [`${l.repo}:${l.sha}`, l])).values()]
  const { error } = await admin.from('projeto_commits').upsert(unicas, { onConflict: 'repo,sha' })
  if (error) throw error
  return { recebidos: unicas.length, ligados: unicas.filter((l) => l.projeto_id).length }
}
