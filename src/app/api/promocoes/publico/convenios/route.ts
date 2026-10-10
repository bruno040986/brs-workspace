/* eslint-disable @typescript-eslint/no-explicit-any */
// Lista pública de convênios para o select do cadastro (contrato: docs/promocao/CONTRATO.md).
// Convênios ativos (não depende de publicação de conteúdo no site); `q` filtra por nome.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, logSeguro } from '@/lib/promocoes/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limite = await aplicarLimites([[`rl:convenios:ip:${ipDoRequest(request)}`, 600, 600]])
  if (limite) return limite
  const camp = await buscarCampanha(request.nextUrl.searchParams.get('campanha'), ['ativa', 'encerrada_cadastro', 'encerrada'])
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const admin: any = await createAdminClient()
  // q (opcional, >= 2 caracteres): busca por nome, até 20; sem q: lista completa até 200
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 60)
  let query = admin.from('convenios').select('id, nome, uf').eq('is_active', true).is('deleted_at', null)
  if (q.length >= 2) query = query.ilike('nome', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  const { data, error } = await query.order('nome').limit(q.length >= 2 ? 20 : 200)
  if (error) {
    logSeguro('convenios publico', error)
    return erro('ERRO_INTERNO', 'Não foi possível carregar os convênios agora.', 503)
  }
  return NextResponse.json({ convenios: data ?? [] }, { headers: { 'Cache-Control': 'public, s-maxage=300' } })
}

function metodoNaoPermitido() {
  const r = erro('METODO_NAO_PERMITIDO', 'Método não permitido.', 405)
  r.headers.set('Allow', 'GET')
  return r
}

export { metodoNaoPermitido as POST, metodoNaoPermitido as PUT, metodoNaoPermitido as PATCH, metodoNaoPermitido as DELETE }
