'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/scp-engine'
import { agruparPorIndicador, hojeSaoPaulo, transicaoValida, type ItemRemessa } from './remessa-logic'

const PERM = 'comercial-promocoes-remessa'

type Res<T = unknown> = { success: true } & T | { success: false; error: string }

async function campanhaPorSlug(slug: string) {
  const sb: any = await createAdminClient()
  const { data } = await sb.from('promocao_campanhas').select('id, slug').eq('slug', slug).maybeSingle()
  if (!data) throw new Error('Campanha não encontrada.')
  return { sb, campanha: data as { id: string; slug: string } }
}

function falha(e: unknown): { success: false; error: string } {
  return { success: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }
}

export async function listarRemessas(slug: string) {
  try {
    await requirePermission(PERM, 'can_view')
    const { sb, campanha } = await campanhaPorSlug(slug)
    const [{ data: remessas }, { data: pendentes }] = await Promise.all([
      sb.from('promocao_remessas').select('*').eq('campanha_id', campanha.id).order('data_referencia', { ascending: false }),
      sb.from('promocao_direitos').select('id').eq('campanha_id', campanha.id).eq('tipo', 'pix_indicador').eq('status', 'devido'),
    ])
    return { success: true as const, remessas: remessas ?? [], pendentes: (pendentes ?? []).length }
  } catch (e) {
    return falha(e)
  }
}

/** Itens com Pix/dados bancários MASCARADOS (tela). O dado em claro só sai no Excel. */
export async function obterRemessa(slug: string, remessaId: string) {
  try {
    await requirePermission(PERM, 'can_view')
    const { sb, campanha } = await campanhaPorSlug(slug)
    const { data: remessa } = await sb.from('promocao_remessas').select('*').eq('id', remessaId).eq('campanha_id', campanha.id).maybeSingle()
    if (!remessa) return { success: false as const, error: 'Remessa não encontrada.' }
    const { data: itens } = await sb.from('promocao_remessa_itens').select('*').eq('remessa_id', remessaId).order('indicado_nome')
    const { mascararCpf, mascararPix } = await import('./mascara')
    return {
      success: true as const,
      remessa,
      itens: (itens ?? []).map((i: any) => ({
        id: i.id,
        indicado_nome: i.indicado_nome,
        indicado_cpf: mascararCpf(i.indicado_cpf),
        valor_centavos: Number(i.valor_centavos),
        pix_tipo: i.pix_tipo,
        pix: mascararPix(i.pix_tipo, i.pix_chave),
        banco: i.pix_tipo === 'dados_bancarios' ? i.banco_nome ?? i.banco_codigo : null,
      })),
    }
  } catch (e) {
    return falha(e)
  }
}

export async function gerarRemessa(slug: string, dataReferencia?: string): Promise<Res<{ remessaId: string; qtd: number }>> {
  try {
    const { user } = await requirePermission(PERM, 'can_include')
    const { sb, campanha } = await campanhaPorSlug(slug)
    const data = dataReferencia && /^\d{4}-\d{2}-\d{2}$/.test(dataReferencia) ? dataReferencia : hojeSaoPaulo()

    const { data: existente } = await sb.from('promocao_remessas').select('id').eq('campanha_id', campanha.id).eq('data_referencia', data).maybeSingle()
    if (existente) return { success: false, error: 'Já existe remessa para este dia.' }

    const { data: direitos, error: errD } = await sb
      .from('promocao_direitos')
      .select('id, valor_centavos, indicador_id, inscricao_id')
      .eq('campanha_id', campanha.id).eq('tipo', 'pix_indicador').eq('status', 'devido').not('indicador_id', 'is', null)
    if (errD) throw errD
    if (!direitos?.length) return { success: false, error: 'Nenhum Pix devido pendente de remessa.' }

    const [{ data: indicadores }, { data: inscricoes }, { data: bloqueados }, { data: jaRemetidos }] = await Promise.all([
      sb.from('promocao_indicadores').select('*').in('id', [...new Set(direitos.map((d: any) => d.indicador_id))]),
      sb.from('promocao_inscricoes').select('id, cpf, nome').in('id', direitos.map((d: any) => d.inscricao_id)),
      sb.from('promocao_cpfs_bloqueados').select('cpf').or(`campanha_id.is.null,campanha_id.eq.${campanha.id}`),
      sb.from('promocao_remessa_itens').select('direito_id').in('direito_id', direitos.map((d: any) => d.id)),
    ])
    const indMap = new Map<string, any>((indicadores ?? []).map((i: any) => [i.id, i]))
    const insMap = new Map<string, any>((inscricoes ?? []).map((i: any) => [i.id, i]))
    const bloq = new Set((bloqueados ?? []).map((b: any) => b.cpf))
    const feitos = new Set((jaRemetidos ?? []).map((r: any) => r.direito_id))

    const elegiveis = direitos.filter((d: any) => {
      const ind = indMap.get(d.indicador_id), ins = insMap.get(d.inscricao_id)
      return ind && ins && !feitos.has(d.id) && !bloq.has(ind.cpf) && !bloq.has(ins.cpf) && Number(d.valor_centavos) > 0
    })
    if (!elegiveis.length) return { success: false, error: 'Nenhum Pix elegível (bloqueados ou já remetidos).' }

    const total = elegiveis.reduce((s: number, d: any) => s + Number(d.valor_centavos), 0)
    const { data: camp } = await sb.from('promocao_campanhas').select('pagador_cnpj, pagador_nome').eq('id', campanha.id).single()
    const { data: remessa, error: errR } = await sb.from('promocao_remessas').insert({
      campanha_id: campanha.id, data_referencia: data, status: 'gerada', total_centavos: total, qtd_itens: elegiveis.length,
      pagador_cnpj: camp?.pagador_cnpj, pagador_nome: camp?.pagador_nome, gerada_por: user.id, gerada_em: new Date().toISOString(),
    }).select('id').single()
    if (errR) throw errR

    const linhas = elegiveis.map((d: any) => {
      const ind = indMap.get(d.indicador_id), ins = insMap.get(d.inscricao_id)
      return {
        remessa_id: remessa.id, direito_id: d.id, indicador_id: d.indicador_id, inscricao_id: d.inscricao_id,
        valor_centavos: d.valor_centavos, indicado_nome: ins.nome, indicado_cpf: ins.cpf,
        pix_tipo: ind.pix_tipo, pix_chave: ind.pix_chave, banco_codigo: ind.banco_codigo, banco_nome: ind.banco_nome, agencia: ind.agencia, conta: ind.conta,
      }
    })
    const { error: errI } = await sb.from('promocao_remessa_itens').insert(linhas)
    if (errI) {
      await sb.from('promocao_remessas').delete().eq('id', remessa.id)
      throw errI
    }
    await sb.from('promocao_direitos').update({ status: 'em_remessa', updated_at: new Date().toISOString() }).in('id', elegiveis.map((d: any) => d.id)).eq('status', 'devido')
    await sb.from('promocao_eventos').insert({ campanha_id: campanha.id, entidade: 'remessa', entidade_id: remessa.id, tipo: 'remessa_gerada', dados: { qtd: elegiveis.length, total }, ator_user_id: user.id })

    revalidatePath(`/promocoes/${slug}/remessa`)
    return { success: true, remessaId: remessa.id, qtd: elegiveis.length }
  } catch (e) {
    return falha(e)
  }
}

