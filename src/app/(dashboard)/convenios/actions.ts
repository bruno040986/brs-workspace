'use server'

/**
 * Convênios — subsistema isolado (permissão workspace-convenios).
 * Cadastro básico hoje; evolui para a Base de Conhecimento de Convênios
 * (estrutura em construção pela equipe) sem carregar o comissionamento junto.
 */

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { normalizarUrl } from '@/lib/url-site'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const PERMISSION_RESOURCE = 'workspace-convenios'

export type ConvenioRecord = {
  id?: string
  nome: string
  nome_reduzido: string
  codigo?: string | null // Código ARW — opcional, só usado pelo importador de comissionamento
  codigo_sistema?: string // gerado pelo banco, não editável
  tipo_convenio_id?: string | null // obrigatório; a esfera deriva dele
  esfera?: string // derivado do tipo — não é mais digitado
  cnpj?: string | null
  razao_social?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
  endereco?: string | null
  numero_servidores?: number | null
  abrangencia?: string // municipal | estadual | nacional — Dados Básicos; sugerido pela esfera do tipo
  averbadora_id?: string | null
  averbadora_nome?: string // derivado, só leitura
  site_averbador?: string | null
  tipo_autenticacao_id?: string | null
  is_active?: boolean
}

const CONVENIO_SELECT =
  'id, nome, nome_reduzido, codigo, codigo_sistema, esfera, tipo_convenio_id, cnpj, razao_social, cidade, uf, cep, endereco, numero_servidores, abrangencia, max_comprometimento_salarial, prazo_minimo_geral, prazo_maximo_geral, bc_observacoes, averbadora_id, site_averbador, tipo_autenticacao_id, is_active, created_at, tipo:tipo_convenio_id(nome, esfera:esfera_id(nome)), averbadora:averbadora_id(nome)'

function mapConvenioRow(r: any) {
  return {
    ...r,
    tipo_convenio_nome: r.tipo?.nome || '',
    // esfera efetiva: deriva do tipo; cai no texto legado se ainda sem tipo
    esfera: r.tipo?.esfera?.nome || r.esfera || '',
    averbadora_nome: r.averbadora?.nome || '',
  }
}

export async function getConvenios() {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select(CONVENIO_SELECT)
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('nome', { ascending: true })
    if (error) throw error

    const ids = (data || []).map((r: any) => r.id)
    const [{ data: pubRows }, { data: formaRows }, { data: instRows }] = await Promise.all([
      ids.length ? supabaseAdmin.from('convenio_publicos').select('convenio_id').in('convenio_id', ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? supabaseAdmin.from('convenio_formas_contrato').select('convenio_id').in('convenio_id', ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? supabaseAdmin.from('convenio_instituicoes').select('convenio_id').in('convenio_id', ids) : Promise.resolve({ data: [] as any[] }),
    ])
    const setPub = new Set((pubRows || []).map((r: any) => r.convenio_id))
    const setForma = new Set((formaRows || []).map((r: any) => r.convenio_id))
    const setInst = new Set((instRows || []).map((r: any) => r.convenio_id))

    const items = (data || []).map((r: any) => {
      const temGeral = r.max_comprometimento_salarial != null || r.prazo_minimo_geral != null || r.prazo_maximo_geral != null
      const bc_score =
        (setPub.has(r.id) ? 25 : 0) + (setForma.has(r.id) ? 25 : 0) + (setInst.has(r.id) ? 25 : 0) + (temGeral ? 25 : 0)
      return { ...mapConvenioRow(r), bc_score }
    })
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao buscar convênios:', error)
    return { success: false, error: error.message }
  }
}

export async function getConvenio(id: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!id) return { success: false, error: 'ID inválido.' }
    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select(CONVENIO_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw error
    if (!data) return { success: false, error: 'Convênio não encontrado.' }
    return { success: true, item: mapConvenioRow(data) }
  } catch (error: any) {
    console.error('Erro ao buscar convênio:', error)
    return { success: false, error: error.message }
  }
}

function onlyDigitsOrNull(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '')
  return digits || null
}

