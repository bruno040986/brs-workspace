'use server'

import { randomBytes } from 'node:crypto'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PREVIEW_VALIDADE_MS, TOKEN_PREVIEW_RE, decidirTokenPreview } from '@/lib/convenios-publico/montar-entrada'

/**
 * Link de preview do RASCUNHO no site da NuAzul (contrato v1, seção 14). Válido por 2 h e
 * reaproveitado enquanto faltar mais de 30 min para expirar (chamadas seguidas devolvem o mesmo link, só estendendo
 * a validade); abaixo disso gera token novo (o anterior para de funcionar).
 * Exige workspace-convenios can_edit (gerar link mexe no rascunho, então não é só leitura).
 * Gravar o token não muda updated_at do rascunho (trigger da migration), então não quebra revisão/publicação.
 */
export async function gerarLinkPreview(
  convenioId: string,
): Promise<{ success: true; data: { url: string; expiraEm: string } } | { success: false; error: string }> {
  try {
    await requirePermission('workspace-convenios', 'can_edit')
    if (!convenioId) return { success: false, error: 'ID do convênio é obrigatório.' }

    const supabase = await createAdminClient()
    const { data: convenio, error: errConv } = await supabase
      .from('convenios')
      .select('slug_publico')
      .eq('id', convenioId)
      .is('deleted_at', null)
      .maybeSingle()
    if (errConv) throw errConv
    if (!convenio) return { success: false, error: 'Convênio não encontrado.' }
    if (!convenio.slug_publico) return { success: false, error: 'Defina o slug público do convênio antes de gerar o link de preview.' }

    const { data: atual, error: errAtual } = await supabase
      .from('convenio_conteudo_site')
      .select('preview_token, preview_token_expira_em')
      .eq('convenio_id', convenioId)
      .eq('is_draft', true)
      .maybeSingle()
    if (errAtual) throw errAtual
    if (!atual) return { success: false, error: 'Não há rascunho salvo deste convênio. Salve o rascunho antes de gerar o preview.' }

    const reutilizar =
      decidirTokenPreview(atual.preview_token, atual.preview_token_expira_em, Date.now()) === 'reutilizar' &&
      TOKEN_PREVIEW_RE.test(atual.preview_token as string)
    const token = reutilizar ? (atual.preview_token as string) : randomBytes(32).toString('base64url')
    const expiraEm = new Date(Date.now() + PREVIEW_VALIDADE_MS).toISOString()
    const { data: rascunho, error } = await supabase
      .from('convenio_conteudo_site')
      .update({ preview_token: token, preview_token_expira_em: expiraEm })
      .eq('convenio_id', convenioId)
      .eq('is_draft', true)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!rascunho) return { success: false, error: 'Não há rascunho salvo deste convênio. Salve o rascunho antes de gerar o preview.' }

    const site = (process.env.NUAZUL_SITE_URL || 'https://www.nuazul.com.br').replace(/\/+$/, '')
    return { success: true, data: { url: `${site}/${convenio.slug_publico}?preview=${token}`, expiraEm } }
  } catch (err) {
    return { success: false, error: (err as Error)?.message || 'Erro ao gerar o link de preview.' }
  }
}
