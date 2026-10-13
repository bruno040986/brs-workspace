'use server'

/**
 * Convênio — imagens públicas (PRJ-1/T-21): logotipo e brasão (1:1), bandeira (proporção livre) e galeria.
 * Arquivo vai para o bucket PÚBLICO `convenios-publico` (só service role grava);
 * o banco guarda a URL pública. Entram no snapshot do contrato v1 ao publicar.
 */

import { requirePermission } from '@/lib/auth/server'
import { aparar } from '@/lib/convenios-publico/emblema-imagem'
import { IMAGEM_TIPOS, type ImagemTipo } from '@/lib/convenios-publico/snapshot'
import { admin } from './supabase-admin'

const RESOURCE = 'workspace-convenios'
const BUCKET = 'convenios-publico'
const MAX_BYTES = 2 * 1024 * 1024
const MAX_GALERIA = 12
// Sem SVG (pode carregar script): só bitmap, com assinatura conferida.
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export type ImagemConvenio = { id: string; url: string; legenda: string | null; tipo: ImagemTipo; ordem: number }
type Resultado = { success: boolean; error?: string }

/** Confere a assinatura (magic bytes) do arquivo, não só o mime que o navegador declarou. */
function conteudoConfere(mime: string, b: Buffer): boolean {
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (mime === 'image/webp') return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'
  return false
}

const erroMsg = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Erro inesperado.')

async function lerArquivo(v: FormDataEntryValue | null): Promise<{ bytes: Buffer; mime: string; ext: string } | string> {
  if (!(v instanceof File) || v.size === 0) return 'Selecione uma imagem.'
  if (v.size > MAX_BYTES) return 'Imagem maior que 2 MB.'
  const ext = EXT[v.type]
  if (!ext) return 'Formato não aceito (use PNG, JPEG ou WebP).'
  const bytes = Buffer.from(await v.arrayBuffer())
  if (!conteudoConfere(v.type, bytes)) return 'O arquivo não é uma imagem válida do formato informado.'
  return { bytes, mime: v.type, ext }
}

async function enviarObjeto(convenioId: string, prefixo: string, arq: { bytes: Buffer; mime: string; ext: string }): Promise<string> {
  const path = `${convenioId}/${prefixo}-${crypto.randomUUID()}.${arq.ext}`
  // Nome único por envio: o objeto nunca muda, então o cache longo é seguro.
  const { error } = await admin.storage.from(BUCKET).upload(path, arq.bytes, { contentType: arq.mime, upsert: false, cacheControl: '31536000' })
  if (error) throw error
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Apaga o objeto do bucket a partir da URL pública gravada (URL de fora do bucket é ignorada). */
async function removerObjeto(url: string | null | undefined) {
  const marca = `/storage/v1/object/public/${BUCKET}/`
  const i = url ? url.indexOf(marca) : -1
  if (i < 0) return
  const { error } = await admin.storage.from(BUCKET).remove([decodeURIComponent(url!.slice(i + marca.length))])
  if (error) console.error('Falha ao apagar imagem do bucket:', error)
}

function legendaValida(v: unknown): string | null | Error {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (t.length > 120) return new Error('Legenda passa de 120 caracteres.')
  return t
}

const tipoValido = (v: unknown): v is ImagemTipo => (IMAGEM_TIPOS as readonly string[]).includes(String(v))

export async function listarImagens(
  convenioId: string,
): Promise<{ success: boolean; logotipo_url?: string | null; brasao_url?: string | null; bandeira_url?: string | null; items?: ImagemConvenio[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const [conv, imgs] = await Promise.all([
      admin.from('convenios').select('logotipo_url, brasao_url, bandeira_url').eq('id', convenioId).maybeSingle(),
      admin.from('convenio_imagens').select('id, url, legenda, tipo, ordem').eq('convenio_id', convenioId).order('ordem').order('created_at'),
    ])
    if (conv.error) throw conv.error
    if (imgs.error) throw imgs.error
    if (!conv.data) return { success: false, error: 'Convênio não encontrado.' }
    return { success: true, logotipo_url: conv.data.logotipo_url, brasao_url: conv.data.brasao_url, bandeira_url: conv.data.bandeira_url, items: (imgs.data || []) as ImagemConvenio[] }
  } catch (error) {
    console.error('Erro ao listar imagens do convênio:', error)
    return { success: false, error: erroMsg(error) }
  }
}

/** FormData: convenio_id, arquivo, tipo, legenda. */
export async function enviarImagem(formData: FormData): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const convenioId = String(formData.get('convenio_id') || '').trim()
    const tipo = String(formData.get('tipo') || 'outro')
    const legenda = legendaValida(formData.get('legenda'))
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    if (!tipoValido(tipo)) return { success: false, error: 'Tipo de imagem inválido.' }
    if (legenda instanceof Error) return { success: false, error: legenda.message }

    const { data: conv } = await admin.from('convenios').select('id').eq('id', convenioId).maybeSingle()
    if (!conv) return { success: false, error: 'Convênio não encontrado.' }
    const { data: atuais, error: cErr } = await admin.from('convenio_imagens').select('ordem').eq('convenio_id', convenioId)
    if (cErr) throw cErr
    if ((atuais || []).length >= MAX_GALERIA) return { success: false, error: `A galeria aceita no máximo ${MAX_GALERIA} imagens.` }

    const arq = await lerArquivo(formData.get('arquivo'))
    if (typeof arq === 'string') return { success: false, error: arq }
    const url = await enviarObjeto(convenioId, tipo, arq)
    const ordem = Math.max(-1, ...(atuais || []).map((r) => r.ordem as number)) + 1
    const { error } = await admin.from('convenio_imagens').insert({ convenio_id: convenioId, url, legenda, tipo, ordem, created_by: user.id })
    if (error) {
      await removerObjeto(url)
      throw error
    }
    return { success: true }
  } catch (error) {
    console.error('Erro ao enviar imagem do convênio:', error)
    return { success: false, error: erroMsg(error) }
  }
}

