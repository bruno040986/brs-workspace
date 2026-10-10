// Rota pública do conteúdo aprovado de um convênio (contrato v1:
// docs/projetos/CONTRATO-CONVENIOS-PUBLICO-V1.md). Sem autenticação, só leitura.
// Serve o snapshot congelado na publicação; não lê cadastro mutável.
// Sem `force-dynamic`: a resposta é cacheável na CDN (revalidatePath na publicação/desativação).
import { createAdminClient } from '@/lib/supabase/server'
import { SLUG_PUBLICO_RE } from '@/lib/convenios-publico/snapshot'

// revalidatePath não purga o CDN da Vercel: a janela de revogação é s-maxage + swr (~3 min). Contrato §12 item 8.
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

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!SLUG_PUBLICO_RE.test(slug)) return json({ erro: 'slug_invalido' }, 400, 'no-store')

  try {
    const admin = await createAdminClient()
    // Uma única consulta: slug desconhecido e convênio sem publicação revisada dão o mesmo 404.
    const { data, error } = await admin
      .from('convenios')
      .select('convenio_conteudo_site!inner(snapshot_publico)')
      .eq('slug_publico', slug)
      .is('deleted_at', null)
      .eq('is_active', true)
      .eq('convenio_conteudo_site.is_publicado', true)
      .eq('convenio_conteudo_site.pendente_revisao_humana', false)
      .not('convenio_conteudo_site.snapshot_publico', 'is', null)
      .maybeSingle()
    if (error) throw error

    const linhas = (data as { convenio_conteudo_site?: { snapshot_publico: unknown }[] } | null)?.convenio_conteudo_site
    const snapshot = linhas?.[0]?.snapshot_publico
    if (!snapshot) return json({ erro: 'sem_publicacao' }, 404, CACHE_PUBLICO)
    return json(snapshot, 200, CACHE_PUBLICO)
  } catch (err) {
    console.error('[convenios/publico/v1] falha ao ler snapshot', err)
    return json({ erro: 'indisponivel' }, 503, 'no-store')
  }
}

function metodoNaoPermitido() {
  return json({ erro: 'metodo_nao_permitido' }, 405, 'no-store', { Allow: 'GET' })
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
