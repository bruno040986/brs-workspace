'use server'

/**
 * Card "WhatsApp Oficial (YCloud)" em Provedores e APIs — permissão
 * `sistema-config-whatsapp-oficial` (seed na migration 20260926142223).
 * Painel de saúde na Central de Atendimento — `conversas-whatsapp-oficial-saude`.
 * Segredo é write-only: nenhuma action devolve a chave nem o secret.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { engine } from '@/lib/central-conversas/engine'
import { somenteDigitos, type YcloudPhoneNumber } from './client'
import { apiKeyDaConexao, ativarNumeroBrs, desativarNumeroBrs, lerConexaoBrs, salvarChaveBrs, testarChave } from './conexoes'
import { lerSaldos, lerSaudeNumero, listarTemplates, type SaldoCarteira, type SaudeNumero, type TemplateYcloud } from './leitura'
import { sincronizarConexao, sincronizarTodasConexoes, type ResultadoSync } from './sync'

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))
const PERM_CONFIG = 'sistema-config-whatsapp-oficial'
const PERM_SAUDE = 'conversas-whatsapp-oficial-saude'
// Card de conexão e painel de saúde foram embutidos em Central de Atendimento
// (reorganização de 27/09/2026) — não têm mais rota própria.
const ROTA_CARD = '/central-conversas/canais'

export type ConexaoBrsPublica = {
  temChave: boolean
  nome: string
  status: 'ativa' | 'invalida' | 'removida' | 'nenhuma'
  webhookConfigurado: boolean
  ultimoTesteEm: string | null
  atualizadoEm: string | null
}

export type NumeroDaConta = {
  numero: string
  exibicao: string
  nomeVerificado: string
  wabaId: string
  qualidade: string
  limitePortfolio: string
  status: string
  instanciaId: string | null
}

export type InstanciaOficial = { id: string; nome: string; numero: string; status: string; saude: SaudeNumero; templatesAprovados: number }

export async function getConexaoYcloud(): Promise<{ success: boolean; data?: ConexaoBrsPublica; error?: string }> {
  try {
    await requirePermission(PERM_CONFIG)
    const c = await lerConexaoBrs()
    return {
      success: true,
      data: {
        temChave: !!c,
        nome: c?.nome || '',
        status: c?.status || 'nenhuma',
        webhookConfigurado: !!c?.webhook_endpoint_id,
        ultimoTesteEm: c?.ultimo_teste_em || null,
        atualizadoEm: c?.updated_at || null,
      },
    }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

export async function saveChaveYcloud(input: { apiKey: string; nome?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(PERM_CONFIG, 'can_edit')
    await salvarChaveBrs({ apiKey: input.apiKey, nome: input.nome, userId: user.id })
    revalidatePath(ROTA_CARD)
    return { success: true }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

/** Testa a chave GRAVADA (não recebe chave do browser) e lista os números da conta com o vínculo de instância. */
export async function testYcloudConnection(): Promise<{ ok: boolean; detalhe: string; saldo?: SaldoCarteira | null; numeros?: NumeroDaConta[] }> {
  try {
    await requirePermission(PERM_CONFIG)
    const c = await lerConexaoBrs()
    if (!c) return { ok: false, detalhe: 'Nenhuma chave cadastrada.' }
    const { saldo, numeros } = await testarChave(apiKeyDaConexao(c))
    const admin = await createAdminClient()
    await admin.from('ycloud_conexoes').update({ ultimo_teste_em: new Date().toISOString(), status: 'ativa' }).eq('id', c.id)
    return {
      ok: true,
      detalhe: `${numeros.length} número(s) na conta.`,
      saldo: saldo ? { moeda: saldo.moeda, saldo: saldo.valor, observadoEm: new Date().toISOString(), obsoleto: false } : null,
      numeros: await mapearNumeros(admin, c.id, numeros),
    }
  } catch (err) {
    return { ok: false, detalhe: mensagem(err) }
  }
}

async function mapearNumeros(admin: Awaited<ReturnType<typeof createAdminClient>>, conexaoId: string, numeros: YcloudPhoneNumber[]): Promise<NumeroDaConta[]> {
  const { data } = await admin.from('chat_instancias').select('id, numero').eq('provedor', 'ycloud').eq('ycloud_conexao_id', conexaoId).is('deleted_at', null)
  const porNumero = new Map((data || []).map((i) => [String(i.numero), String(i.id)]))
  return numeros.map((n) => {
    const digitos = somenteDigitos(n.phoneNumber)
    return {
      numero: digitos,
      exibicao: String(n.displayPhoneNumber || n.phoneNumber),
      nomeVerificado: String(n.verifiedName || ''),
      wabaId: String(n.wabaId || ''),
      qualidade: String(n.qualityRating || 'UNKNOWN'),
      limitePortfolio: String(n.whatsappBusinessManagerMessagingLimit || n.messagingLimit || 'TIER_NOT_SET'),
      status: String(n.status || ''),
      instanciaId: porNumero.get(digitos) || null,
    }
  })
}

