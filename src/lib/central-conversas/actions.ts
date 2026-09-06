'use server'

/**
 * Central de Conversas (BRS) — configuração das instâncias/canais e leitura
 * das conversas do Chatwoot. Dono aqui é sempre a BRS (owner_tipo 'brs');
 * o parceiro tem o equivalente dentro do CRM AlvoConsig.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission, requireCurrentUser, getCurrentUserEffectivePermissions, hasPermissionForUser } from '@/lib/auth/server'

/** Pro dock do BRS Messenger decidir se mostra a aba Atendimento. */
export async function podeAtenderConversas(): Promise<boolean> {
  try {
    const perms = await getCurrentUserEffectivePermissions()
    return perms.some((p) => p.resource_name === 'conversas' && Boolean(p.can_view))
  } catch {
    return false
  }
}
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarJson, cofreConfigurado, decifrarTexto } from './cofre'
import { engine, engineConfigurado } from './engine'
import { ChatwootConta, type ChatwootConversa } from './chatwoot'

const LIMITE_INSTANCIAS_BRS = 3

export type InstanciaView = {
  id: string
  nome: string
  papel: 'receptiva' | 'disparo'
  provedor: 'baileys' | 'zapi'
  permite_grupos: boolean
  status: string
  numero: string | null
  nome_perfil: string | null
  ultimo_qr: string | null
  qr_atualizado_em: string | null
  ultimo_erro: string | null
  conectada_em: string | null
  chatwoot_inbox_id: number | null
  ordem: number
  departamento_id: string | null
}

const COLS_VIEW = 'id, nome, papel, provedor, permite_grupos, status, numero, nome_perfil, ultimo_qr, qr_atualizado_em, ultimo_erro, conectada_em, chatwoot_inbox_id, ordem, departamento_id'

export async function contaBrs() {
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_contas').select('id, nome, chatwoot_account_id, token_cifrado').eq('owner_tipo', 'brs').maybeSingle()
  return data
}

export async function clienteChatwootBrs(): Promise<ChatwootConta | null> {
  const conta = await contaBrs()
  if (!conta) return null
  return new ChatwootConta(Number(conta.chatwoot_account_id), decifrarTexto(String(conta.token_cifrado)))
}

export async function getCentralConversasView() {
  const { permissions } = await requirePermission('central-conversas', 'can_view')
  const canEdit = permissions.some((p) => p.resource_name === 'central-conversas' && Boolean(p.can_edit))
  const admin = await createAdminClient()
  const conta = await contaBrs()
  const { data: instancias } = conta
    ? await admin.from('chat_instancias').select(COLS_VIEW).eq('conta_id', conta.id).is('deleted_at', null).order('ordem').order('created_at')
    : { data: [] as InstanciaView[] }

  let inboxes: Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }> = []
  if (conta) {
    try {
      const cli = await clienteChatwootBrs()
      inboxes = (await cli?.listarInboxes()) || []
    } catch {
      inboxes = []
    }
  }

  return {
    can_edit: canEdit,
    cofreOk: cofreConfigurado(),
    engineOk: engineConfigurado() ? await engine.saude() : false,
    chatwootUrl: String(process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br'),
    conta: conta ? { nome: String(conta.nome), chatwootAccountId: Number(conta.chatwoot_account_id) } : null,
    instancias: (instancias || []) as InstanciaView[],
    limite: LIMITE_INSTANCIAS_BRS,
    inboxes,
  }
}

export async function criarInstanciaBrs(input: { nome: string; provedor: 'baileys' | 'zapi'; zapi?: { instanceId: string; token: string; clientToken?: string } }) {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const nome = String(input.nome || '').trim().slice(0, 60)
  if (!nome) throw new Error('Dê um nome à instância (ex.: Suporte, Financeiro).')

  const { count } = await admin.from('chat_instancias').select('id', { count: 'exact', head: true }).eq('conta_id', conta.id).is('deleted_at', null)
  if ((count || 0) >= LIMITE_INSTANCIAS_BRS) throw new Error(`Limite de ${LIMITE_INSTANCIAS_BRS} instâncias por QR Code na BRS.`)

  let credencial: string | null = null
  if (input.provedor === 'zapi') {
    const z = input.zapi
    if (!z?.instanceId || !z?.token) throw new Error('Informe o ID da instância e o token da Z-API.')
    if (!cofreConfigurado()) throw new Error('Cofre não configurado.')
    credencial = cifrarJson({ instanceId: z.instanceId.trim(), token: z.token.trim(), clientToken: (z.clientToken || '').trim() || undefined })
  }

  const { data, error } = await admin
    .from('chat_instancias')
    .insert({
      conta_id: conta.id,
      owner_tipo: 'brs',
      nome,
      papel: 'receptiva',
      provedor: input.provedor,
      permite_grupos: true,
      credencial_cifrada: credencial,
      ordem: (count || 0) + 1,
    })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/central-conversas')
  return { id: String(data.id) }
}