/** gerada → exportada (idempotente: se já passou disso, não mexe). Usada pela rota do Excel. */
export async function registrarExportacao(remessaId: string, userId: string) {
  const sb: any = await createAdminClient()
  const { data } = await sb.from('promocao_remessas')
    .update({ status: 'exportada', exportada_por: userId, exportada_em: new Date().toISOString() })
    .eq('id', remessaId).eq('status', 'gerada').select('campanha_id').maybeSingle()
  if (data) await sb.from('promocao_eventos').insert({ campanha_id: data.campanha_id, entidade: 'remessa', entidade_id: remessaId, tipo: 'remessa_exportada', ator_user_id: userId })
}

export async function marcarEnviadaPagamento(slug: string, remessaId: string): Promise<Res<{ avisos: number }>> {
  try {
    const { user } = await requirePermission(PERM, 'can_edit')
    const { sb, campanha } = await campanhaPorSlug(slug)
    const { data: atual } = await sb.from('promocao_remessas').select('status').eq('id', remessaId).eq('campanha_id', campanha.id).maybeSingle()
    if (!atual) return { success: false, error: 'Remessa não encontrada.' }
    if (!transicaoValida(atual.status, 'enviada_pagamento')) return { success: false, error: 'Exporte o Excel antes de marcar como enviada para pagamento.' }

    const { data: ganhou } = await sb.from('promocao_remessas')
      .update({ status: 'enviada_pagamento', enviada_por: user.id, enviada_em: new Date().toISOString() })
      .eq('id', remessaId).eq('status', 'exportada').select('id').maybeSingle()
    if (!ganhou) return { success: false, error: 'Remessa já foi marcada por outra pessoa.' }

    const { data: itens } = await sb.from('promocao_remessa_itens').select('direito_id, indicador_id, valor_centavos').eq('remessa_id', remessaId)
    await sb.from('promocao_direitos').update({ status: 'pago', updated_at: new Date().toISOString() }).in('id', (itens ?? []).map((i: any) => i.direito_id)).eq('status', 'em_remessa')

    const grupos = agruparPorIndicador((itens ?? []) as ItemRemessa[])
    for (const g of grupos) {
      await enqueueJob({
        kind: 'promocoes.aviso_pagamento',
        payload: { remessaId, indicadorId: g.indicadorId },
        dedupeKey: `promo-pag:${remessaId}:${g.indicadorId}`,
        maxAttempts: 8,
      })
    }
    await sb.from('promocao_eventos').insert({ campanha_id: campanha.id, entidade: 'remessa', entidade_id: remessaId, tipo: 'remessa_enviada_pagamento', dados: { avisos: grupos.length }, ator_user_id: user.id })

    revalidatePath(`/promocoes/${slug}/remessa`)
    return { success: true, avisos: grupos.length }
  } catch (e) {
    return falha(e)
  }
}
