// Lista pública dos convênios com landing no ar (contrato v1, seção 14). Sem autenticação, só leitura.
// Mesmo filtro da rota {slug} (ativo, não excluído, publicado + revisado + snapshot); campos lidos ao vivo do cadastro.
// Rota estática em v1/: não colide com o dinâmico v1/[slug] (profundidades diferentes).
import { createAdminClient } from '@/lib/supabase/server'
import { itemListaPublica, ordenarListaPublica, type ConvenioListaPublica } from '@/lib/convenios-publico/lista'

const CACHE_PUBLICO = 'public, s-maxage=120, stale-while-revalidate=30'

function json(body: unknown, status: number, cache: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
      ...extra,
    },
  })
}

export async function GET() {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('convenios')
      .select(
        'slug_publico, nome, nome_reduzido, esfera, uf, logotipo_url, brasao_url, ' +
          'convenio_conteudo_site!inner(published_at), imagens_predio:convenio_imagens(url)',
      )
      .not('slug_publico', 'is', null)
      .is('deleted_at', null)
      .eq('is_active', true)
      .eq('convenio_conteudo_site.is_publicado', true)
      .eq('convenio_conteudo_site.pendente_revisao_humana', false)
      .not('convenio_conteudo_site.snapshot_publico', 'is', null)
      .eq('imagens_predio.tipo', 'predio')
      .order('ordem', { referencedTable: 'imagens_predio' })
      .order('created_at', { referencedTable: 'imagens_predio' })
      .limit(500)
    if (error) throw error

    type Linha = Parameters<typeof itemListaPublica>[0] & { convenio_conteudo_site?: { published_at: unknown }[] }
    const convenios = ordenarListaPublica(
      ((data || []) as unknown as Linha[])
        .map((r) => itemListaPublica({ ...r, publicado_em: r.convenio_conteudo_site?.[0]?.published_at }))
        .filter((c): c is ConvenioListaPublica => !!c),
    )
    return json({ convenios }, 200, CACHE_PUBLICO)
  } catch (err) {
    console.error('[convenios/publico/v1] falha ao listar', err)
    return json({ erro: 'indisponivel' }, 503, 'no-store')
  }
}

function metodoNaoPermitido() {
  return json({ erro: 'metodo_nao_permitido' }, 405, 'no-store', { Allow: 'GET' })
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
