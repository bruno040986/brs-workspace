/**
 * Convênio — Base de Conhecimento, Fase 3 (Jarvis pesquisador).
 * POST: inicia uma pesquisa nova para o convênio. GET: devolve a pesquisa
 * mais recente + fontes + sugestões (sem `texto_extraido`, que pode ser
 * grande e não interessa ao cliente).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { lerModelosPesquisa } from '@/lib/ia/config'
import { admin } from '@/app/(dashboard)/convenios/supabase-admin'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export const maxDuration = 60

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requirePermission('workspace-convenios', 'can_edit')
    const { id: convenioId } = await params

    const modelos = await lerModelosPesquisa()
    if (!modelos) {
      return NextResponse.json(
        { error: 'O modelo de pesquisa do Jarvis não está configurado. Configure em Configurações › IA do Workspace.' },
        { status: 400 },
      )
    }

    const { data: convenio, error: convErr } = await admin
      .from('convenios')
      .select('id, abrangencia, cidade, uf')
      .eq('id', convenioId)
      .is('deleted_at', null)
      .maybeSingle()
    if (convErr) throw convErr
    if (!convenio) return NextResponse.json({ error: 'Convênio não encontrado.' }, { status: 404 })
    if (convenio.abrangencia === 'municipal' && !convenio.cidade) {
      return NextResponse.json({ error: 'Preencha a cidade do convênio em Dados Básicos antes de pesquisar.' }, { status: 400 })
    }
    if (convenio.abrangencia === 'estadual' && !convenio.uf) {
      return NextResponse.json({ error: 'Preencha a UF do convênio em Dados Básicos antes de pesquisar.' }, { status: 400 })
    }

    const { data: pesquisa, error } = await admin
      .from('convenio_pesquisas')
      .insert({ convenio_id: convenioId, iniciado_por: user.id })
      .select('*')
      .single()
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'Já existe uma pesquisa em andamento para este convênio.' }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({ success: true, pesquisa })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao iniciar a pesquisa.')
    console.error('Erro ao iniciar pesquisa do convênio:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('workspace-convenios')
    const { id: convenioId } = await params

    const { data: pesquisa, error } = await admin
      .from('convenio_pesquisas')
      .select('id, convenio_id, origem, documento_id, status, etapa_msg, progresso, resumo, nao_encontrado, erro, tentativas, iniciado_por, concluido_em, created_at, updated_at')
      .eq('convenio_id', convenioId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!pesquisa) return NextResponse.json({ success: true, pesquisa: null, fontes: [], sugestoes: [] })

    const [{ data: fontes, error: fontesErr }, { data: sugestoes, error: sugErr }] = await Promise.all([
      admin
        .from('convenio_pesquisa_fontes')
        .select('id, url, titulo, tipo_norma, numero, ano, ente_citado, ente_detectado, uf_detectada, status, motivo, arquivo_path, extraida_em, confirmada_por, confirmada_em, ordem')
        .eq('pesquisa_id', pesquisa.id)
        .order('ordem'),
      admin
        .from('convenio_bc_sugestoes')
        .select('id, fonte_id, secao, campo, valor, valor_atual, citacao, artigo, status, valor_aplicado, decidido_por, decidido_em, created_at')
        .eq('pesquisa_id', pesquisa.id)
        .order('created_at'),
    ])
    if (fontesErr) throw fontesErr
    if (sugErr) throw sugErr

    return NextResponse.json({ success: true, pesquisa, fontes: fontes || [], sugestoes: sugestoes || [] })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao carregar a pesquisa.')
    console.error('Erro ao carregar pesquisa do convênio:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}
