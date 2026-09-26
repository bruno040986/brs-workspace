/**
 * Templates de Mensagens — leitura e renderização (fatia 5, 26/09/2026).
 * Módulo SÓ de servidor (importado pelas server actions). Não é 'use server':
 * expor isto como action daria leitura sem checagem de permissão.
 * `obterMensagem(chave, vars)` devolve assunto/HTML/texto já renderizados a
 * partir do template personalizado (tabela) ou do padrão (catálogo).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { TEMPLATES_PADRAO, templatePadrao, type TemplateDef } from './catalogo'
import { limparWhatsApp, renderizarHtml, renderizarTexto, type Vars } from './render'

export type TemplateSalvo = {
  chave: string
  email_assunto: string | null
  email_html: string | null
  whatsapp_texto: string | null
  versao: number
  updated_by: string | null
  updated_at: string
}

export type TemplateResolvido = TemplateDef & { personalizado: boolean; versao: number; updated_by_nome: string | null; updated_at: string | null }

export async function carregarTemplatesSalvos(): Promise<Map<string, TemplateSalvo>> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('mensagem_templates').select('chave,email_assunto,email_html,whatsapp_texto,versao,updated_by,updated_at')
  if (error) throw error
  return new Map((data || []).map((r: any) => [r.chave, r as TemplateSalvo]))
}

/** Padrão + personalização (campo a campo: vazio no salvo = padrão). */
export async function resolverTemplate(chave: string): Promise<TemplateDef & { personalizado: boolean }> {
  const def = templatePadrao(chave)
  if (!def) throw new Error(`Template desconhecido: ${chave}`)
  const salvos = await carregarTemplatesSalvos()
  const s = salvos.get(chave)
  if (!s) return { ...def, personalizado: false }
  return {
    ...def,
    email_assunto: s.email_assunto || def.email_assunto,
    email_html: s.email_html || def.email_html,
    whatsapp_texto: s.whatsapp_texto || def.whatsapp_texto,
    personalizado: true,
  }
}

export type MensagemPronta = { assunto: string; html: string; texto: string }

export async function obterMensagem(chave: string, vars: Vars): Promise<MensagemPronta> {
  const t = await resolverTemplate(chave)
  return {
    assunto: renderizarTexto(t.email_assunto, vars),
    html: renderizarHtml(t.email_html, vars),
    texto: renderizarTexto(limparWhatsApp(t.whatsapp_texto), vars),
  }
}

export async function listarTemplatesResolvidos(): Promise<TemplateResolvido[]> {
  const admin = await createAdminClient()
  const salvos = await carregarTemplatesSalvos()
  const ids = Array.from(new Set([...salvos.values()].map((s) => s.updated_by).filter(Boolean))) as string[]
  const { data: users } = ids.length ? await admin.from('users').select('id,name').in('id', ids) : { data: [] as any[] }
  const nome = new Map((users || []).map((u: any) => [u.id, u.name]))
  return TEMPLATES_PADRAO.map((def) => {
    const s = salvos.get(def.chave)
    return {
      ...def,
      email_assunto: s?.email_assunto || def.email_assunto,
      email_html: s?.email_html || def.email_html,
      whatsapp_texto: s?.whatsapp_texto || def.whatsapp_texto,
      personalizado: Boolean(s),
      versao: s?.versao || 0,
      updated_by_nome: s?.updated_by ? nome.get(s.updated_by) || null : null,
      updated_at: s?.updated_at || null,
    }
  })
}
