'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  MIDIAS, chaveNovaVersao, gerarChave, proximaChave, validarMidia, validarTemplate, type FormatoMidia,
} from '@/lib/alvoconsig/templates-biblioteca'

const RECURSO = 'alvoconsig-gestao'
const BUCKET = 'parceiro-midias'
const CANAL = 'whatsapp_nao_oficial'

export type TemplateSistema = {
  id: string
  chave: string
  nome: string
  categoria: string | null
  corpo: string
  midia_tipo: 'imagem' | 'audio' | null
  midiaUrl: string | null
  ativo: boolean
  arquivado_em: string | null
  updated_at: string
}

type Res<T = object> = ({ success: true } & T) | { success: false; error: string }
const erro = (e: unknown) => ({ success: false as const, error: e instanceof Error ? e.message : 'Erro inesperado.' })

export async function listarTemplatesSistema(): Promise<Res<{ templates: TemplateSistema[] }>> {
  try {
    await requirePermission(RECURSO)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('crm_templates_mensagem')
      .select('id, chave, nome, categoria, corpo, midia_path, midia_tipo, ativo, arquivado_em, updated_at')
      .eq('sistema', true)
      .order('nome')
    if (error) throw error
    const templates = await Promise.all(
      (data || []).map(async (t) => {
        let midiaUrl: string | null = null
        if (t.midia_path) {
          const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(String(t.midia_path), 3600)
          midiaUrl = s?.signedUrl || null
        }
        const { midia_path: _p, ...resto } = t
        return { ...resto, midiaUrl } as TemplateSistema
      }),
    )
    return { success: true, templates }
  } catch (e) {
    return erro(e)
  }
}

async function chavesUsadas(admin: Awaited<ReturnType<typeof createAdminClient>>): Promise<string[]> {
  const { data, error } = await admin.from('crm_templates_mensagem').select('chave').eq('sistema', true)
  if (error) throw error
  return (data || []).map((r) => String(r.chave))
}

async function lerMidia(formData: FormData) {
  const arquivo = formData.get('midia')
  if (!(arquivo instanceof File) || arquivo.size === 0) return null
  const v = validarMidia(new Uint8Array(await arquivo.slice(0, 12).arrayBuffer()), arquivo.size)
  if (!v.ok) throw new Error(v.error)
  return { arquivo, formato: v.formato as FormatoMidia }
}

/** Cria template do sistema (campos: nome, categoria, corpo, midia opcional). */
export async function criarTemplateSistema(formData: FormData): Promise<Res<{ id: string }>> {
  try {
    await requirePermission(RECURSO, 'can_edit')
    const v = validarTemplate({
      nome: String(formData.get('nome') ?? ''), categoria: String(formData.get('categoria') ?? ''), corpo: String(formData.get('corpo') ?? ''),
    })
    if (!v.ok) return { success: false, error: v.error }
    const midia = await lerMidia(formData)
    const admin = await createAdminClient()
    const id = randomUUID()
    const chave = proximaChave(gerarChave(v.dados.nome), await chavesUsadas(admin))

    let midia_path: string | null = null
    if (midia) {
      midia_path = `sistema/templates/${id}.${midia.formato}`
      const { error: up } = await admin.storage.from(BUCKET).upload(midia_path, midia.arquivo, { contentType: MIDIAS[midia.formato].mime })
      if (up) throw up
    }
    const { error } = await admin.from('crm_templates_mensagem').insert({
      id, sistema: true, agente_parceiro_id: null, canal: CANAL, chave, ...v.dados, variaveis: v.variaveis,
      midia_path, midia_tipo: midia ? MIDIAS[midia.formato].tipo : null,
    })
    if (error) {
      if (midia_path) await admin.storage.from(BUCKET).remove([midia_path]).catch(() => undefined)
      throw error
    }
    revalidatePath('/alvoconsig/templates')
    return { success: true, id }
  } catch (e) {
    return erro(e)
  }
}