export async function conectarInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  const res = await engine.conectar(instanciaId)
  revalidatePath('/central-conversas')
  return res
}

export async function statusInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_view')
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_instancias').select(COLS_VIEW).eq('id', instanciaId).is('deleted_at', null).maybeSingle()
  if (!data) throw new Error('Instância não encontrada.')
  return data as InstanciaView
}

export async function desconectarInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  await engine.desconectar(instanciaId, true)
  revalidatePath('/central-conversas')
  return { ok: true }
}

export async function excluirInstancia(instanciaId: string) {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()
  try {
    await engine.desconectar(instanciaId, true)
  } catch {
    // engine fora do ar: ainda assim marca como excluída
  }
  const { error } = await admin.from('chat_instancias').update({ deleted_at: new Date().toISOString(), status: 'desconectada', sessao_cifrada: null }).eq('id', instanciaId)
  if (error) throw error
  revalidatePath('/central-conversas')
  return { ok: true }
}

export async function conectar360dialog(input: { nome: string; telefone: string; apiKey: string }) {
  await requirePermission('central-conversas', 'can_edit')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const telefone = String(input.telefone || '').replace(/\D/g, '')
  if (!telefone || !input.apiKey?.trim()) throw new Error('Informe o número e a API key da 360dialog.')
  const inbox = await cli.criarInbox360dialog({ nome: String(input.nome || 'WhatsApp Oficial').trim(), telefone: `+${telefone}`, apiKey: input.apiKey.trim() })
  revalidatePath('/central-conversas')
  return { inboxId: inbox.id }
}

export async function criarChatDeSite(input: { nome: string; siteUrl: string }) {
  await requirePermission('central-conversas', 'can_edit')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const inbox = await cli.criarInboxSite({ nome: String(input.nome || 'Chat do site').trim(), siteUrl: String(input.siteUrl || '').trim() })
  revalidatePath('/central-conversas')
  return { inboxId: inbox.id, websiteToken: inbox.website_token }
}

// ---------------------------------------------------------------------------
// Atendimento (Central de Conversas / dock do BRS Messenger)
// ---------------------------------------------------------------------------

export type EntidadeTipo = 'parceiro' | 'instituicao' | 'promotora'

export type ConversaMeta = {
  protocolo: string
  observacoes: string
  entidade: { tipo: EntidadeTipo; id: string; nome: string } | null
}

export type EntidadeBusca = { tipo: EntidadeTipo; id: string; nome: string; detalhe: string | null }

type MetaRow = {
  chatwoot_conversation_id: number
  protocolo: string
  observacoes: string
  entidade_tipo: EntidadeTipo | null
  entidade_id: string | null
}

/** Resolve os nomes das entidades vinculadas (em lote, uma query por tipo). */
async function resolverNomesEntidades(rows: MetaRow[]): Promise<Map<string, string>> {
  const admin = await createAdminClient()
  const porTipo = new Map<EntidadeTipo, string[]>()
  for (const r of rows) {
    if (!r.entidade_tipo || !r.entidade_id) continue
    const ids = porTipo.get(r.entidade_tipo) || []
    ids.push(r.entidade_id)
    porTipo.set(r.entidade_tipo, ids)
  }
  const nomes = new Map<string, string>()
  const parceiros = porTipo.get('parceiro')
  if (parceiros?.length) {
    const { data } = await admin.from('agentes_parceiros').select('id, fantasy_name, name, arw_code').in('id', parceiros)
    for (const p of data || []) nomes.set(`parceiro:${p.id}`, String(p.fantasy_name || p.name || p.arw_code || 'Parceiro'))
  }
  const instituicoes = porTipo.get('instituicao')
  if (instituicoes?.length) {
    const { data } = await admin.from('financial_institutions').select('id, name').in('id', instituicoes)
    for (const i of data || []) nomes.set(`instituicao:${i.id}`, String(i.name || 'Instituição'))
  }
  const promotoras = porTipo.get('promotora')
  if (promotoras?.length) {
    const { data } = await admin.from('promotoras').select('id, nome_fantasia, razao_social').in('id', promotoras)
    for (const p of data || []) nomes.set(`promotora:${p.id}`, String(p.nome_fantasia || p.razao_social || 'Promotora'))
  }
  return nomes
}

