'use server'

/**
 * Promoções › telas internas (frente C). Toda action passa por
 * requirePermission e devolve { ok, ... } sem lançar para a UI. CPF só sai
 * mascarado nas listagens; Pix completo só por `revelarPix` (permissão da
 * remessa, com evento de auditoria).
 */
import { revalidatePath } from 'next/cache'
import { hasPermissionForUser, requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/scp-engine/queue'
import type { PermissionAction } from '@/lib/auth/permissions'
import { somenteDigitos, cpfValido } from './validacao'
import { mascararCpf, mascararPix, mascararTelefone } from './mascara'
import { prazoLink } from './dias-uteis'
import { AVISO_INDICACAO_POSTERIOR, calcularElegibilidade, direitosDoIndicador, indicacaoVale, inscricaoPodeSerIndicada, operacoesConsideradasParaIndicador } from './elegibilidade'
import { dentroDoPeriodo, opsValidasDaInscricao, parametrosDaCampanha, primeiraDigitacaoDaInscricao, recalcularDireitos, titularesDosNumeros } from './direitos-service'
import type { OperacaoConfirmada, TipoOperacao } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CH = 'comercial-promocoes'
const TIPOS: TipoOperacao[] = ['novo', 'refinanciamento', 'portabilidade', 'saque_cartao_consignado', 'saque_cartao_beneficio', 'outro']

type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : (e as any)?.message || String(e))

async function ctx(slug: string, chave = CH, acao: PermissionAction = 'can_view') {
  const { user } = await requirePermission(chave, acao)
  const db: any = await createAdminClient()
  const { data: camp, error } = await db.from('promocao_campanhas').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!camp) throw new Error('Campanha não encontrada.')
  return { db, camp, userId: user.id as string }
}

async function evento(db: any, campanhaId: string, entidade: string, entidadeId: string, tipo: string, dados: any, userId: string | null) {
  await db.from('promocao_eventos').insert({ campanha_id: campanhaId, entidade, entidade_id: entidadeId, tipo, dados, ator_user_id: userId })
}

const like = (q: string) => `%${q.replace(/[%,()]/g, ' ').trim()}%`

/* ------------------------------ painel ------------------------------ */

