// Lista pública de instituições financeiras ativas (contrato v1, seção 13). Sem autenticação, só leitura.
// Rota estática: vence o irmão dinâmico [slug] no App Router.
import { createAdminClient } from '@/lib/supabase/server'
import { logoPublico } from '@/lib/convenios-publico/snapshot'

const CACHE_PUBLICO = 'public, s-maxage=600, stale-while-revalidate=60'

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
    // ponytail: logo_url traz o base64 inteiro (~1,7 MB hoje) só para validar; com s-maxage=600 é 1 leitura a cada 10 min.
    const { data, error } = await admin
      .from('financial_institutions')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(500)
    if (error) throw error

    const base = process.env.NEXT_PUBLIC_APP_URL || undefined
    const instituicoes = ((data || []) as { id: string; name: string | null; logo_url: string | null }[])
      .map((i) => ({ id: i.id, nome: (i.name || '').trim(), logo_url: logoPublico(i.id, i.logo_url, base) }))
      .filter((i) => i.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    return json({ instituicoes }, 200, CACHE_PUBLICO)
  } catch (err) {
    console.error('[convenios/publico/v1/instituicoes] falha ao listar', err)
    return json({ erro: 'indisponivel' }, 503, 'no-store')
  }
}

function metodoNaoPermitido() {
  return json({ erro: 'metodo_nao_permitido' }, 405, 'no-store', { Allow: 'GET' })
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