async function metaRowParaView(row: MetaRow, nomes?: Map<string, string>): Promise<ConversaMeta> {
  const resolvidos = nomes || (await resolverNomesEntidades([row]))
  return {
    protocolo: String(row.protocolo || ''),
    observacoes: String(row.observacoes || ''),
    entidade:
      row.entidade_tipo && row.entidade_id
        ? { tipo: row.entidade_tipo, id: row.entidade_id, nome: resolvidos.get(`${row.entidade_tipo}:${row.entidade_id}`) || '' }
        : null,
  }
}

/** Assinatura de WhatsApp do usuário: nome_exibicao || name (nunca em nota interna). */
async function assinaturaDoUsuario(userId: string): Promise<string> {
  const admin = await createAdminClient()
  const { data } = await admin.from('users').select('name, nome_exibicao').eq('id', userId).maybeSingle()
  return String(data?.nome_exibicao || data?.name || '').trim()
}

function assinar(assinatura: string, texto: string): string {
  return assinatura ? `*${assinatura}:*\n${texto}` : texto
}

// ---------------------------------------------------------------------------
// Departamentos (Fase A — paridade Digisac). Fonte da verdade da FILIAÇÃO é o
// Chatwoot (Teams); o espelho local (`chat_departamentos`) guarda o resto.
// ---------------------------------------------------------------------------

export type DepartamentoResumo = { id: string; nome: string; chatwootTeamId: number | null; ehGrupos: boolean }

async function meusDepartamentosInterno(userId: string): Promise<{ ehSupervisor: boolean; departamentos: DepartamentoResumo[] }> {
  const ehSupervisor = await hasPermissionForUser(userId, 'central-conversas', 'can_view')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) return { ehSupervisor, departamentos: [] }
  if (ehSupervisor) {
    const { data } = await admin.from('chat_departamentos').select('id, nome, chatwoot_team_id, eh_grupos').eq('conta_id', conta.id).eq('ativo', true)
    return { ehSupervisor, departamentos: mapDepartamentos(data) }
  }
  const { data: membros } = await admin.from('chat_departamento_membros').select('departamento_id').eq('user_id', userId)
  const ids = [...new Set((membros || []).map((m: any) => m.departamento_id))]
  if (!ids.length) return { ehSupervisor, departamentos: [] }
  const { data } = await admin.from('chat_departamentos').select('id, nome, chatwoot_team_id, eh_grupos').in('id', ids).eq('ativo', true)
  return { ehSupervisor, departamentos: mapDepartamentos(data) }
}

function mapDepartamentos(rows: any[] | null): DepartamentoResumo[] {
  return (rows || []).map((d) => ({ id: String(d.id), nome: String(d.nome), chatwootTeamId: d.chatwoot_team_id === null ? null : Number(d.chatwoot_team_id), ehGrupos: Boolean(d.eh_grupos) }))
}

/** Pro seletor "Transferir para departamento" e pro filtro por permissão. */
export async function meusDepartamentos(): Promise<{ ehSupervisor: boolean; departamentos: DepartamentoResumo[] }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  return meusDepartamentosInterno(user.id)
}

// Mesma heurística de grupo do PainelContato (types.ts) — duplicada aqui de
// propósito: esta é uma action de servidor, não deve depender de um arquivo
// de componente de UI.
function conversaEhGrupo(c: ChatwootConversa): boolean {
  const sender = c.meta?.sender as { type?: string; identifier?: string } | undefined
  return sender?.type === 'group' || String(sender?.identifier || '').includes('-group')
}

/**
 * Roteia automaticamente pro departamento certo as conversas que ainda não
 * têm Team no Chatwoot (grupo → departamento "recebe grupos"; senão →
 * departamento padrão da conexão/inbox). Best-effort: falha aqui nunca
 * derruba a listagem — só fica sem departamento até a próxima tentativa.
 */
