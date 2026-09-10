'use server'

/**
 * Convênios — cadastros de apoio: Esfera e Tipo de Convênio.
 * Cadeia: Esfera → Tipo de Convênio (tem esfera obrigatória) → Convênio (tem
 * tipo; a esfera do convênio deriva do tipo). Permissão: `workspace-convenios`.
 */
import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESOURCE = 'workspace-convenios'

export type Esfera = { id: string; nome: string; is_active: boolean }
export type TipoConvenio = { id: string; nome: string; esfera_id: string; is_active: boolean; esfera_nome?: string }

// ---------------- Esferas ----------------
export async function getEsferas(): Promise<{ success: boolean; items?: Esfera[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin.from('convenio_esferas').select('id, nome, is_active').order('is_active', { ascending: false }).order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as Esfera[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarEsfera(input: { id?: string; nome: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome da esfera.')
    const row = { nome, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('convenio_esferas').update(row).eq('id', input.id)
      : await admin.from('convenio_esferas').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe uma esfera com esse nome.') : error
    revalidatePath('/convenios/esferas')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setEsferaStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('convenio_esferas').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/esferas')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------- Tipos de Convênio ----------------
export async function getTiposConvenio(): Promise<{ success: boolean; items?: TipoConvenio[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('convenio_tipos')
      .select('id, nome, esfera_id, is_active, esfera:esfera_id(nome)')
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []).map((r: any) => ({ id: r.id, nome: r.nome, esfera_id: r.esfera_id, is_active: r.is_active, esfera_nome: r.esfera?.nome || '' })) as TipoConvenio[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function salvarTipoConvenio(input: { id?: string; nome: string; esfera_id: string }): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do tipo de convênio.')
    if (!input.esfera_id) throw new Error('A esfera é obrigatória no tipo de convênio.')
    const row = { nome, esfera_id: input.esfera_id, updated_at: new Date().toISOString() }
    const { error } = input.id
      ? await admin.from('convenio_tipos').update(row).eq('id', input.id)
      : await admin.from('convenio_tipos').insert(row)
    if (error) throw error.code === '23505' ? new Error('Já existe um tipo com esse nome.') : error
    revalidatePath('/convenios/tipos')
    revalidatePath('/convenios')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setTipoConvenioStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('convenio_tipos').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/tipos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ---------------- Lookups ativos (dropdowns) ----------------
export async function getEsferasAtivas(): Promise<Esfera[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin.from('convenio_esferas').select('id, nome, is_active').eq('is_active', true).order('nome')
    return (data || []) as Esfera[]
  } catch {
    return []
  }
}

export async function getTiposAtivos(): Promise<TipoConvenio[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('convenio_tipos')
      .select('id, nome, esfera_id, is_active, esfera:esfera_id(nome)')
      .eq('is_active', true)
      .order('nome')
    return (data || []).map((r: any) => ({ id: r.id, nome: r.nome, esfera_id: r.esfera_id, is_active: r.is_active, esfera_nome: r.esfera?.nome || '' })) as TipoConvenio[]
  } catch {
    return []
  }
}

// ============================================================================
// Públicos Atendidos — cadastro global (Convênio Base de Conhecimento §2.2)
// Sem vínculo a esfera/tipo: Aposentado, Pensionista e Efetivo, por exemplo,
// aparecem em praticamente todos os convênios. Situação funcional, regime
// jurídico e tipo de provimento são texto livre com sugestão (datalist).
// ============================================================================
export type PublicoAtendido = {
  id: string
  nome: string
  situacao_funcional: string | null
  regime_juridico: string | null
  tipo_provimento: string | null
  descricao: string | null
  is_active: boolean
}

export async function getPublicos(): Promise<{ success: boolean; items?: PublicoAtendido[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('publicos_atendidos')
      .select('id, nome, situacao_funcional, regime_juridico, tipo_provimento, descricao, is_active')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome')
    if (error) throw error
    return { success: true, items: (data || []) as PublicoAtendido[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getPublicosAtivos(): Promise<PublicoAtendido[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('publicos_atendidos')
      .select('id, nome, situacao_funcional, regime_juridico, tipo_provimento, descricao, is_active')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome')
    return (data || []) as PublicoAtendido[]
  } catch {
    return []
  }
}

// Sugestões (datalist) dos 3 campos classificatórios, a partir do que já foi
// digitado — evita grafias divergentes sem virar um cadastro à parte.
export async function getPublicosSugestoes(): Promise<{ situacoes: string[]; regimes: string[]; provimentos: string[] }> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('publicos_atendidos')
      .select('situacao_funcional, regime_juridico, tipo_provimento')
      .is('deleted_at', null)
    const uniq = (values: (string | null)[]) => [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))].sort()
    return {
      situacoes: uniq((data || []).map((r: any) => r.situacao_funcional)),
      regimes: uniq((data || []).map((r: any) => r.regime_juridico)),
      provimentos: uniq((data || []).map((r: any) => r.tipo_provimento)),
    }
  } catch {
    return { situacoes: [], regimes: [], provimentos: [] }
  }
}

export async function salvarPublico(input: {
  id?: string
  nome: string
  situacao_funcional?: string | null
  regime_juridico?: string | null
  tipo_provimento?: string | null
  descricao?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do público.')
    const row = {
      nome,
      situacao_funcional: String(input.situacao_funcional || '').trim() || null,
      regime_juridico: String(input.regime_juridico || '').trim() || null,
      tipo_provimento: String(input.tipo_provimento || '').trim() || null,
      descricao: String(input.descricao || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = input.id
      ? await admin.from('publicos_atendidos').update(row).eq('id', input.id)
      : await admin.from('publicos_atendidos').insert(row)
    if (error) throw (error as any).code === '23505' ? new Error('Já existe um público com esse nome.') : error
    revalidatePath('/convenios/publicos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setPublicoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('publicos_atendidos').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/publicos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ============================================================================
// Órgãos / Empregadores — "sub-convênio" de exceção (§2.8). Só se cadastra o
// que aparece numa restrição de vínculo Convênio×IF (ex.: Embrapa dentro do
// SIAPE) — nunca a lista completa de órgãos de um convênio nacional.
// ============================================================================
export type OrgaoEmpregador = {
  id: string
  convenio_id: string
  convenio_nome?: string
  nome: string
  cnpj: string | null
  observacao: string | null
  is_active: boolean
}

export async function getOrgaos(convenioId?: string): Promise<{ success: boolean; items?: OrgaoEmpregador[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    let query = admin
      .from('orgaos_empregadores')
      .select('id, convenio_id, nome, cnpj, observacao, is_active, convenio:convenio_id(nome)')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome')
    if (convenioId) query = query.eq('convenio_id', convenioId)
    const { data, error } = await query
    if (error) throw error
    return {
      success: true,
      items: (data || []).map((r: any) => ({ ...r, convenio_nome: r.convenio?.nome || '' })) as OrgaoEmpregador[],
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getOrgaosAtivos(convenioId: string): Promise<OrgaoEmpregador[]> {
  try {
    await requirePermission(RESOURCE)
    const { data } = await admin
      .from('orgaos_empregadores')
      .select('id, convenio_id, nome, cnpj, observacao, is_active')
      .eq('convenio_id', convenioId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome')
    return (data || []) as OrgaoEmpregador[]
  } catch {
    return []
  }
}

export async function salvarOrgao(input: {
  id?: string
  convenio_id: string
  nome: string
  cnpj?: string | null
  observacao?: string | null
}): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    await requirePermission(RESOURCE, input.id ? 'can_edit' : 'can_include')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Informe o nome do órgão.')
    if (!input.convenio_id) throw new Error('O convênio-pai é obrigatório.')
    const cnpjDigits = String(input.cnpj || '').replace(/\D/g, '')
    if (cnpjDigits && cnpjDigits.length !== 14) throw new Error('CNPJ inválido — informe 14 dígitos ou deixe em branco.')
    const row = {
      convenio_id: input.convenio_id,
      nome,
      cnpj: cnpjDigits || null,
      observacao: String(input.observacao || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (input.id) {
      const { error } = await admin.from('orgaos_empregadores').update(row).eq('id', input.id)
      if (error) throw (error as any).code === '23505' ? new Error('Já existe um órgão com esse nome para este convênio.') : error
      revalidatePath('/convenios/orgaos')
      return { success: true, id: input.id }
    }
    const { data, error } = await admin.from('orgaos_empregadores').insert(row).select('id').single()
    if (error) throw (error as any).code === '23505' ? new Error('Já existe um órgão com esse nome para este convênio.') : error
    revalidatePath('/convenios/orgaos')
    return { success: true, id: data?.id }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setOrgaoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { error } = await admin.from('orgaos_empregadores').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    revalidatePath('/convenios/orgaos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