export async function editarImagem(id: string, dados: { legenda: string; tipo: string }): Promise<Resultado> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const legenda = legendaValida(dados.legenda)
    if (legenda instanceof Error) return { success: false, error: legenda.message }
    if (!tipoValido(dados.tipo)) return { success: false, error: 'Tipo de imagem inválido.' }
    const { data, error } = await admin.from('convenio_imagens').update({ legenda, tipo: dados.tipo }).eq('id', id).select('id').maybeSingle()
    if (error) throw error
    if (!data) return { success: false, error: 'Imagem não encontrada.' }
    return { success: true }
  } catch (error) {
    console.error('Erro ao editar imagem do convênio:', error)
    return { success: false, error: erroMsg(error) }
  }
}

export async function removerImagem(id: string): Promise<Resultado> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { data, error } = await admin.from('convenio_imagens').delete().eq('id', id).select('url').maybeSingle()
    if (error) throw error
    if (!data) return { success: false, error: 'Imagem não encontrada.' }
    await removerObjeto(data.url)
    return { success: true }
  } catch (error) {
    console.error('Erro ao remover imagem do convênio:', error)
    return { success: false, error: erroMsg(error) }
  }
}

/** ids na nova ordem; só mexe nas imagens deste convênio. */
export async function reordenarImagens(convenioId: string, ids: string[]): Promise<Resultado> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    if (!convenioId || !Array.isArray(ids) || ids.length > MAX_GALERIA) return { success: false, error: 'Ordem inválida.' }
    const res = await Promise.all(ids.map((id, ordem) => admin.from('convenio_imagens').update({ ordem }).eq('id', id).eq('convenio_id', convenioId)))
    const falha = res.find((r) => r.error)
    if (falha?.error) throw falha.error
    return { success: true }
  } catch (error) {
    console.error('Erro ao reordenar imagens do convênio:', error)
    return { success: false, error: erroMsg(error) }
  }
}

/**
 * Foto da landing (topo e públicos em destaque). FormData: convenio_id, arquivo.
 * Só sobe o arquivo e devolve a URL: quem grava é o rascunho da landing.
 * Remover/trocar no rascunho NÃO apaga do bucket: uma versão publicada pode apontar para ela.
 * ponytail: arquivo trocado vira órfão no bucket; limpar por varredura se o volume importar.
 */
export async function enviarImagemLanding(formData: FormData): Promise<Resultado & { url?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const convenioId = String(formData.get('convenio_id') || '').trim()
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    const { data: conv, error: cErr } = await admin.from('convenios').select('id').eq('id', convenioId).maybeSingle()
    if (cErr) throw cErr
    if (!conv) return { success: false, error: 'Convênio não encontrado.' }
    const arq = await lerArquivo(formData.get('arquivo'))
    if (typeof arq === 'string') return { success: false, error: arq }
    return { success: true, url: await enviarObjeto(convenioId, 'landing', arq) }
  } catch (error) {
    console.error('Erro ao enviar foto da landing:', error)
    return { success: false, error: erroMsg(error) }
  }
}

/** FormData: convenio_id + arquivo (envia/troca) ou remover=1. A imagem anterior é apagada do bucket. */
async function definirMarca(campo: 'logotipo_url' | 'brasao_url' | 'bandeira_url', formData: FormData): Promise<Resultado & { url?: string | null }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const convenioId = String(formData.get('convenio_id') || '').trim()
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    const { data: conv, error: cErr } = await admin.from('convenios').select(campo).eq('id', convenioId).maybeSingle()
    if (cErr) throw cErr
    if (!conv) return { success: false, error: 'Convênio não encontrado.' }
    const anterior = (conv as Record<string, string | null>)[campo]

    let url: string | null = null
    if (formData.get('remover') !== '1') {
      const arq = await lerArquivo(formData.get('arquivo'))
      if (typeof arq === 'string') return { success: false, error: arq }
      // Emblema: apara a margem transparente (galeria e foto da landing ficam como enviadas).
      const { buffer } = await aparar(arq.bytes)
      url = await enviarObjeto(convenioId, campo.replace('_url', ''), { ...arq, bytes: buffer })
    }
    const { error } = await admin.from('convenios').update({ [campo]: url }).eq('id', convenioId)
    if (error) {
      await removerObjeto(url)
      throw error
    }
    if (anterior && anterior !== url) await removerObjeto(anterior)
    return { success: true, url }
  } catch (error) {
    console.error(`Erro ao definir ${campo}:`, error)
    return { success: false, error: erroMsg(error) }
  }
}

export async function definirLogotipo(formData: FormData) {
  return definirMarca('logotipo_url', formData)
}

export async function definirBrasao(formData: FormData) {
  return definirMarca('brasao_url', formData)
}

export async function definirBandeira(formData: FormData) {
  return definirMarca('bandeira_url', formData)
}
