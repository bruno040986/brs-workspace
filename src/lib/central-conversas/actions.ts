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
import { engine, engineConfigurado, EngineEnvioIncertoError, mensagemErroEngine } from './engine'
import { ehOperationId, normalizarTelefoneDestino, type ResultadoEnvio } from './envio-intencao'
import { ChatwootConta, type ChatwootConversa, type ChatwootMensagem } from './chatwoot'
import { listarAgendamentos, type AcaoAgendada } from './agendamento-actions'

const LIMITE_INSTANCIAS_BRS = 3
const contatosHigienizadosSet = new Set<number>()
const conversasRoteadasSet = new Set<number>()

export type InstanciaRecargaItem = {
  id: string
  data_recarga: string
  valor: number
  proxima_recarga: string
  created_at: string
}

export type OperadoraOption = {
  id: string
  nome: string
  logo_url: string | null
}

export type InstanciaView = {
  id: string
  nome: string
  papel: 'receptiva' | 'disparo'
  provedor: 'baileys' | 'zapi'
  permite_grupos: boolean
  status: string
  numero: string | null
  numero_informado: string | null
  tipo_numero: 'celular' | 'fixo' | 'virtual' | null
  operadora_id: string | null
  operadora_nome: string | null
  operadora_logo_url: string | null
  tipo_plano: 'pre_pago' | 'pos_pago' | 'virtual' | null
  nome_perfil: string | null
  ultimo_qr: string | null
  qr_atualizado_em: string | null
  ultimo_erro: string | null
  conectada_em: string | null
  chatwoot_inbox_id: number | null
  ordem: number
  departamento_id: string | null
  ultima_recarga: InstanciaRecargaItem | null
  dias_para_recarga: number | null
}

const COLS_VIEW = 'id, nome, papel, provedor, permite_grupos, status, numero, numero_informado, tipo_numero, operadora_id, tipo_plano, nome_perfil, ultimo_qr, qr_atualizado_em, ultimo_erro, conectada_em, chatwoot_inbox_id, ordem, departamento_id'

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

async function enrichInstancias(instancias: any[]): Promise<InstanciaView[]> {
  if (!instancias.length) return []
  const admin = await createAdminClient()

  const operadoraIds = [...new Set(instancias.map((i) => i.operadora_id).filter(Boolean))] as string[]
  let operadorasMap = new Map<string, { nome: string; logo_url: string | null }>()
  if (operadoraIds.length) {
    const { data: ops } = await admin.from('operadoras_telefonia').select('id, nome, logo_url').in('id', operadoraIds)
    if (ops) {
      operadorasMap = new Map(ops.map((o) => [o.id, { nome: String(o.nome), logo_url: o.logo_url ? String(o.logo_url) : null }]))
    }
  }

  const instIds = instancias.map((i) => i.id)
  const { data: recargas } = await admin
    .from('chat_instancia_recargas')
    .select('id, instancia_id, data_recarga, valor, proxima_recarga, created_at')
    .in('instancia_id', instIds)
    .order('data_recarga', { ascending: false })

  const recargasPorInst = new Map<string, InstanciaRecargaItem>()
  if (recargas) {
    for (const r of recargas) {
      if (!recargasPorInst.has(r.instancia_id)) {
        recargasPorInst.set(r.instancia_id, {
          id: String(r.id),
          data_recarga: String(r.data_recarga),
          valor: Number(r.valor),
          proxima_recarga: String(r.proxima_recarga),
          created_at: String(r.created_at),
        })
      }
    }
  }

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  return instancias.map((i) => {
    const op = i.operadora_id ? operadorasMap.get(i.operadora_id) : undefined
    const recarga = recargasPorInst.get(i.id) || null
    let dias_para_recarga: number | null = null
    if (recarga?.proxima_recarga) {
      const prox = new Date(recarga.proxima_recarga + 'T00:00:00')
      const diffTime = prox.getTime() - hoje.getTime()
      dias_para_recarga = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }

    return {
      ...i,
      operadora_nome: op?.nome || null,
      operadora_logo_url: op?.logo_url || null,
      ultima_recarga: recarga,
      dias_para_recarga,
    } as InstanciaView
  })
}

export async function getCentralConversasView() {
  const { permissions } = await requirePermission('central-conversas', 'can_view')
  const canEdit = permissions.some((p) => p.resource_name === 'central-conversas' && Boolean(p.can_edit))
  const admin = await createAdminClient()
  const conta = await contaBrs()

  const { data: instanciasRaw } = conta
    ? await admin.from('chat_instancias').select(COLS_VIEW).eq('conta_id', conta.id).is('deleted_at', null).order('ordem').order('created_at')
    : { data: [] }

  const { data: operadorasRaw } = await admin
    .from('operadoras_telefonia')
    .select('id, nome, logo_url')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('nome')

  const operadoras = (operadorasRaw || []) as OperadoraOption[]
  const instancias = await enrichInstancias(instanciasRaw || [])

  // Saúde do engine (timeout 6s) e listagem de inboxes do Chatwoot são
  // chamadas de rede independentes — rodavam em série (achado 14/09/2026:
  // "tela muito lenta" em /central-conversas), somando os dois piores casos
  // a cada carregamento da página. Em paralelo.
  const [inboxes, engineOk] = await Promise.all([
    conta
      ? clienteChatwootBrs()
          .then((cli) => cli?.listarInboxes())
          .then((r) => r || [])
          .catch(() => [] as Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }>)
      : Promise.resolve([] as Array<{ id: number; name: string; channel_type: string; website_token?: string; phone_number?: string }>),
    engineConfigurado() ? engine.saude() : Promise.resolve(false),
  ])

  return {
    can_edit: canEdit,
    cofreOk: cofreConfigurado(),
    engineOk,
    chatwootUrl: String(process.env.CHATWOOT_URL || 'https://chat.brspromotora.com.br'),
    conta: conta ? { nome: String(conta.nome), chatwootAccountId: Number(conta.chatwoot_account_id) } : null,
    instancias,
    operadoras,
    limite: LIMITE_INSTANCIAS_BRS,
    inboxes,
  }
}

export async function criarInstanciaBrs(input: {
  nome: string
  provedor: 'baileys' | 'zapi'
  numero_informado?: string | null
  tipo_numero?: 'celular' | 'fixo' | 'virtual' | null
  operadora_id?: string | null
  tipo_plano?: 'pre_pago' | 'pos_pago' | 'virtual' | null
  zapi?: { instanceId: string; token: string; clientToken?: string }
}) {
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

  const numInformado = input.numero_informado?.trim() || null

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
      numero_informado: numInformado,
      tipo_numero: input.tipo_numero || null,
      operadora_id: input.operadora_id || null,
      tipo_plano: input.tipo_plano || null,
      ordem: (count || 0) + 1,
    })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/central-conversas')
  return { id: String(data.id) }
}

export async function salvarChipInstancia(input: {
  instanciaId: string
  nome?: string | null
  numero_informado?: string | null
  tipo_numero?: 'celular' | 'fixo' | 'virtual' | null
  operadora_id?: string | null
  tipo_plano?: 'pre_pago' | 'pos_pago' | 'virtual' | null
}) {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()

  const nomeLimpo = input.nome ? String(input.nome).trim().slice(0, 60) : undefined

  const row: Record<string, any> = {
    numero_informado: input.numero_informado?.trim() || null,
    tipo_numero: input.tipo_numero || null,
    operadora_id: input.operadora_id || null,
    tipo_plano: input.tipo_plano || null,
    updated_at: new Date().toISOString(),
  }

  if (nomeLimpo) {
    row.nome = nomeLimpo
  }

  const { error } = await admin.from('chat_instancias').update(row).eq('id', input.instanciaId)
  if (error) throw error
  revalidatePath('/central-conversas')
  return { success: true }
}

