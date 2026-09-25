'use server'

/**
 * Menu Agente Corban › Certificações (fatia 3, 25/09/2026): catálogos de
 * certificadoras, tipos e certificações + painel de vencimentos.
 * Permissão `workspace-certificacoes` (leitura também para quem opera
 * Cadastros Recebidos). Lançamentos por pessoa ficam nas ações do processo
 * (cadastros-recebidos/actions.ts: salvarLancamentoCertificacao).
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAnyPermission, requirePermission } from '@/lib/auth/server'
import { diasParaVencer, hojeIso } from '@/lib/certificacoes'

const RESOURCE = 'workspace-certificacoes'
const RESOURCE_PROCESSO = 'agente-corban-cadastros-recebidos'
const BUCKET_LOGOS = 'certificacoes'
const ROTA = '/agente-corban/certificacoes'

type Resultado<T = Record<string, never>> = ({ success: true } & T) | { success: false; error: string }

export type Certificadora = { id: string; nome: string; site: string | null; logotipo_url: string | null; is_active: boolean }
export type CertificacaoTipo = { id: string; nome: string; obrigatorio: boolean; is_active: boolean }
export type Certificacao = { id: string; certificadora_id: string; nome: string; is_active: boolean; tipo_ids: string[] }

export async function getCatalogoCertificacoes(): Promise<
  Resultado<{ certificadoras: Certificadora[]; tipos: CertificacaoTipo[]; certificacoes: Certificacao[] }>
> {
  try {
    await requireAnyPermission([
      { resource: RESOURCE, action: 'can_view' },
      { resource: RESOURCE_PROCESSO, action: 'can_view' },
    ])
    const admin = await createAdminClient()
    const [cd, ti, ce, vi] = await Promise.all([
      admin.from('certificadoras').select('id,nome,site,logotipo_url,is_active').order('nome'),
      admin.from('certificacao_tipos').select('id,nome,obrigatorio,is_active').order('nome'),
      admin.from('certificacoes').select('id,certificadora_id,nome,is_active').order('nome'),
      admin.from('certificacao_tipo_vinculos').select('certificacao_id,tipo_id'),
    ])
    for (const r of [cd, ti, ce, vi]) if (r.error) throw r.error
    const tiposPorCert = new Map<string, string[]>()
    for (const v of vi.data || []) tiposPorCert.set(v.certificacao_id, [...(tiposPorCert.get(v.certificacao_id) || []), v.tipo_id])
    return {
      success: true,
      certificadoras: (cd.data || []) as Certificadora[],
      tipos: (ti.data || []) as CertificacaoTipo[],
      certificacoes: (ce.data || []).map((c: any) => ({ ...c, tipo_ids: tiposPorCert.get(c.id) || [] })),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function salvarCertificadora(input: { id?: string; nome: string; site?: string | null; is_active?: boolean }): Promise<Resultado<{ id: string }>> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const admin = await createAdminClient()
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da certificadora.')
    const site = String(input.site || '').trim() || null
    if (site && !/^https?:\/\//i.test(site)) throw new Error('O site precisa começar com http(s)://')
    const row = { nome, site, is_active: input.is_active ?? true, updated_at: new Date().toISOString() }
    const q = input.id
      ? admin.from('certificadoras').update(row).eq('id', input.id).select('id').single()
      : admin.from('certificadoras').insert(row).select('id').single()
    const { data, error } = await q
    if (error) throw error
    revalidatePath(ROTA)
    return { success: true, id: data.id }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/** Logotipo (PNG/JPG/SVG/WebP até 2 MB) no bucket público `certificacoes`. */
