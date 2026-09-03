'use server'

/**
 * Subsistema Nuvidio (Operacional) — server actions.
 * Permissões: `operacional-nuvidio-links` (criar/acompanhar/enviar/tabular)
 * e `operacional-nuvidio-atendimento` (tela de atendimento).
 * "Uma engine, duas lentes": origem 'proposta' (cotidiano) e 'onboarding'
 * (Cadastros Recebidos, com processo vinculado).
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { getDefaultInstance, getInstanceById } from '@/lib/zapi/instances'
import { sendAndLog } from '@/lib/zapi/send'
import { enviarEmailOnboarding } from '@/lib/onboarding-comunicacao'
import { criarInvite, desabilitarInvite, lerNuvidioConfigRow, listarDepartments, ssoAtendente } from './client'

const PERM_LINKS = 'operacional-nuvidio-links'
const PERM_ATENDIMENTO = 'operacional-nuvidio-atendimento'

export type NuvidioConviteRow = {
  id: string
  origem: 'proposta' | 'onboarding'
  processo_id: string | null
  invite_id: string
  link: string
  department_id: string
  department_nome: string
  expiration_at: string | null
  schedule_at: string | null
  instituicao_financeira_id: string | null
  instituicao_nome?: string
  forma_contrato_id: string | null
  forma_contrato_nome?: string
  convenio_id: string | null
  convenio_nome?: string
  cpf: string
  nome_cliente: string
  telefone_cliente: string
  email_cliente: string
  agente_parceiro_id: string | null
  parceiro_nome?: string
  proposta_numero: string
  proposta_valor: number | null
  status: string
  gravacao_url: string
  resultado_obs: string
  chamada_iniciada_em: string | null
  chamada_finalizada_em: string | null
  created_at: string
}

export type NuvidioTemplateRow = {
  id: string
  nome: string
  canal: 'whatsapp' | 'email'
  destino: 'parceiro' | 'cliente'
  assunto: string
  corpo: string
  instancia_zapi_id: string | null
  is_active: boolean
}

export type NuvidioLookups = {
  departments: Array<{ id: string; nome: string }>
  departmentPadraoId: string
  instituicoes: Array<{ id: string; name: string }>
  formasContrato: Array<{ id: string; nome: string }>
  convenios: Array<{ id: string; nome: string }>
  parceiros: Array<{ id: string; name: string; arw_code: string | null }>
  temCredenciais: boolean
}

async function registrarEvento(admin: Awaited<ReturnType<typeof createAdminClient>>, conviteId: string, tipo: string, detalhe: Record<string, unknown>, actorId: string | null) {
  await admin.from('nuvidio_eventos').insert({ convite_id: conviteId, tipo, detalhe, actor_id: actorId })
}

function revalidar() {
  revalidatePath('/nuvidio')
  revalidatePath('/nuvidio/atendimento')
  revalidatePath('/agente-corban/cadastros-recebidos')
}

// ---------------------------------------------------------------------------
// Lookups do formulário Criar Link
// ---------------------------------------------------------------------------

export async function getNuvidioLookups(): Promise<{ success: boolean; data?: NuvidioLookups; error?: string }> {
  try {
    await requirePermission(PERM_LINKS)
    const admin = await createAdminClient()
    const config = await lerNuvidioConfigRow()
    const temCredenciais = Boolean(config?.api_key_enc && config?.api_secret_enc)

    let departments: Array<{ id: string; nome: string }> = []
    if (temCredenciais) {
      try {
        departments = await listarDepartments()
      } catch {
        departments = []
      }
    }

    const [{ data: ifs }, { data: formas }, { data: convs }, { data: parceiros }] = await Promise.all([
      admin.from('financial_institutions').select('id,name').is('deleted_at', null).order('name'),
      admin.from('formas_contrato').select('id,nome').eq('is_active', true).order('nome'),
      admin.from('convenios').select('id,nome_reduzido').eq('is_active', true).is('deleted_at', null).order('nome_reduzido'),
      admin.from('agentes_parceiros').select('id,name,arw_code').order('name').limit(500),
    ])

    return {
      success: true,
      data: {
        departments,
        departmentPadraoId: config?.department_padrao_id || '',
        instituicoes: (ifs || []).map((r: any) => ({ id: String(r.id), name: String(r.name) })),
        formasContrato: (formas || []).map((r: any) => ({ id: String(r.id), nome: String(r.nome) })),
        convenios: (convs || []).map((r: any) => ({ id: String(r.id), nome: String(r.nome_reduzido || '') })),
        parceiros: (parceiros || []).map((r: any) => ({ id: String(r.id), name: String(r.name), arw_code: r.arw_code || null })),
        temCredenciais,
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Criar convite
// ---------------------------------------------------------------------------

export async function criarNuvidioConvite(input: {
  origem?: 'proposta' | 'onboarding'
  processoId?: string | null
  departmentId: string
  departmentNome?: string
  expiracaoHoras?: number
  agendarPara?: string | null
  instituicaoFinanceiraId?: string | null
  formaContratoId?: string | null
  convenioId?: string | null
  cpf?: string
  nomeCliente: string
  telefoneCliente?: string
  emailCliente?: string
  agenteParceiroId?: string | null
  propostaNumero?: string
  propostaValor?: number | null
}): Promise<{ success: true; id: string; link: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(PERM_LINKS, 'can_include')
    const admin = await createAdminClient()

    if (!input.departmentId) throw new Error('Escolha o departamento da Nuvidio.')
    if (!String(input.nomeCliente || '').trim()) throw new Error('Informe o nome do cliente.')

    const horas = Math.max(1, Math.min(24 * 14, Number(input.expiracaoHoras || 48)))
    const expirationDate = new Date(Date.now() + horas * 3600 * 1000).toISOString()

    const customerData: Array<{ value: string; label: string }> = [{ value: input.nomeCliente.trim(), label: 'name' }]
    if (input.telefoneCliente?.trim()) customerData.push({ value: input.telefoneCliente.trim(), label: 'tel' })
    if (input.emailCliente?.trim()) customerData.push({ value: input.emailCliente.trim(), label: 'email' })
    if (input.cpf?.trim()) customerData.push({ value: input.cpf.trim(), label: 'cpf' })
    if (input.propostaNumero?.trim()) customerData.push({ value: input.propostaNumero.trim(), label: 'proposta' })

    const invite = await criarInvite({
      departmentId: input.departmentId,
      expirationDate,
      initialDate: input.agendarPara || undefined,
      schedule: Boolean(input.agendarPara),
      customerData,
    })

    const { data: inserido, error } = await admin
      .from('nuvidio_convites')
      .insert({
        origem: input.origem === 'onboarding' ? 'onboarding' : 'proposta',
        processo_id: input.processoId || null,
        invite_id: invite.inviteId,
        link: invite.link,
        department_id: input.departmentId,
        department_nome: input.departmentNome || '',
        expiration_at: expirationDate,
        schedule_at: input.agendarPara || null,
        instituicao_financeira_id: input.instituicaoFinanceiraId || null,
        forma_contrato_id: input.formaContratoId || null,
        convenio_id: input.convenioId || null,
        cpf: String(input.cpf || '').replace(/\D/g, ''),
        nome_cliente: input.nomeCliente.trim(),
        telefone_cliente: String(input.telefoneCliente || '').trim(),
        email_cliente: String(input.emailCliente || '').trim(),
        agente_parceiro_id: input.agenteParceiroId || null,
        proposta_numero: String(input.propostaNumero || '').trim(),
        proposta_valor: input.propostaValor ?? null,
        created_by: user.id,
      })
      .select('id, link')
      .single()
    if (error) throw error

    await registrarEvento(admin, inserido.id, 'convite_criado', { invite_id: invite.inviteId, origem: input.origem || 'proposta' }, user.id)

    // Lente onboarding: o link entra no processo automaticamente.
    if (input.origem === 'onboarding' && input.processoId && invite.link) {
      await admin
        .from('corban_onboarding_processos')
        .update({ nuvidio_link: invite.link, updated_at: new Date().toISOString() })
        .eq('id', input.processoId)
    }

    revalidar()
    return { success: true, id: String(inserido.id), link: String(inserido.link) }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Listagem (Links Criados / Acompanhamento / Atendimento)
// ---------------------------------------------------------------------------

export async function listarNuvidioConvites(filtro?: {
  origem?: 'proposta' | 'onboarding'
  status?: string
  busca?: string
}): Promise<{ success: boolean; data?: NuvidioConviteRow[]; error?: string }> {
  try {
    await requirePermission(PERM_LINKS)
    const admin = await createAdminClient()
    let query = admin
      .from('nuvidio_convites')
      .select('*, instituicao:instituicao_financeira_id(name), forma:forma_contrato_id(nome), convenio:convenio_id(nome_reduzido), parceiro:agente_parceiro_id(name)')
      .order('created_at', { ascending: false })
      .limit(400)
    if (filtro?.origem) query = query.eq('origem', filtro.origem)
    if (filtro?.status) query = query.eq('status', filtro.status)
    const { data, error } = await query
    if (error) throw error

    const busca = String(filtro?.busca || '').trim().toLowerCase()
    const rows = (data || [])
      .map((r: any) => ({
        ...r,
        instituicao_nome: r.instituicao?.name || '',
        forma_contrato_nome: r.forma?.nome || '',
        convenio_nome: r.convenio?.nome_reduzido || '',
        parceiro_nome: r.parceiro?.name || '',
      }))
      .filter((r: any) =>
        !busca ||
        `${r.nome_cliente} ${r.cpf} ${r.proposta_numero} ${r.parceiro_nome}`.toLowerCase().includes(busca),
      )
    return { success: true, data: rows as NuvidioConviteRow[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Envio por WhatsApp/e-mail com templates
// ---------------------------------------------------------------------------

function aplicarVariaveis(texto: string, convite: NuvidioConviteRow): string {
  const mapa: Record<string, string> = {
    nome_cliente: convite.nome_cliente,
    link: convite.link,
    proposta: convite.proposta_numero,
    valor: convite.proposta_valor != null ? Number(convite.proposta_valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
    parceiro: convite.parceiro_nome || '',
    instituicao: convite.instituicao_nome || '',
    convenio: convite.convenio_nome || '',
    cpf: convite.cpf,
  }
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, chave) => mapa[String(chave).toLowerCase()] ?? '')
}

export async function enviarNuvidioConvite(input: {
  conviteId: string
  templateId: string
  destinoOverride?: { telefone?: string; email?: string }
}): Promise<{ success: true; detalhe: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(PERM_LINKS, 'can_edit')
    const admin = await createAdminClient()

    const [{ data: convite }, { data: template }] = await Promise.all([
      admin
        .from('nuvidio_convites')
        .select('*, instituicao:instituicao_financeira_id(name), forma:forma_contrato_id(nome), convenio:convenio_id(nome_reduzido), parceiro:agente_parceiro_id(name, corban_data)')
        .eq('id', input.conviteId)
        .maybeSingle(),
      admin.from('nuvidio_templates').select('*').eq('id', input.templateId).maybeSingle(),
    ])
    if (!convite) throw new Error('Convite não encontrado.')
    if (!template) throw new Error('Template não encontrado.')

    const linha: NuvidioConviteRow = {
      ...(convite as any),
      instituicao_nome: (convite as any).instituicao?.name || '',
      forma_contrato_nome: (convite as any).forma?.nome || '',
      convenio_nome: (convite as any).convenio?.nome_reduzido || '',
      parceiro_nome: (convite as any).parceiro?.name || '',
    }

    // destino: cliente = dados do convite; parceiro = contatos do corban_data
    let telefone = input.destinoOverride?.telefone || ''
    let email = input.destinoOverride?.email || ''
    if (!telefone && !email) {
      if (template.destino === 'cliente') {
        telefone = linha.telefone_cliente
        email = linha.email_cliente
      } else {
        const cd = (convite as any).parceiro?.corban_data || {}
        telefone = String(cd?.contacts?.phone_whatsapp || cd?.commercial?.whatsapp_atendimento || '')
        email = String(cd?.socios?.[0]?.email || cd?.contacts?.email_comissao || '')
      }
    }

    let detalhe = ''
    if (template.canal === 'whatsapp') {
      if (!telefone) throw new Error(`Sem telefone do ${template.destino} para envio.`)
      const instance = template.instancia_zapi_id ? await getInstanceById(template.instancia_zapi_id) : await getDefaultInstance()
      if (!instance) throw new Error('Instância Z-API do template indisponível.')
      const res = await sendAndLog({
        instance,
        phone: telefone,
        source: 'manual',
        block: { type: 'text', body: aplicarVariaveis(template.corpo, linha) },
        refs: { partnerId: linha.agente_parceiro_id, createdBy: user.id },
      })
      if (!res.ok) throw new Error(res.error)
      detalhe = `WhatsApp enviado para ${telefone}.`
    } else {
      if (!email) throw new Error(`Sem e-mail do ${template.destino} para envio.`)
      const r = await enviarEmailOnboarding({
        to: email,
        subject: aplicarVariaveis(template.assunto || 'Confirmação por vídeo — BRS Promotora', linha),
        html: aplicarVariaveis(template.corpo, linha).replace(/\n/g, '<br/>'),
      })
      if (!r.ok) throw new Error(r.detalhe)
      detalhe = `E-mail enviado para ${email}.`
    }

    await registrarEvento(admin, input.conviteId, 'convite_enviado', { template: template.nome, canal: template.canal, destino: template.destino }, user.id)
    return { success: true, detalhe }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Tabulação / cancelamento / refazer
// ---------------------------------------------------------------------------

export async function tabularNuvidioConvite(input: {
  conviteId: string
  status: 'aprovado' | 'reprovado' | 'aguardando_refazer'
  observacao?: string
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(PERM_ATENDIMENTO, 'can_edit')
    const admin = await createAdminClient()
    const { error } = await admin
      .from('nuvidio_convites')
      .update({ status: input.status, resultado_obs: String(input.observacao || '').trim(), updated_at: new Date().toISOString() })
      .eq('id', input.conviteId)
    if (error) throw error
    await registrarEvento(admin, input.conviteId, 'tabulado', { status: input.status }, user.id)
    revalidar()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function cancelarNuvidioConvite(conviteId: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(PERM_LINKS, 'can_edit')
    const admin = await createAdminClient()
    const { data: convite } = await admin.from('nuvidio_convites').select('invite_id,status').eq('id', conviteId).maybeSingle()
    if (!convite) throw new Error('Convite não encontrado.')
    if (convite.invite_id) {
      try {
        await desabilitarInvite(convite.invite_id)
      } catch (err) {
        // cancela localmente mesmo assim, mas avisa no evento
        await registrarEvento(admin, conviteId, 'cancelamento_api_falhou', { erro: err instanceof Error ? err.message : String(err) }, user.id)
      }
    }
    const { error } = await admin
      .from('nuvidio_convites')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', conviteId)
    if (error) throw error
    await registrarEvento(admin, conviteId, 'cancelado', {}, user.id)
    revalidar()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Templates (CRUD)
// ---------------------------------------------------------------------------

export async function listarNuvidioTemplates(): Promise<{ success: boolean; data?: NuvidioTemplateRow[]; instancias?: Array<{ id: string; name: string }>; error?: string }> {
  try {
    await requirePermission(PERM_LINKS)
    const admin = await createAdminClient()
    const [{ data, error }, { data: instancias }] = await Promise.all([
      admin.from('nuvidio_templates').select('*').order('nome'),
      admin.from('zapi_instances').select('id,name').order('name'),
    ])
    if (error) throw error
    return {
      success: true,
      data: (data || []) as NuvidioTemplateRow[],
      instancias: (instancias || []).map((i: any) => ({ id: String(i.id), name: String(i.name) })),
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarNuvidioTemplate(input: Partial<NuvidioTemplateRow> & { nome: string; canal: 'whatsapp' | 'email'; destino: 'parceiro' | 'cliente'; corpo: string }): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requirePermission(PERM_LINKS, 'can_edit')
    const admin = await createAdminClient()
    const row = {
      nome: input.nome.trim(),
      canal: input.canal,
      destino: input.destino,
      assunto: String(input.assunto || '').trim(),
      corpo: input.corpo,
      instancia_zapi_id: input.instancia_zapi_id || null,
      is_active: input.is_active !== false,
      updated_at: new Date().toISOString(),
    }
    const { error } = input.id
      ? await admin.from('nuvidio_templates').update(row).eq('id', input.id)
      : await admin.from('nuvidio_templates').insert(row)
    if (error) throw error
    revalidatePath('/nuvidio/templates')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function excluirNuvidioTemplate(id: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requirePermission(PERM_LINKS, 'can_delete')
    const admin = await createAdminClient()
    const { error } = await admin.from('nuvidio_templates').delete().eq('id', id)
    if (error) throw error
    revalidatePath('/nuvidio/templates')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Atendimento — SSO do atendente
// ---------------------------------------------------------------------------

export async function abrirAtendimentoNuvidio(): Promise<{ success: true; url: string | null } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(PERM_ATENDIMENTO)
    const admin = await createAdminClient()
    const { data: usuario } = await admin.from('users').select('email').eq('id', user.id).maybeSingle()
    if (!usuario?.email) throw new Error('Usuário sem e-mail cadastrado.')
    const sso = await ssoAtendente(String(usuario.email))
    return { success: true, url: sso.url }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
