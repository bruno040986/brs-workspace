'use server'

/**
 * Amigoz — Fatia 1 (descoberta). Card da IF na config "APIs de Instituições
 * Financeiras de Crédito" + chamadas de descoberta (só leitura/simulação:
 * NUNCA cria cliente nem contrato aqui — isso é a Fatia 3, depois do formato
 * das respostas estar fixado). Permissão: sistema-config-if-credito.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { cifrarTexto } from '@/lib/central-conversas/cofre'
import {
  AMIGOZ_BASE_URL_PADRAO,
  autenticarAmigoz,
  carregarConfigAmigoz,
  chamarAmigozAutenticado,
  mensagemErroAmigoz,
  obterInstituicaoAmigoz,
  type ResultadoChamada,
} from '@/lib/if-credito/amigoz/client'

const RESOURCE = 'sistema-config-if-credito'
const PATH_CONFIG = '/rh/parceiros/config/provedores/if-credito'

export type ConfigAmigozPublica = {
  instituicao_financeira_id: string
  base_url: string
  usuario: string
  corban_id_externo: string
  ativo: boolean
  temSenha: boolean
  token_expira_em: string | null
}

export async function lerConfigAmigoz(instituicaoId: string): Promise<{ success: boolean; data?: ConfigAmigozPublica; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    if (!instituicaoId) throw new Error('Instituição inválida.')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('if_credito_config')
      .select('base_url, usuario, senha_enc, corban_id_externo, ativo, token_expira_em')
      .eq('instituicao_financeira_id', instituicaoId)
      .maybeSingle()
    if (error) throw error
    return {
      success: true,
      data: {
        instituicao_financeira_id: instituicaoId,
        base_url: String(data?.base_url || AMIGOZ_BASE_URL_PADRAO),
        usuario: String(data?.usuario || ''),
        corban_id_externo: String(data?.corban_id_externo || ''),
        ativo: Boolean(data?.ativo),
        temSenha: Boolean(data?.senha_enc),
        token_expira_em: data?.token_expira_em ? String(data.token_expira_em) : null,
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar.' }
  }
}

export async function salvarConfigAmigoz(input: {
  instituicao_financeira_id: string
  base_url?: string
  usuario: string
  senha?: string
  corban_id_externo?: string
  ativo: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!input.instituicao_financeira_id) throw new Error('Selecione a instituição financeira.')
    const usuario = String(input.usuario || '').trim()
    if (!usuario) throw new Error('Informe o usuário de acesso.')
    const baseUrl = String(input.base_url || AMIGOZ_BASE_URL_PADRAO).trim().replace(/\/+$/, '')
    if (!/^https:\/\//.test(baseUrl)) throw new Error('Base URL precisa começar com https://')

    const admin = await createAdminClient()
    const row: Record<string, unknown> = {
      instituicao_financeira_id: input.instituicao_financeira_id,
      ambiente: 'producao', // a doc do Amigoz não expõe homologação
      base_url: baseUrl,
      usuario,
      corban_id_externo: String(input.corban_id_externo || '').trim() || null,
      ativo: Boolean(input.ativo),
      updated_at: new Date().toISOString(),
    }
    // Senha só quando vier preenchida (em branco mantém a cifrada). Trocar
    // usuário/senha invalida o token em cache.
    if (input.senha?.trim()) {
      row.senha_enc = cifrarTexto(input.senha.trim())
      row.access_token_enc = null
      row.refresh_token_enc = null
      row.token_expira_em = null
    }
    const { error } = await admin.from('if_credito_config').upsert(row, { onConflict: 'instituicao_financeira_id' })
    if (error) throw error
    revalidatePath(PATH_CONFIG)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao salvar.' }
  }
}

export type RespostaDescoberta = {
  operacao: string
  http_status: number
  sucesso: boolean
  duracao_ms: number
  corpo: unknown
}

function empacotar(operacao: string, r: ResultadoChamada): RespostaDescoberta {
  return { operacao, http_status: r.status, sucesso: r.ok, duracao_ms: r.duracaoMs, corpo: r.corpo }
}

/**
 * Testa a credencial de ponta a ponta: login → seleciona corban → lista os
 * convênios do corban. Login forçado (ignora token em cache) pra validar o
 * que está salvo agora.
 */
