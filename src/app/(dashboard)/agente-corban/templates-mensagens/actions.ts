'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAnyPermission, requirePermission } from '@/lib/auth/server'
import { exemploVars, templatePadrao } from '@/lib/mensagens/catalogo'
import { limparWhatsApp, problemasHtmlTemplate, renderizarHtml, renderizarTexto, variaveisUsadas } from '@/lib/mensagens/render'
import { listarTemplatesResolvidos, type TemplateResolvido } from '@/lib/mensagens/templates'

const RESOURCE = 'workspace-templates-mensagens'
const ROTA = '/agente-corban/templates-mensagens'

type Resultado<T = object> = ({ success: true } & T) | { success: false; error: string }

export async function getTemplatesMensagens(): Promise<Resultado<{ templates: TemplateResolvido[] }>> {
  try {
    await requireAnyPermission([
      { resource: RESOURCE, action: 'can_view' },
      { resource: 'agente-corban-cadastros-recebidos', action: 'can_view' },
    ])
    return { success: true, templates: await listarTemplatesResolvidos() }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Avisa sobre variáveis que o template usa mas não existem para ele. */
function variaveisDesconhecidas(chave: string, ...textos: string[]): string[] {
  const def = templatePadrao(chave)
  if (!def) return []
  const conhecidas = new Set(def.variaveis.map((v) => v.chave))
  return Array.from(new Set(textos.flatMap((t) => variaveisUsadas(t)).filter((v) => !conhecidas.has(v))))
}

export async function salvarTemplateMensagem(input: {
  chave: string
  email_assunto: string
  email_html: string
  whatsapp_texto: string
}): Promise<Resultado<{ versao: number; avisos: string[] }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const def = templatePadrao(input.chave)
    if (!def) throw new Error('Template desconhecido.')
    const email_assunto = String(input.email_assunto || '').trim()
    const email_html = String(input.email_html || '').trim()
    const whatsapp_texto = limparWhatsApp(String(input.whatsapp_texto || ''))
    if (def.canais.includes('email') && (!email_assunto || !email_html)) throw new Error('Assunto e corpo do e-mail são obrigatórios.')
    if (def.canais.includes('whatsapp') && !whatsapp_texto) throw new Error('O texto do WhatsApp é obrigatório.')
    const perigos = problemasHtmlTemplate(email_html)
    if (perigos.length) throw new Error(`O HTML do e-mail contém conteúdo não permitido: ${perigos.join('; ')}.`)
    const avisos = variaveisDesconhecidas(input.chave, email_assunto, email_html, whatsapp_texto).map((v) => `Variável {{${v}}} não existe neste template e vai sair vazia.`)

    const admin = await createAdminClient()
    const { data: atual } = await admin.from('mensagem_templates').select('versao').eq('chave', input.chave).maybeSingle()
    const versao = (atual?.versao || 0) + 1
    const nowIso = new Date().toISOString()
    const row = { chave: input.chave, email_assunto, email_html, whatsapp_texto, versao, updated_by: user.id, updated_at: nowIso }
    const { error } = await admin.from('mensagem_templates').upsert(row, { onConflict: 'chave' })
    if (error) throw error
    const { error: vErr } = await admin.from('mensagem_templates_versoes').insert({ chave: input.chave, versao, email_assunto, email_html, whatsapp_texto, updated_by: user.id })
    if (vErr) throw vErr
    revalidatePath(ROTA)
    return { success: true, versao, avisos }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Volta ao texto padrão do catálogo (apaga a personalização; o histórico fica). */
export async function restaurarTemplatePadrao(chave: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    if (!templatePadrao(chave)) throw new Error('Template desconhecido.')
    const admin = await createAdminClient()
    const { data: atual } = await admin.from('mensagem_templates').select('versao').eq('chave', chave).maybeSingle()
    if (atual) {
      await admin.from('mensagem_templates_versoes').insert({ chave, versao: atual.versao + 1, email_assunto: null, email_html: null, whatsapp_texto: null, updated_by: user.id })
      const { error } = await admin.from('mensagem_templates').delete().eq('chave', chave)
      if (error) throw error
    }
    revalidatePath(ROTA)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type VersaoTemplate = { versao: number; email_assunto: string | null; email_html: string | null; whatsapp_texto: string | null; autor: string | null; created_at: string }

export async function listarVersoesTemplate(chave: string): Promise<Resultado<{ versoes: VersaoTemplate[] }>> {
  try {
    await requirePermission(RESOURCE, 'can_view')
    const admin = await createAdminClient()
    const { data, error } = await admin.from('mensagem_templates_versoes').select('*').eq('chave', chave).order('versao', { ascending: false }).limit(30)
    if (error) throw error
    const ids = Array.from(new Set((data || []).map((v: any) => v.updated_by).filter(Boolean)))
    const { data: users } = ids.length ? await admin.from('users').select('id,name').in('id', ids) : { data: [] as any[] }
    const nome = new Map((users || []).map((u: any) => [u.id, u.name]))
    return {
      success: true,
      versoes: (data || []).map((v: any) => ({
        versao: v.versao,
        email_assunto: v.email_assunto,
        email_html: v.email_html,
        whatsapp_texto: v.whatsapp_texto,
        autor: v.updated_by ? nome.get(v.updated_by) || null : null,
        created_at: v.created_at,
      })),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Pré-visualização com dados de exemplo (o que o parceiro veria). */
export async function previewTemplate(input: { chave: string; email_assunto: string; email_html: string; whatsapp_texto: string }): Promise<Resultado<{ assunto: string; html: string; texto: string }>> {
  try {
    await requireAnyPermission([
      { resource: RESOURCE, action: 'can_view' },
      { resource: 'agente-corban-cadastros-recebidos', action: 'can_view' },
    ])
    const def = templatePadrao(input.chave)
    if (!def) throw new Error('Template desconhecido.')
    const perigos = problemasHtmlTemplate(input.email_html)
    if (perigos.length) throw new Error(`O HTML do e-mail contém conteúdo não permitido: ${perigos.join('; ')}.`)
    const vars = exemploVars(def)
    return {
      success: true,
      assunto: renderizarTexto(input.email_assunto, vars),
      html: renderizarHtml(input.email_html, vars),
      texto: renderizarTexto(limparWhatsApp(input.whatsapp_texto), vars),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
