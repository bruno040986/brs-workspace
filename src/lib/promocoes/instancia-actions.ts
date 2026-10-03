'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs } from '@/lib/central-conversas/actions'
import { engine, engineConfigurado, mensagemErroEngine } from '@/lib/central-conversas/engine'
import { novoOperationId } from '@/lib/central-conversas/envio-intencao'
import { enviarWhatsappPromocao } from './whatsapp'

// Permissão própria (comercial-promocoes-config), sem exigir `central-conversas`:
// quem configura a promoção não ganha acesso às demais instâncias, e as ações
// só tocam a instância gravada em promocao_campanhas.instancia_id.
const RECURSO = 'comercial-promocoes-config'

export type InstanciaPromocaoView = {
  id: string
  nome: string
  status: string
  numero: string | null
  ultimo_qr: string | null
  ultimo_erro: string | null
  conectada_em: string | null
}

type Resp<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const COLS = 'id, nome, status, numero, ultimo_qr, ultimo_erro, conectada_em'

async function campanha(admin: any, slug: string) {
  const { data } = await admin.from('promocao_campanhas').select('id, nome, instancia_id').eq('slug', slug).maybeSingle()
  if (!data) throw new Error('Campanha não encontrada.')
  return data as { id: string; nome: string; instancia_id: string | null }
}

async function instancia(admin: any, id: string | null): Promise<InstanciaPromocaoView | null> {
  if (!id) return null
  const { data } = await admin.from('chat_instancias').select(COLS).eq('id', id).is('deleted_at', null).maybeSingle()
  return data ? ({ ...data, id: String(data.id) } as InstanciaPromocaoView) : null
}

async function executar<T extends object>(acao: 'can_view' | 'can_edit', fn: () => Promise<T>): Promise<Resp<T>> {
  try {
    await requirePermission(RECURSO, acao)
    return { ok: true, ...(await fn()) }
  } catch (err) {
    return { ok: false, error: mensagemErroEngine(err) }
  }
}

export async function statusInstanciaPromocao(slug: string) {
  return executar('can_view', async () => {
    const admin: any = await createAdminClient()
    const c = await campanha(admin, slug)
    const inst = await instancia(admin, c.instancia_id)
    // QR de pareamento só para quem edita (can_view não pareia o número)
    const podeEditar = await requirePermission(RECURSO, 'can_edit').then(() => true, () => false)
    return { instancia: inst && !podeEditar ? { ...inst, ultimo_qr: null } : inst }
  })
}

export async function criarInstanciaPromocao(slug: string) {
  return executar('can_edit', async () => {
    if (!engineConfigurado()) throw new Error('Engine não configurado (ENGINE_API_TOKEN).')
    const admin: any = await createAdminClient()
    const c = await campanha(admin, slug)
    if (await instancia(admin, c.instancia_id)) throw new Error('A promoção já tem uma instância.')
    const conta = await contaBrs()
    if (!conta) throw new Error('Chatwoot da BRS ainda não foi provisionado.')
    const { count } = await admin.from('chat_instancias').select('id', { count: 'exact', head: true }).eq('conta_id', conta.id).is('deleted_at', null)
    const { data, error } = await admin
      .from('chat_instancias')
      .insert({ conta_id: conta.id, owner_tipo: 'brs', nome: 'NuAzul Promoção', papel: 'receptiva', provedor: 'baileys', permite_grupos: false, ordem: (count || 0) + 1 })
      .select('id')
      .single()
    if (error) throw error
    await admin.from('promocao_campanhas').update({ instancia_id: data.id }).eq('id', c.id)
    await engine.conectar(String(data.id))
    revalidatePath(`/promocoes/${slug}/config`)
    return { instancia: await instancia(admin, String(data.id)) }
  })
}

export async function conectarInstanciaPromocao(slug: string) {
  return executar('can_edit', async () => {
    const admin: any = await createAdminClient()
    const c = await campanha(admin, slug)
    if (!(await instancia(admin, c.instancia_id))) throw new Error('Crie a instância primeiro.')
    await engine.conectar(c.instancia_id!)
    return { instancia: await instancia(admin, c.instancia_id) }
  })
}

export async function desconectarInstanciaPromocao(slug: string) {
  return executar('can_edit', async () => {
    const admin: any = await createAdminClient()
    const c = await campanha(admin, slug)
    if (!c.instancia_id) throw new Error('Sem instância.')
    await engine.desconectar(c.instancia_id, true)
    return { instancia: await instancia(admin, c.instancia_id) }
  })
}

/** Cada clique é uma intenção nova (chave nova); retentar o MESMO envio é papel do job. */
export async function enviarTestePromocao(slug: string, telefone: string) {
  return executar('can_edit', async () => {
    const admin: any = await createAdminClient()
    const c = await campanha(admin, slug)
    const envio = await enviarWhatsappPromocao({
      campanhaId: c.id,
      chave: `teste:${c.id}:${novoOperationId()}`,
      tipo: 'otp',
      telefone,
      texto: 'NuAzul: teste da instância de WhatsApp da promoção. Pode ignorar esta mensagem.',
    })
    return { envio }
  })
}
