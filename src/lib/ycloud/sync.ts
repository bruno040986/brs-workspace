/**
 * Sync YCloud (F3): números → ycloud_numeros_saude (+ eventos de mudança),
 * templates por WABA → ycloud_templates, saldo → ycloud_saldos; alertas via
 * workspace_notifications. Roda pelo cron /api/cron/ycloud-sync e pelo botão
 * "Sincronizar agora". Tolerante a falha por conexão: uma conta com chave
 * inválida não derruba as outras (status vira 'invalida' e a tela avisa).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { createWorkspaceNotifications } from '@/lib/notifications'
import { ErroYcloudApi, somenteDigitos, ycloudApi } from './client'
import { apiKeyDaConexao, gravarSaudeNumero, listarConexoesAtivas, type ConexaoRow } from './conexoes'
import { alertasDeSaude, alertasDeTemplates, diffSaude, type SaudeAnterior, type TemplateAnterior } from './sync-regras'

type Admin = Awaited<ReturnType<typeof createAdminClient>>

export type ResultadoSync = { conexoes: number; numeros: number; templates: number; alertas: number; erros: string[] }

export async function sincronizarTodasConexoes(): Promise<ResultadoSync> {
  const admin = await createAdminClient()
  const conexoes = await listarConexoesAtivas(admin)
  const total: ResultadoSync = { conexoes: conexoes.length, numeros: 0, templates: 0, alertas: 0, erros: [] }
  for (const c of conexoes) {
    try {
      const r = await sincronizarConexao(admin, c)
      total.numeros += r.numeros
      total.templates += r.templates
      total.alertas += r.alertas
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      total.erros.push(`${c.nome}: ${msg}`)
      if (e instanceof ErroYcloudApi && e.status === 401) {
        await admin.from('ycloud_conexoes').update({ status: 'invalida', updated_at: new Date().toISOString() }).eq('id', c.id)
        await notificar(admin, [{ titulo: `WhatsApp Oficial: chave da YCloud inválida (${c.nome})`, corpo: 'A API Key foi recusada. Gere uma nova no painel da YCloud e atualize em Provedores.' }], '/rh/parceiros/config/provedores/whatsapp-oficial')
      }
    }
  }
  return total
}

export async function sincronizarConexao(admin: Admin, conexao: ConexaoRow): Promise<{ numeros: number; templates: number; alertas: number }> {
  const apiKey = apiKeyDaConexao(conexao)
  const alertas: Array<{ titulo: string; corpo: string }> = []

  // --- instâncias ativas desta conexão (só elas ganham snapshot) ------------
  const { data: instancias, error: erroInst } = await admin
    .from('chat_instancias')
    .select('id, nome, numero, ycloud_waba_id')
    .eq('provedor', 'ycloud')
    .eq('ycloud_conexao_id', conexao.id)
    .is('deleted_at', null)
  if (erroInst) throw erroInst
  const porNumero = new Map((instancias || []).map((i) => [String(i.numero), i]))

  // --- números ---------------------------------------------------------------
  const numeros = await ycloudApi.phoneNumbers(apiKey)
  let numerosSync = 0
  for (const n of numeros) {
    const inst = porNumero.get(somenteDigitos(n.phoneNumber))
    if (!inst) continue // número da conta não ativado aqui: ignorado (ADR-2)
    const { data: anterior } = await admin
      .from('ycloud_numeros_saude')
      .select('quality_rating, messaging_limit, bm_messaging_limit, status, name_status')
      .eq('instancia_id', inst.id)
      .maybeSingle()
    const mudancas = diffSaude((anterior as SaudeAnterior | null) || null, n)
    await gravarSaudeNumero(admin, String(inst.id), n)
    if (mudancas.length) {
      const agora = new Date().toISOString()
      await admin.from('ycloud_numeros_saude_eventos').insert(
        mudancas.map((m) => ({ instancia_id: inst.id, tipo: `sync.${m.campo}`, de: { valor: m.de }, para: { valor: m.para }, evento_id: null, ocorrido_em: agora, payload: null })),
      )
      alertas.push(...alertasDeSaude(String(inst.nome), mudancas))
    }
    numerosSync++
  }

  // --- templates (por WABA, deduplicado: 2 números na mesma WABA = 1 lista) --
  const wabas = new Set((instancias || []).map((i) => String(i.ycloud_waba_id || '')).filter(Boolean))
  let templatesSync = 0
  for (const wabaId of wabas) {
    const atuais = await ycloudApi.templates(apiKey, wabaId)
    const { data: anteriores } = await admin
      .from('ycloud_templates')
      .select('nome, idioma, status, quality_rating')
      .eq('conexao_id', conexao.id)
      .eq('waba_id', wabaId)
    alertas.push(...alertasDeTemplates((anteriores || []) as TemplateAnterior[], atuais))
    const agora = new Date().toISOString()
    if (atuais.length) {
      const { error } = await admin.from('ycloud_templates').upsert(
        atuais.map((t) => ({
          conexao_id: conexao.id,
          waba_id: wabaId,
          nome: t.name,
          idioma: t.language,
          categoria: t.category ?? null,
          status: t.status ?? null,
          quality_rating: t.qualityRating ?? null,
          componentes: t.components ?? null,
          sincronizado_em: agora,
        })),
        { onConflict: 'conexao_id,waba_id,nome,idioma' },
      )
      if (error) throw error
    }
    // sumiu da lista da YCloud = apagado na Meta → marca DELETED (nunca remove a linha: campanhas/histórico apontam pra ela)
    const vivos = new Set(atuais.map((t) => `${t.name}::${t.language}`))
    for (const ant of (anteriores || []) as TemplateAnterior[]) {
      if (!vivos.has(`${ant.nome}::${ant.idioma}`) && ant.status !== 'DELETED') {
        await admin.from('ycloud_templates').update({ status: 'DELETED', sincronizado_em: agora }).eq('conexao_id', conexao.id).eq('waba_id', wabaId).eq('nome', ant.nome).eq('idioma', ant.idioma)
      }
    }
    templatesSync += atuais.length
  }

  // --- saldo (por conexão e moeda; nunca somado por número) ------------------
  const balance = await ycloudApi.balance(apiKey)
  if (balance?.amount !== undefined && balance?.currency) {
    const { error } = await admin
      .from('ycloud_saldos')
      .upsert({ conexao_id: conexao.id, moeda: String(balance.currency), saldo: String(balance.amount), observado_em: new Date().toISOString() }, { onConflict: 'conexao_id,moeda' })
    if (error) throw error
  }

  await admin.from('ycloud_conexoes').update({ ultimo_teste_em: new Date().toISOString(), status: 'ativa' }).eq('id', conexao.id)
  if (alertas.length) await notificar(admin, alertas, '/central-conversas/whatsapp-oficial')
  return { numeros: numerosSync, templates: templatesSync, alertas: alertas.length }
}

/** Destinatários = quem enxerga o painel de saúde (perm conversas-whatsapp-oficial-saude), por usuário ou perfil. */
async function usuariosComPermissaoSaude(admin: Admin): Promise<string[]> {
  const ids = new Set<string>()
  const { data: diretos } = await admin.from('user_permissions').select('user_id').eq('resource_name', 'conversas-whatsapp-oficial-saude').eq('can_view', true)
  for (const r of diretos || []) ids.add(String(r.user_id))
  const { data: perfis } = await admin.from('profile_permissions').select('profile_id').eq('resource_name', 'conversas-whatsapp-oficial-saude').eq('can_view', true)
  const profileIds = (perfis || []).map((p) => String(p.profile_id))
  if (profileIds.length) {
    const { data: users } = await admin.from('users').select('id').in('profile_id', profileIds).eq('active', true)
    for (const u of users || []) ids.add(String(u.id))
  }
  return [...ids]
}

async function notificar(admin: Admin, alertas: Array<{ titulo: string; corpo: string }>, href: string): Promise<void> {
  const destinatarios = await usuariosComPermissaoSaude(admin)
  if (!destinatarios.length) return
  await createWorkspaceNotifications(
    admin,
    destinatarios.flatMap((user_id) => alertas.map((a) => ({ user_id, type: 'ycloud_saude', title: a.titulo, body: a.corpo, href, entity_type: 'ycloud' }))),
  )
}