/**
 * "Editar" = NOVA VERSÃO. Nunca altera a linha existente (campanhas apontam para o id
 * e não há snapshot): insere a linha nova (chave -vN, copia o que não mudou, mídia
 * copiada ou substituída) e só então arquiva a anterior. Campos: id, nome, categoria,
 * corpo, midia (novo arquivo, opcional), removerMidia ('1' para tirar a mídia).
 * ponytail: sem transação no client JS; se o arquivamento falhar, a linha nova é
 * apagada (ninguém a referencia ainda). Trocar por RPC se isso incomodar.
 */
export async function novaVersaoTemplateSistema(formData: FormData): Promise<Res<{ id: string }>> {
  try {
    await requirePermission(RECURSO, 'can_edit')
    const idAtual = String(formData.get('id') ?? '')
    const v = validarTemplate({
      nome: String(formData.get('nome') ?? ''), categoria: String(formData.get('categoria') ?? ''), corpo: String(formData.get('corpo') ?? ''),
    })
    if (!v.ok) return { success: false, error: v.error }
    const midia = await lerMidia(formData)
    const admin = await createAdminClient()

    const { data: atual, error: eAtual } = await admin
      .from('crm_templates_mensagem')
      .select('id, chave, midia_path, midia_tipo')
      .eq('id', idAtual).eq('sistema', true).is('deleted_at', null).is('arquivado_em', null).maybeSingle()
    if (eAtual) throw eAtual
    if (!atual) return { success: false, error: 'Template não encontrado ou já arquivado.' }

    const id = randomUUID()
    const chave = chaveNovaVersao(String(atual.chave), await chavesUsadas(admin))
    let midia_path: string | null = null
    let midia_tipo: string | null = null
    if (midia) {
      midia_path = `sistema/templates/${id}.${midia.formato}`
      midia_tipo = MIDIAS[midia.formato].tipo
      const { error: up } = await admin.storage.from(BUCKET).upload(midia_path, midia.arquivo, { contentType: MIDIAS[midia.formato].mime })
      if (up) throw up
    } else if (atual.midia_path && formData.get('removerMidia') !== '1') {
      const ext = String(atual.midia_path).split('.').pop()
      midia_path = `sistema/templates/${id}.${ext}`
      midia_tipo = atual.midia_tipo
      const { error: cp } = await admin.storage.from(BUCKET).copy(String(atual.midia_path), midia_path)
      if (cp) throw cp
    }
    const limpar = async () => {
      if (midia_path) await admin.storage.from(BUCKET).remove([midia_path]).catch(() => undefined)
    }

    const { error: eIns } = await admin.from('crm_templates_mensagem').insert({
      id, sistema: true, agente_parceiro_id: null, canal: CANAL, chave, ...v.dados, variaveis: v.variaveis, midia_path, midia_tipo,
    })
    if (eIns) { await limpar(); throw eIns }

    const { data: arq, error: eArq } = await admin
      .from('crm_templates_mensagem')
      .update({ arquivado_em: new Date().toISOString() })
      .eq('id', idAtual).is('arquivado_em', null)
      .select('id')
    if (eArq || !arq?.length) {
      await admin.from('crm_templates_mensagem').delete().eq('id', id)
      await limpar()
      if (eArq) throw eArq
      return { success: false, error: 'Esta versão já foi alterada por outra edição; recarregue.' }
    }
    revalidatePath('/alvoconsig/templates')
    return { success: true, id }
  } catch (e) {
    return erro(e)
  }
}

/** Arquivar = só arquivado_em (ativo/deleted_at intactos: fila e campanhas em andamento seguem usando). */
export async function arquivarTemplateSistema(id: string): Promise<Res> {
  try {
    await requirePermission(RECURSO, 'can_edit')
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('crm_templates_mensagem')
      .update({ arquivado_em: new Date().toISOString() })
      .eq('id', id).eq('sistema', true).is('deleted_at', null).is('arquivado_em', null)
      .select('id')
    if (error) throw error
    if (!data?.length) return { success: false, error: 'Template não encontrado ou já arquivado.' }
    revalidatePath('/alvoconsig/templates')
    return { success: true }
  } catch (e) {
    return erro(e)
  }
}
