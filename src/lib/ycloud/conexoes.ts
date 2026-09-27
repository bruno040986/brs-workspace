/**
 * Conexão YCloud da BRS (ycloud_conexoes, owner_tipo='brs') — helpers de
 * SERVIDOR, fora de 'use server' de propósito (segredo nunca vira action).
 * Contrato: docs/YCLOUD-F0-CONTRATOS-2026-09-26.md, ADR-1/ADR-2.
 *
 * O parceiro (CRM) terá helpers equivalentes na F4/S2, na MESMA tabela, com
 * owner_tipo='parceiro' — não duplicar esta lógica lá: extrair o comum.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, cofreConfigurado, decifrarTexto } from '@/lib/central-conversas/cofre'
import { contaBrs } from '@/lib/central-conversas/actions'
import { engine } from '@/lib/central-conversas/engine'
import { EVENTOS_WEBHOOK_V1, ErroYcloudApi, somenteDigitos, ycloudApi, type YcloudPhoneNumber } from './client'

type Admin = Awaited<ReturnType<typeof createAdminClient>>

export type ConexaoRow = {
  id: string
  owner_tipo: 'brs' | 'parceiro'
  agente_parceiro_id: string | null
  nome: string
  api_key_cifrada: string
  webhook_endpoint_id: string | null
  webhook_criado_em: string | null
  status: 'ativa' | 'invalida' | 'removida'
  ultimo_teste_em: string | null
  updated_at: string
}

const COLS = 'id, owner_tipo, agente_parceiro_id, nome, api_key_cifrada, webhook_endpoint_id, webhook_criado_em, status, ultimo_teste_em, updated_at'

export async function lerConexaoBrs(admin?: Admin): Promise<ConexaoRow | null> {
  const cli = admin || (await createAdminClient())
  const { data, error } = await cli.from('ycloud_conexoes').select(COLS).eq('owner_tipo', 'brs').neq('status', 'removida').maybeSingle()
  if (error) throw error
  return (data as ConexaoRow | null) || null
}

export async function listarConexoesAtivas(admin: Admin): Promise<ConexaoRow[]> {
  const { data, error } = await admin.from('ycloud_conexoes').select(COLS).eq('status', 'ativa')
  if (error) throw error
  return (data || []) as ConexaoRow[]
}

export function apiKeyDaConexao(c: ConexaoRow): string {
  return decifrarTexto(c.api_key_cifrada)
}

/** Valida a chave contra a conta real (balance + números) antes de gravar. */
export async function testarChave(apiKey: string): Promise<{ saldo: { valor: string; moeda: string } | null; numeros: YcloudPhoneNumber[] }> {
  const [balance, numeros] = await Promise.all([ycloudApi.balance(apiKey), ycloudApi.phoneNumbers(apiKey)])
  const saldo = balance?.amount !== undefined ? { valor: String(balance.amount), moeda: String(balance.currency || '') } : null
  return { saldo, numeros }
}

/**
 * Grava/troca a chave da BRS. Troca de chave (ADR-1): valida primeiro e
 * confere que os números já ATIVOS continuam na conta — senão recusa (a
 * chave é de outra conta e quebraria as instâncias).
 */
export async function salvarChaveBrs(input: { apiKey: string; nome?: string; userId: string }): Promise<ConexaoRow> {
  if (!cofreConfigurado()) throw new Error('Cofre não configurado (CRM_CREDENTIALS_KEY).')
  const apiKey = input.apiKey.trim()
  if (apiKey.length < 16) throw new Error('Informe a API Key da YCloud.')
  const admin = await createAdminClient()
  const { numeros } = await testarChave(apiKey) // lança CREDENCIAL inválida
  const atual = await lerConexaoBrs(admin)
  if (atual) {
    const ativos = await numerosAtivos(admin, atual.id)
    const naConta = new Set(numeros.map((n) => somenteDigitos(n.phoneNumber)))
    const faltando = ativos.filter((n) => !naConta.has(n))
    if (faltando.length) throw new Error(`A chave informada não dá acesso aos números já ativados (${faltando.join(', ')}). Desative-os antes de trocar de conta.`)
  }
  const agora = new Date().toISOString()
  const { data, error } = await admin
    .from('ycloud_conexoes')
    .upsert(
      {
        ...(atual ? { id: atual.id } : {}),
        owner_tipo: 'brs',
        agente_parceiro_id: null,
        nome: (input.nome || atual?.nome || 'BRS Promotora').trim().slice(0, 80),
        api_key_cifrada: cifrarTexto(apiKey),
        status: 'ativa',
        ultimo_teste_em: agora,
        updated_at: agora,
        ...(atual ? {} : { criado_por: input.userId }),
      },
      { onConflict: 'id' },
    )
    .select(COLS)
    .single()
  if (error) throw error
  return data as ConexaoRow
}

async function numerosAtivos(admin: Admin, conexaoId: string): Promise<string[]> {
  const { data, error } = await admin.from('chat_instancias').select('numero').eq('provedor', 'ycloud').eq('ycloud_conexao_id', conexaoId).is('deleted_at', null)
  if (error) throw error
  return (data || []).map((r) => String(r.numero || '')).filter(Boolean)
}

