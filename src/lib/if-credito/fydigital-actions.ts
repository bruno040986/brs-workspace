'use server'

/**
 * FyDigital — descoberta (Fatia 4, escopo reduzido: autenticação + chamadas
 * assinadas de leitura/simulação + webhook). Painel na config "APIs de
 * Instituições Financeiras de Crédito" (mesmo card da credencial). Permissão:
 * sistema-config-if-credito. NÃO inclui Criar Operação nem Enviar Documento
 * ainda — ficam pra depois que o formato real do webhook estiver confirmado.
 */
import { randomBytes } from 'node:crypto'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppBaseUrl } from '@/lib/zapi/webhooks'
import {
  carregarConfigFyDigital,
  chamarOperacaoAssinada,
  mensagemErroFyDigital,
  obterInstituicaoFyDigital,
  obterTokenFyDigital,
  testarApiOk,
  type ResultadoOperacaoAssinada,
} from '@/lib/if-credito/fydigital/client'

const RESOURCE = 'sistema-config-if-credito'

export type RespostaDescobertaFyDigital = {
  operacao: string
  http_status: number
  sucesso: boolean
  duracao_ms: number
  corpo: unknown
  assinatura_valida?: boolean
  corpo_decodificado?: unknown
}

function empacotar(operacao: string, r: ResultadoOperacaoAssinada): RespostaDescobertaFyDigital {
  return {
    operacao,
    http_status: r.status,
    sucesso: r.ok,
    duracao_ms: r.duracaoMs,
    corpo: r.corpo,
    assinatura_valida: r.assinaturaValida,
    corpo_decodificado: r.corpoDecodificado,
  }
}

/** URL a cadastrar no suporte da FyDigital (tecnologia@fy.digital). Gera a chave na 1ª vez. */
export async function obterWebhookUrlFyDigital(): Promise<{ success: boolean; data?: { url: string }; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const inst = await obterInstituicaoFyDigital()
    if (!inst) throw new Error('FyDigital não está cadastrada em Instituições Financeiras.')
    const admin = await createAdminClient()
    const { data } = await admin.from('if_credito_config').select('webhook_key').eq('instituicao_financeira_id', inst.id).maybeSingle()
    let chave = data?.webhook_key as string | undefined
    if (!chave) {
      chave = randomBytes(20).toString('hex')
      await admin.from('if_credito_config').upsert({ instituicao_financeira_id: inst.id, webhook_key: chave }, { onConflict: 'instituicao_financeira_id' })
    }
    return { success: true, data: { url: `${getAppBaseUrl()}/api/if-credito/fydigital/webhook?key=${chave}` } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao gerar URL do webhook.' }
  }
}

/**
 * Testa a credencial de ponta a ponta: OAuth client_credentials (login
 * forçado, ignora token em cache) → base_path/api/ok com o Bearer. Não usa
 * as chaves RSA (o teste de assinatura é a descoberta abaixo).
 */
export async function testarAutenticacaoFyDigital(): Promise<{ success: boolean; data?: RespostaDescobertaFyDigital; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const cfg = await carregarConfigFyDigital()
    const token = await obterTokenFyDigital(cfg, user.id, true)
    const r = await testarApiOk(cfg, token, user.id)
    if (!r.ok) throw new Error(`/api/ok: ${mensagemErroFyDigital(r)}`)
    return { success: true, data: empacotar('api_ok', { ...r }) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro no teste de autenticação.' }
  }
}

/**
 * Operações de descoberta assinadas (RS256). Só leitura/simulação e
 * cancelamento/alteração — Criar Operação fica de fora até confirmarmos o
 * formato real do webhook (ela grava uma proposta de verdade na FyDigital).
 */
export type OperacaoDescobertaFyDigital = 'simular-operacao' | 'cancelar-proposta' | 'alterar-operacao'