export async function testarConexaoAmigoz(): Promise<{ success: boolean; data?: RespostaDescoberta; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const cfg = await carregarConfigAmigoz()
    await autenticarAmigoz(cfg, user.id)
    const cfgAtualizada = await carregarConfigAmigoz()
    const r = await chamarAmigozAutenticado(cfgAtualizada, 'convenios', 'GET', '/api/cliente/convenios', undefined, user.id)
    if (!r.ok) throw new Error(`Convênios: ${mensagemErroAmigoz(r)}`)
    return { success: true, data: empacotar('convenios', r) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro no teste de conexão.' }
  }
}

/** Operações de descoberta permitidas — só leitura e simulação. */
export type OperacaoDescoberta =
  | 'convenios'
  | 'consulta-margem'
  | 'cartoes'
  | 'simulacao-cartao'
  | 'simulacao-saque-v2'
  | 'contratos'

const OPERACOES: Record<OperacaoDescoberta, { metodo: 'GET' | 'POST'; caminho: string }> = {
  convenios: { metodo: 'GET', caminho: '/api/cliente/convenios' },
  'consulta-margem': { metodo: 'POST', caminho: '/api/consulta-margem' },
  cartoes: { metodo: 'POST', caminho: '/api/cliente/cartoes' },
  'simulacao-cartao': { metodo: 'POST', caminho: '/api/simulacao/cartao' },
  'simulacao-saque-v2': { metodo: 'POST', caminho: '/api/simulacao/v2/saque-complementar' },
  contratos: { metodo: 'GET', caminho: '/api/contratos/' },
}

/**
 * Executa UMA operação de descoberta com o payload informado na tela e
 * devolve a resposta bruta (também gravada em if_credito_chamadas).
 * `payloadJson` é o corpo (POST) ou a query string em JSON (GET).
 */
export async function executarDescobertaAmigoz(input: {
  operacao: OperacaoDescoberta
  payloadJson: string
}): Promise<{ success: boolean; data?: RespostaDescoberta; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const op = OPERACOES[input.operacao]
    if (!op) throw new Error('Operação não permitida na descoberta.')

    let payload: unknown = undefined
    const texto = String(input.payloadJson || '').trim()
    if (texto) {
      try {
        payload = JSON.parse(texto)
      } catch {
        throw new Error('Payload não é um JSON válido.')
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Payload precisa ser um objeto JSON.')
    }

    const cfg = await carregarConfigAmigoz()
    let caminho = op.caminho
    let body: unknown = undefined
    if (op.metodo === 'GET') {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries((payload as Record<string, unknown>) || {})) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
      }
      const s = qs.toString()
      if (s) caminho += `?${s}`
    } else {
      body = payload ?? {}
    }
    const r = await chamarAmigozAutenticado(cfg, input.operacao, op.metodo, caminho, body, user.id)
    return { success: true, data: empacotar(input.operacao, r) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro na descoberta.' }
  }
}

export type ChamadaResumo = {
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

/** Últimas chamadas registradas (histórico da descoberta). */
export async function listarChamadasAmigoz(limite = 20): Promise<{ success: boolean; data?: ChamadaResumo[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const inst = await obterInstituicaoAmigoz()
    if (!inst) return { success: true, data: [] }
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('if_credito_chamadas')
      .select('id, operacao, metodo, caminho, http_status, sucesso, duracao_ms, created_at, resposta')
      .eq('instituicao_financeira_id', inst.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limite, 1), 100))
    if (error) throw error
    return { success: true, data: (data || []) as ChamadaResumo[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao listar chamadas.' }
  }
}
