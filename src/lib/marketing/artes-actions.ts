'use server'

/**
 * Biblioteca de Artes de Marketing — server actions do lado STAFF (cadastro
 * das artes-base com elementos posicionados). Permissão:
 * `marketing-biblioteca-artes`. A geração da arte personalizada pelo parceiro
 * é do Portal Parceiro (outro repo).
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'

const RESOURCE = 'marketing-biblioteca-artes'
const BUCKET = 'marketing-templates'

export type ArteElemento = {
  id: string
  tipo: 'logo' | 'texto' | 'foto' | 'whatsapp'
  x: number
  y: number
  w: number
  h: number
  proporcao?: string
  maxChars?: number
  fonte?: string
  cor?: string
  alinhamento?: 'left' | 'center' | 'right'
  modoPermitido?: Array<'texto' | 'qrcode'>
  rotulo?: string
}

export type MarketingArte = {
  id: string
  nome: string
  descricao: string
  imagem_url: string
  imagem_signed_url?: string
  largura_px: number
  altura_px: number
  convenio_id: string | null
  convenio_nome?: string
  categoria: string
  formato: string
  grupo_nome: string | null
  elementos: ArteElemento[]
  is_active: boolean
  created_at: string
}

async function signImagem(admin: Awaited<ReturnType<typeof createAdminClient>>, path: string): Promise<string> {
  if (!path) return ''
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  return data?.signedUrl || ''
}

export async function listarArtes(): Promise<{ success: boolean; data?: MarketingArte[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('marketing_artes')
      .select('*, convenio:convenio_id(nome_reduzido)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) throw error
    const rows = await Promise.all(
      (data || []).map(async (r: any) => ({
        ...r,
        convenio_nome: r.convenio?.nome_reduzido || '',
        imagem_signed_url: await signImagem(admin, r.imagem_url),
        elementos: Array.isArray(r.elementos) ? r.elementos : [],
      })),
    )
    return { success: true, data: rows as MarketingArte[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getArte(id: string): Promise<{ success: boolean; data?: MarketingArte; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('marketing_artes')
      .select('*, convenio:convenio_id(nome_reduzido)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Arte não encontrada.')
    return {
      success: true,
      data: {
        ...(data as any),
        convenio_nome: (data as any).convenio?.nome_reduzido || '',
        imagem_signed_url: await signImagem(admin, (data as any).imagem_url),
        elementos: Array.isArray((data as any).elementos) ? (data as any).elementos : [],
      } as MarketingArte,
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getArteLookups(): Promise<{ convenios: Array<{ id: string; nome: string }> }> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data } = await admin
      .from('convenios')
      .select('id, nome_reduzido')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome_reduzido')
    return { convenios: (data || []).map((c: any) => ({ id: String(c.id), nome: String(c.nome_reduzido || '') })) }
  } catch {
    return { convenios: [] }
  }
}

/** Upload da imagem-base (bucket privado). Retorna path + dimensões informadas. */
export async function uploadImagemBase(formData: FormData): Promise<{ success: true; path: string } | { success: false; error: string }> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
    if (file.size > 15 * 1024 * 1024) throw new Error('Imagem acima de 15MB.')
    const extBruta = (file.name.split('.').pop() || '').toLowerCase()
    const ext = /^[a-z0-9]{1,5}$/.test(extBruta) ? extBruta : 'png'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const bytes = await file.arrayBuffer()
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || 'image/png',
      upsert: false,
    })
    if (error) throw error
    return { success: true, path }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** URL assinada temporária para prévia da imagem-base. */
export async function assinarImagemBase(path: string): Promise<string> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    return await signImagem(admin, path)
  } catch {
    return ''
  }
}

export async function salvarArte(input: {
  id?: string
  nome: string
  descricao?: string
  imagem_url: string
  largura_px: number
  altura_px: number
  convenio_id?: string | null
  categoria?: string
  formato?: string
  grupo_nome?: string | null
  elementos: ArteElemento[]
  is_active?: boolean
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    if (!input.nome?.trim()) throw new Error('Dê um nome à arte.')
    if (!input.imagem_url) throw new Error('Envie a imagem-base.')
    if (!input.largura_px || !input.altura_px) throw new Error('Dimensões da imagem inválidas.')
    const admin = await createAdminClient()
    const row = {
      nome: input.nome.trim(),
      descricao: String(input.descricao || '').trim(),
      imagem_url: input.imagem_url,
      largura_px: Math.round(input.largura_px),
      altura_px: Math.round(input.altura_px),
      convenio_id: input.convenio_id || null,
      categoria: String(input.categoria || '').trim(),
      formato: String(input.formato || '').trim(),
      grupo_nome: input.grupo_nome?.trim() || null,
      elementos: input.elementos || [],
      is_active: input.is_active !== false,
      updated_at: new Date().toISOString(),
    }
    if (input.id) {
      const { error } = await admin.from('marketing_artes').update(row).eq('id', input.id)
      if (error) throw error
      revalidatePath('/marketing/artes')
      return { success: true, id: input.id }
    }
    const { data, error } = await admin.from('marketing_artes').insert({ ...row, created_by: user.id }).select('id').single()
    if (error) throw error
    revalidatePath('/marketing/artes')
    return { success: true, id: String(data.id) }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setArteStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { error } = await admin.from('marketing_artes').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/marketing/artes')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
