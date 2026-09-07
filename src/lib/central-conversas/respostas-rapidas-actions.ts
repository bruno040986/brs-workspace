'use server'

/**
 * Respostas rápidas próprias (Fase B §2 da spec) — a canned response nativa
 * do Chatwoot é só texto; aqui tem categoria, escopo por departamento e
 * anexo. Cadastro: permissão `central-conversas`. Uso no composer: `conversas`.
 */
import { revalidatePath } from 'next/cache'
import { requireCurrentUser, requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { assinaturaDoUsuario, clienteChatwootBrs, contaBrs, meusDepartamentos } from './actions'

// Mesma allowlist do composer (ANEXO_MIMES_PERMITIDOS em actions.ts) — o
// anexo da resposta rápida sai pelo mesmo caminho de envio.
const EXTENSOES_ANEXO = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'ogg', 'opus', 'mp4', 'xlsx', 'csv'])
const MIME_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
}

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
    ? await admin.from('chat_resposta_categorias').update(row).eq('id', input.id).eq('conta_id', contaId)
    : await admin.from('chat_resposta_categorias').insert(row)
  if (error) throw error.code === '23505' ? new Error('Já existe uma categoria com esse nome.') : error
  revalidatePath('/central-conversas/respostas-rapidas')
  return { ok: true }
}

export async function excluirCategoriaResposta(id: string): Promise<{ ok: true }> {
  await requirePermission('central-conversas', 'can_delete')
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_resposta_categorias').delete().eq('id', id).eq('conta_id', contaId)
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
    const { error } = await admin.from('chat_respostas_rapidas').update(row).eq('id', input.id).eq('conta_id', contaId)
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
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const { error } = await admin.from('chat_respostas_rapidas').delete().eq('id', id).eq('conta_id', contaId)
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
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!EXTENSOES_ANEXO.has(ext)) throw new Error('Tipo de arquivo não permitido (aceitos: pdf, png, jpg, webp, mp3, ogg, opus, mp4, xlsx, csv).')
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

/**
 * Envia uma resposta rápida COM anexo na conversa (Fase B §d — "se tiver
 * arquivo, envia como anexo com legenda"): baixa o arquivo do bucket privado
 * e manda pelo mesmo caminho do composer, com o texto assinado como legenda.
 * Respeita o escopo por departamento igual a `listarRespostasVisiveis`.
 */
export async function enviarRespostaRapida(conversationId: number, respostaId: string): Promise<{ id: number }> {
  await requirePermission('conversas', 'can_view')
  const user = await requireCurrentUser()
  const contaId = await contaIdOuErro()
  const admin = await createAdminClient()
  const { data: r } = await admin
    .from('chat_respostas_rapidas')
    .select('id, texto, arquivo_url, ativo')
    .eq('conta_id', contaId)
    .eq('id', respostaId)
    .maybeSingle()
  if (!r || !r.ativo) throw new Error('Resposta rápida não encontrada.')
  if (!r.arquivo_url) throw new Error('Esta resposta rápida não tem anexo.')

  const { data: escopos } = await admin.from('chat_resposta_departamentos').select('departamento_id').eq('resposta_id', respostaId)
  if (escopos?.length) {
    const { departamentos } = await meusDepartamentos()
    const meus = new Set(departamentos.map((d) => d.id))
    if (!escopos.some((e: { departamento_id: string }) => meus.has(e.departamento_id))) throw new Error('Resposta rápida fora do seu departamento.')
  }

  const path = String(r.arquivo_url)
  const { data: blob, error } = await admin.storage.from('parceiro-midias').download(path)
  if (error || !blob) throw new Error('Não foi possível baixar o anexo da resposta rápida.')
  const nome = path.split('/').pop() || 'anexo'
  const ext = (nome.split('.').pop() || '').toLowerCase()
  const mime = MIME_POR_EXTENSAO[ext] || blob.type || 'application/octet-stream'
  const bytes = Buffer.from(await blob.arrayBuffer())

  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  const texto = String(r.texto || '').trim()
  // Mesma convenção de assinatura do composer (`assinar` em actions.ts não
  // pode ser exportada: arquivo 'use server' só exporta async).
  const assinatura = texto ? await assinaturaDoUsuario(user.id) : ''
  const legenda = texto ? (assinatura ? `*${assinatura}:*\n${texto}` : texto) : undefined
  return cli.enviarMensagemComAnexo(conversationId, { nome, mime, bytes }, legenda)
}