export async function registrarRecargaInstancia(input: {
  instanciaId: string
  data_recarga: string
  valor: number
  proxima_recarga: string
}) {
  await requirePermission('central-conversas', 'can_edit')
  const user = await requireCurrentUser()
  const admin = await createAdminClient()

  if (!input.instanciaId) throw new Error('ID da instância inválido.')
  if (!input.data_recarga) throw new Error('Informe a data da recarga.')
  if (!input.valor || Number(input.valor) <= 0) throw new Error('Informe um valor de recarga válido.')
  if (!input.proxima_recarga) throw new Error('Informe a data da próxima recarga.')

  const dRecarga = new Date(input.data_recarga + 'T00:00:00')
  const dProxima = new Date(input.proxima_recarga + 'T00:00:00')

  if (isNaN(dRecarga.getTime()) || isNaN(dProxima.getTime())) throw new Error('Datas inválidas.')

  if (dProxima <= dRecarga) {
    throw new Error('A próxima recarga deve ser posterior à data da recarga.')
  }

  const maxProxima = new Date(dRecarga)
  maxProxima.setDate(maxProxima.getDate() + 60)

  if (dProxima > maxProxima) {
    throw new Error('A próxima recarga não pode ser agendada para além de 60 dias da data de recarga.')
  }

  const { error } = await admin.from('chat_instancia_recargas').insert({
    instancia_id: input.instanciaId,
    data_recarga: input.data_recarga,
    valor: input.valor,
    proxima_recarga: input.proxima_recarga,
    autor_crm_usuario_id: user.id,
  })

  if (error) throw error
  revalidatePath('/central-conversas')
  return { success: true }
}

export async function listarRecargasInstancia(instanciaId: string): Promise<{ success: boolean; recargas?: InstanciaRecargaItem[]; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('chat_instancia_recargas')
      .select('id, data_recarga, valor, proxima_recarga, created_at')
      .eq('instancia_id', instanciaId)
      .order('data_recarga', { ascending: false })

    if (error) throw error
    const items = (data || []).map((r) => ({
      id: String(r.id),
      data_recarga: String(r.data_recarga),
      valor: Number(r.valor),
      proxima_recarga: String(r.proxima_recarga),
      created_at: String(r.created_at),
    }))
    return { success: true, recargas: items }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
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
  const [enriched] = await enrichInstancias([data])
  return enriched
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
  const porTipo = new Map<EntidadeTipo, Set<string>>()
  for (const r of rows) {
    if (!r.entidade_tipo || !r.entidade_id) continue
    const idLimpo = String(r.entidade_id).trim()
    if (!idLimpo) continue
    const set = porTipo.get(r.entidade_tipo) || new Set<string>()
    set.add(idLimpo)
    porTipo.set(r.entidade_tipo, set)
  }
  const nomes = new Map<string, string>()

  const parceiros = [...(porTipo.get('parceiro') || [])]
  const instituicoes = [...(porTipo.get('instituicao') || [])]
  const promotoras = [...(porTipo.get('promotora') || [])]

  const [parceirosRes, instituicoesRes, promotorasRes] = await Promise.all([
    parceiros.length
      ? admin.from('agentes_parceiros').select('id, fantasy_name, name, arw_code').in('id', parceiros)
      : Promise.resolve({ data: [] }),
    instituicoes.length
      ? admin.from('financial_institutions').select('id, name, razao_social').in('id', instituicoes)
      : Promise.resolve({ data: [] }),
    promotoras.length
      ? admin.from('promotoras').select('id, nome_fantasia, razao_social').in('id', promotoras)
      : Promise.resolve({ data: [] }),
  ])

  for (const p of parceirosRes.data || []) {
    const rotulo = p.arw_code ? `ARW ${p.arw_code}` : String(p.fantasy_name || p.name || 'Parceiro').trim()
    const idStr = String(p.id).trim()
    nomes.set(`parceiro:${idStr}`, rotulo)
    nomes.set(`parceiro:${idStr.toLowerCase()}`, rotulo)
  }

  for (const i of instituicoesRes.data || []) {
    const rotulo = String(i.name || i.razao_social || 'Instituição').trim()
    const idStr = String(i.id).trim()
    nomes.set(`instituicao:${idStr}`, rotulo)
    nomes.set(`instituicao:${idStr.toLowerCase()}`, rotulo)
  }

  for (const p of promotorasRes.data || []) {
    const rotulo = String(p.nome_fantasia || p.razao_social || 'Promotora').trim()
    const idStr = String(p.id).trim()
    nomes.set(`promotora:${idStr}`, rotulo)
    nomes.set(`promotora:${idStr.toLowerCase()}`, rotulo)
  }

  return nomes
}

async function metaRowParaView(row: MetaRow, nomes?: Map<string, string>): Promise<ConversaMeta> {
  const resolvidos = nomes || (await resolverNomesEntidades([row]))
  const idLimpo = row.entidade_id ? String(row.entidade_id).trim() : ''
  const chave = row.entidade_tipo && idLimpo ? `${row.entidade_tipo}:${idLimpo}` : ''
  const nomeResolvido = chave ? (resolvidos.get(chave) || resolvidos.get(chave.toLowerCase()) || '') : ''
  return {
    protocolo: String(row.protocolo || ''),
    observacoes: String(row.observacoes || ''),
    entidade:
      row.entidade_tipo && idLimpo
        ? { tipo: row.entidade_tipo, id: idLimpo, nome: nomeResolvido }
        : null,
  }
}

/** Assinatura de WhatsApp do usuário: nome_exibicao || name (nunca em nota interna). */
export async function assinaturaDoUsuario(userId: string): Promise<string> {
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
  // identifier = "<instanciaId>:<jid>" (engine); grupo = jid `@g.us`, igual ao engine.
  const sender = c.meta?.sender as { type?: string; identifier?: string } | undefined
  const jid = String(sender?.identifier || '').split(':').slice(1).join(':')
  return sender?.type === 'group' || jid.endsWith('@g.us')
}

/**
 * Roteia automaticamente pro departamento certo as conversas que ainda não
 * têm Team no Chatwoot. Ordem (Fase B): grupo → departamento "recebe
 * grupos"; senão → departamento/atendente PADRÃO DO CONTATO
 * (`chat_contato_meta`), se existir; senão → departamento padrão da
 * conexão/inbox. Best-effort: falha aqui nunca derruba a listagem — só fica
 * sem departamento até a próxima tentativa.
 */
