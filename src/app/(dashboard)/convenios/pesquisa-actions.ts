'use server'

/**
 * Convênio — Base de Conhecimento, Fase 3 (Jarvis pesquisador).
 * Ações de revisão humana: confirmar/descartar fonte, aceitar/rejeitar
 * sugestão, ler um documento já anexado, histórico. Iniciar/avançar a
 * pesquisa em si são rotas (`/api/convenios/[id]/pesquisa[...]`), não
 * server actions — precisam de `maxDuration` próprio.
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { admin } from './supabase-admin'
import { aplicarSugestao } from '@/lib/convenios/pesquisa/aplicar-sugestao'

const RESOURCE = 'workspace-convenios'

export async function confirmarFonte(fonteId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const { data: fonte, error: fetchErr } = await admin.from('convenio_pesquisa_fontes').select('id, pesquisa_id, convenio_id, status').eq('id', fonteId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!fonte) return { success: false, error: 'Fonte não encontrada.' }
    if (fonte.status !== 'nao_verificada') return { success: false, error: 'Só é possível confirmar uma fonte marcada como "não verificada".' }

    const { error } = await admin
      .from('convenio_pesquisa_fontes')
      .update({ confirmada_por: user.id, confirmada_em: new Date().toISOString() })
      .eq('id', fonteId)
    if (error) throw error

    // se a pesquisa já tinha concluído sem essa fonte (ela ficou "não
    // verificada" e ninguém confirmou a tempo), reabre pra extração pegá-la.
    await admin.from('convenio_pesquisas').update({ status: 'extraindo', etapa_msg: 'Analisando fonte confirmada...' }).eq('id', fonte.pesquisa_id).eq('status', 'concluida')

    revalidatePath(`/convenios/${fonte.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao confirmar fonte:', error)
    return { success: false, error: error.message }
  }
}

export async function descartarFonte(fonteId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { data: fonte, error: fetchErr } = await admin.from('convenio_pesquisa_fontes').select('convenio_id').eq('id', fonteId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!fonte) return { success: false, error: 'Fonte não encontrada.' }

    const { error } = await admin.from('convenio_pesquisa_fontes').update({ status: 'descartada' }).eq('id', fonteId)
    if (error) throw error

    revalidatePath(`/convenios/${fonte.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao descartar fonte:', error)
    return { success: false, error: error.message }
  }
}

export async function aceitarSugestao(sugestaoId: string, valorEditado?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const { data: sugestao } = await admin.from('convenio_bc_sugestoes').select('convenio_id').eq('id', sugestaoId).maybeSingle()
    const resultado = await aplicarSugestao(sugestaoId, user.id, valorEditado)
    if (!resultado.success) return resultado
    if (sugestao?.convenio_id) {
      revalidatePath(`/convenios/${sugestao.convenio_id}`)
      revalidatePath('/convenios')
    }
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao aceitar sugestão:', error)
    return { success: false, error: error.message }
  }
}

export async function rejeitarSugestao(sugestaoId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const { data: sugestao, error: fetchErr } = await admin.from('convenio_bc_sugestoes').select('convenio_id, status').eq('id', sugestaoId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!sugestao) return { success: false, error: 'Sugestão não encontrada.' }
    if (sugestao.status !== 'pendente') return { success: false, error: 'Esta sugestão já foi decidida.' }

    const { error } = await admin
      .from('convenio_bc_sugestoes')
      .update({ status: 'rejeitada', decidido_por: user.id, decidido_em: new Date().toISOString() })
      .eq('id', sugestaoId)
    if (error) throw error

    revalidatePath(`/convenios/${sugestao.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao rejeitar sugestão:', error)
    return { success: false, error: error.message }
  }
}

export async function aceitarTodasDaFonte(fonteId: string): Promise<{ success: boolean; error?: string; aplicadas?: number; falhas?: string[] }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const { data: sugestoes, error } = await admin
      .from('convenio_bc_sugestoes')
      .select('id, convenio_id, secao, campo')
      .eq('fonte_id', fonteId)
      .eq('status', 'pendente')
    if (error) throw error

    let aplicadas = 0
    const falhas: string[] = []
    for (const s of sugestoes || []) {
      // campo "?" (forma/público sem correspondência) precisa de escolha humana — pula no "aceitar todas".
      if (s.campo.endsWith(':?')) {
        falhas.push(`Uma sugestão de "${s.secao}" precisa que você escolha a correspondência antes de aceitar.`)
        continue
      }
      const resultado = await aplicarSugestao(s.id, user.id)
      if (resultado.success) aplicadas++
      else falhas.push(resultado.error)
    }

    const convenioId = sugestoes?.[0]?.convenio_id
    if (convenioId) {
      revalidatePath(`/convenios/${convenioId}`)
      revalidatePath('/convenios')
    }
    return { success: true, aplicadas, falhas }
  } catch (error: any) {
    console.error('Erro ao aceitar todas as sugestões da fonte:', error)
    return { success: false, error: error.message }
  }
}

export async function cancelarPesquisa(pesquisaId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const { data: pesquisa, error: fetchErr } = await admin.from('convenio_pesquisas').select('convenio_id, status').eq('id', pesquisaId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!pesquisa) return { success: false, error: 'Pesquisa não encontrada.' }
    if (!['pendente', 'buscando', 'baixando', 'extraindo'].includes(pesquisa.status)) {
      return { success: false, error: 'Esta pesquisa já foi concluída.' }
    }

    const { error } = await admin
      .from('convenio_pesquisas')
      .update({ status: 'cancelada', lease_token: null, lease_until: null, etapa_msg: 'Cancelada pelo usuário.' })
      .eq('id', pesquisaId)
    if (error) throw error

    revalidatePath(`/convenios/${pesquisa.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao cancelar pesquisa:', error)
    return { success: false, error: error.message }
  }
}

export async function lerDocumentoComJarvis(documentoId: string): Promise<{ success: boolean; error?: string; convenioId?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const { data: doc, error: fetchErr } = await admin.from('convenio_documentos').select('id, convenio_id').eq('id', documentoId).maybeSingle()
    if (fetchErr) throw fetchErr
    if (!doc) return { success: false, error: 'Documento não encontrado.' }

    const { error } = await admin.from('convenio_pesquisas').insert({
      convenio_id: doc.convenio_id,
      origem: 'documento',
      documento_id: doc.id,
      iniciado_por: user.id,
    })
    if (error) {
      if ((error as any).code === '23505') return { success: false, error: 'Já existe uma pesquisa em andamento para este convênio.' }
      throw error
    }

    revalidatePath(`/convenios/${doc.convenio_id}`)
    return { success: true, convenioId: doc.convenio_id }
  } catch (error: any) {
    console.error('Erro ao iniciar leitura do documento com o Jarvis:', error)
    return { success: false, error: error.message }
  }
}

export type PesquisaHistoricoItem = {
  id: string
  origem: string
  status: string
  resumo: string | null
  created_at: string
  concluido_em: string | null
}

export async function getHistoricoPesquisas(convenioId: string): Promise<{ success: boolean; items?: PesquisaHistoricoItem[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin
      .from('convenio_pesquisas')
      .select('id, origem, status, resumo, created_at, concluido_em')
      .eq('convenio_id', convenioId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return { success: true, items: (data || []) as PesquisaHistoricoItem[] }
  } catch (error: any) {
    console.error('Erro ao buscar histórico de pesquisas:', error)
    return { success: false, error: error.message }
  }
}

// Usado pela sub-aba FAQ pra avisar "há N sugestões de FAQ aguardando revisão
// na aba Pesquisa" — sem precisar carregar a pesquisa inteira ali.
export async function getContagemSugestoesFaqPendentes(convenioId: string): Promise<number> {
  try {
    await requirePermission(RESOURCE)
    const { count } = await admin
      .from('convenio_bc_sugestoes')
      .select('id', { count: 'exact', head: true })
      .eq('convenio_id', convenioId)
      .eq('secao', 'faq')
      .eq('status', 'pendente')
    return count || 0
  } catch {
    return 0
  }
}

export async function getFonteUrl(fonteId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data: fonte, error } = await admin.from('convenio_pesquisa_fontes').select('arquivo_path').eq('id', fonteId).maybeSingle()
    if (error) throw error
    if (!fonte?.arquivo_path) return { success: false, error: 'Esta fonte não tem cópia de arquivo guardada.' }
    const { data: signed, error: signErr } = await admin.storage.from('convenio-documentos').createSignedUrl(fonte.arquivo_path, 3600)
    if (signErr) throw signErr
    return { success: true, url: signed?.signedUrl }
  } catch (error: any) {
    console.error('Erro ao gerar URL da fonte:', error)
    return { success: false, error: error.message }
  }
}
