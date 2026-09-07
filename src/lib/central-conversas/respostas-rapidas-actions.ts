'use server'

/**
 * Respostas rápidas próprias (Fase B §2 da spec) — a canned response nativa
 * do Chatwoot é só texto; aqui tem categoria, escopo por departamento e
 * anexo. Cadastro: permissão `central-conversas`. Uso no composer: `conversas`.
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs } from './actions'

export type CategoriaResposta = { id: string; nome: string; ordem: number }

export type RespostaRapidaRow = {
  id: string
  nome: string
  atalho: string
  texto: string
  categoriaId: string | null
  categoriaNome: string | null
  arquivoPath: string | null
  ativo: boolean
  departamentoIds: string[]
}

async function contaIdOuErro(): Promise<string> {
  const conta = await contaBrs()
  if (!conta) throw new Error('Chatwoot não provisionado.')
  return conta.id
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export async function listarCategoriasResposta(): Promise<CategoriaResposta[]> {
  await requirePermission('central-conversas', 'can_view')
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const { data } = await admin.from('chat_resposta_categorias').select('id, nome, ordem').eq('conta_id', contaId).order('ordem')
  return (data || []).map((c: any) => ({ id: String(c.id), nome: String(c.nome), ordem: Number(c.ordem) || 0 }))
}

export async function salvarCategoriaResposta(input: { id?: string; nome: string; ordem: number }): Promise<{ ok: true }> {
  await requirePermission('central-conversas', 'can_edit')
  const nome = String(input.nome || '').trim()
  if (!nome) throw new Error('Dê um nome à categoria.')
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const row = { conta_id: contaId, nome, ordem: Math.round(Number(input.ordem)) || 0 }
  const { error } = input.id
    ? await admin.from('chat_resposta_categorias').update(row).eq('id', input.id)
    : await admin.from('chat_resposta_categorias').insert(row)
  if (error) throw error.code === '23505' ? new Error('Já existe uma categoria com esse nome.') : error
  revalidatePath('/central-conversas/respostas-rapidas')
  return { ok: true }
}

export async function excluirCategoriaResposta(id: string): Promise<{ ok: true }> {
  await requirePermission('central-conversas', 'can_edit')
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_resposta_categorias').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/central-conversas/respostas-rapidas')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Respostas rápidas
// ---------------------------------------------------------------------------

export async function listarRespostasRapidasAdmin(): Promise<RespostaRapidaRow[]> {
  await requirePermission('central-conversas', 'can_view')
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const [{ data: respostas }, { data: escopos }] = await Promise.all([
    admin
      .from('chat_respostas_rapidas')
      .select('id, nome, atalho, texto, categoria_id, arquivo_url, ativo, categoria:categoria_id(nome)')
      .eq('conta_id', contaId)
      .order('nome'),
    admin.from('chat_resposta_departamentos').select('resposta_id, departamento_id'),
  ])
  const escopoPorResposta = new Map<string, string[]>()
  for (const e of escopos || []) {
    const arr = escopoPorResposta.get(e.resposta_id) || []
    arr.push(e.departamento_id)
    escopoPorResposta.set(e.resposta_id, arr)
  }
  return (respostas || []).map((r: any) => ({
    id: String(r.id),
    nome: String(r.nome),
    atalho: String(r.atalho),
    texto: String(r.texto),
    categoriaId: r.categoria_id ? String(r.categoria_id) : null,
    categoriaNome: r.categoria?.nome || null,
    arquivoPath: r.arquivo_url || null,
    ativo: Boolean(r.ativo),
    departamentoIds: escopoPorResposta.get(r.id) || [],
  }))
}

/**
 * Respostas visíveis pro composer: ativas E (sem departamento vinculado =
 * visível a todos OU o departamento do usuário está no escopo).
 */