export async function uploadLogotipoCertificadora(id: string, formData: FormData): Promise<Resultado<{ url: string }>> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(file.type)) throw new Error('Envie PNG, JPG, SVG ou WebP.')
    if (file.size > 2 * 1024 * 1024) throw new Error('Logotipo acima de 2 MB.')
    const safe = String(file.name || 'logo').replace(/[^\w.\-]+/g, '_').slice(0, 60)
    const path = `certificadoras/${id}/${Date.now()}-${safe}`
    const { error: upErr } = await admin.storage.from(BUCKET_LOGOS).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })
    if (upErr) throw upErr
    const { data: pub } = admin.storage.from(BUCKET_LOGOS).getPublicUrl(path)
    const { error } = await admin.from('certificadoras').update({ logotipo_url: pub.publicUrl, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath(ROTA)
    return { success: true, url: pub.publicUrl }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function salvarTipoCertificacao(input: { id?: string; nome: string; obrigatorio: boolean; is_active?: boolean }): Promise<Resultado<{ id: string }>> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const admin = await createAdminClient()
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do tipo.')
    const row = { nome, obrigatorio: Boolean(input.obrigatorio), is_active: input.is_active ?? true, updated_at: new Date().toISOString() }
    const q = input.id
      ? admin.from('certificacao_tipos').update(row).eq('id', input.id).select('id').single()
      : admin.from('certificacao_tipos').insert(row).select('id').single()
    const { data, error } = await q
    if (error) throw error
    revalidatePath(ROTA)
    return { success: true, id: data.id }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function salvarCertificacao(input: {
  id?: string
  certificadora_id: string
  nome: string
  tipo_ids: string[]
  is_active?: boolean
}): Promise<Resultado<{ id: string }>> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const admin = await createAdminClient()
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da certificação.')
    if (!input.certificadora_id) throw new Error('Escolha a certificadora.')
    const tipoIds = Array.from(new Set((input.tipo_ids || []).filter(Boolean)))
    if (tipoIds.length === 0) throw new Error('Marque pelo menos um tipo que esta certificação cobre.')
    const row = { certificadora_id: input.certificadora_id, nome, is_active: input.is_active ?? true, updated_at: new Date().toISOString() }
    const q = input.id
      ? admin.from('certificacoes').update(row).eq('id', input.id).select('id').single()
      : admin.from('certificacoes').insert(row).select('id').single()
    const { data, error } = await q
    if (error) throw error
    const { error: delErr } = await admin.from('certificacao_tipo_vinculos').delete().eq('certificacao_id', data.id)
    if (delErr) throw delErr
    const { error: insErr } = await admin.from('certificacao_tipo_vinculos').insert(tipoIds.map((tipo_id) => ({ certificacao_id: data.id, tipo_id })))
    if (insErr) throw insErr
    revalidatePath(ROTA)
    return { success: true, id: data.id }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export type VencimentoRow = {
  id: string
  cpf: string
  nome: string
  certificacao_nome: string
  certificadora_nome: string
  data_validade: string
  dias: number
  processo_id: string | null
  agente_parceiro_id: string | null
  agente_nome: string | null
}

/** Lançamentos conferidos que vencem em até `dias` (inclui já vencidos). */
export async function listarVencimentos(dias = 60): Promise<Resultado<{ rows: VencimentoRow[] }>> {
  try {
    await requireAnyPermission([
      { resource: RESOURCE, action: 'can_view' },
      { resource: RESOURCE_PROCESSO, action: 'can_view' },
    ])
    const admin = await createAdminClient()
    const limite = new Date()
    limite.setDate(limite.getDate() + Math.max(0, dias))
    const { data, error } = await admin
      .from('pessoa_certificacoes')
      .select('id,cpf,nome,data_validade,processo_id,agente_parceiro_id,certificacao:certificacoes(nome,certificadora:certificadoras(nome)),agente:agentes_parceiros(name)')
      .not('verificado_em', 'is', null)
      .lte('data_validade', hojeIso(limite))
      .order('data_validade', { ascending: true })
    if (error) throw error
    const rows: VencimentoRow[] = (data || []).map((r: any) => {
      const cert = Array.isArray(r.certificacao) ? r.certificacao[0] : r.certificacao
      const cd = cert ? (Array.isArray(cert.certificadora) ? cert.certificadora[0] : cert.certificadora) : null
      const ag = Array.isArray(r.agente) ? r.agente[0] : r.agente
      return {
        id: r.id,
        cpf: r.cpf,
        nome: r.nome,
        certificacao_nome: cert?.nome || '',
        certificadora_nome: cd?.nome || '',
        data_validade: r.data_validade,
        dias: diasParaVencer(r.data_validade),
        processo_id: r.processo_id,
        agente_parceiro_id: r.agente_parceiro_id,
        agente_nome: ag?.name || null,
      }
    })
    return { success: true, rows }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
