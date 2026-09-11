/**
 * Convênio — Base de Conhecimento, Fase 3. Avança UMA etapa da pesquisa
 * atual do convênio (spec §6.2/§6.5). A tela chama esta rota em laço
 * enquanto o status estiver ativo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { admin } from '@/app/(dashboard)/convenios/supabase-admin'
import { avancarPesquisa } from '@/lib/convenios/pesquisa/motor'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

// Precisa de folga acima do timeout da chamada de IA (55s em chamarIaJson) +
// as leituras/escritas no banco em volta — 60s era curto demais e a Vercel
// matava a função à força no meio de uma etapa, deixando o lease preso
// (achado real em produção, 10/09/2026).
export const maxDuration = 90

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('workspace-convenios', 'can_edit')
    const { id: convenioId } = await params

    const { data: pesquisaAtual, error: buscaErr } = await admin
      .from('convenio_pesquisas')
      .select('id, convenio_id')
      .eq('convenio_id', convenioId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (buscaErr) throw buscaErr
    if (!pesquisaAtual) return NextResponse.json({ error: 'Nenhuma pesquisa encontrada para este convênio.' }, { status: 404 })

    const pesquisa = await avancarPesquisa(pesquisaAtual.id)
    // null = a pesquisa não estava mais "claimável" (já concluiu, ou outro
    // worker segura o lease agora) — devolve o estado atual mesmo assim.
    const atual = pesquisa || (await admin.from('convenio_pesquisas').select('*').eq('id', pesquisaAtual.id).maybeSingle()).data

    return NextResponse.json({ success: true, pesquisa: atual })
  } catch (error) {
    const message = getErrorMessage(error, 'Falha ao avançar a pesquisa.')
    console.error('Erro ao avançar pesquisa do convênio:', error)
    return NextResponse.json({ error: message }, { status: message.includes('permissao') ? 403 : 500 })
  }
}
