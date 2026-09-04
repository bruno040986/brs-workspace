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
  formato_id: string | null
  formato_rotulo?: string
  tipo_convenio_id: string | null
  tipo_convenio_nome?: string
  associacao_ids: string[]
  destinos?: Array<{ grupo: string; categoria: string; formato: string }>
  // legados (retrocompat — não usar como fonte da verdade)
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
      .select(`*, convenio:convenio_id(nome_reduzido), formato:formato_id(rotulo),
        tipo:tipo_convenio_id(nome),
        assocs:marketing_arte_associacoes(associacao_id,
          associacao:associacao_id(grupo:grupo_id(nome), categoria:categoria_id(nome), formato:formato_id(rotulo)))`)
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) throw error
    const rows = await Promise.all(
      (data || []).map(async (r: any) => ({
        ...r,
        convenio_nome: r.convenio?.nome_reduzido || '',
        formato_rotulo: r.formato?.rotulo || '',
        tipo_convenio_nome: r.tipo?.nome || '',
        associacao_ids: (r.assocs || []).map((a: any) => a.associacao_id),
        destinos: (r.assocs || []).map((a: any) => ({
          grupo: a.associacao?.grupo?.nome || '',
          categoria: a.associacao?.categoria?.nome || '',
          formato: a.associacao?.formato?.rotulo || '',
        })),
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
      .select(`*, convenio:convenio_id(nome_reduzido), formato:formato_id(rotulo),
        tipo:tipo_convenio_id(nome),
        assocs:marketing_arte_associacoes(associacao_id,
          associacao:associacao_id(grupo:grupo_id(nome), categoria:categoria_id(nome), formato:formato_id(rotulo)))`)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Arte não encontrada.')
    const r = data as any
    return {
      success: true,
      data: {
        ...r,
        convenio_nome: r.convenio?.nome_reduzido || '',
        formato_rotulo: r.formato?.rotulo || '',
        tipo_convenio_nome: r.tipo?.nome || '',
        associacao_ids: (r.assocs || []).map((a: any) => a.associacao_id),
        destinos: (r.assocs || []).map((a: any) => ({
          grupo: a.associacao?.grupo?.nome || '',
          categoria: a.associacao?.categoria?.nome || '',
          formato: a.associacao?.formato?.rotulo || '',
        })),
        imagem_signed_url: await signImagem(admin, r.imagem_url),
        elementos: Array.isArray(r.elementos) ? r.elementos : [],
      } as MarketingArte,
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export type ArteLookups = {
  convenios: Array<{ id: string; nome: string; tipo_convenio_id: string | null }>
  tipos: Array<{ id: string; nome: string; esfera_nome: string }>
  formatos: Array<{ id: string; rotulo: string; largura_px: number; altura_px: number }>
  associacoes: Array<{
    id: string
    grupo_id: string
    categoria_id: string
    formato_id: string
    grupo_nome: string
    categoria_nome: string
    formato_rotulo: string
    largura_px: number
    altura_px: number
  }>
}

export async function getArteLookups(): Promise<ArteLookups> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const [{ data: conv }, { data: tipos }, { data: fmts }, { data: assocs }] = await Promise.all([
      admin.from('convenios').select('id, nome_reduzido, tipo_convenio_id').eq('is_active', true).is('deleted_at', null).order('nome_reduzido'),
      admin.from('convenio_tipos').select('id, nome, esfera:esfera_id(nome)').eq('is_active', true).order('nome'),
      admin.from('marketing_formatos').select('id, rotulo, largura_px, altura_px').eq('is_active', true).order('rotulo'),
      admin
        .from('marketing_associacoes')
        .select('id, grupo_id, categoria_id, formato_id, grupo:grupo_id(nome), categoria:categoria_id(nome), formato:formato_id(rotulo, largura_px, altura_px)')
        .eq('is_active', true),
    ])
    return {
      convenios: (conv || []).map((c: any) => ({ id: String(c.id), nome: String(c.nome_reduzido || ''), tipo_convenio_id: c.tipo_convenio_id || null })),
      tipos: (tipos || []).map((t: any) => ({ id: String(t.id), nome: String(t.nome || ''), esfera_nome: t.esfera?.nome || '' })),
      formatos: (fmts || []).map((f: any) => ({ id: String(f.id), rotulo: String(f.rotulo || ''), largura_px: Number(f.largura_px), altura_px: Number(f.altura_px) })),
      associacoes: (assocs || []).map((a: any) => ({
        id: String(a.id),
        grupo_id: a.grupo_id,
        categoria_id: a.categoria_id,
        formato_id: a.formato_id,
        grupo_nome: a.grupo?.nome || '',
        categoria_nome: a.categoria?.nome || '',
        formato_rotulo: a.formato?.rotulo || '',
        largura_px: Number(a.formato?.largura_px) || 0,
        altura_px: Number(a.formato?.altura_px) || 0,
      })),
    }
  } catch {
    return { convenios: [], tipos: [], formatos: [], associacoes: [] }
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
  formato_id?: string | null
  tipo_convenio_id?: string | null
  associacao_ids?: string[]
  elementos: ArteElemento[]
  is_active?: boolean
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    if (!input.nome?.trim()) throw new Error('Dê um nome à arte.')
    if (!input.imagem_url) throw new Error('Envie a imagem-base.')
    if (!input.largura_px || !input.altura_px) throw new Error('Dimensões da imagem inválidas.')
    const admin = await createAdminClient()

    const associacaoIds = [...new Set((input.associacao_ids || []).filter(Boolean))]
    let formatoId = input.formato_id || null

    // Coerência: os destinos escolhidos têm de ser todos do mesmo formato, e
    // esse formato deve bater com o formato_id (a dimensão da arte).
    if (associacaoIds.length > 0) {
      const { data: assocs, error: assocErr } = await admin
        .from('marketing_associacoes')
        .select('id, formato_id')
        .in('id', associacaoIds)
      if (assocErr) throw assocErr
      const formatosDistintos = [...new Set((assocs || []).map((a: any) => a.formato_id))]
      if (formatosDistintos.length > 1) throw new Error('Os destinos escolhidos têm formatos diferentes. Selecione destinos de um único formato (a dimensão da arte).')
      if (formatosDistintos.length === 1) {
        if (formatoId && formatoId !== formatosDistintos[0]) throw new Error('O formato da arte não bate com os destinos escolhidos.')
        formatoId = formatosDistintos[0] as string
      }
    }

    const row = {
      nome: input.nome.trim(),
      descricao: String(input.descricao || '').trim(),
      imagem_url: input.imagem_url,
      largura_px: Math.round(input.largura_px),
      altura_px: Math.round(input.altura_px),
      convenio_id: input.convenio_id || null,
      formato_id: formatoId,
      tipo_convenio_id: input.tipo_convenio_id || null,
      elementos: input.elementos || [],
      is_active: input.is_active !== false,
      updated_at: new Date().toISOString(),
    }

    let arteId = input.id || ''
    if (input.id) {
      const { error } = await admin.from('marketing_artes').update(row).eq('id', input.id)
      if (error) throw error
    } else {
      const { data, error } = await admin.from('marketing_artes').insert({ ...row, created_by: user.id }).select('id').single()
      if (error) throw error
      arteId = String(data.id)
    }

    // Substitui os destinos (ponte arte↔associação).
    await admin.from('marketing_arte_associacoes').delete().eq('arte_id', arteId)
    if (associacaoIds.length > 0) {
      const { error: linkErr } = await admin
        .from('marketing_arte_associacoes')
        .insert(associacaoIds.map((associacao_id) => ({ arte_id: arteId, associacao_id })))
      if (linkErr) throw linkErr
    }

    revalidatePath('/marketing/artes')
    return { success: true, id: arteId }
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
