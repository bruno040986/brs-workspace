/**
 * Recalcula os direitos (números do servidor, número e Pix do indicador) de uma
 * inscrição a partir das operações confirmadas e cria o link individual de
 * geração quando há número a emitir. Contrato §5. Nunca revoga número emitido.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/scp-engine/queue'
import { gerarToken } from './codigos'
import { dataCivilSp } from './dias-uteis'
import { calcularElegibilidade, direitosDoIndicador, montarSnapshotGeracao, operacoesConsideradasParaIndicador } from './elegibilidade'
import type { OperacaoConfirmada, ParametrosCampanha } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function parametrosDaCampanha(c: any): ParametrosCampanha {
  return {
    minimoCentavos: Number(c.minimo_centavos),
    passoCentavos: Number(c.passo_numeros_centavos),
    numerosPorPasso: Number(c.numeros_por_passo),
    faixasCartao: c.faixas_cartao,
    pixIndicadorCentavos: Number(c.pix_indicador_centavos),
  }
}

export function linhaParaOperacao(r: any): OperacaoConfirmada {
  return { id: r.id, tipo: r.tipo, valorCentavos: Number(r.valor_liquido_centavos), dataDigitacao: r.data_digitacao, dataPagamento: r.data_pagamento }
}

export function dentroDoPeriodo(r: { data_digitacao: string; data_pagamento: string | null }, c: any): boolean {
  const ini = dataCivilSp(c.inicio_em)
  const fim = dataCivilSp(c.fim_em)
  const ok = (d: string | null) => !!d && d >= ini && d <= fim
  return ok(r.data_digitacao) && ok(r.data_pagamento)
}

export async function opsValidasDaInscricao(inscricaoId: string, c: any): Promise<{ ops: OperacaoConfirmada[]; rows: any[] }> {
  const db: any = await createAdminClient()
  const { data, error } = await db.from('promocao_operacoes').select('*').eq('inscricao_id', inscricaoId).eq('status', 'confirmada')
  if (error) throw error
  const rows = (data || []).filter((r: any) => dentroDoPeriodo(r, c))
  return { ops: rows.map(linhaParaOperacao), rows }
}

type DireitoRef = { id: string; qtd_emitida: number; status: string }

async function upsertDireito(db: any, base: Record<string, any>): Promise<DireitoRef> {
  const { data, error } = await db
    .from('promocao_direitos')
    .upsert({ ...base, calculado_em: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'inscricao_id,tipo' })
    .select('id, qtd_emitida, status')
    .single()
  if (error) throw error
  return data
}

async function criarGeracaoSeNecessario(
  db: any,
  c: any,
  direito: DireitoRef,
  qtd: number,
  titular: { tipo: 'inscricao' | 'indicador'; id: string; telefone: string },
  snapshot: Record<string, any>,
  vinculos: Array<{ operacaoId: string; valorUtilizadoCentavos: number }>,
): Promise<boolean> {
  const { data: vivas } = await db.from('promocao_geracoes').select('id, qtd').eq('direito_id', direito.id).in('status', ['pendente', 'enviado'])
  if ((vivas || []).some((g: any) => Number(g.qtd) === qtd)) return false
  if ((vivas || []).length) {
    // filtro de status: geração confirmada entre o select e o update (usado) não pode ser cancelada
    await db.from('promocao_geracoes').update({ status: 'cancelado', cancelado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', vivas.map((g: any) => g.id)).in('status', ['pendente', 'enviado'])
    // recarrega o emitido: se mudou, houve confirmação concorrente e a qtd calculada está velha
    // (quem chama enfileira novo recálculo)
    const { data: atual } = await db.from('promocao_direitos').select('qtd_emitida').eq('id', direito.id).single()
    if (Number(atual?.qtd_emitida ?? 0) !== Number(direito.qtd_emitida)) return true
  }
  const { token, hash } = gerarToken()
  const { data: ger, error } = await db
    .from('promocao_geracoes')
    .insert({
      campanha_id: c.id,
      direito_id: direito.id,
      titular_tipo: titular.tipo,
      titular_id: titular.id,
      telefone: titular.telefone,
      qtd,
      token_hash: hash,
      expira_em: c.prazo_geracao_ate,
      snapshot,
    })
    .select('id')
    .single()
  if (error) throw error
  if (vinculos.length) {
    await db.from('promocao_geracao_operacoes').insert(vinculos.map((v) => ({ geracao_id: ger.id, operacao_id: v.operacaoId, valor_utilizado_centavos: v.valorUtilizadoCentavos })))
  }
  await enqueueJob({ kind: 'promocoes.enviar_link_numeros', payload: { geracaoId: ger.id, token }, dedupeKey: `promo-link:${ger.id}`, maxAttempts: 8 })
  return false
}

export async function recalcularDireitos(inscricaoId: string): Promise<void> {
  const db: any = await createAdminClient()
  const { data: insc, error: e1 } = await db.from('promocao_inscricoes').select('*').eq('id', inscricaoId).single()
  if (e1) throw e1
  const { data: c, error: e2 } = await db.from('promocao_campanhas').select('*').eq('id', insc.campanha_id).single()
  if (e2) throw e2
  const p = parametrosDaCampanha(c)

  // CPF bloqueado (servidor ou indicador): não gera direito nem link
  let cpfIndicador: string | null = null
  if (insc.indicacao_id) {
    const { data: i0 } = await db.from('promocao_indicacoes').select('indicador:promocao_indicadores(cpf)').eq('id', insc.indicacao_id).single()
    cpfIndicador = i0?.indicador?.cpf ?? null
  }
  const cpfs = [insc.cpf, cpfIndicador].filter(Boolean)
  const { data: bloq } = await db.from('promocao_cpfs_bloqueados').select('cpf').in('cpf', cpfs).or(`campanha_id.is.null,campanha_id.eq.${c.id}`)
  if (bloq?.length) {
    await db.from('promocao_eventos').insert({ campanha_id: c.id, entidade: 'inscricao', entidade_id: inscricaoId, tipo: 'direitos.bloqueado_cpf', dados: {} })
    return
  }
  const { ops, rows } = await opsValidasDaInscricao(inscricaoId, c)
  const instituicao = new Map<string, string | null>(rows.map((r: any) => [r.id, r.instituicao_texto]))

  const { data: dExist } = await db.from('promocao_direitos').select('id, tipo, qtd_emitida, status').eq('inscricao_id', inscricaoId)
  const exist = (tipo: string) => (dExist || []).find((d: any) => d.tipo === tipo)

  const emitidos = Number(exist('numeros_servidor')?.qtd_emitida || 0)
  const el = calcularElegibilidade(ops, emitidos, p)
  const dServ = await upsertDireito(db, {
    campanha_id: c.id,
    inscricao_id: inscricaoId,
    tipo: 'numeros_servidor',
    qtd_devida: el.numerosDevidos,
    total_elegivel_centavos: el.totalCentavos,
    total_cartao_centavos: el.cartaoCentavos,
    saldo_centavos: el.saldoCentavos,
    cartao_faltante_centavos: el.cartaoFaltanteCentavos,
    proporcao_ok: el.proporcaoOk,
    status: el.numerosAEmitir > 0 ? 'devido' : emitidos > 0 ? (emitidos >= el.numerosDevidos ? 'emitido' : 'emitido_parcial') : 'sem_direito',
  })
  if (el.numerosAEmitir > 0) {
    const { data: usadas } = await db
      .from('promocao_geracoes')
      .select('snapshot, qtd')
      .eq('direito_id', dServ.id)
      .eq('status', 'usado')
    const usadoAnterior = (usadas || []).reduce((s: number, g: any) => s + (Number(g.qtd) / p.numerosPorPasso) * p.passoCentavos, 0)
    const snap = montarSnapshotGeracao(ops, usadoAnterior, el.numerosAEmitir, p)
    const { vinculos, ...resto } = snap
    const snapshot = { ...resto, operacoes: snap.operacoes.map((o) => ({ ...o, instituicao: instituicao.get(o.id) ?? null })) }
    const desatualizado = await criarGeracaoSeNecessario(db, c, dServ, el.numerosAEmitir, { tipo: 'inscricao', id: inscricaoId, telefone: insc.telefone }, snapshot, vinculos)
    if (desatualizado) {
      // confirmação concorrente mudou o emitido: refaz o cálculo logo depois
      await enqueueJob({ kind: 'promocoes.recalcular_direitos', payload: { inscricaoId }, dedupeKey: `promo-recalc:${inscricaoId}:${dServ.qtd_emitida}`, runAfterIso: new Date(Date.now() + 5000).toISOString(), maxAttempts: 5 })
    }
  }

  if (!insc.indicacao_id) return
  const { data: ind } = await db.from('promocao_indicacoes').select('*, indicador:promocao_indicadores(*)').eq('id', insc.indicacao_id).single()
  if (!ind || ind.status !== 'valida') return
  const considerados = operacoesConsideradasParaIndicador(ops, ind.inscrita_em, c.regra_data_indicacao)
  const dir = direitosDoIndicador(considerados, p)
  const e = dir.elegibilidade
  const comum = {
    campanha_id: c.id,
    inscricao_id: inscricaoId,
    indicador_id: ind.indicador_id,
    total_elegivel_centavos: e.totalCentavos,
    total_cartao_centavos: e.cartaoCentavos,
    saldo_centavos: e.saldoCentavos,
    cartao_faltante_centavos: e.cartaoFaltanteCentavos,
    proporcao_ok: e.proporcaoOk,
  }

  const pixAtual = exist('pix_indicador')
  const pixTravado = pixAtual && ['em_remessa', 'pago'].includes(pixAtual.status)
  await upsertDireito(db, {
    ...comum,
    tipo: 'pix_indicador',
    qtd_devida: dir.pixDevido ? 1 : 0,
    valor_centavos: dir.pixDevido ? p.pixIndicadorCentavos : 0,
    ...(pixTravado ? {} : { status: dir.pixDevido ? 'devido' : 'sem_direito' }),
  })
  if (pixTravado && !dir.pixDevido) {
    await db.from('promocao_eventos').insert({ campanha_id: c.id, entidade: 'inscricao', entidade_id: inscricaoId, tipo: 'pix.revisar_apos_invalidacao', dados: { status: pixAtual.status } })
  }

  const numAtual = exist('numero_indicador')
  const emitido = Number(numAtual?.qtd_emitida || 0)
  const devido = Math.max(emitido, dir.numeroDevido ? 1 : 0)
  const dNum = await upsertDireito(db, {
    ...comum,
    tipo: 'numero_indicador',
    qtd_devida: devido,
    status: devido > emitido ? 'devido' : emitido > 0 ? 'emitido' : 'sem_direito',
  })
  if (devido > emitido) {
    const snapshot = {
      operacoes: considerados.map((o) => ({ ...o, instituicao: instituicao.get(o.id) ?? null })),
      totalCentavos: e.totalCentavos,
      usadoAnteriorCentavos: 0,
      usadoNestaCentavos: p.minimoCentavos,
      saldoCentavos: e.totalCentavos - p.minimoCentavos,
    }
    const desatualizado = await criarGeracaoSeNecessario(db, c, dNum, 1, { tipo: 'indicador', id: ind.indicador_id, telefone: ind.indicador.telefone }, snapshot, [])
    if (desatualizado) {
      await enqueueJob({ kind: 'promocoes.recalcular_direitos', payload: { inscricaoId }, dedupeKey: `promo-recalc:${inscricaoId}:${dNum.qtd_emitida}`, runAfterIso: new Date(Date.now() + 5000).toISOString(), maxAttempts: 5 })
    }
  }
}

export async function titularesDosNumeros(db: any, nums: any[]): Promise<Map<string, { nome: string; cpf: string }>> {
  const out = new Map<string, { nome: string; cpf: string }>()
  for (const [tipo, tabela] of [['inscricao', 'promocao_inscricoes'], ['indicador', 'promocao_indicadores']] as const) {
    const ids = [...new Set(nums.filter((n) => n.titular_tipo === tipo).map((n) => n.titular_id))]
    if (!ids.length) continue
    const { data } = await db.from(tabela).select('id, nome, cpf').in('id', ids)
    for (const t of data || []) out.set(`${tipo}:${t.id}`, { nome: t.nome, cpf: t.cpf })
  }
  return out
}