async function atribuirDepartamentosAutomaticos(cli: ChatwootConta, contaId: string, payload: ChatwootConversa[]): Promise<void> {
  const semTeam = payload.filter((c) => !c.meta?.team)
  if (!semTeam.length) return
  try {
    const admin = await createAdminClient()
    const [{ data: deptoGrupos }, { data: instancias }] = await Promise.all([
      admin.from('chat_departamentos').select('chatwoot_team_id').eq('conta_id', contaId).eq('eh_grupos', true).maybeSingle(),
      admin.from('chat_instancias').select('chatwoot_inbox_id, departamento_id').eq('conta_id', contaId).is('deleted_at', null).not('departamento_id', 'is', null),
    ])
    const deptoIds = [...new Set((instancias || []).map((i: any) => i.departamento_id).filter(Boolean))] as string[]
    let teamPorDepto = new Map<string, number>()
    if (deptoIds.length) {
      const { data: deps } = await admin.from('chat_departamentos').select('id, chatwoot_team_id').in('id', deptoIds)
      teamPorDepto = new Map((deps || []).filter((d: any) => d.chatwoot_team_id).map((d: any) => [String(d.id), Number(d.chatwoot_team_id)]))
    }
    const teamPorInbox = new Map<number, number>()
    for (const i of instancias || []) {
      const team = i.departamento_id ? teamPorDepto.get(i.departamento_id) : undefined
      if (i.chatwoot_inbox_id && team) teamPorInbox.set(Number(i.chatwoot_inbox_id), team)
    }
    const teamGrupos = deptoGrupos?.chatwoot_team_id ? Number(deptoGrupos.chatwoot_team_id) : null

    for (const c of semTeam) {
      const alvo = conversaEhGrupo(c) ? teamGrupos : teamPorInbox.get(c.inbox_id) ?? null
      if (alvo) {
        try {
          await cli.atribuir(c.id, { teamId: alvo })
        } catch {
          // best-effort: tenta de novo na próxima listagem
        }
      }
    }
  } catch (err) {
    console.error('[conversas] roteamento automático de departamento falhou', err)
  }
}

export async function getConversas(params: { aba: 'meus' | 'fila' | 'geral'; q?: string; page?: number; inboxId?: number; teamId?: number }) {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) return { disponivel: false as const, conversas: [], meta: {} }
  const assigneeType = params.aba === 'meus' ? 'me' : params.aba === 'fila' ? 'unassigned' : 'all'
  const data = await cli.listarConversas({ status: 'open', assigneeType, q: params.q, page: params.page, inboxId: params.inboxId, teamId: params.teamId })

  const conta = await contaBrs()
  let payload = data.payload || []

  // Permissão por departamento: filiação ao Team = permissão (spec §6). Quem
  // não tem `central-conversas` (supervisor) só vê conversas dos SEUS
  // departamentos; a aba "Geral" (visão de supervisão) fica vazia pra eles —
  // a UI já esconde essa aba de quem não é supervisor.
  const { ehSupervisor, departamentos } = await meusDepartamentosInterno(user.id)
  if (!ehSupervisor) {
    if (params.aba === 'geral') {
      payload = []
    } else {
      const idsPermitidos = new Set(departamentos.map((d) => d.chatwootTeamId).filter((x): x is number => x !== null))
      payload = payload.filter((c) => {
        const teamId = c.meta?.team?.id
        // Sem team ainda (conversa nova, roteamento automático pendente):
        // mostra — falha-aberto pra não esconder trabalho de ninguém antes do
        // roteamento rodar. Ver §0/§6 da spec.
        if (teamId === undefined || teamId === null) return true
        return idsPermitidos.has(teamId)
      })
    }
  }

  if (conta) void atribuirDepartamentosAutomaticos(cli, conta.id, payload)

  // Junta os metadados do Workspace (chat_conversa_meta) por conversa. A linha
  // meta NÃO é criada aqui em lote — nasce on-demand no getMeta() da conversa
  // aberta; quem ainda não tem linha volta com atendimentoMeta: null.
  let metaPorConversa = new Map<number, ConversaMeta>()
  try {
    const ids = payload.map((c) => c.id)
    if (conta && ids.length) {
      const admin = await createAdminClient()
      const { data: rows } = await admin
        .from('chat_conversa_meta')
        .select('chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id')
        .eq('conta_id', conta.id)
        .in('chatwoot_conversation_id', ids)
      const metaRows = (rows || []) as MetaRow[]
      const nomes = await resolverNomesEntidades(metaRows)
      metaPorConversa = new Map(await Promise.all(metaRows.map(async (r) => [r.chatwoot_conversation_id, await metaRowParaView(r, nomes)] as const)))
    }
  } catch {
    // meta é acessório da listagem: falha aqui não derruba o atendimento
  }
  const conversas = payload.map((c) => ({ ...c, atendimentoMeta: metaPorConversa.get(c.id) || null }))
  return { disponivel: true as const, conversas, meta: data.meta }
}

/** Contadores por aba (Chats/Fila/Geral), opcionalmente restritos a um departamento. */
export async function getContadores(teamId?: number): Promise<{ mine: number; unassigned: number; all: number }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return { mine: 0, unassigned: 0, all: 0 }
  try {
    const meta = await cli.metaConversas({ teamId })
    return { mine: meta.mine_count, unassigned: meta.unassigned_count, all: meta.all_count }
  } catch {
    return { mine: 0, unassigned: 0, all: 0 }
  }
}