export async function getPainel(slug: string): Promise<R<{ campanha: any; kpis: Record<string, number>; links: any[] }>> {
  try {
    const { db, camp } = await ctx(slug)
    const cnt = async (t: string, f?: (q: any) => any) => {
      const q = db.from(t).select('id', { count: 'exact', head: true }).eq('campanha_id', camp.id)
      const { count } = await (f ? f(q) : q)
      return count || 0
    }
    const [inscritos, indicacoes, opsInformadas, opsConfirmadas, numeros, pixDevidos] = await Promise.all([
      cnt('promocao_inscricoes', (q) => q.eq('status', 'ativa')),
      cnt('promocao_indicacoes', (q) => q.eq('status', 'valida')),
      cnt('promocao_operacoes', (q) => q.eq('status', 'informada')),
      cnt('promocao_operacoes', (q) => q.eq('status', 'confirmada')),
      cnt('promocao_numeros', (q) => q.eq('status', 'valido')),
      cnt('promocao_direitos', (q) => q.eq('tipo', 'pix_indicador').eq('status', 'devido')),
    ])
    const { data: gers } = await db
      .from('promocao_geracoes')
      .select('id, titular_tipo, titular_id, qtd, status, created_at, enviado_em')
      .eq('campanha_id', camp.id)
      .in('status', ['pendente', 'enviado'])
      .order('created_at')
      .limit(200)
    const links = await Promise.all(
      (gers || []).map(async (g: any) => {
        const tabela = g.titular_tipo === 'inscricao' ? 'promocao_inscricoes' : 'promocao_indicadores'
        const { data: t } = await db.from(tabela).select('nome, cpf').eq('id', g.titular_id).maybeSingle()
        return { ...g, nome: t?.nome || '—', cpf: t?.cpf ? mascararCpf(t.cpf) : '', prazo: prazoLink(g.created_at) }
      }),
    )
    return { ok: true, campanha: camp, kpis: { inscritos, indicacoes, opsInformadas, opsConfirmadas, numeros, pixDevidos }, links }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ----------------------------- inscritos ---------------------------- */

export async function listarInscritos(slug: string, q = ''): Promise<R<{ items: any[] }>> {
  try {
    const { db, camp } = await ctx(slug)
    let query = db
      .from('promocao_inscricoes')
      .select('id, codigo, cpf, nome, telefone, origem, status, telefone_verificado, wesales_status, wesales_erro, created_at, indicacao:promocao_indicacoes!promocao_inscricoes_indicacao_fk(numero, indicador:promocao_indicadores(nome))')
      .eq('campanha_id', camp.id)
      .order('created_at', { ascending: false })
      .limit(500)
    const t = q.trim()
    if (t) {
      const d = somenteDigitos(t)
      query = query.or(`nome.ilike.${like(t)},codigo.ilike.${like(t)}${d.length >= 3 ? `,cpf.like.${d}%,telefone.like.%${d}%` : ''}`)
    }
    const { data, error } = await query
    if (error) throw error
    const ids = (data || []).map((i: any) => i.id)
    const { data: dir } = ids.length ? await db.from('promocao_direitos').select('inscricao_id, qtd_emitida, total_elegivel_centavos, saldo_centavos').eq('tipo', 'numeros_servidor').in('inscricao_id', ids) : { data: [] }
    const porInsc = new Map((dir || []).map((d: any) => [d.inscricao_id, d]))
    const items = (data || []).map((i: any) => {
      const d: any = porInsc.get(i.id)
      return {
        id: i.id,
        codigo: i.codigo,
        nome: i.nome,
        cpf: mascararCpf(i.cpf),
        telefone: mascararTelefone(i.telefone),
        origem: i.origem,
        status: i.status,
        verificado: i.telefone_verificado,
        wesales: i.wesales_status,
        wesalesErro: i.wesales_erro,
        criadoEm: i.created_at,
        numeroIndicacao: i.indicacao?.numero || null,
        indicador: i.indicacao?.indicador?.nome || null,
        totalCentavos: Number(d?.total_elegivel_centavos || 0),
        numeros: Number(d?.qtd_emitida || 0),
        saldoCentavos: Number(d?.saldo_centavos || 0),
      }
    })
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function reenviarWesales(slug: string, inscricaoId: string): Promise<R> {
  try {
    await ctx(slug, CH, 'can_edit')
    const r = await enqueueJob({ kind: 'promocoes.wesales_sync', payload: { inscricaoId }, dedupeKey: `promo-wesales:${inscricaoId}:${Date.now()}`, maxAttempts: 8 })
    if (r.error) throw new Error(r.error)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ---------------------------- indicações ---------------------------- */

export async function listarIndicacoes(slug: string, q = ''): Promise<R<{ items: any[] }>> {
  try {
    const { db, camp } = await ctx(slug)
    const { data, error } = await db
      .from('promocao_indicacoes')
      .select('id, numero, status, inscrita_em, cpf_indicado, inscricao_id, indicador:promocao_indicadores(id, nome, cpf, telefone, pix_tipo, pix_chave, pix_atualizado_em), inscricao:promocao_inscricoes!promocao_indicacoes_inscricao_id_fkey(id, nome, codigo, indicacao_id)')
      .eq('campanha_id', camp.id)
      .order('inscrita_em', { ascending: false })
      .limit(500)
    if (error) throw error
    const ids = (data || []).map((i: any) => i.inscricao_id)
    const { data: dir } = ids.length ? await db.from('promocao_direitos').select('inscricao_id, tipo, status, total_elegivel_centavos, proporcao_ok').in('inscricao_id', ids).in('tipo', ['pix_indicador', 'numero_indicador']) : { data: [] }
    const t = q.trim().toLowerCase()
    const sete = Date.now() - 7 * 86400000
    const items = (data || [])
      .map((i: any) => {
        const pix = (dir || []).find((d: any) => d.inscricao_id === i.inscricao_id && d.tipo === 'pix_indicador')
        const num = (dir || []).find((d: any) => d.inscricao_id === i.inscricao_id && d.tipo === 'numero_indicador')
        return {
          id: i.id,
          numero: i.numero,
          status: i.status,
          inscritaEm: i.inscrita_em,
          indicadorId: i.indicador?.id,
          indicador: i.indicador?.nome,
          indicadorCpf: mascararCpf(i.indicador?.cpf || ''),
          indicadorTel: mascararTelefone(i.indicador?.telefone || ''),
          pix: mascararPix(i.indicador?.pix_tipo, i.indicador?.pix_chave),
          pixAlteradoRecente: !!i.indicador?.pix_atualizado_em && new Date(i.indicador.pix_atualizado_em).getTime() > sete,
          indicado: i.inscricao?.nome,
          indicadoCpf: mascararCpf(i.cpf_indicado),
          codigoIndicado: i.inscricao?.codigo,
          inscricaoId: i.inscricao?.id,
          vinculada: i.inscricao?.indicacao_id === i.id,
          pixStatus: pix?.status || 'sem_direito',
          numeroStatus: num?.status || 'sem_direito',
          totalCentavos: Number(pix?.total_elegivel_centavos || 0),
        }
      })
      .filter((i: any) => !t || [i.numero, i.indicador, i.indicado, i.codigoIndicado].some((v) => String(v || '').toLowerCase().includes(t)))
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function vincularManual(slug: string, inscricaoId: string, indicacaoId: string): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, CH, 'can_edit')
    const { data: insc } = await db.from('promocao_inscricoes').select('*').eq('id', inscricaoId).eq('campanha_id', camp.id).maybeSingle()
    const { data: ind } = await db.from('promocao_indicacoes').select('*').eq('id', indicacaoId).eq('campanha_id', camp.id).maybeSingle()
    if (!insc || !ind) throw new Error('Inscrição ou indicação não encontrada.')
    if (insc.indicacao_id) throw new Error('Esta inscrição já tem indicação vinculada.')
    if (ind.status !== 'valida') throw new Error('A indicação não está válida.')
    if (insc.cpf !== ind.cpf_indicado) throw new Error('O CPF da inscrição não confere com o CPF indicado.')
    if (camp.regra_data_indicacao !== 'sem_restricao') {
      if (!inscricaoPodeSerIndicada(insc.origem, insc.created_at, ind.inscrita_em)) {
        throw new Error('Inscrição direta/anterior à indicação: não pode ser vinculada retroativamente (regulamento §9.4).')
      }
      if (!indicacaoVale(ind.inscrita_em, await primeiraDigitacaoDaInscricao(insc.id))) {
        throw new Error('Já existe proposta cadastrada antes da indicação: não pode ser vinculada (regulamento §9.4).')
      }
    }
    const { error } = await db.from('promocao_inscricoes').update({ indicacao_id: ind.id, updated_at: new Date().toISOString() }).eq('id', insc.id)
    if (error) throw error
    await evento(db, camp.id, 'inscricao', insc.id, 'indicacao.vinculo_manual', { indicacaoId: ind.id, numero: ind.numero }, userId)
    await recalcularDireitos(insc.id)
    revalidatePath(`/promocoes/${slug}`, 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/** Pix completo do indicador: restrito à permissão da remessa e auditado. */
export async function revelarPix(slug: string, indicadorId: string): Promise<R<{ texto: string }>> {
  try {
    const { db, camp, userId } = await ctx(slug, 'comercial-promocoes-remessa')
    const { data: i } = await db.from('promocao_indicadores').select('pix_tipo, pix_chave, banco_nome, agencia, conta').eq('id', indicadorId).eq('campanha_id', camp.id).maybeSingle()
    if (!i) throw new Error('Indicador não encontrado.')
    await evento(db, camp.id, 'indicador', indicadorId, 'indicador.pix_revelado', {}, userId)
    const texto = i.pix_tipo === 'dados_bancarios' ? `${i.banco_nome || 'Banco'} ag. ${i.agencia} c/c ${i.conta}` : `${i.pix_tipo}: ${i.pix_chave}`
    return { ok: true, texto }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ----------------------------- operações ---------------------------- */

export async function listarOperacoes(slug: string, q = '', status = ''): Promise<R<{ items: any[] }>> {
  try {
    const { db, camp } = await ctx(slug)
    let query = db
      .from('promocao_operacoes')
      .select('*, inscricao:promocao_inscricoes(nome, cpf, codigo)')
      .eq('campanha_id', camp.id)
      .order('created_at', { ascending: false })
      .limit(500)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw error
    const t = q.trim().toLowerCase()
    const d = somenteDigitos(q)
    const items = (data || [])
      .filter((o: any) => !t || String(o.inscricao?.nome || '').toLowerCase().includes(t) || String(o.numero_proposta || '').toLowerCase().includes(t) || String(o.inscricao?.codigo || '').toLowerCase().includes(t) || (d.length >= 3 && String(o.inscricao?.cpf || '').startsWith(d)))
      .map((o: any) => ({
        id: o.id,
        inscricaoId: o.inscricao_id,
        nome: o.inscricao?.nome,
        cpf: mascararCpf(o.inscricao?.cpf || ''),
        codigo: o.inscricao?.codigo,
        tipo: o.tipo,
        valorCentavos: Number(o.valor_liquido_centavos),
        dataDigitacao: o.data_digitacao,
        dataPagamento: o.data_pagamento,
        instituicao: o.instituicao_texto,
        instituicaoId: o.instituicao_financeira_id,
        proposta: o.numero_proposta,
        status: o.status,
        motivo: o.motivo_invalidacao,
        observacao: o.observacao,
        foraDoPeriodo: !dentroDoPeriodo(o, camp),
      }))
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function listarInstituicoes(): Promise<R<{ items: Array<{ id: string; nome: string }> }>> {
  try {
    await requirePermission(CH)
    const db: any = await createAdminClient()
    const { data } = await db.from('financial_institutions').select('id, name').order('name')
    return { ok: true, items: (data || []).map((i: any) => ({ id: i.id, nome: i.name })) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export type OperacaoInput = {
  id?: string
  cpf: string
  tipo: TipoOperacao
  valorCentavos: number
  dataDigitacao: string
  dataPagamento: string | null
  instituicaoId: string | null
  instituicaoTexto: string | null
  numeroProposta: string | null
  observacao: string | null
}

export async function salvarOperacao(slug: string, i: OperacaoInput): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, CH, i.id ? 'can_edit' : 'can_include')
    if (!TIPOS.includes(i.tipo)) throw new Error('Tipo de operação inválido.')
    if (!Number.isInteger(i.valorCentavos) || i.valorCentavos <= 0) throw new Error('Informe o valor líquido creditado.')
    if (!i.dataDigitacao) throw new Error('Informe a data de digitação na financeira.')
    const { data: insc } = await db.from('promocao_inscricoes').select('id, status').eq('campanha_id', camp.id).eq('cpf', somenteDigitos(i.cpf)).maybeSingle()
    if (!insc) throw new Error('CPF sem inscrição nesta campanha. O servidor precisa se cadastrar (direto ou por indicação) antes.')
    if (insc.status !== 'ativa') throw new Error('Inscrição cancelada.')
    const row = {
      inscricao_id: insc.id,
      tipo: i.tipo,
      valor_liquido_centavos: i.valorCentavos,
      data_digitacao: i.dataDigitacao,
      data_pagamento: i.dataPagamento || null,
      instituicao_financeira_id: i.instituicaoId || null,
      instituicao_texto: i.instituicaoTexto?.trim() || null,
      numero_proposta: i.numeroProposta?.trim() || null,
      observacao: i.observacao?.trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (i.id) {
      const { data: atual } = await db.from('promocao_operacoes').select('status').eq('id', i.id).maybeSingle()
      if (atual?.status !== 'informada') throw new Error('Só operação "informada" pode ser editada.')
      const { error } = await db.from('promocao_operacoes').update(row).eq('id', i.id)
      if (error) throw error
    } else {
      const { error } = await db.from('promocao_operacoes').insert({ ...row, campanha_id: camp.id, created_by: userId })
      if (error) throw error
    }
    revalidatePath(`/promocoes/${slug}/operacoes`)
    return { ok: true }
  } catch (e) {
    const m = msg(e)
    return { ok: false, error: /23505|duplicate key/.test(m) ? 'Já existe operação com esta proposta nesta financeira.' : m }
  }
}

export async function excluirOperacao(slug: string, id: string): Promise<R> {
  try {
    const { db } = await ctx(slug, CH, 'can_edit')
    const { error } = await db.from('promocao_operacoes').delete().eq('id', id).eq('status', 'informada')
    if (error) throw error
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function confirmarOperacao(slug: string, id: string): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, CH, 'can_edit')
    const { data: op } = await db.from('promocao_operacoes').select('*, inscricao:promocao_inscricoes(cpf)').eq('id', id).eq('campanha_id', camp.id).maybeSingle()
    if (!op) throw new Error('Operação não encontrada.')
    if (op.status !== 'informada') throw new Error('Só operação "informada" pode ser confirmada.')
    if (!op.data_pagamento) throw new Error('Informe a data de pagamento do crédito antes de confirmar.')
    if (!dentroDoPeriodo(op, camp)) throw new Error('Digitação e pagamento precisam estar dentro do período da campanha. Invalide a operação ou corrija as datas.')
    const { data: bloq } = await db
      .from('promocao_cpfs_bloqueados')
      .select('id')
      .eq('cpf', op.inscricao.cpf)
      .or(`campanha_id.is.null,campanha_id.eq.${camp.id}`)
      .limit(1)
    if (bloq?.length) throw new Error('CPF impedido de participar (lista de bloqueados).')
    const agora = new Date().toISOString()
    const { error } = await db.from('promocao_operacoes').update({ status: 'confirmada', confirmada_em: agora, confirmada_por: userId, updated_at: agora }).eq('id', id)
    if (error) throw error
    await evento(db, camp.id, 'operacao', id, 'operacao.confirmada', {}, userId)
    await recalcularDireitos(op.inscricao_id)
    revalidatePath(`/promocoes/${slug}`, 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function invalidarOperacao(slug: string, id: string, motivo: string): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, CH, 'can_edit')
    if (!motivo.trim()) throw new Error('Informe o motivo da invalidação.')
    const { data: op } = await db.from('promocao_operacoes').select('inscricao_id, status').eq('id', id).eq('campanha_id', camp.id).maybeSingle()
    if (!op) throw new Error('Operação não encontrada.')
    if (op.status === 'invalidada') throw new Error('Operação já invalidada.')
    const agora = new Date().toISOString()
    const { error } = await db.from('promocao_operacoes').update({ status: 'invalidada', motivo_invalidacao: motivo.trim(), invalidada_em: agora, invalidada_por: userId, updated_at: agora }).eq('id', id)
    if (error) throw error
    await evento(db, camp.id, 'operacao', id, 'operacao.invalidada', { motivo: motivo.trim(), statusAnterior: op.status }, userId)
    if (op.status === 'confirmada') await recalcularDireitos(op.inscricao_id)
    revalidatePath(`/promocoes/${slug}`, 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export type DraftOp = { tipo: TipoOperacao; valorCentavos: number; dataDigitacao: string; dataPagamento: string | null }

/** Cálculo ao vivo por CPF (ou id da inscrição): estado atual (só confirmadas) e "se esta operação fosse confirmada". */
export async function calcularCpf(slug: string, cpf: string, draft?: DraftOp | null): Promise<R<{ encontrado: boolean; inscricao?: any; atual?: any; comRascunho?: any; indicador?: any }>> {
  try {
    const { db, camp } = await ctx(slug)
    const porId = /^[0-9a-f-]{36}$/.test(cpf)
    const d = somenteDigitos(cpf)
    if (!porId && d.length !== 11) return { ok: true, encontrado: false }
    const { data: insc } = await db.from('promocao_inscricoes').select('id, nome, codigo, indicacao_id, status').eq('campanha_id', camp.id).eq(porId ? 'id' : 'cpf', porId ? cpf : d).maybeSingle()
    if (!insc) return { ok: true, encontrado: false }
    const p = parametrosDaCampanha(camp)
    const { ops } = await opsValidasDaInscricao(insc.id, camp)
    const { data: dir } = await db.from('promocao_direitos').select('qtd_emitida').eq('inscricao_id', insc.id).eq('tipo', 'numeros_servidor').maybeSingle()
    const emitidos = Number(dir?.qtd_emitida || 0)
    const atual = calcularElegibilidade(ops, emitidos, p)
    const rasc: OperacaoConfirmada[] | null =
      draft && draft.valorCentavos > 0 ? [...ops, { id: 'rascunho', tipo: draft.tipo, valorCentavos: draft.valorCentavos, dataDigitacao: draft.dataDigitacao, dataPagamento: draft.dataPagamento }] : null
    const comRascunho = rasc ? calcularElegibilidade(rasc, emitidos, p) : null
    let indicador: any = null
    if (insc.indicacao_id) {
      const { data: ind } = await db.from('promocao_indicacoes').select('inscrita_em, indicador:promocao_indicadores(nome)').eq('id', insc.indicacao_id).maybeSingle()
      if (ind) {
        const primeira = await primeiraDigitacaoDaInscricao(insc.id)
        const primeiraRasc = rasc && draft && (!primeira || draft.dataDigitacao < primeira) ? draft.dataDigitacao : primeira
        const calc = (o: OperacaoConfirmada[], prim: string | null) => {
          const r = direitosDoIndicador(operacoesConsideradasParaIndicador(o, ind.inscrita_em, camp.regra_data_indicacao, prim), p)
          return { pixDevido: r.pixDevido, numeroDevido: r.numeroDevido, totalCentavos: r.elegibilidade.totalCentavos }
        }
        const vale = (prim: string | null) => camp.regra_data_indicacao !== 'digitacao_apos_inscricao' || indicacaoVale(ind.inscrita_em, prim)
        indicador = {
          nome: ind.indicador?.nome,
          atual: calc(ops, primeira),
          comRascunho: rasc ? calc(rasc, primeiraRasc) : null,
          aviso: vale(primeira) ? null : AVISO_INDICACAO_POSTERIOR,
          avisoComRascunho: rasc && !vale(primeiraRasc) ? AVISO_INDICACAO_POSTERIOR : null,
        }
      }
    }
    return { ok: true, encontrado: true, inscricao: { id: insc.id, nome: insc.nome, codigo: insc.codigo, status: insc.status, emitidos }, atual, comRascunho, indicador }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ------------------------------ números ----------------------------- */

export async function listarNumeros(slug: string, q = ''): Promise<R<{ items: any[] }>> {
  try {
    const { db, camp } = await ctx(slug)
    const { data, error } = await db
      .from('promocao_numeros')
      .select('id, numero, status, titular_tipo, titular_id, inscricao_id, created_at, motivo, geracao_id, inscricao:promocao_inscricoes(codigo, indicacao:promocao_indicacoes!promocao_inscricoes_indicacao_fk(numero, indicador:promocao_indicadores(nome)))')
      .eq('campanha_id', camp.id)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw error
    const tit = await titularesDosNumeros(db, data || [])
    const t = q.trim().toLowerCase()
    const items = (data || [])
      .map((n: any) => {
        const x = tit.get(`${n.titular_tipo}:${n.titular_id}`)
        return {
          id: n.id,
          numero: String(n.numero).padStart(5, '0'),
          status: n.status,
          titularTipo: n.titular_tipo,
          titular: x?.nome || '—',
          cpf: x ? mascararCpf(x.cpf) : '',
          codigo: n.inscricao?.codigo,
          indicador: n.titular_tipo === 'indicador' ? null : n.inscricao?.indicacao?.indicador?.nome || null,
          origem: n.titular_tipo === 'indicador' ? 'Número do indicador' : n.inscricao?.indicacao ? 'Servidor indicado' : 'Servidor (direto)',
          geradoEm: n.created_at,
          motivo: n.motivo,
        }
      })
      .filter((n: any) => !t || [n.numero, n.titular, n.codigo].some((v) => String(v || '').toLowerCase().includes(t)))
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function desconsiderarNumero(slug: string, id: string, motivo: string): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, CH, 'can_edit')
    if (!motivo.trim()) throw new Error('Informe o motivo.')
    const { error } = await db
      .from('promocao_numeros')
      .update({ status: 'desconsiderado', desconsiderado_em: new Date().toISOString(), desconsiderado_por: userId, motivo: motivo.trim() })
      .eq('id', id)
      .eq('campanha_id', camp.id)
    if (error) throw error
    await evento(db, camp.id, 'numero', id, 'numero.desconsiderado', { motivo: motivo.trim() }, userId)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ---------------------------- bloqueados ---------------------------- */

export async function listarBloqueados(slug: string): Promise<R<{ items: any[] }>> {
  try {
    const { db, camp } = await ctx(slug, 'comercial-promocoes-bloqueados')
    const { data, error } = await db.from('promocao_cpfs_bloqueados').select('*').or(`campanha_id.is.null,campanha_id.eq.${camp.id}`).order('created_at', { ascending: false })
    if (error) throw error
    return { ok: true, items: (data || []).map((b: any) => ({ id: b.id, cpf: mascararCpf(b.cpf), nome: b.nome, motivo: b.motivo, todas: !b.campanha_id, criadoEm: b.created_at })) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function adicionarBloqueado(slug: string, i: { cpf: string; nome: string; motivo: string; todas: boolean }): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, 'comercial-promocoes-bloqueados', 'can_include')
    const cpf = somenteDigitos(i.cpf)
    if (!cpfValido(cpf)) throw new Error('CPF inválido.')
    if (!i.motivo.trim()) throw new Error('Informe o motivo (ex.: sócio, funcionário ou parente).')
    const { error } = await db.from('promocao_cpfs_bloqueados').insert({ campanha_id: i.todas ? null : camp.id, cpf, nome: i.nome.trim() || null, motivo: i.motivo.trim(), criado_por: userId })
    if (error) throw error.code === '23505' ? new Error('CPF já está na lista.') : error
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function removerBloqueado(slug: string, id: string): Promise<R> {
  try {
    const { db } = await ctx(slug, 'comercial-promocoes-bloqueados', 'can_edit')
    const { error } = await db.from('promocao_cpfs_bloqueados').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/* ----------------------------- configuração ------------------------- */

export async function getConfig(slug: string): Promise<R<{ campanha: any; convenios: Array<{ id: string; nome: string }>; podeEditar: boolean }>> {
  try {
    const { db, camp, userId } = await ctx(slug, 'comercial-promocoes-config')
    const podeEditar = await hasPermissionForUser(userId, 'comercial-promocoes-config', 'can_edit')
    const { data: conv } = await db.from('convenios').select('id, nome').order('nome')
    return { ok: true, campanha: camp, convenios: conv || [], podeEditar }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

const CAMPOS_CONFIG = [
  'nome', 'status', 'convenio_id', 'cidade', 'uf', 'inicio_em', 'fim_em', 'prazo_geracao_ate', 'data_sorteio', 'prefixo_codigo', 'prefixo_indicacao',
  'minimo_centavos', 'passo_numeros_centavos', 'numeros_por_passo', 'pix_indicador_centavos', 'faixas_cartao', 'regra_data_indicacao', 'otp_obrigatorio',
  'telefone_contato', 'site_base_url', 'regulamento_url', 'regulamento_versao', 'wesales_funil_nome', 'wesales_etapa_nome', 'wesales_tags',
  'pagador_cnpj', 'pagador_nome', 'pixel_meta_id', 'ga4_id', 'gads_id',
]

export async function salvarConfig(slug: string, patch: Record<string, any>): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, 'comercial-promocoes-config', 'can_edit')
    const row: Record<string, any> = {}
    for (const k of CAMPOS_CONFIG) if (k in patch) row[k] = patch[k]
    if ('faixas_cartao' in row) {
      const f = row.faixas_cartao
      if (!Array.isArray(f) || !f.length || f.some((x: any) => typeof x.pct !== 'number' || (x.ate !== null && typeof x.ate !== 'number'))) throw new Error('Faixas de cartão inválidas.')
    }
    if (row.telefone_contato) row.telefone_contato = somenteDigitos(row.telefone_contato)
    row.updated_at = new Date().toISOString()
    const { error } = await db.from('promocao_campanhas').update(row).eq('id', camp.id)
    if (error) throw error
    await evento(db, camp.id, 'campanha', camp.id, 'campanha.config_alterada', { campos: Object.keys(row) }, userId)
    revalidatePath(`/promocoes/${slug}`, 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}