function urlWebhookEngine(conexaoId: string): string {
  const base = (process.env.ENGINE_URL || 'https://engine.brspromotora.com.br').replace(/\/$/, '')
  return `${base}/webhooks/ycloud/${conexaoId}`
}

/**
 * Cria o endpoint na YCloud (1 por conexão, ADR-2) e guarda id + secret
 * cifrado. Idempotente: se já existe, só confere que continua lá; se a YCloud
 * não o encontra mais (404), recria. Nunca apaga endpoint.
 */
export async function garantirWebhook(admin: Admin, conexao: ConexaoRow): Promise<{ endpointId: string; criado: boolean }> {
  const apiKey = apiKeyDaConexao(conexao)
  if (conexao.webhook_endpoint_id) {
    try {
      await ycloudApi.webhookEndpoint(apiKey, conexao.webhook_endpoint_id)
      return { endpointId: conexao.webhook_endpoint_id, criado: false }
    } catch (e) {
      if (!(e instanceof ErroYcloudApi && e.status === 404)) throw e
    }
  }
  const ep = await ycloudApi.criarWebhookEndpoint(apiKey, {
    url: urlWebhookEngine(conexao.id),
    enabledEvents: EVENTOS_WEBHOOK_V1,
    description: `BRS Workspace — conexão ${conexao.id}`,
  })
  if (!ep.id || !ep.secret) throw new Error('A YCloud criou o endpoint sem devolver id/secret.')
  const { error } = await admin
    .from('ycloud_conexoes')
    .update({ webhook_endpoint_id: ep.id, webhook_secret_cifrado: cifrarTexto(ep.secret), webhook_criado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conexao.id)
  if (error) throw error
  return { endpointId: ep.id, criado: true }
}

/**
 * Ativa um número da conta como instância do BRS Messenger (provedor ycloud).
 * Ordem: webhook garantido → instância (unique parcial por número impede
 * duplicata/corrida) → engine.conectar (inbox Chatwoot + status).
 * BRS não tem trial/assinatura (uso interno) — o trial único por número é
 * regra do CRM (F4).
 */
export async function ativarNumeroBrs(input: { numero: string; nome: string; userId: string }): Promise<{ instanciaId: string }> {
  const admin = await createAdminClient()
  const conexao = await lerConexaoBrs(admin)
  if (!conexao || conexao.status !== 'ativa') throw new Error('Conecte a conta YCloud da BRS antes de ativar um número.')
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
  const digitos = somenteDigitos(input.numero)
  const numeros = await ycloudApi.phoneNumbers(apiKeyDaConexao(conexao))
  const alvo = numeros.find((n) => somenteDigitos(n.phoneNumber) === digitos)
  if (!alvo) throw new Error('Esse número não está habilitado na conta YCloud conectada.')
  await garantirWebhook(admin, conexao)
  const nome = String(input.nome || alvo.verifiedName || digitos).trim().slice(0, 60)
  const { data, error } = await admin
    .from('chat_instancias')
    .insert({
      conta_id: conta.id,
      owner_tipo: 'brs',
      nome,
      papel: 'receptiva',
      provedor: 'ycloud',
      permite_grupos: false,
      status: 'conectando',
      numero: digitos,
      numero_informado: digitos,
      ycloud_conexao_id: conexao.id,
      ycloud_waba_id: alvo.wabaId,
      ycloud_phone_number_id: alvo.id || null,
    })
    .select('id')
    .single()
  if (error) {
    if (String((error as { code?: string }).code) === '23505') throw new Error('Esse número já está ativo em uma instância.')
    throw error
  }
  const instanciaId = String(data.id)
  // Snapshot inicial de saúde (a tela não fica "desconhecida" até o 1º cron)
  await gravarSaudeNumero(admin, instanciaId, alvo).catch(() => undefined)
  await engine.conectar(instanciaId).catch(() => undefined) // status vem no próximo /status ou cron
  return { instanciaId }
}

/** Desativa a instância (soft delete). Webhook/credencial ficam: outras instâncias podem depender (ADR-8). */
export async function desativarNumeroBrs(instanciaId: string): Promise<void> {
  const admin = await createAdminClient()
  const { error } = await admin
    .from('chat_instancias')
    .update({ deleted_at: new Date().toISOString(), status: 'desconectada' })
    .eq('id', instanciaId)
    .eq('provedor', 'ycloud')
    .eq('owner_tipo', 'brs')
    .is('deleted_at', null)
  if (error) throw error
}

export async function gravarSaudeNumero(admin: Admin, instanciaId: string, n: YcloudPhoneNumber): Promise<void> {
  const { error } = await admin.from('ycloud_numeros_saude').upsert(
    {
      instancia_id: instanciaId,
      quality_rating: n.qualityRating ?? null,
      messaging_limit: n.messagingLimit ?? null,
      bm_messaging_limit: n.whatsappBusinessManagerMessagingLimit ?? null,
      status: n.status ?? null,
      name_status: n.nameStatus ?? null,
      verified_name: n.verifiedName ?? null,
      update_event: n.updateEvent ?? null,
      quality_update_event: n.qualityUpdateEvent ?? null,
      is_oba: n.isOfficialBusinessAccount ?? null,
      observado_em: new Date().toISOString(),
      payload: n,
    },
    { onConflict: 'instancia_id' },
  )
  if (error) throw error
}
