'use server'

/**
 * Convênio — Base de Conhecimento, Fase 2 (Documentos).
 * Spec: docs/SPEC-CONVENIO-BASE-CONHECIMENTO.md §2.9.
 * Decretos, roteiros operacionais (presos a um vínculo Convênio×IF) e outros
 * documentos — texto colado e/ou link e/ou arquivo. Arquivo em bucket
 * PRIVADO (`convenio-documentos`); nunca servido por URL pública, só por
 * signed URL de curta duração. Leitura pela IA (resumo_ia/ia_status) fica
 * para a Fase 4 — aqui só os campos já existem no schema.
 */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { normalizarUrl } from '@/lib/url-site'
import { admin } from './supabase-admin'

const RESOURCE = 'workspace-convenios'
const BUCKET = 'convenio-documentos'
const SIGNED_URL_TTL_SECONDS = 3600
// O arquivo passa pela server action (corpo da requisição). Na Vercel a função
// serverless recusa corpo acima de ~4,5 MB, então o teto útil é 4 MB até o
// upload ir direto ao Storage por URL assinada (pendência registrada no
// roteiro da Fase 2). Documento maior: usar o campo Link.
const MAX_ARQUIVO_BYTES = 4 * 1024 * 1024
const MIMES_ACEITOS = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
])

export type TipoDocumento = 'decreto' | 'roteiro' | 'outro'

export type DocumentoConvenio = {
  id: string
  tipo: TipoDocumento
  convenio_instituicao_id: string | null
  titulo: string
  texto: string | null
  url: string | null
  arquivo_nome: string | null
  arquivo_mime: string | null
  arquivo_tamanho: number | null
  temArquivo: boolean
  resumo_ia: string | null
  ia_status: string
  is_active: boolean
  ordem: number
}

function sanitizarNomeArquivo(nome: string): string {
  const base = String(nome || 'arquivo').trim().slice(0, 150)
  const limpo = base.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return limpo || 'arquivo'
}

export async function getDocumentos(
  convenioId: string,
  tipo?: TipoDocumento,
  convenioInstituicaoId?: string,
): Promise<{ success: boolean; items?: DocumentoConvenio[]; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }

    let query = admin
      .from('convenio_documentos')
      .select(
        'id, tipo, convenio_instituicao_id, titulo, texto, url, arquivo_path, arquivo_nome, arquivo_mime, arquivo_tamanho, resumo_ia, ia_status, is_active, ordem',
      )
      .eq('convenio_id', convenioId)
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true })
    if (tipo) query = query.eq('tipo', tipo)
    if (convenioInstituicaoId) query = query.eq('convenio_instituicao_id', convenioInstituicaoId)

    const { data, error } = await query
    if (error) throw error

    const items: DocumentoConvenio[] = (data || []).map((r: any) => ({
      id: r.id,
      tipo: r.tipo,
      convenio_instituicao_id: r.convenio_instituicao_id,
      titulo: r.titulo,
      texto: r.texto,
      url: r.url,
      arquivo_nome: r.arquivo_nome,
      arquivo_mime: r.arquivo_mime,
      arquivo_tamanho: r.arquivo_tamanho,
      temArquivo: !!r.arquivo_path,
      resumo_ia: r.resumo_ia,
      ia_status: r.ia_status,
      is_active: r.is_active,
      ordem: r.ordem,
    }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao buscar documentos do convênio:', error)
    return { success: false, error: error.message }
  }
}