/**
 * Metadados da conversa (protocolo/vínculo/observações). Cria a linha em
 * chat_conversa_meta on-demand na primeira leitura — o protocolo é gerado
 * por trigger no banco (inserimos sem protocolo e lemos de volta).
 */
export async function getMeta(conversationId: number): Promise<ConversaMeta> {
  await requirePermission('conversas', 'can_view')
  const row = await garantirMetaRow(conversationId)
  return metaRowParaView(row)
}

async function garantirMetaRow(conversationId: number): Promise<MetaRow> {
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const COLS = 'chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id'
  const { data: existente } = await admin
    .from('chat_conversa_meta')
    .select(COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .maybeSingle()
  if (existente) return existente as MetaRow
  // Corrida entre dois atendentes abrindo a mesma conversa: o unique
  // (conta_id, chatwoot_conversation_id) segura; em conflito, relê.
  const { error } = await admin.from('chat_conversa_meta').insert({ conta_id: conta.id, chatwoot_conversation_id: conversationId })
  if (error && String(error.code) !== '23505') throw error
  const { data: criada, error: errLeitura } = await admin
    .from('chat_conversa_meta')
    .select(COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .single()
  if (errLeitura) throw errLeitura
  return criada as MetaRow
}

/** Vincula (ou desvincula, com tipo e id nulos) a conversa a uma entidade do Workspace. */
export async function setVinculo(conversationId: number, tipo: EntidadeTipo | null, id: string | null): Promise<ConversaMeta> {
  await requirePermission('conversas', 'can_view')
  if ((tipo === null) !== (id === null)) throw new Error('Vínculo inválido: informe tipo e id juntos, ou nenhum.')
  if (tipo && !['parceiro', 'instituicao', 'promotora'].includes(tipo)) throw new Error('Tipo de entidade inválido.')
  const admin = await createAdminClient()
  if (tipo && id) {
    const tabela = tipo === 'parceiro' ? 'agentes_parceiros' : tipo === 'instituicao' ? 'financial_institutions' : 'promotoras'
    const { data: existe } = await admin.from(tabela).select('id').eq('id', id).maybeSingle()
    if (!existe) throw new Error('Entidade não encontrada para o vínculo.')
  }
  await garantirMetaRow(conversationId)
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: row, error } = await admin
    .from('chat_conversa_meta')
    .update({ entidade_tipo: tipo, entidade_id: id })
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .select('chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id')
    .single()
  if (error) throw error
  return metaRowParaView(row as MetaRow)
}

export async function setObservacoes(conversationId: number, texto: string): Promise<ConversaMeta> {
  await requirePermission('conversas', 'can_view')
  await garantirMetaRow(conversationId)
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: row, error } = await admin
    .from('chat_conversa_meta')
    .update({ observacoes: String(texto || '').slice(0, 4000) })
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .select('chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id')
    .single()
  if (error) throw error
  return metaRowParaView(row as MetaRow)
}

/** Busca de entidades pro "Vincular a" (máx. 8 por tipo; só ativas quando a tabela tem o conceito). */
export async function buscarEntidades(q: string): Promise<{ parceiros: EntidadeBusca[]; instituicoes: EntidadeBusca[]; promotoras: EntidadeBusca[] }> {
  await requirePermission('conversas', 'can_view')
  const termo = String(q || '').trim()
  if (!termo) return { parceiros: [], instituicoes: [], promotoras: [] }
  const admin = await createAdminClient()
  // Vírgula e parênteses quebrariam a sintaxe do .or() do PostgREST.
  const like = `%${termo.replace(/[%_,()]/g, '')}%`

  // agentes_parceiros não tem flag de ativo/deleted_at — busca em todos.
  const [parceirosRes, instituicoesRes, promotorasRes] = await Promise.all([
    admin.from('agentes_parceiros').select('id, arw_code, fantasy_name, name').or(`arw_code.ilike.${like},fantasy_name.ilike.${like},name.ilike.${like}`).limit(8),
    admin.from('financial_institutions').select('id, name').ilike('name', like).eq('is_active', true).is('deleted_at', null).limit(8),
    admin.from('promotoras').select('id, nome_fantasia, razao_social').or(`nome_fantasia.ilike.${like},razao_social.ilike.${like}`).eq('is_active', true).is('deleted_at', null).limit(8),
  ])

  return {
    parceiros: (parceirosRes.data || []).map((p) => ({
      tipo: 'parceiro' as const,
      id: String(p.id),
      nome: String(p.fantasy_name || p.name || ''),
      detalhe: p.arw_code ? `ARW ${p.arw_code}` : null,
    })),
    instituicoes: (instituicoesRes.data || []).map((i) => ({ tipo: 'instituicao' as const, id: String(i.id), nome: String(i.name || ''), detalhe: null })),
    promotoras: (promotorasRes.data || []).map((p) => ({
      tipo: 'promotora' as const,
      id: String(p.id),
      nome: String(p.nome_fantasia || p.razao_social || ''),
      detalhe: p.nome_fantasia && p.razao_social && p.nome_fantasia !== p.razao_social ? String(p.razao_social) : null,
    })),
  }
}