async function atribuirDepartamentosAutomaticos(cli: ChatwootConta, contaId: string, payload: ChatwootConversa[]): Promise<void> {
  const semTeam = payload.filter((c) => !c.meta?.team && !conversasRoteadasSet.has(c.id))
  if (!semTeam.length) return
  for (const c of semTeam) conversasRoteadasSet.add(c.id)

  try {
    const admin = await createAdminClient()
    const contactIds = [...new Set(semTeam.map((c) => c.meta?.sender?.id).filter((x): x is number => typeof x === 'number'))]

    const [{ data: deptoGrupos }, { data: instancias }, { data: contatoMetas }] = await Promise.all([
      admin.from('chat_departamentos').select('chatwoot_team_id').eq('conta_id', contaId).eq('eh_grupos', true).maybeSingle(),
      admin.from('chat_instancias').select('chatwoot_inbox_id, departamento_id').eq('conta_id', contaId).is('deleted_at', null).not('departamento_id', 'is', null),
      contactIds.length
        ? admin
            .from('chat_contato_meta')
            .select('chatwoot_contact_id, departamento_padrao_id, atendente_padrao_chatwoot_id')
            .eq('conta_id', contaId)
            .in('chatwoot_contact_id', contactIds)
            .not('departamento_padrao_id', 'is', null)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const deptoIds = [
      ...new Set([
        ...(instancias || []).map((i: any) => i.departamento_id).filter(Boolean),
        ...(contatoMetas || []).map((m: any) => m.departamento_padrao_id).filter(Boolean),
      ]),
    ] as string[]
    let teamPorDepto = new Map<string, number>()
    let agentePadraoPorDepto = new Map<string, number>()
    if (deptoIds.length) {
      const { data: deps } = await admin.from('chat_departamentos').select('id, chatwoot_team_id, atendente_padrao_chatwoot_id').in('id', deptoIds)
      teamPorDepto = new Map((deps || []).filter((d: any) => d.chatwoot_team_id).map((d: any) => [String(d.id), Number(d.chatwoot_team_id)]))
      agentePadraoPorDepto = new Map((deps || []).filter((d: any) => d.atendente_padrao_chatwoot_id).map((d: any) => [String(d.id), Number(d.atendente_padrao_chatwoot_id)]))
    }
    const teamPorInbox = new Map<number, number>()
    const deptoIdPorInbox = new Map<number, string>()
    for (const i of instancias || []) {
      const team = i.departamento_id ? teamPorDepto.get(i.departamento_id) : undefined
      if (i.chatwoot_inbox_id && i.departamento_id) deptoIdPorInbox.set(Number(i.chatwoot_inbox_id), i.departamento_id)
      if (i.chatwoot_inbox_id && team) teamPorInbox.set(Number(i.chatwoot_inbox_id), team)
    }
    const metaPorContato = new Map((contatoMetas || []).map((m: any) => [Number(m.chatwoot_contact_id), m]))
    const teamGrupos = deptoGrupos?.chatwoot_team_id ? Number(deptoGrupos.chatwoot_team_id) : null

    const batch = semTeam.slice(0, 5)
    await Promise.allSettled(
      batch.map(async (c) => {
        let teamAlvo: number | null = null
        let agenteAlvo: number | undefined
        if (conversaEhGrupo(c)) {
          teamAlvo = teamGrupos
        } else {
          const contactId = c.meta?.sender?.id
          const metaContato = contactId ? metaPorContato.get(contactId) : undefined
          let deptoAlvoId: string | null = null
          if (metaContato?.departamento_padrao_id && teamPorDepto.has(metaContato.departamento_padrao_id)) {
            deptoAlvoId = metaContato.departamento_padrao_id
            teamAlvo = teamPorDepto.get(metaContato.departamento_padrao_id) || null
            if (metaContato.atendente_padrao_chatwoot_id) agenteAlvo = Number(metaContato.atendente_padrao_chatwoot_id)
          } else {
            deptoAlvoId = deptoIdPorInbox.get(c.inbox_id) ?? null
            teamAlvo = teamPorInbox.get(c.inbox_id) ?? null
          }
          if (agenteAlvo === undefined && deptoAlvoId) agenteAlvo = agentePadraoPorDepto.get(deptoAlvoId)
        }
        if (c.meta?.assignee?.id) agenteAlvo = c.meta.assignee.id
        if (teamAlvo) {
          try {
            await cli.atribuir(c.id, { teamId: teamAlvo, ...(agenteAlvo !== undefined ? { assigneeId: agenteAlvo } : {}) })
          } catch {
            // best-effort
          }
        }
      })
    )
  } catch (err) {
    console.error('[conversas] roteamento automático de departamento falhou', err)
  }
}

export async function getConversas(params: { aba: 'meus' | 'fila' | 'geral'; q?: string; page?: number; inboxId?: number; teamId?: number }) {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) return { disponivel: false as const, conversas: [], meta: {} }
  // Fila = abertas sem atendente; Geral = tudo (inclui resolvidas); Meus =
  // abertas DO USUÁRIO LOGADO. `assignee_type=me` não serve pra "Meus": o token
  // da conta é um só, então "me" era sempre o dono do token, pra todo mundo.
  const status = params.aba === 'geral' ? 'all' : 'open'
  let data: { meta: Record<string, number>; payload: ChatwootConversa[] }
  if (params.aba === 'meus') {
    const agenteId = await meuAgenteId(cli, user.id)
    if (agenteId === null) data = { meta: {}, payload: [] }
    else if (params.q) {
      // Busca textual só existe no GET /conversations — filtra o agente aqui.
      const r = await cli.listarConversas({ status, assigneeType: 'all', q: params.q, page: params.page, inboxId: params.inboxId, teamId: params.teamId })
      data = { ...r, payload: (r.payload || []).filter((c) => c.meta?.assignee?.id === agenteId) }
    } else data = await cli.filtrarConversas({ assigneeId: agenteId, status, page: params.page, inboxId: params.inboxId, teamId: params.teamId })
  } else {
    data = await cli.listarConversas({ status, assigneeType: params.aba === 'fila' ? 'unassigned' : 'all', q: params.q, page: params.page, inboxId: params.inboxId, teamId: params.teamId })
  }

  const conta = await contaBrs()
  let payload = data.payload || []

  // Permissão por departamento: filiação ao Team = permissão (spec §6). Quem
  // não tem `central-conversas` (supervisor) só vê conversas dos SEUS
  // departamentos.
  const { ehSupervisor, departamentos } = await meusDepartamentosInterno(user.id)
  if (!ehSupervisor) {
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

  if (conta) void atribuirDepartamentosAutomaticos(cli, conta.id, payload)

  // Junta os metadados do Workspace (chat_conversa_meta) por conversa. A linha
  // meta NÃO é criada aqui em lote — nasce on-demand no getMeta() da conversa
  // aberta; quem ainda não tem linha volta com atendimentoMeta: null.
  let metaPorConversa = new Map<number, ConversaMeta>()
  try {
    const ids = payload.map((c) => c.id)
    if (conta && ids.length) {
      const admin = await createAdminClient()
      const contactIds = payload.map((c) => c.meta?.sender?.id).filter((x): x is number => typeof x === 'number')

      const [{ data: rows }, { data: contactRows }] = await Promise.all([
        admin
          .from('chat_conversa_meta')
          .select('chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id')
          .eq('conta_id', conta.id)
          .in('chatwoot_conversation_id', ids),
        contactIds.length
          ? admin
              .from('chat_contato_meta')
              .select('chatwoot_contact_id, entidade_tipo, entidade_id')
              .eq('conta_id', conta.id)
              .in('chatwoot_contact_id', contactIds)
          : Promise.resolve({ data: [] }),
      ])

      const metaRows = (rows || []) as MetaRow[]
      const contactMetaMap = new Map<number, { tipo: EntidadeTipo; id: string }>()
      for (const cr of contactRows || []) {
        if (cr.entidade_tipo && cr.entidade_id) {
          contactMetaMap.set(Number(cr.chatwoot_contact_id), { tipo: cr.entidade_tipo as EntidadeTipo, id: String(cr.entidade_id) })
        }
      }

      // Monta as linhas efetivas para a resolução de nomes em lote
      const effectiveRows: MetaRow[] = []
      for (const c of payload) {
        const existing = metaRows.find((r) => r.chatwoot_conversation_id === c.id)
        const contactId = c.meta?.sender?.id
        const cMeta = contactId ? contactMetaMap.get(contactId) : undefined
        if (existing && existing.entidade_tipo && existing.entidade_id) {
          effectiveRows.push(existing)
        } else if (existing) {
          effectiveRows.push({
            ...existing,
            entidade_tipo: cMeta ? cMeta.tipo : existing.entidade_tipo,
            entidade_id: cMeta ? cMeta.id : existing.entidade_id,
          })
        } else if (cMeta) {
          effectiveRows.push({
            chatwoot_conversation_id: c.id,
            protocolo: '',
            observacoes: '',
            entidade_tipo: cMeta.tipo,
            entidade_id: cMeta.id,
          })
        }
      }

      const nomes = await resolverNomesEntidades(effectiveRows)
      metaPorConversa = new Map(await Promise.all(effectiveRows.map(async (r) => [r.chatwoot_conversation_id, await metaRowParaView(r, nomes)] as const)))
    }
  } catch {
    // meta é acessório da listagem: falha aqui não derruba o atendimento
  }

  const conversas = payload.map((c) => {
    const senderName = c.meta?.sender?.name || ''
    const contactId = c.meta?.sender?.id

    if (senderName && /bruno/i.test(senderName)) {
      const rawPhone = c.meta.sender?.phone_number || (c.meta.sender?.identifier ? String(c.meta.sender.identifier).split(':').pop()?.replace('@s.whatsapp.net', '') : '') || ''
      const limpo = rawPhone.replace(/\D/g, '')
      const ehDono = limpo.endsWith('999551641') || limpo.endsWith('99551641') || limpo.endsWith('999556019') || limpo.endsWith('99556019')
      if (limpo && !ehDono) {
        const digitsOnly = limpo.startsWith('55') && (limpo.length === 12 || limpo.length === 13) ? limpo.slice(2) : limpo
        let telefoneFormatado = limpo
        if (digitsOnly.length === 11) {
          telefoneFormatado = digitsOnly.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
        } else if (digitsOnly.length === 10) {
          telefoneFormatado = digitsOnly.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
        }
        if (c.meta.sender) {
          c.meta.sender.name = telefoneFormatado
        }
        if (cli && contactId && !contatosHigienizadosSet.has(contactId)) {
          contatosHigienizadosSet.add(contactId)
          void cli.atualizarContato(contactId, { name: telefoneFormatado }).catch(() => {})
        }
      } else if (!limpo && cli && contactId && !contatosHigienizadosSet.has(contactId)) {
        contatosHigienizadosSet.add(contactId)
        void (async () => {
          try {
            const detalhe = await cli.detalharContato(contactId)
            const p = detalhe?.phone_number || detalhe?.identifier || ''
            const l = p.replace(/\D/g, '')
            if (l && !l.endsWith('999551641') && !l.endsWith('99551641')) {
              const dOnly = l.startsWith('55') && (l.length === 12 || l.length === 13) ? l.slice(2) : l
              const fmt = dOnly.length === 11 ? dOnly.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : dOnly.length === 10 ? dOnly.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3') : l
              await cli.atualizarContato(contactId, { name: fmt })
            }
          } catch {}
        })()
      }
    }

    // Sanitização síncrona e auto-healing de contatos salvos com nome contendo '@lid'
    if (senderName && /@lid/i.test(senderName)) {
      const rawPhone = c.meta?.sender?.phone_number || (c.meta?.sender?.identifier ? String(c.meta.sender.identifier).split(':').pop()?.replace('@s.whatsapp.net', '') : '') || ''
      const limpo = rawPhone.replace(/\D/g, '')
      if (limpo && limpo.length >= 10 && !limpo.includes('lid')) {
        const digitsOnly = limpo.startsWith('55') && (limpo.length === 12 || limpo.length === 13) ? limpo.slice(2) : limpo
        let telefoneFormatado = limpo
        if (digitsOnly.length === 11) {
          telefoneFormatado = digitsOnly.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
        } else if (digitsOnly.length === 10) {
          telefoneFormatado = digitsOnly.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
        }
        if (c.meta?.sender) {
          c.meta.sender.name = telefoneFormatado
        }
        if (cli && contactId && !contatosHigienizadosSet.has(contactId)) {
          contatosHigienizadosSet.add(contactId)
          void cli.atualizarContato(contactId, { name: telefoneFormatado }).catch(() => {})
        }
      } else {
        if (c.meta?.sender) {
          c.meta.sender.name = 'Contato WhatsApp'
        }
        if (cli && contactId && !contatosHigienizadosSet.has(contactId)) {
          contatosHigienizadosSet.add(contactId)
          const lidClean = senderName.split(':')[0]
          void (async () => {
            try {
              const admin = await createAdminClient()
              const { data: aliasRow } = await admin
                .from('chat_contato_alias')
                .select('jid_telefone')
                .eq('lid', lidClean.endsWith('@lid') ? lidClean : `${lidClean}@lid`)
                .maybeSingle()

              if (aliasRow?.jid_telefone) {
                const digitos = String(aliasRow.jid_telefone).replace(/\D/g, '')
                const digitsOnly = digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13) ? digitos.slice(2) : digitos
                const fmt = digitsOnly.length === 11 ? digitsOnly.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : digitsOnly.length === 10 ? digitsOnly.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3') : digitos
                await cli.atualizarContato(contactId, { name: fmt })
              }
            } catch {}
          })()
        }
      }
    }
    return { ...c, atendimentoMeta: metaPorConversa.get(c.id) || null }
  })
  return { disponivel: true as const, conversas, meta: data.meta }
}

/** Contadores por aba (Chats/Fila/Geral), opcionalmente restritos a um departamento. */
export async function getContadores(teamId?: number): Promise<{ mine: number; unassigned: number; all: number }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) return { mine: 0, unassigned: 0, all: 0 }
  try {
    const [meta, agenteId] = await Promise.all([cli.metaConversas({ teamId }), meuAgenteId(cli, user.id)])
    // `mine_count` da API é do dono do token — o badge "Chats" tem que contar o
    // mesmo universo que a aba lista: abertas atribuídas ao agente do usuário.
    const minhas = agenteId === null ? null : await cli.filtrarConversas({ assigneeId: agenteId, status: 'open', teamId }).catch(() => null)
    const mine = minhas ? (minhas.meta?.all_count ?? minhas.payload?.length ?? 0) : 0
    return { mine, unassigned: meta.unassigned_count, all: meta.all_count }
  } catch {
    return { mine: 0, unassigned: 0, all: 0 }
  }
}