export async function saveConvenio(payload: ConvenioRecord) {
  try {
    await requirePermission(PERMISSION_RESOURCE, payload.id ? 'can_edit' : 'can_include')

    const nome = String(payload.nome || '').trim()
    if (!nome) return { success: false, error: 'O nome do convênio é obrigatório.' }

    const nomeReduzido = String(payload.nome_reduzido || '').trim()
    if (!nomeReduzido) return { success: false, error: 'O nome reduzido é obrigatório.' }

    const tipoConvenioId = String(payload.tipo_convenio_id || '').trim()
    if (!tipoConvenioId) return { success: false, error: 'O tipo de convênio é obrigatório.' }

    // Esfera deriva do tipo (guardada também no texto legado para retrocompat).
    const { data: tipoRow, error: tipoErr } = await supabaseAdmin
      .from('convenio_tipos')
      .select('id, esfera:esfera_id(nome)')
      .eq('id', tipoConvenioId)
      .maybeSingle()
    if (tipoErr) throw tipoErr
    if (!tipoRow) return { success: false, error: 'Tipo de convênio inválido.' }
    const esfera = String((tipoRow as any).esfera?.nome || '').toLowerCase()

    // Vínculo com averbadora só faz sentido junto da averbadora escolhida —
    // sem averbadora_id, site/tipo de autenticação não têm a quem se referir.
    const averbadoraId = String(payload.averbadora_id || '').trim() || null
    let siteAverbador: string | null = null
    let tipoAutenticacaoId: string | null = null
    if (averbadoraId) {
      const siteBruto = String(payload.site_averbador || '').trim()
      // site_averbador é texto livre e pode REPETIR entre convênios (subdomínio
      // próprio ou URL compartilhada) — só normaliza o formato, nunca valida unicidade.
      siteAverbador = siteBruto ? normalizarUrl(siteBruto) : null
      tipoAutenticacaoId = String(payload.tipo_autenticacao_id || '').trim() || null
    }

    const abrangencia = String(payload.abrangencia || 'nacional').trim()
    if (!['municipal', 'estadual', 'nacional'].includes(abrangencia)) {
      return { success: false, error: 'Abrangência inválida.' }
    }

    const numeroServidores =
      payload.numero_servidores === null || payload.numero_servidores === undefined || (payload.numero_servidores as any) === ''
        ? null
        : Number(payload.numero_servidores)
    if (numeroServidores !== null && (!Number.isFinite(numeroServidores) || numeroServidores < 0)) {
      return { success: false, error: 'Número de servidores inválido.' }
    }

    const row = {
      nome,
      nome_reduzido: nomeReduzido,
      codigo: String(payload.codigo || '').trim() || null,
      tipo_convenio_id: tipoConvenioId,
      esfera,
      cnpj: onlyDigitsOrNull(payload.cnpj),
      razao_social: String(payload.razao_social || '').trim() || null,
      cidade: String(payload.cidade || '').trim() || null,
      uf: String(payload.uf || '').trim().toUpperCase().slice(0, 2) || null,
      cep: onlyDigitsOrNull(payload.cep),
      endereco: String(payload.endereco || '').trim() || null,
      numero_servidores: numeroServidores,
      abrangencia,
      averbadora_id: averbadoraId,
      site_averbador: siteAverbador,
      tipo_autenticacao_id: tipoAutenticacaoId,
      updated_at: new Date().toISOString(),
    }

    let id = payload.id
    if (payload.id) {
      const { error } = await supabaseAdmin.from('convenios').update(row).eq('id', payload.id)
      if (error) throw error
    } else {
      const { data, error } = await supabaseAdmin.from('convenios').insert(row).select('id').single()
      if (error) throw error
      id = data?.id
    }

    revalidatePath('/convenios')
    if (id) revalidatePath(`/convenios/${id}`)
    return { success: true, id }
  } catch (error: any) {
    console.error('Erro ao salvar convênio:', error)
    if ((error as any)?.code === '23505') {
      return { success: false, error: 'Já existe um convênio com esse nome ou código.' }
    }
    return { success: false, error: error.message }
  }
}

export async function setConvenioStatus(id: string, isActive: boolean) {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_activate_inactivate')
    if (!id) return { success: false, error: 'ID inválido.' }

    const { error } = await supabaseAdmin
      .from('convenios')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error

    revalidatePath('/convenios')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do convênio:', error)
    return { success: false, error: error.message }
  }
}
