import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { formatarNumeroSorte } from '@/lib/promocoes/codigos'
import { mascararTelefone } from '@/lib/promocoes/mascara'
import {
  LIMITE_EXCEDIDO,
  LINK_INVALIDO,
  PRAZO_ENCERRADO,
  carregarGeracao,
  carregarTitular,
  ipDe,
  lerSnapshot,
  limiteExcedido,
  numerosValidosDoTitular,
  tokenValido,
} from '@/lib/promocoes/geracao-publico'

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get('t')
  if (!tokenValido(t)) return LINK_INVALIDO()

  const admin: any = await createAdminClient()
  if (await limiteExcedido(admin, `rl:geracao:ip:${ipDe(request)}`, 30, 600)) return LIMITE_EXCEDIDO()

  const carregada = await carregarGeracao(admin, t)
  if (!carregada || carregada.estado === 'invalido') return LINK_INVALIDO()
  if (carregada.estado === 'encerrado') return PRAZO_ENCERRADO()
  const { g, campanha } = carregada

  const titular = await carregarTitular(admin, g)
  if (!titular) return LINK_INVALIDO()

  const snapshot = lerSnapshot(g.snapshot)
  const ids = snapshot.operacoes.map((o: any) => o.id).filter(Boolean)
  const instituicoes = new Map<string, string>()
  if (ids.length) {
    const { data } = await admin.from('promocao_operacoes').select('id, instituicao_texto, financial_institutions ( name )').in('id', ids)
    for (const o of (data || []) as any[]) instituicoes.set(String(o.id), o.financial_institutions?.name || o.instituicao_texto || '')
  }

  const [numerosAnteriores, { count: usadas }] = await Promise.all([
    numerosValidosDoTitular(admin, g),
    admin
      .from('promocao_geracoes')
      .select('id', { count: 'exact', head: true })
      .eq('titular_tipo', g.titular_tipo)
      .eq('titular_id', g.titular_id)
      .eq('status', 'usado'),
  ])

  return NextResponse.json({
    titularTipo: g.titular_tipo,
    nome: titular.nome,
    telefoneMascarado: mascararTelefone(g.telefone),
    email: titular.email || null,
    qtd: g.qtd,
    expiraEm: g.expira_em,
    snapshot: {
      operacoes: snapshot.operacoes.map((o: any) => ({
        tipo: o.tipo,
        valorCentavos: o.valorCentavos,
        dataPagamento: o.dataPagamento,
        instituicao: (o.id && instituicoes.get(o.id)) || null,
      })),
      totalCentavos: snapshot.totalCentavos,
      usadoAnteriorCentavos: snapshot.usadoAnteriorCentavos,
      usadoNestaCentavos: snapshot.usadoNestaCentavos,
      saldoCentavos: snapshot.saldoCentavos,
    },
    numerosAnteriores: numerosAnteriores.map(formatarNumeroSorte),
    regulamentoUrl: campanha.regulamento_url,
    regulamentoVersao: campanha.regulamento_versao,
    primeiraGeracao: !usadas,
  })
}