/**
 * Metadados da conversa (protocolo/vínculo/observações). Cria a linha em
 * chat_conversa_meta on-demand na primeira leitura — o protocolo é gerado
 * por trigger no banco (inserimos sem protocolo e lemos de volta).
 */
/**
 * Leitura de metadados da conversa sem efeitos colaterais de escrita (GET idôneo).
 * Não realiza INSERT se a linha ainda não existir.
 */
export async function getMetaReadOnly(conversationId: number, contactId?: number): Promise<ConversaMeta> {
  await requirePermission('conversas', 'can_view')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) return { protocolo: '', observacoes: '', entidade: null }

  const COLS = 'chatwoot_conversation_id, protocolo, observacoes, entidade_tipo, entidade_id'
  const { data: existente } = await admin
    .from('chat_conversa_meta')
    .select(COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_conversation_id', conversationId)
    .maybeSingle()

  if (existente) return metaRowParaView(existente as MetaRow)
  return { protocolo: '', observacoes: '', entidade: null }
}

export async function getMeta(conversationId: number, contactId?: number): Promise<ConversaMeta> {
  await requirePermission('conversas', 'can_view')
  const row = await garantirMetaRow(conversationId, contactId)
  return metaRowParaView(row)
}

/**
 * Cria a linha de meta da conversa se ainda não existir. Quando `contactId`
 * vem (a UI sempre tem `conversa.meta.sender.id`), o vínculo do CONTATO
 * (`chat_contato_meta`) PRÉ-PREENCHE o vínculo da conversa na criação —
 * decisão da Fase B (spec §4): a conversa continua podendo sobrescrever
 * pontualmente sem alterar o padrão do contato.
 */
