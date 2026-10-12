// Preview do RASCUNHO por token (contrato v1, seção 14). Sem login: o token (gerarLinkPreview, 2 h) é a credencial.
// Mesma montagem da publicação, a partir do rascunho, sem exigir revisão e sem gravar nada.
import { createAdminClient } from '@/lib/supabase/server'
import { SLUG_PUBLICO_RE } from '@/lib/convenios-publico/snapshot'
import { lerDadosSnapshot, montarPreview, TOKEN_PREVIEW_RE, tokenPreviewValido } from '@/lib/convenios-publico/montar-entrada'

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      ...extra,
    },
  })
}

// Slug inexistente, token errado ou expirado: mesma resposta, de propósito.
const naoAutorizado = () => json({ erro: 'token_invalido' }, 401)

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!SLUG_PUBLICO_RE.test(slug) || !TOKEN_PREVIEW_RE.test(token)) return naoAutorizado()

  try {
    const admin = await createAdminClient()
    const { data: convenio, error } = await admin
      .from('convenios')
      .select('id, nome, esfera, uf, logotipo_url, brasao_url, bandeira_url')
      .eq('slug_publico', slug)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) throw error
    if (!convenio) return naoAutorizado()

    const { data: rascunho, error: errR } = await admin
      .from('convenio_conteudo_site')
      .select('*')
      .eq('convenio_id', convenio.id)
      .eq('is_draft', true)
      .maybeSingle()
    if (errR) throw errR

    if (!rascunho) {
      // Token de um rascunho que já foi publicado (deixou de ser rascunho): 404. Sem isso, 401.
      const { data: antigo, error: errA } = await admin
        .from('convenio_conteudo_site')
        .select('id')
        .eq('convenio_id', convenio.id)
        .eq('preview_token', token)
        .maybeSingle()
      if (errA) throw errA
      return antigo ? json({ erro: 'sem_rascunho' }, 404) : naoAutorizado()
    }
    if (!tokenPreviewValido(token, rascunho.preview_token, rascunho.preview_token_expira_em)) return naoAutorizado()

    const montado = montarPreview(await lerDadosSnapshot(admin, convenio.id), convenio, slug, rascunho)
    // Mensagem de validação do próprio conteúdo (a mesma que bloquearia a publicação); útil para quem revisa.
    if (!montado.ok) return json({ erro: 'rascunho_invalido', mensagem: montado.erro }, 422)
    return json(montado.snapshot, 200)
  } catch (err) {
    console.error('[convenios/publico/v1/rascunho] falha ao montar preview', err)
    return json({ erro: 'indisponivel' }, 503)
  }
}

function metodoNaoPermitido() {
  return json({ erro: 'metodo_nao_permitido' }, 405, { Allow: 'GET' })
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