export async function listarRespostasVisiveis(departamentoIds: string[]): Promise<RespostaRapidaRow[]> {
  await requirePermission('conversas', 'can_view')
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const [{ data: respostas }, { data: escopos }] = await Promise.all([
    admin
      .from('chat_respostas_rapidas')
      .select('id, nome, atalho, texto, categoria_id, arquivo_url, ativo, categoria:categoria_id(nome)')
      .eq('conta_id', contaId)
      .eq('ativo', true)
      .order('nome'),
    admin.from('chat_resposta_departamentos').select('resposta_id, departamento_id'),
  ])
  const escopoPorResposta = new Map<string, string[]>()
  for (const e of escopos || []) {
    const arr = escopoPorResposta.get(e.resposta_id) || []
    arr.push(e.departamento_id)
    escopoPorResposta.set(e.resposta_id, arr)
  }
  const meusDeptos = new Set(departamentoIds)
  return (respostas || [])
    .map((r: any) => ({
      id: String(r.id),
      nome: String(r.nome),
      atalho: String(r.atalho),
      texto: String(r.texto),
      categoriaId: r.categoria_id ? String(r.categoria_id) : null,
      categoriaNome: r.categoria?.nome || null,
      arquivoPath: r.arquivo_url || null,
      ativo: true,
      departamentoIds: escopoPorResposta.get(r.id) || [],
    }))
    .filter((r) => r.departamentoIds.length === 0 || r.departamentoIds.some((d) => meusDeptos.has(d)))
}

export async function salvarRespostaRapida(input: {
  id?: string
  nome: string
  atalho: string
  texto: string
  categoriaId?: string | null
  arquivoPath?: string | null
  ativo: boolean
  departamentoIds: string[]
}): Promise<{ ok: true; id: string }> {
  const { user } = await requirePermission('central-conversas', input.id ? 'can_edit' : 'can_include')
  const nome = String(input.nome || '').trim()
  const texto = String(input.texto || '').trim()
  let atalho = String(input.atalho || '').trim()
  if (!nome) throw new Error('Dê um nome à resposta.')
  if (!texto) throw new Error('Escreva o texto da resposta.')
  if (!atalho) atalho = `/${nome.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  if (!atalho.startsWith('/')) atalho = `/${atalho}`

  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const row = {
    conta_id: contaId,
    nome,
    atalho,
    texto,
    categoria_id: input.categoriaId || null,
    arquivo_url: input.arquivoPath || null,
    ativo: Boolean(input.ativo),
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }

  let respostaId = input.id || ''
  if (input.id) {
    const { error } = await admin.from('chat_respostas_rapidas').update(row).eq('id', input.id)
    if (error) throw error.code === '23505' ? new Error('Já existe uma resposta com esse atalho.') : error
  } else {
    const { data, error } = await admin.from('chat_respostas_rapidas').insert(row).select('id').single()
    if (error) throw error.code === '23505' ? new Error('Já existe uma resposta com esse atalho.') : error
    respostaId = String(data.id)
  }

  await admin.from('chat_resposta_departamentos').delete().eq('resposta_id', respostaId)
  if (input.departamentoIds.length) {
    const { error } = await admin
      .from('chat_resposta_departamentos')
      .insert(input.departamentoIds.map((departamento_id) => ({ resposta_id: respostaId, departamento_id })))
    if (error) throw error
  }

  revalidatePath('/central-conversas/respostas-rapidas')
  return { ok: true, id: respostaId }
}

export async function excluirRespostaRapida(id: string): Promise<{ ok: true }> {
  await requirePermission('central-conversas', 'can_delete')
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_respostas_rapidas').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/central-conversas/respostas-rapidas')
  return { ok: true }
}

/**
 * Upload do anexo da resposta rápida. Bucket `parceiro-midias` é PRIVADO
 * (mesmo padrão das mídias de campanha do CRM) — gravamos o PATH em
 * `chat_respostas_rapidas.arquivo_url` (nome da coluna já aplicado na
 * migration; guarda o path, não uma URL pública) e assinamos na leitura.
 */
export async function uploadArquivoResposta(formData: FormData): Promise<{ ok: true; path: string }> {
  await requirePermission('central-conversas', 'can_edit')
  const file = formData.get('file')
  if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo acima de 10MB.')
  const admin = await createAdminClient()
  const extBruta = (file.name.split('.').pop() || '').toLowerCase()
  const ext = /^[a-z0-9]{1,8}$/.test(extBruta) ? extBruta : 'bin'
  const path = `respostas-rapidas/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const bytes = await file.arrayBuffer()
  const { error } = await admin.storage.from('parceiro-midias').upload(path, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw error
  return { ok: true, path }
}

/** URL assinada (1h) do anexo, pro composer baixar/enviar ou o admin conferir. */
export async function assinarArquivoResposta(path: string): Promise<string> {
  await requirePermission('conversas', 'can_view')
  if (!path) return ''
  const admin = await createAdminClient()
  const { data } = await admin.storage.from('parceiro-midias').createSignedUrl(path, 60 * 60)
  return data?.signedUrl || ''
}