async function garantirMetaRow(conversationId: number, contactId?: number): Promise<MetaRow> {
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

  let entidadeTipo: EntidadeTipo | null = null
  let entidadeId: string | null = null
  if (contactId) {
    const { data: contatoMeta } = await admin
      .from('chat_contato_meta')
      .select('entidade_tipo, entidade_id')
      .eq('conta_id', conta.id)
      .eq('chatwoot_contact_id', contactId)
      .maybeSingle()
    if (contatoMeta?.entidade_tipo && contatoMeta?.entidade_id) {
      entidadeTipo = contatoMeta.entidade_tipo as EntidadeTipo
      entidadeId = String(contatoMeta.entidade_id)
    }
  }

  // Corrida entre dois atendentes abrindo a mesma conversa: o unique
  // (conta_id, chatwoot_conversation_id) segura; em conflito, relê.
  const { error } = await admin
    .from('chat_conversa_meta')
    .insert({ conta_id: conta.id, chatwoot_conversation_id: conversationId, entidade_tipo: entidadeTipo, entidade_id: entidadeId })
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

// ---------------------------------------------------------------------------
// Meta por CONTATO (Fase B): vínculo/departamento/atendente padrão que
// persistem entre conversas do mesmo contato (chat_contato_meta). Chave =
// `conversa.meta.sender.id`, o mesmo id que o Chatwoot já devolve na lista —
// não duplica nada do cadastro do contato.
// ---------------------------------------------------------------------------

export type ContatoMeta = {
  entidade: { tipo: EntidadeTipo; id: string; nome: string } | null
  departamentoPadraoId: string | null
  atendentePadraoChatwootId: number | null
}

type ContatoMetaRow = {
  chatwoot_contact_id: number
  entidade_tipo: EntidadeTipo | null
  entidade_id: string | null
  departamento_padrao_id: string | null
  atendente_padrao_chatwoot_id: number | null
}

const CONTATO_META_COLS = 'chatwoot_contact_id, entidade_tipo, entidade_id, departamento_padrao_id, atendente_padrao_chatwoot_id'

async function contatoMetaParaView(row: ContatoMetaRow): Promise<ContatoMeta> {
  let nome = ''
  if (row.entidade_tipo && row.entidade_id) {
    const nomes = await resolverNomesEntidades([{ chatwoot_conversation_id: 0, protocolo: '', observacoes: '', entidade_tipo: row.entidade_tipo, entidade_id: row.entidade_id }])
    nome = nomes.get(`${row.entidade_tipo}:${row.entidade_id}`) || ''
  }
  return {
    entidade: row.entidade_tipo && row.entidade_id ? { tipo: row.entidade_tipo, id: row.entidade_id, nome } : null,
    departamentoPadraoId: row.departamento_padrao_id,
    atendentePadraoChatwootId: row.atendente_padrao_chatwoot_id,
  }
}

async function garantirContatoMetaRow(contactId: number): Promise<ContatoMetaRow> {
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: existente } = await admin
    .from('chat_contato_meta')
    .select(CONTATO_META_COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .maybeSingle()
  if (existente) return existente as ContatoMetaRow
  const { error } = await admin.from('chat_contato_meta').insert({ conta_id: conta.id, chatwoot_contact_id: contactId })
  if (error && String(error.code) !== '23505') throw error
  const { data: criada, error: errLeitura } = await admin
    .from('chat_contato_meta')
    .select(CONTATO_META_COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .single()
  if (errLeitura) throw errLeitura
  return criada as ContatoMetaRow
}

/**
 * Leitura de metadados de contato sem efeitos colaterais de escrita (GET idôneo).
 * Não realiza INSERT se a linha ainda não existir.
 */
export async function getContatoMetaReadOnly(contactId: number): Promise<ContatoMeta> {
  await requirePermission('conversas', 'can_view')
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) return { entidade: null, departamentoPadraoId: null, atendentePadraoChatwootId: null }

  const { data: existente } = await admin
    .from('chat_contato_meta')
    .select(CONTATO_META_COLS)
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .maybeSingle()

  if (existente) return contatoMetaParaView(existente as ContatoMetaRow)
  return { entidade: null, departamentoPadraoId: null, atendentePadraoChatwootId: null }
}

export async function getContatoMeta(contactId: number): Promise<ContatoMeta> {
  await requirePermission('conversas', 'can_view')
  const row = await garantirContatoMetaRow(contactId)
  return contatoMetaParaView(row)
}

export async function setVinculoContato(contactId: number, tipo: EntidadeTipo | null, id: string | null): Promise<ContatoMeta> {
  await requirePermission('conversas', 'can_view')
  if ((tipo === null) !== (id === null)) throw new Error('Vínculo inválido: informe tipo e id juntos, ou nenhum.')
  const admin = await createAdminClient()
  if (tipo && id) {
    const tabela = tipo === 'parceiro' ? 'agentes_parceiros' : tipo === 'instituicao' ? 'financial_institutions' : 'promotoras'
    const { data: existe } = await admin.from(tabela).select('id').eq('id', id).maybeSingle()
    if (!existe) throw new Error('Entidade não encontrada para o vínculo.')
  }
  await garantirContatoMetaRow(contactId)
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: row, error } = await admin
    .from('chat_contato_meta')
    .update({ entidade_tipo: tipo, entidade_id: id })
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .select(CONTATO_META_COLS)
    .single()
  if (error) throw error
  return contatoMetaParaView(row as ContatoMetaRow)
}

export async function setDepartamentoPadraoContato(contactId: number, departamentoId: string | null): Promise<ContatoMeta> {
  await requirePermission('conversas', 'can_view')
  await garantirContatoMetaRow(contactId)
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: row, error } = await admin
    .from('chat_contato_meta')
    .update({ departamento_padrao_id: departamentoId })
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .select(CONTATO_META_COLS)
    .single()
  if (error) throw error
  return contatoMetaParaView(row as ContatoMetaRow)
}

export async function setAtendentePadraoContato(contactId: number, chatwootAgentId: number | null): Promise<ContatoMeta> {
  await requirePermission('conversas', 'can_view')
  await garantirContatoMetaRow(contactId)
  const admin = await createAdminClient()
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  const { data: row, error } = await admin
    .from('chat_contato_meta')
    .update({ atendente_padrao_chatwoot_id: chatwootAgentId })
    .eq('conta_id', conta.id)
    .eq('chatwoot_contact_id', contactId)
    .select(CONTATO_META_COLS)
    .single()
  if (error) throw error
  return contatoMetaParaView(row as ContatoMetaRow)
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

export type MensagemExtras = { status?: 'enviado' | 'entregue' | 'lido' | 'falhou'; reacoes: Array<{ jid: string; emoji: string }>; /** Texto atual de mensagem editada no WhatsApp (chat_mensagem_edicoes); o original fica no Chatwoot. */ edicao?: { texto: string; origem: 'nos' | 'contato' } }
export type MensagemComExtras = ChatwootMensagem & MensagemExtras

/**
 * Mensagens da conversa + ticks/reações gravados pelo engine
 * (chat_mensagem_status/chat_mensagem_reacoes, Fase B) — join best-effort:
 * se as tabelas ainda não tiverem dado (engine sem publicar ainda), a
 * conversa segue funcionando normalmente, só sem os extras.
 */
export async function getMensagens(conversationId: number, before?: number): Promise<{ payload: MensagemComExtras[]; meta: Record<string, unknown> }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const r = await cli.mensagens(conversationId, before)
  const payload = r.payload || []
  try {
    const conta = await contaBrs()
    const ids = payload.map((m) => m.id)
    if (conta && ids.length) {
      const admin = await createAdminClient()
      const [{ data: status }, { data: reacoes }, { data: edicoes }] = await Promise.all([
        admin.from('chat_mensagem_status').select('chatwoot_message_id, status').eq('conta_id', conta.id).in('chatwoot_message_id', ids),
        admin.from('chat_mensagem_reacoes').select('chatwoot_message_id, jid, emoji').eq('conta_id', conta.id).in('chatwoot_message_id', ids),
        // Tabela nova: sem a migration aplicada o select devolve erro (data null) e a conversa segue sem "editada".
        admin.from('chat_mensagem_edicoes').select('chatwoot_message_id, texto_novo, origem').eq('conta_id', conta.id).in('chatwoot_message_id', ids),
      ])
      const edicaoPorMsg = new Map((edicoes || []).map((e: any) => [e.chatwoot_message_id, { texto: String(e.texto_novo), origem: e.origem as 'nos' | 'contato' }]))
      const statusPorMsg = new Map((status || []).map((s: any) => [s.chatwoot_message_id, s.status]))
      const reacoesPorMsg = new Map<number, Array<{ jid: string; emoji: string }>>()
      for (const rr of reacoes || []) {
        const arr = reacoesPorMsg.get(rr.chatwoot_message_id) || []
        arr.push({ jid: String(rr.jid), emoji: String(rr.emoji) })
        reacoesPorMsg.set(rr.chatwoot_message_id, arr)
      }
      return { ...r, payload: payload.map((m) => ({ ...m, status: statusPorMsg.get(m.id), reacoes: reacoesPorMsg.get(m.id) || [], edicao: edicaoPorMsg.get(m.id) })) }
    }
  } catch {
    // extras são acessórios — a conversa segue sem ticks/reações
  }
  return { ...r, payload: payload.map((m) => ({ ...m, reacoes: [] })) }
}

export type DadosConversaAberta = {
  mensagens: MensagemComExtras[]
  meta: ConversaMeta
  tagsConversa: string[]
  agendamentos: AcaoAgendada[]
  contatoMeta: ContatoMeta | null
  tagsContato: string[]
}

/**
 * Busca consolidada de todos os dados necessários ao abrir/alternar uma conversa.
 * Em vez de 6 Server Actions separadas (e 6 RTTs de rede), busca tudo em paralelo
 * em uma única chamada de servidor.
 */