export async function ativarNumeroYcloud(input: { numero: string; nome: string }): Promise<{ success: boolean; instanciaId?: string; error?: string }> {
  try {
    const { user } = await requirePermission(PERM_CONFIG, 'can_edit')
    const r = await ativarNumeroBrs({ numero: input.numero, nome: input.nome, userId: user.id })
    revalidatePath(ROTA_CARD)
    revalidatePath('/central-conversas')
    return { success: true, instanciaId: r.instanciaId }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

export async function desativarNumeroYcloud(instanciaId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(PERM_CONFIG, 'can_edit')
    await desativarNumeroBrs(instanciaId)
    revalidatePath(ROTA_CARD)
    revalidatePath('/central-conversas')
    return { success: true }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

export async function sincronizarYcloudAgora(): Promise<{ success: boolean; data?: ResultadoSync; error?: string }> {
  try {
    await requirePermission(PERM_CONFIG, 'can_edit')
    const data = await sincronizarTodasConexoes()
    revalidatePath(ROTA_CARD)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

// ---------------------------------------------------------------------------
// Painel de saúde (Central de Atendimento) — leitura
// ---------------------------------------------------------------------------

export async function getPainelSaudeYcloud(): Promise<{ success: boolean; data?: { instancias: InstanciaOficial[]; saldos: SaldoCarteira[]; conexao: ConexaoBrsPublica | null }; error?: string }> {
  try {
    await requirePermission(PERM_SAUDE)
    const admin = await createAdminClient()
    const c = await lerConexaoBrs(admin)
    if (!c) return { success: true, data: { instancias: [], saldos: [], conexao: null } }
    const { data: rows, error } = await admin.from('chat_instancias').select('id, nome, numero, status, ycloud_waba_id').eq('provedor', 'ycloud').eq('ycloud_conexao_id', c.id).is('deleted_at', null).order('ordem')
    if (error) throw error
    const instancias: InstanciaOficial[] = []
    for (const r of rows || []) {
      const [saude, templates] = await Promise.all([lerSaudeNumero(admin, String(r.id)), listarTemplates(admin, c.id, String(r.ycloud_waba_id || ''), true)])
      instancias.push({ id: String(r.id), nome: String(r.nome), numero: String(r.numero || ''), status: String(r.status), saude, templatesAprovados: templates.length })
    }
    return {
      success: true,
      data: {
        instancias,
        saldos: await lerSaldos(admin, c.id),
        conexao: { temChave: true, nome: c.nome, status: c.status, webhookConfigurado: !!c.webhook_endpoint_id, ultimoTesteEm: c.ultimo_teste_em, atualizadoEm: c.updated_at },
      },
    }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

/** Templates da WABA da instância (seletor do compositor, S1). */
export async function getTemplatesYcloud(instanciaId: string, apenasAprovados = true): Promise<{ success: boolean; data?: TemplateYcloud[]; error?: string }> {
  try {
    await requirePermission(PERM_SAUDE)
    const admin = await createAdminClient()
    const { data: inst, error } = await admin.from('chat_instancias').select('ycloud_conexao_id, ycloud_waba_id').eq('id', instanciaId).eq('provedor', 'ycloud').is('deleted_at', null).maybeSingle()
    if (error) throw error
    if (!inst?.ycloud_conexao_id || !inst.ycloud_waba_id) return { success: true, data: [] }
    return { success: true, data: await listarTemplates(admin, String(inst.ycloud_conexao_id), String(inst.ycloud_waba_id), apenasAprovados) }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

export async function getHistoricoSaudeYcloud(instanciaId: string): Promise<{ success: boolean; data?: Array<{ tipo: string; de: unknown; para: unknown; ocorridoEm: string }>; error?: string }> {
  try {
    await requirePermission(PERM_SAUDE)
    const admin = await createAdminClient()
    const { data, error } = await admin.from('ycloud_numeros_saude_eventos').select('tipo, de, para, ocorrido_em').eq('instancia_id', instanciaId).order('ocorrido_em', { ascending: false }).limit(100)
    if (error) throw error
    return { success: true, data: (data || []).map((e) => ({ tipo: String(e.tipo), de: e.de, para: e.para, ocorridoEm: String(e.ocorrido_em) })) }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

/** Reconecta (engine.conectar) uma instância oficial — confere webhook e atualiza status. */
export async function reconectarInstanciaYcloud(instanciaId: string): Promise<{ success: boolean; conectada?: boolean; error?: string }> {
  try {
    await requirePermission(PERM_CONFIG, 'can_edit')
    const admin = await createAdminClient()
    const c = await lerConexaoBrs(admin)
    if (!c) throw new Error('Conexão YCloud não encontrada.')
    await sincronizarConexao(admin, c).catch(() => undefined)
    const r = await engine.conectar(instanciaId)
    revalidatePath('/central-conversas')
    return { success: true, conectada: r.conectada === true }
  } catch (err) {
    return { success: false, error: mensagem(err) }
  }
}