export async function salvarDocumento(formData: FormData): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')

    const id = String(formData.get('id') || '').trim() || null
    const convenioId = String(formData.get('convenio_id') || '').trim()
    const tipo = String(formData.get('tipo') || '').trim() as TipoDocumento
    const convenioInstituicaoId = String(formData.get('convenio_instituicao_id') || '').trim() || null
    const titulo = String(formData.get('titulo') || '').trim()
    const textoRaw = String(formData.get('texto') || '').trim()
    const urlRaw = String(formData.get('url') || '').trim()
    const removerArquivo = formData.get('remover_arquivo') === '1'
    const ordemRaw = formData.get('ordem')
    const arquivo = formData.get('arquivo')

    if (!convenioId) return { success: false, error: 'ID de convênio inválido.' }
    if (!['decreto', 'roteiro', 'outro'].includes(tipo)) return { success: false, error: 'Tipo de documento inválido.' }
    if (!titulo) return { success: false, error: 'Informe o título do documento.' }
    if (tipo === 'roteiro' && !convenioInstituicaoId) {
      return { success: false, error: 'Roteiro operacional precisa estar vinculado a uma instituição.' }
    }

    let url: string | null = null
    if (urlRaw) {
      try {
        url = normalizarUrl(urlRaw)
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }

    const temArquivoNovo = arquivo instanceof File && arquivo.size > 0
    if (temArquivoNovo) {
      const file = arquivo as File
      if (file.size > MAX_ARQUIVO_BYTES) {
        return { success: false, error: 'Arquivo maior que 4 MB. Nesta versão, documentos maiores devem ser informados pelo campo Link.' }
      }
      if (!MIMES_ACEITOS.has(file.type)) {
        return { success: false, error: 'Tipo de arquivo não aceito (use PDF, DOCX, TXT, MD, PNG ou JPEG).' }
      }
    }

    // Registro existente — precisa saber se já tinha arquivo (path) e conferir
    // que pertence ao mesmo convênio antes de deixar editar.
    let existente: { arquivo_path: string | null; arquivo_nome: string | null; arquivo_mime: string | null; arquivo_tamanho: number | null } | null = null
    if (id) {
      const { data } = await admin
        .from('convenio_documentos')
        .select('arquivo_path, arquivo_nome, arquivo_mime, arquivo_tamanho, convenio_id')
        .eq('id', id)
        .maybeSingle()
      if (!data) return { success: false, error: 'Documento não encontrado.' }
      if (data.convenio_id !== convenioId) return { success: false, error: 'Documento não pertence a este convênio.' }
      existente = data
    }

    const temArquivoFinal = temArquivoNovo || (!!existente?.arquivo_path && !removerArquivo)
    if (!textoRaw && !url && !temArquivoFinal) {
      return { success: false, error: 'Informe texto, link ou arquivo — pelo menos um é obrigatório.' }
    }

    const docId = id || crypto.randomUUID()
    let arquivoPath: string | null = existente?.arquivo_path || null
    let arquivoNome: string | null = existente?.arquivo_nome || null
    let arquivoMime: string | null = existente?.arquivo_mime || null
    let arquivoTamanho: number | null = existente?.arquivo_tamanho || null
    let zerarExtracao = false

    if (temArquivoNovo) {
      const file = arquivo as File
      const nomeSanitizado = sanitizarNomeArquivo(file.name)
      const path = `convenios/${convenioId}/${docId}/${nomeSanitizado}`
      const bytes = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      })
      if (upErr) throw upErr
      if (existente?.arquivo_path && existente.arquivo_path !== path) {
        await admin.storage.from(BUCKET).remove([existente.arquivo_path])
      }
      arquivoPath = path
      arquivoNome = file.name
      arquivoMime = file.type || null
      arquivoTamanho = file.size
      zerarExtracao = true
    } else if (removerArquivo && existente?.arquivo_path) {
      await admin.storage.from(BUCKET).remove([existente.arquivo_path])
      arquivoPath = null
      arquivoNome = null
      arquivoMime = null
      arquivoTamanho = null
      zerarExtracao = true
    }

    const row: Record<string, any> = {
      convenio_id: convenioId,
      tipo,
      convenio_instituicao_id: tipo === 'roteiro' ? convenioInstituicaoId : null,
      titulo,
      texto: textoRaw || null,
      url,
      arquivo_path: arquivoPath,
      arquivo_nome: arquivoNome,
      arquivo_mime: arquivoMime,
      arquivo_tamanho: arquivoTamanho,
      ordem: ordemRaw != null && ordemRaw !== '' ? Number(ordemRaw) : 0,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }
    if (zerarExtracao) {
      row.texto_extraido = null
      row.resumo_ia = null
      row.ia_status = 'nao_lido'
      row.ia_erro = null
      row.ia_modelo = null
      row.ia_lido_em = null
    }

    if (id) {
      const { error } = await admin.from('convenio_documentos').update(row).eq('id', id)
      if (error) throw error
    } else {
      const { error } = await admin.from('convenio_documentos').insert({ id: docId, ...row, created_by: user.id })
      if (error) throw error
    }

    revalidatePath(`/convenios/${convenioId}`)
    return { success: true, id: docId }
  } catch (error: any) {
    console.error('Erro ao salvar documento:', error)
    return { success: false, error: error.message }
  }
}

export async function getDocumentoUrl(id: string): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    const { data, error } = await admin.from('convenio_documentos').select('arquivo_path').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data?.arquivo_path) return { success: false, error: 'Este documento não tem arquivo anexado.' }
    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(data.arquivo_path, SIGNED_URL_TTL_SECONDS)
    if (signErr) throw signErr
    return { success: true, url: signed?.signedUrl }
  } catch (error: any) {
    console.error('Erro ao gerar URL do documento:', error)
    return { success: false, error: error.message }
  }
}

export async function excluirDocumento(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_delete')
    const { data } = await admin.from('convenio_documentos').select('arquivo_path, convenio_id').eq('id', id).maybeSingle()
    if (!data) return { success: false, error: 'Documento não encontrado.' }
    if (data.arquivo_path) await admin.storage.from(BUCKET).remove([data.arquivo_path])
    const { error } = await admin.from('convenio_documentos').delete().eq('id', id)
    if (error) throw error
    revalidatePath(`/convenios/${data.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao excluir documento:', error)
    return { success: false, error: error.message }
  }
}

export async function setDocumentoStatus(id: string, isActive: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_activate_inactivate')
    const { data, error } = await admin
      .from('convenio_documentos')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('convenio_id')
      .maybeSingle()
    if (error) throw error
    if (data?.convenio_id) revalidatePath(`/convenios/${data.convenio_id}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao alterar status do documento:', error)
    return { success: false, error: error.message }
  }
}