export async function getDadosConversaAberta(conversationId: number, contactId?: number): Promise<DadosConversaAberta> {
  await requirePermission('conversas', 'can_view')
  const [mensagensRes, metaRes, tagsRes, agendamentosRes, contatoMetaRes, tagsContatoRes] = await Promise.all([
    getMensagens(conversationId).catch(() => ({ payload: [] as MensagemComExtras[], meta: {} })),
    getMeta(conversationId, contactId).catch(() => ({ protocolo: '', observacoes: '', entidade: null })),
    getTags(conversationId).catch(() => [] as string[]),
    listarAgendamentos(conversationId).catch(() => [] as AcaoAgendada[]),
    contactId ? getContatoMeta(contactId).catch(() => null) : Promise.resolve(null),
    contactId ? getTagsContato(contactId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ])

  return {
    mensagens: mensagensRes.payload || [],
    meta: metaRes,
    tagsConversa: tagsRes,
    agendamentos: agendamentosRes,
    contatoMeta: contatoMetaRes,
    tagsContato: tagsContatoRes,
  }
}

/**
 * `inReplyTo` = id (no Chatwoot) da mensagem citada — vira
 * `content_attributes.in_reply_to`, contrato nosso com o engine pro Baileys
 * mandar como `quoted` de verdade no WhatsApp (ver
 * docs/RECADO-ENGINE-ACK-REACAO-APARELHO.md).
 */
export async function responderConversa(conversationId: number, content: string, inReplyTo?: number, mentions?: string[]) {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const texto = String(content || '').trim()
  if (!texto) throw new Error('Mensagem vazia.')
  // Toda mensagem de WhatsApp da equipe sai assinada *Nome:*\n (mesma
  // convenção do CRM AlvoConsig). Nota interna NUNCA passa por aqui.
  const assinatura = await assinaturaDoUsuario(user.id)
  const contentAttributes: Record<string, unknown> = {}
  if (inReplyTo) contentAttributes.in_reply_to = inReplyTo
  if (mentions?.length) contentAttributes.mentions = mentions
  return cli.enviarMensagem(conversationId, assinar(assinatura, texto), false, Object.keys(contentAttributes).length ? contentAttributes : undefined)
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
 * Áudio gravado no composer (ogg/opus do Firefox ou webm/opus do Chrome; o
 * engine converte SEMPRE pra OGG/Opus mono antes de mandar como nota de voz).
 * Sem assinatura. Retorna `{ok:false,error}` em vez de lançar: o Next apaga a
 * mensagem de um Error lançado em produção (ver transferirConversa).
 */
export async function enviarAudioConversa(conversationId: number, formData: FormData): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const cli = await clienteChatwootBrs()
    if (!cli) throw new Error('Chatwoot não provisionado.')
    const arquivo = await arquivoDoFormData(formData)
    if (!['audio/ogg', 'audio/opus', 'audio/webm'].includes(arquivo.mime)) throw new Error('Formato de áudio não suportado (esperado ogg/opus ou webm do gravador).')
    const { id } = await cli.enviarMensagemComAnexo(conversationId, arquivo)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao enviar áudio.' }
  }
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
/**
 * Retorna `{ok:false,error}` em vez de lançar (achado 15/09/2026): uma Server
 * Action que lança `Error` em produção tem a MENSAGEM apagada pelo Next.js
 * antes de chegar no navegador ("omitted in production builds"), viram
 * só o texto genérico + digest — foi assim que "departamento sem Time no
 * Chatwoot" virou um erro ilegível na tela. O resto do arquivo mistura os
 * dois estilos; este e os outros pontos tocados na mesma investigação foram
 * corrigidos, os demais ainda têm o mesmo risco (não veio nesta rodada).
 */
export async function transferirConversa(conversationId: number, input: { departamentoId: string; agenteId?: number | null; comentario?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const cli = await clienteChatwootBrs()
    if (!cli) throw new Error('Chatwoot não provisionado.')
    const admin = await createAdminClient()
    const { data: depto } = await admin.from('chat_departamentos').select('nome, chatwoot_team_id').eq('id', input.departamentoId).maybeSingle()
    if (!depto?.chatwoot_team_id) throw new Error('Este departamento ainda não está sincronizado com o Chatwoot — sincronize em Configurações › Comunicação › Departamentos antes de transferir pra ele.')

    const comentario = String(input.comentario || '').trim()
    if (comentario) {
      await cli.notaInterna(conversationId, `🔁 Transferido para ${depto.nome}: ${comentario}`)
    }
    await cli.atribuir(conversationId, { teamId: depto.chatwoot_team_id, assigneeId: input.agenteId ?? null })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

/** Encerra (resolve). Desvincula o atendente para que, se houver nova mensagem, a conversa reabra na Fila. */
export async function encerrarConversa(conversationId: number, motivo?: string): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const razao = String(motivo || '').trim()
  const reqs: Promise<any>[] = [
    cli.atribuir(conversationId, { assigneeId: null }),
    cli.mudarStatus(conversationId, 'resolved'),
  ]
  if (razao) reqs.push(cli.notaInterna(conversationId, `Encerrado: ${razao}`))
  await Promise.all(reqs)
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

// ---------------------------------------------------------------------------
// Tags do CONTATO (Fase B §3) — mesma tag/cor da conta, aplicada no contato
// em vez da conversa (persiste entre conversas do mesmo contato).
// ---------------------------------------------------------------------------

export async function getTagsContato(contactId: number): Promise<string[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  return cli.labelsDoContato(contactId)
}

export async function setTagsContato(contactId: number, tags: string[]): Promise<string[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const limpas = (Array.isArray(tags) ? tags : []).map((t) => String(t || '').trim()).filter(Boolean)
  return cli.setLabelsDoContato(contactId, limpas)
}

// ---------------------------------------------------------------------------
// Reações, Apagar/Revogar e Encaminhamento de Mensagens
// ---------------------------------------------------------------------------

/** Prazo do WhatsApp para editar texto enviado (o engine confere de novo, pelo relógio dele). */
const EDICAO_JANELA_MS = 15 * 60 * 1000

/**
 * Edita no WhatsApp uma mensagem de texto NOSSA (≤ 15 min). `texto` é o texto
 * inteiro já com a assinatura `*Nome:*\n` da original (a tela preserva o prefixo).
 * Retorna `{ok:false,error}` em vez de lançar (o Next apaga a mensagem de Error em produção).
 */
export async function editarMensagemConversa(conversationId: number, messageId: number, texto: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const conta = await contaBrs()
    if (!conta) throw new Error('Conta do BRS Messenger não provisionada.')
    const novo = String(texto || '').trim()
    if (!novo) throw new Error('Digite o novo texto da mensagem.')
    const admin = await createAdminClient()
    const { data: mapa } = await admin
      .from('chat_mensagens_mapa')
      .select('instancia_id, wa_id, from_me, created_at, chatwoot_conversation_id')
      .eq('conta_id', conta.id)
      .eq('chatwoot_message_id', messageId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!mapa || mapa.chatwoot_conversation_id !== conversationId) throw new Error('Esta mensagem não tem vínculo com o WhatsApp e não pode ser editada.')
    if (!mapa.from_me) throw new Error('Só é possível editar mensagens enviadas por nós.')
    if (Date.now() - Date.parse(String(mapa.created_at)) > EDICAO_JANELA_MS) throw new Error('O WhatsApp só permite editar até 15 minutos depois do envio.')
    await engine.editarMensagem(String(mapa.instancia_id), String(mapa.wa_id), novo)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function reagirMensagem(conversationId: number, messageId: number, emoji: string): Promise<{ ok: boolean }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const conta = await contaBrs()
  if (conta && messageId) {
    const admin = await createAdminClient()
    const jidUsuario = user.email || String(user.id)
    if (emoji) {
      await admin.from('chat_mensagem_reacoes').upsert(
        { conta_id: conta.id, chatwoot_message_id: messageId, jid: jidUsuario, emoji },
        { onConflict: 'conta_id,chatwoot_message_id,jid' },
      )
    } else {
      await admin.from('chat_mensagem_reacoes').delete().eq('conta_id', conta.id).eq('chatwoot_message_id', messageId).eq('jid', jidUsuario)
    }
  }
  return { ok: true }
}

/** Janela do WhatsApp para "apagar para todos" (o engine confere de novo). */
const APAGAR_JANELA_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Mensagem NOSSA vinculada ao WhatsApp e dentro de ~2 dias: apaga PARA TODOS no
 * WhatsApp (engine) e só então marca como apagada aqui. Fora do prazo: erro claro,
 * nada muda. Mensagem do contato (ou sem vínculo): só some da tela — o WhatsApp não
 * deixa apagar a dos outros — e o retorno diz isso (`paraTodos: false`).
 */
export async function apagarMensagem(conversationId: number, messageId: number): Promise<{ ok: true; paraTodos: boolean } | { ok: false; error: string }> {
  try {
    await requirePermission('conversas', 'can_view')
    const conta = await contaBrs()
    let paraTodos = false
    if (conta && messageId) {
      const admin = await createAdminClient()
      const { data: mapa } = await admin
        .from('chat_mensagens_mapa')
        .select('instancia_id, wa_id, from_me, created_at')
        .eq('conta_id', conta.id)
        .eq('chatwoot_message_id', messageId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (mapa?.from_me) {
        if (Date.now() - Date.parse(String(mapa.created_at)) > APAGAR_JANELA_MS) throw new Error('O WhatsApp só permite apagar para todos até cerca de 2 dias depois do envio.')
        await engine.apagarParaTodos(String(mapa.instancia_id), String(mapa.wa_id))
        paraTodos = true
      }
      // Grava status revogada para que o frontend mostre como riscada (soft-delete), preservando histórico
      await admin.from('chat_mensagem_status').upsert(
        { conta_id: conta.id, chatwoot_message_id: messageId, status: 'revogada' },
        { onConflict: 'conta_id,chatwoot_message_id' },
      )
    }
    const cli = await clienteChatwootBrs()
    if (cli) {
      try {
        await cli.req(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' })
      } catch {
        // tolerado pois o histórico é mantido em nosso banco
      }
    }
    return { ok: true, paraTodos }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function encaminharMensagem(sourceMessage: MensagemComExtras, targetConversationId: number): Promise<{ ok: boolean }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const user = await requireCurrentUser()
  const assinatura = await assinaturaDoUsuario(user.id)

  const anexo = sourceMessage.attachments?.[0]
  if (anexo && anexo.data_url) {
    try {
      const res = await fetch(anexo.data_url)
      const arrayBuffer = await res.arrayBuffer()
      const bytes = Buffer.from(arrayBuffer)
      const mime = anexo.file_type === 'image' ? 'image/png' : anexo.file_type === 'audio' ? 'audio/ogg' : 'application/pdf'
      const arquivo = { nome: `encaminhado_${anexo.id}`, mime, bytes }
      const legenda = sourceMessage.content ? `↪️ Encaminhado: ${sourceMessage.content}` : '↪️ Encaminhado'
      await cli.enviarMensagemComAnexo(targetConversationId, arquivo, assinar(assinatura, legenda))
    } catch {
      if (sourceMessage.content) {
        await cli.enviarMensagem(targetConversationId, assinar(assinatura, `↪️ Encaminhado: ${sourceMessage.content}`))
      }
    }
  } else if (sourceMessage.content) {
    const texto = `↪️ Encaminhado: ${sourceMessage.content}`
    await cli.enviarMensagem(targetConversationId, assinar(assinatura, texto))
  }
  return { ok: true }
}


// ---------------------------------------------------------------------------
// Cadastro de Tags (Configurações › Comunicação › Tags) — CRUD das labels da
// conta, com cor. Permissão de configurar: central-conversas.
// ---------------------------------------------------------------------------

export type TagAdmin = { id: number; titulo: string; cor: string | null; descricao: string | null }

export async function listarTagsAdmin(): Promise<TagAdmin[]> {
  await requirePermission('central-conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  const labels = await cli.listarLabelsConta()
  return labels.map((l: any) => ({ id: l.id, titulo: String(l.title), cor: l.color || null, descricao: l.description || null }))
}

export async function salvarTagAdmin(input: { id?: number; titulo: string; cor: string; descricao?: string }): Promise<{ ok: true }> {
  await requirePermission('central-conversas', input.id ? 'can_edit' : 'can_include')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const titulo = String(input.titulo || '').trim()
  if (!titulo) throw new Error('Dê um nome à tag.')
  const cor = String(input.cor || '#94a3b8').trim()
  if (input.id) await cli.atualizarLabel(input.id, { titulo, cor, descricao: input.descricao })
  else await cli.criarLabel({ titulo, cor, descricao: input.descricao })
  return { ok: true }
}

export async function excluirTagAdmin(id: number): Promise<{ ok: true }> {
  await requirePermission('central-conversas', 'can_delete')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.excluirLabel(id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Histórico de chamados do contato + galeria completa (Fase B §2)
// ---------------------------------------------------------------------------

export type HistoricoChamado = {
  conversationId: number
  conexaoNome: string | null
  departamento: string | null
  atendente: string | null
  ultimoAtendimento: string | null // ISO
  protocolo: string | null
}

export async function getHistoricoContato(contactId: number): Promise<HistoricoChamado[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  const [conversas, inboxes, conta] = await Promise.all([
    cli.conversasDoContato(contactId).catch(() => [] as ChatwootConversa[]),
    cli.listarInboxes().catch(() => []),
    contaBrs(),
  ])
  const inboxPorId = new Map(inboxes.map((i) => [i.id, i.name]))
  let protocolos = new Map<number, string>()
  if (conta && conversas.length) {
    const admin = await createAdminClient()
    const { data } = await admin
      .from('chat_conversa_meta')
      .select('chatwoot_conversation_id, protocolo')
      .eq('conta_id', conta.id)
      .in(
        'chatwoot_conversation_id',
        conversas.map((c) => c.id),
      )
    protocolos = new Map((data || []).map((r: any) => [r.chatwoot_conversation_id, String(r.protocolo || '')]))
  }
  return [...conversas]
    .sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0))
    .map((c) => ({
      conversationId: c.id,
      conexaoNome: inboxPorId.get(c.inbox_id) || null,
      departamento: c.meta?.team?.name || null,
      atendente: c.meta?.assignee?.name || null,
      ultimoAtendimento: c.last_activity_at ? new Date(c.last_activity_at * 1000).toISOString() : null,
      protocolo: protocolos.get(c.id) || null,
    }))
}

export type GaleriaItem = { id: number; url: string; tipo: string }

/**
 * Agrega os anexos de TODA a conversa (não só a última página carregada),
 * paginando `before` pra trás. Teto de 20 páginas — proteção contra conversa
 * gigante; a galeria fica parcial nesse caso raro em vez de travar a tela.
 */
export async function getGaleriaConversa(conversationId: number): Promise<GaleriaItem[]> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) return []
  const itens: GaleriaItem[] = []
  const vistos = new Set<number>()
  let before: number | undefined
  for (let i = 0; i < 20; i++) {
    const r = await cli.mensagens(conversationId, before)
    const pagina = r.payload || []
    if (!pagina.length) break
    for (const m of pagina) {
      for (const a of m.attachments || []) {
        if (!vistos.has(a.id)) {
          vistos.add(a.id)
          itens.push({ id: a.id, url: a.data_url, tipo: a.file_type })
        }
      }
    }
    // O Chatwoot devolve a página em ordem cronológica ascendente; a mais
    // antiga da página vira o próximo `before` (pagina pra trás no tempo).
    before = pagina[0]?.id
    if (pagina.length < 20 || !before) break
  }
  return itens
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

/** Chamado ao abrir a conversa: zera o unread_count no Chatwoot (ver ChatwootConta.marcarLida). */
export async function marcarConversaLida(conversationId: number): Promise<{ ok: true }> {
  await requirePermission('conversas', 'can_view')
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  await cli.marcarLida(conversationId)
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
  conta: { nome: string; chatwootAccountId: number } | null
}> {
  await requirePermission('conversas', 'can_view')
  const conta = await contaBrs()
  if (!conta) return { inboxes: [], instancias: [], conta: null }
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
    conta: { nome: String(conta.nome), chatwootAccountId: Number(conta.chatwoot_account_id) },
  }
}

/**
 * "Nova conversa": envia a 1ª mensagem pelo engine na instância escolhida
 * (o engine espelha no Chatwoot e devolve a conversa criada). Texto assinado.
 */
export type ResultadoNovaConversa = ResultadoEnvio

/**
 * Único envio direto ao engine (fora do Chatwoot). `operationId` vem da UI —
 * gerado uma vez por intenção (Lote 02B); a action não gera nem substitui a
 * chave. Autorização: instância precisa pertencer à conta BRS; texto sai
 * assinado com `users.nome_exibicao || name`, como no composer.
 *
 * Devolve o resultado como VALOR (confirmado | rejeitado | incerto) — Server
 * Action mascara `Error.message` em produção, e a UI precisa distinguir
 * "nada saiu" (pode repetir) de "pode ter saído" (não reenviar sozinho). Só a
 * permissão continua lançando (é a mesma regra de todas as actions).
 */
export async function iniciarConversaPorTelefone(input: { instanciaId: string; telefone: string; texto: string; operationId: string }): Promise<ResultadoNovaConversa> {
  await requirePermission('conversas', 'can_view')
  const rejeitado = (mensagem: string): ResultadoNovaConversa => ({ resultado: 'rejeitado', mensagem })
  try {
    const user = await requireCurrentUser()
    if (!ehOperationId(input.operationId)) return rejeitado('Chave de envio (operationId) ausente ou inválida.')
    const destino = normalizarTelefoneDestino(input.telefone)
    const texto = String(input.texto || '').trim()
    if (!texto) return rejeitado('Escreva a primeira mensagem.')
    const admin = await createAdminClient()
    const conta = await contaBrs()
    if (!conta) return rejeitado('Chatwoot não provisionado.')
    const { data: inst } = await admin.from('chat_instancias').select('id, conta_id').eq('id', input.instanciaId).eq('conta_id', conta.id).is('deleted_at', null).maybeSingle()
    if (!inst) return rejeitado('Instância não encontrada.')
    const assinatura = await assinaturaDoUsuario(user.id)
    const res = await engine.enviar(String(inst.id), destino, assinar(assinatura, texto), { operationId: input.operationId })
    return { resultado: 'confirmado', conversationId: res.conversationId ?? null }
  } catch (err) {
    if (err instanceof EngineEnvioIncertoError) return { resultado: 'incerto', mensagem: err.message }
    // Tudo o mais acontece ANTES do POST (validação, banco, EngineErro =
    // rejeição comprovada): nada saiu.
    return rejeitado(err instanceof Error ? err.message : 'Falha ao iniciar conversa.')
  }
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

// Agente Chatwoot do usuário logado (mesmo par e-mail da presença e do
// "Assumir para mim"). Cache curto: lista e contadores refazem isto a cada
// poll/Realtime. `null` (usuário ainda não sincronizado como agente) não fica
// em cache — a sincronização roda no bootstrap e ele aparece em seguida.
const cacheAgentePorEmail = new Map<string, { id: number; em: number }>()
async function meuAgenteId(cli: ChatwootConta, userId: string): Promise<number | null> {
  const email = (await meuEmail(userId))?.toLowerCase()
  if (!email) return null
  const hit = cacheAgentePorEmail.get(email)
  if (hit && Date.now() - hit.em < 5 * 60_000) return hit.id
  const agente = (await cli.agentes()).find((a) => String(a.email || '').toLowerCase() === email)
  if (!agente) return null
  cacheAgentePorEmail.set(email, { id: Number(agente.id), em: Date.now() })
  return Number(agente.id)
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

/** Resolução usuário logado → agente Chatwoot (mesmo par e-mail usado pela presença acima), pro
 * botão "Assumir para mim" (Messenger M0 frente e). Null quando o usuário ainda não está
 * sincronizado como agente — quem chama deve esconder o botão nesse caso, nunca inventar um id. */
export async function getMeuAgente(): Promise<{ id: number; name: string } | null> {
  try {
    await requirePermission('conversas', 'can_view')
    const user = await requireCurrentUser()
    const cli = await clienteChatwootBrs()
    const email = await meuEmail(user.id)
    if (!cli || !email) return null
    const agentes = await cli.agentes()
    const agente = agentes.find((a) => String(a.email || '').toLowerCase() === email.toLowerCase())
    return agente ? { id: agente.id, name: agente.name } : null
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

export type BootstrapData = {
  agentes: any[]
  canaisAtendimento: {
    inboxes: Array<{ id: number; nome: string; tipo: string }>
    instancias: Array<{ id: string; nome: string; inboxId: number | null; papel: 'receptiva' | 'disparo'; provedor: 'baileys' | 'zapi'; status: string }>
    conta: { nome: string; chatwootAccountId: number } | null
  }
  tagsConta: Array<{ titulo: string; cor: string | null }>
  departamentos: DepartamentoResumo[]
  ehSupervisor: boolean
  presenca: 'online' | 'busy' | 'offline' | null
  respostasRapidas: Array<{ id: number; atalho: string; conteudo: string }> | null
}

/**
 * Agregador de bootstrap otimizado: realiza autenticação, autorização de rota,
 * busca da conta e cliente Chatwoot uma única vez, reutilizando o contexto em paralelo.
 */
export async function getBootstrapData(): Promise<BootstrapData> {
  const { user, permissions } = await requirePermission('conversas', 'can_view')

  const conta = await contaBrs()
  const cli = conta ? new ChatwootConta(Number(conta.chatwoot_account_id), decifrarTexto(String(conta.token_cifrado))) : null

  const ehSupervisor = permissions.some((p) => p.resource_name === 'central-conversas' && Boolean(p.can_view))
  let departamentos: DepartamentoResumo[] = []

  const admin = await createAdminClient()

  if (conta) {
    if (ehSupervisor) {
      const { data } = await admin.from('chat_departamentos').select('id, nome, chatwoot_team_id, eh_grupos').eq('conta_id', conta.id).eq('ativo', true)
      departamentos = mapDepartamentos(data)
    } else {
      const { data: membros } = await admin.from('chat_departamento_membros').select('departamento_id').eq('user_id', user.id)
      const ids = [...new Set((membros || []).map((m: any) => m.departamento_id))]
      if (ids.length) {
        const { data } = await admin.from('chat_departamentos').select('id, nome, chatwoot_team_id, eh_grupos').in('id', ids).eq('ativo', true)
        departamentos = mapDepartamentos(data)
      }
    }
  }

  const email = user.email || ''

  const [agentesRes, canaisInstanciasRes, inboxesRes, labelsRes, respostasRes] = await Promise.all([
    cli ? cli.agentes().catch(() => []) : Promise.resolve([]),
    conta ? admin.from('chat_instancias').select('id, nome, chatwoot_inbox_id, papel, provedor, status').eq('conta_id', conta.id).is('deleted_at', null).order('ordem') : Promise.resolve({ data: [] }),
    cli ? cli.listarInboxes().catch(() => []) : Promise.resolve([]),
    cli ? cli.listarLabelsConta().catch(() => []) : Promise.resolve([]),
    cli ? cli.respostasRapidas().catch(() => []) : Promise.resolve([]),
  ])

  const agentes = agentesRes || []
  const agente = email ? agentes.find((a) => String(a.email || '').toLowerCase() === email.toLowerCase()) : null
  const presenca = (agente?.availability_status as 'online' | 'busy' | 'offline' | undefined) || null

  const instanciasData = canaisInstanciasRes.data || []
  const canaisAtendimento = {
    inboxes: (inboxesRes || []).map((i) => ({ id: i.id, nome: String(i.name), tipo: String(i.channel_type || '') })),
    instancias: instanciasData.map((i) => ({
      id: String(i.id),
      nome: String(i.nome),
      inboxId: i.chatwoot_inbox_id === null ? null : Number(i.chatwoot_inbox_id),
      papel: i.papel as 'receptiva' | 'disparo',
      provedor: i.provedor as 'baileys' | 'zapi',
      status: String(i.status || ''),
    })),
    conta: conta ? { nome: String(conta.nome), chatwootAccountId: Number(conta.chatwoot_account_id) } : null,
  }

  const tagsConta = (labelsRes || []).map((l) => ({
    titulo: String(l.title),
    cor: l.color || null,
  }))

  const respostasRapidas = respostasRes
    ? respostasRes.map((c) => ({
        id: c.id,
        atalho: String(c.short_code || ''),
        conteudo: String(c.content || ''),
      }))
    : null

  return {
    agentes,
    canaisAtendimento,
    tagsConta,
    departamentos,
    ehSupervisor,
    presenca,
    respostasRapidas,
  }
}