export async function getMensagens(conversationId: number, before?: number) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli.mensagens(conversationId, before)
}

export async function responderConversa(conversationId: number, content: string) {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const texto = String(content || '').trim()
  if (!texto) throw new Error('Mensagem vazia.')
  // Toda mensagem de WhatsApp da equipe sai assinada *Nome:*\n (mesma
  // convenção do CRM AlvoConsig). Nota interna NUNCA passa por aqui.
  const assinatura = await assinaturaDoUsuario(user.id)
  return cli.enviarMensagem(conversationId, assinar(assinatura, texto))
}

// Allowlist de anexos do composer (contrato BRS Messenger fase 1).
const ANEXO_MIMES_PERMITIDOS = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'audio/mpeg', // mp3
  'audio/mp3',
  'audio/ogg',
  'audio/opus',
  'video/mp4',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'text/csv',
])
const ANEXO_MAX_BYTES = 15 * 1024 * 1024

async function arquivoDoFormData(formData: FormData): Promise<{ nome: string; mime: string; bytes: Buffer }> {
  const file = formData.get('file')
  if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
  if (file.size > ANEXO_MAX_BYTES) throw new Error('Arquivo excede o limite de 15 MB.')
  const mime = String(file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase()
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.length) throw new Error('Arquivo vazio.')
  return { nome: String(file.name || 'arquivo'), mime, bytes }
}

/**
 * Anexo do composer (campos do FormData: 'file' e 'legenda' opcional).
 * Anexo com legenda assina a legenda; anexo sem texto vai sem assinatura.
 */
export async function enviarAnexoConversa(conversationId: number, formData: FormData): Promise<{ id: number }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const arquivo = await arquivoDoFormData(formData)
  if (!ANEXO_MIMES_PERMITIDOS.has(arquivo.mime)) throw new Error('Tipo de arquivo não permitido (aceitos: pdf, png, jpg, webp, mp3, ogg, opus, mp4, xlsx, csv).')
  const legenda = String(formData.get('legenda') || '').trim()
  const assinatura = legenda ? await assinaturaDoUsuario(user.id) : ''
  return cli.enviarMensagemComAnexo(conversationId, arquivo, legenda ? assinar(assinatura, legenda) : undefined)
}

/**
 * Áudio gravado no composer (MediaRecorder → ogg/opus; aceitamos também
 * audio/webm com opus, que é o que o Chrome entrega). Sem assinatura.
 */
export async function enviarAudioConversa(conversationId: number, formData: FormData): Promise<{ id: number }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const arquivo = await arquivoDoFormData(formData)
  if (!['audio/ogg', 'audio/opus', 'audio/webm'].includes(arquivo.mime)) throw new Error('Formato de áudio não suportado (esperado ogg/opus do gravador).')
  return cli.enviarMensagemComAnexo(conversationId, arquivo)
}

/** Nota interna (visual âmbar na UI): só o time vê. NUNCA assinada. */
export async function addNotaInterna(conversationId: number, texto: string): Promise<{ id: number }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const corpo = String(texto || '').trim()
  if (!corpo) throw new Error('Nota vazia.')
  return cli.notaInterna(conversationId, corpo)
}

/**
 * Transfere a conversa pra um DEPARTAMENTO (obrigatório) e, opcionalmente,
 * pra um atendente dentro dele. Comentário vira nota interna ANTES da
 * atribuição (padrão Digisac). Sem atendente escolhido, a conversa cai na
 * fila do departamento (desatribuída) — nunca fica presa com o atendente
 * anterior depois de transferida.
 */