export const OPERACOES_FYDIGITAL: Record<OperacaoDescobertaFyDigital, { rotulo: string; operacaoApi: string; payloadModelo: string; dica: string }> = {
  'simular-operacao': {
    rotulo: 'Simular Operação',
    operacaoApi: 'Consig.simularOperacao',
    payloadModelo: JSON.stringify(
      {
        bancarizadora: 3,
        cliente: '00000000000',
        simulacao: {
          id_empregador: 0,
          id_orgao: 0,
          id_tabela_fin: 0,
          id_produto: 0,
          tipo_proposta: 'CartaoMaisSaqueParcelado',
          valor_sol_total: 1000,
          valor_sol_parcela: 0,
          num_parcelas: 12,
        },
      },
      null,
      2
    ),
    dica: 'Resposta síncrona costuma ser só um ack — o resultado real (id_simulacao, taxas, parcela) chega pelos webhooks "identificador" e depois "simular_operacao"/"erro_simulacao". Os ids de empregador/órgão/tabela/produto ainda dependem do catálogo que o suporte da FyDigital vai confirmar.',
  },
  'cancelar-proposta': {
    rotulo: 'Cancelar Proposta',
    operacaoApi: 'Consig.cancelarOperacao',
    payloadModelo: JSON.stringify({ proposta: '' }, null, 2),
    dica: '"proposta" é o id devolvido no webhook "criar_proposta". Sem resultado síncrono — confirmação chega no webhook "operacao_cancelada".',
  },
  'alterar-operacao': {
    rotulo: 'Alterar Operação',
    operacaoApi: 'Consig.editOperacao',
    payloadModelo: JSON.stringify({ proposta: { id_proposta_consignado: 0, matricula: null, token: null }, financeiro: null, documento: null }, null, 2),
    dica: 'Só o bloco que você quer alterar vai preenchido; os demais precisam ir null (é assim que a doc deles distingue "não mexe" de "limpa o campo"). Único obrigatório: proposta.id_proposta_consignado.',
  },
}

export async function executarDescobertaFyDigital(input: {
  operacao: OperacaoDescobertaFyDigital
  payloadJson: string
}): Promise<{ success: boolean; data?: RespostaDescobertaFyDigital; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const meta = OPERACOES_FYDIGITAL[input.operacao]
    if (!meta) throw new Error('Operação não permitida na descoberta.')

    let data: unknown
    try {
      data = JSON.parse(input.payloadJson || '{}')
    } catch {
      throw new Error('Payload não é um JSON válido.')
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Payload precisa ser um objeto JSON.')

    const cfg = await carregarConfigFyDigital()
    const envelope = { operacao: meta.operacaoApi, data }
    const r = await chamarOperacaoAssinada(cfg, input.operacao, envelope, user.id)
    return { success: true, data: empacotar(input.operacao, r) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro na descoberta.' }
  }
}

export type ChamadaResumoFyDigital = {
  id: string
  operacao: string
  metodo: string
  caminho: string
  http_status: number | null
  sucesso: boolean
  duracao_ms: number | null
  created_at: string
  resposta: unknown
}

/** Últimas chamadas SAÍDAS por nós (auth, /api/ok, descoberta). */
export async function listarChamadasFyDigital(limite = 20): Promise<{ success: boolean; data?: ChamadaResumoFyDigital[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const inst = await obterInstituicaoFyDigital()
    if (!inst) return { success: true, data: [] }
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('if_credito_chamadas')
      .select('id, operacao, metodo, caminho, http_status, sucesso, duracao_ms, created_at, resposta')
      .eq('instituicao_financeira_id', inst.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limite, 1), 100))
    if (error) throw error
    return { success: true, data: (data || []) as ChamadaResumoFyDigital[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar chamadas.' }
  }
}

export type WebhookEventoResumoFyDigital = {
  id: string
  webhook: string | null
  tipo_webhook: string | null
  request_id: string | null
  id_externo: string | null
  assinatura_valida: boolean
  processado: boolean
  recebido_em: string
  payload: unknown
}

/** Últimos webhooks RECEBIDOS da FyDigital (depois que a URL for cadastrada no suporte deles). */
export async function listarWebhooksFyDigital(limite = 20): Promise<{ success: boolean; data?: WebhookEventoResumoFyDigital[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const inst = await obterInstituicaoFyDigital()
    if (!inst) return { success: true, data: [] }
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('if_webhook_eventos')
      .select('id, webhook, tipo_webhook, request_id, id_externo, assinatura_valida, processado, recebido_em, payload')
      .eq('instituicao_financeira_id', inst.id)
      .order('recebido_em', { ascending: false })
      .limit(Math.min(Math.max(limite, 1), 100))
    if (error) throw error
    return { success: true, data: (data || []) as WebhookEventoResumoFyDigital[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar webhooks recebidos.' }
  }
}
