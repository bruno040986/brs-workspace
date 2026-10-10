// Logo pública de uma instituição financeira (contrato v1, seção 13). Sem autenticação, só leitura.
// financial_institutions.logo_url guarda data URL base64; aqui ela vira binário cacheável.
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { ehUuid, logoDataUrl } from '@/lib/convenios-publico/snapshot'

const CACHE_LOGO = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
const CACHE_404 = 'public, s-maxage=600, stale-while-revalidate=60'

function erro(body: unknown, status: number, cache: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', ...extra },
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ehUuid(id)) return erro({ erro: 'id_invalido' }, 400, 'no-store')

  const wide = new URL(request.url).searchParams.get('v') === 'wide'
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from('financial_institutions')
      .select('logo_url, logo_wide_url')
      .eq('id', id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw error

    const logo = logoDataUrl(wide ? (data as { logo_wide_url: string | null } | null)?.logo_wide_url : (data as { logo_url: string | null } | null)?.logo_url)
    if (!logo) return erro({ erro: 'sem_logo' }, 404, CACHE_404)

    const etag = `"${createHash('md5').update(logo.base64).digest('hex')}"`
    const headers: Record<string, string> = {
      'Cache-Control': CACHE_LOGO,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (logo.mime === 'image/svg+xml') {
      // SVG pode carregar script: sem CSP ele roda se aberto direto no navegador.
      headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
      headers['Content-Disposition'] = 'inline'
    }

    const inm = request.headers.get('if-none-match')
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(new Uint8Array(Buffer.from(logo.base64, 'base64')), {
      status: 200,
      headers: { ...headers, 'Content-Type': logo.mime },
    })
  } catch (err) {
    console.error('[convenios/publico/v1/instituicoes/logo] falha ao ler logo', err)
    return erro({ erro: 'indisponivel' }, 503, 'no-store')
  }
}

function metodoNaoPermitido() {
  return erro({ erro: 'metodo_nao_permitido' }, 405, 'no-store', { Allow: 'GET' })
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