export async function transferirConversa(conversationId: number, input: { departamentoId: string; agenteId?: number | null; comentario?: string }): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const admin = await createAdminClient()
  const { data: depto } = await admin.from('chat_departamentos').select('nome, chatwoot_team_id').eq('id', input.departamentoId).maybeSingle()
  if (!depto?.chatwoot_team_id) throw new Error('Departamento sem sincronização com o Chatwoot ainda.')

  const comentario = String(input.comentario || '').trim()
  if (comentario) {
    await cli.notaInterna(conversationId, `🔁 Transferido para ${depto.nome}: ${comentario}`)
  }
  await cli.atribuir(conversationId, { teamId: depto.chatwoot_team_id, assigneeId: input.agenteId ?? null })
  return { ok: true }
}

/** Encerra (resolve). Com motivo, registra nota interna "Encerrado: <motivo>" antes. */
export async function encerrarConversa(conversationId: number, motivo?: string): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const razao = String(motivo || '').trim()
  if (razao) await cli.notaInterna(conversationId, `Encerrado: ${razao}`)
  await cli.mudarStatus(conversationId, 'resolved')
  return { ok: true }
}

/** Tags disponíveis na conta (labels do Chatwoot). */
export async function getTagsConta(): Promise<Array<{ titulo: string; cor: string | null }>> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  const labels = await cli.listarLabelsConta()
  return labels.map((l) => ({ titulo: String(l.title), cor: l.color || null }))
}

export async function getTags(conversationId: number): Promise<string[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  return cli.labelsDaConversa(conversationId)
}

/** Grava o CONJUNTO de tags da conversa (substitui as anteriores). */
export async function setTags(conversationId: number, tags: string[]): Promise<string[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const limpas = (Array.isArray(tags) ? tags : []).map((t) => String(t || '').trim()).filter(Boolean)
  return cli.setLabelsDaConversa(conversationId, limpas)
}

/** O usuário edita a PRÓPRIA assinatura de WhatsApp (users.nome_exibicao). Vazio limpa. */
export async function setMinhaAssinatura(nomeExibicao: string): Promise<{ ok: true }> {
  const user = await requireCurrentUser()
  const admin = await createAdminClient()
  const valor = String(nomeExibicao || '').trim().slice(0, 60)
  const { error } = await admin.from('users').update({ nome_exibicao: valor || null }).eq('id', user.id)
  if (error) throw error
  return { ok: true }
}

export async function getMinhaAssinatura(): Promise<{ nomeExibicao: string | null; nome: string }> {
  const user = await requireCurrentUser()
  const admin = await createAdminClient()
  const { data } = await admin.from('users').select('name, nome_exibicao').eq('id', user.id).maybeSingle()
  return { nomeExibicao: data?.nome_exibicao ? String(data.nome_exibicao) : null, nome: String(data?.name || '') }
}

export async function silenciarConversa(conversationId: number, silenciar: boolean): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.silenciar(conversationId, silenciar)
  return { ok: true }
}

export async function marcarNaoLidaConversa(conversationId: number): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.marcarNaoLida(conversationId)
  return { ok: true }
}

/** Respostas rápidas (canned responses do Chatwoot) pros chips do composer. */
export async function getRespostasRapidas(): Promise<Array<{ id: number; atalho: string; conteudo: string }>> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  try {
    const lista = await cli.respostasRapidas()
    return (lista || []).map((c) => ({ id: c.id, atalho: String(c.short_code || ''), conteudo: String(c.content || '') }))
  } catch {
    return []
  }
}

/**
 * Canais pro filtro (chips): inboxes do Chatwoot + instâncias do engine.
 * Diferente do getCentralConversasView, exige só a permissão de ATENDER.
 */
export async function getCanaisAtendimento(): Promise<{
  inboxes: Array<{ id: number; nome: string; tipo: string }>
  instancias: Array<{ id: string; nome: string; inboxId: number | null; papel: 'receptiva' | 'disparo'; provedor: 'baileys' | 'zapi'; status: string }>
}> {
  await requirePermission('conversas', 'can_view')
  const conta = await contaBrs()
  if (!conta) return { inboxes: [], instancias: [] }
  const admin = await createAdminClient()
  const [{ data: instancias }, inboxes] = await Promise.all([
    admin.from('chat_instancias').select('id, nome, chatwoot_inbox_id, papel, provedor, status').eq('conta_id', conta.id).is('deleted_at', null).order('ordem'),
    clienteChatwootBrs()
      .then((cli) => cli?.listarInboxes() || [])
      .catch(() => [] as Array<{ id: number; name: string; channel_type: string }>),
  ])
  return {
    inboxes: (inboxes || []).map((i) => ({ id: i.id, nome: String(i.name), tipo: String(i.channel_type || '') })),
    instancias: (instancias || []).map((i) => ({
      id: String(i.id),
      nome: String(i.nome),
      inboxId: i.chatwoot_inbox_id === null ? null : Number(i.chatwoot_inbox_id),
      papel: i.papel as 'receptiva' | 'disparo',
      provedor: i.provedor as 'baileys' | 'zapi',
      status: String(i.status || ''),
    })),
  }
}

/**
 * "Nova conversa": envia a 1ª mensagem pelo engine na instância escolhida
 * (o engine espelha no Chatwoot e devolve a conversa criada). Texto assinado.
 */
export async function iniciarConversaPorTelefone(input: { instanciaId: string; telefone: string; texto: string }): Promise<{ conversationId: number | null }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const telefone = String(input.telefone || '').replace(/\D/g, '')
  if (telefone.length < 10) throw new Error('Informe o telefone com DDD (mínimo 10 dígitos).')
  const texto = String(input.texto || '').trim()
  if (!texto) throw new Error('Escreva a primeira mensagem.')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: inst } = await admin.from('chat_instancias').select('id, conta_id').eq('id', input.instanciaId).eq('conta_id', conta.id).is('deleted_at', null).maybeSingle()
  if (!inst) throw new Error('Instância não encontrada.')
  const assinatura = await assinaturaDoUsuario(user.id)
  const destino = telefone.length <= 11 ? `55${telefone}` : telefone
  const res = await engine.enviar(String(inst.id), destino, assinar(assinatura, texto))
  return { conversationId: res.conversationId ?? null }
}

export async function assumirConversa(conversationId: number, agenteId: number | null) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.atribuir(conversationId, { assigneeId: agenteId })
  return { ok: true }
}

export async function resolverConversa(conversationId: number) {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.mudarStatus(conversationId, 'resolved')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Presença (Online / Ausente / Offline) — mapeia pro agente Chatwoot do
// usuário logado, resolvido por e-mail (mesmo padrão de provisionar-agentes).
// "Ausente" no Digisac = 'busy' no Chatwoot.
// ---------------------------------------------------------------------------

async function meuEmail(userId: string): Promise<string | null> {
  const admin = await createAdminClient()
  const { data } = await admin.from('users').select('email').eq('id', userId).maybeSingle()
  return data?.email ? String(data.email) : null
}

export async function setMinhaDisponibilidade(status: 'online' | 'busy' | 'offline'): Promise<{ ok: boolean; erro?: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const user = await requireCurrentUser()
    const cli = await clienteChatwootBrs()
    const email = await meuEmail(user.id)
    if (!cli || !email) return { ok: false, erro: 'Chatwoot não provisionado.' }
    const agentes = await cli.agentes()
    const agente = agentes.find((a) => String(a.email || '').toLowerCase() === email.toLowerCase())
    if (!agente) return { ok: false, erro: 'Ainda não sincronizado como agente — tente novamente em instantes.' }
    await cli.atualizarDisponibilidadeAgente(agente.id, agente.role || 'agent', status)
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'Falha ao atualizar disponibilidade.' }
  }
}

export async function getMinhaDisponibilidade(): Promise<'online' | 'busy' | 'offline' | null> {
  try {
    await requirePermission('conversas', 'can_view')
    const user = await requireCurrentUser()
    const cli = await clienteChatwootBrs()
    const email = await meuEmail(user.id)
    if (!cli || !email) return null
    const agentes = await cli.agentes()
    const agente = agentes.find((a) => String(a.email || '').toLowerCase() === email.toLowerCase())
    return (agente?.availability_status as 'online' | 'busy' | 'offline' | undefined) || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Contatos (aba "Contatos" da lista — Digisac). Busca via /contacts/search.
// ---------------------------------------------------------------------------

export type ContatoBusca = { id: number; nome: string; telefone: string | null; thumbnail: string | null }

export async function listarContatos(params: { q?: string; page?: number }): Promise<ContatoBusca[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  try {
    const lista = await cli.listarContatos({ q: params.q, page: params.page })
    return lista.map((c) => ({ id: c.id, nome: String(c.name || c.phone_number || 'Sem nome'), telefone: c.phone_number || null, thumbnail: c.thumbnail || null }))
  } catch {
    return []
  }
}

export async function getAgentesChat() {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  // Espelha usuários do Workspace com permissão `conversas` como agentes da
  // conta (só escreve quando aparece usuário novo); falha não bloqueia a lista.
  try {
    const { sincronizarAgentesBrs } = await import('./provisionar-agentes')
    await sincronizarAgentesBrs(cli)
  } catch (err) {
    console.error('[conversas] sincronização de agentes falhou', err)
  }
  return cli.agentes()
}
