'use server'

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { LIMITES_PADRAO, estadoAtendimento, validarConfigAtendimento, type EstadoAtendimento, type PatchAtendimento } from './atendimento-config-regras'

// Config do "Solicitar atendimento" (CONTRATO-ATENDIMENTO §6). Só lê/grava as 8 colunas novas;
// nunca conecta/desconecta instância de parceiro (isso é feito no CRM do parceiro).
const RECURSO = 'comercial-promocoes-config'

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const msg = (e: unknown) => (e instanceof Error ? e.message : (e as any)?.message || String(e))

export type ParceiroOpcao = { id: string; arw_code: string | null; nome: string }
/** `numero` já vem MASCARADO (só os 4 últimos dígitos saem do servidor). */
export type InstanciaOpcao = { id: string; nome: string | null; papel: string | null; status: string; numeroMascarado: string; inbox: number | null }
export type ConfigAtendimento = PatchAtendimento

const COLUNAS = [
  'parceiro_atendimento_id', 'instancia_atendimento_id', 'instancia_atendimento_reserva_id', 'atendimento_liberado_em', 'atendimento_pausado',
  'limite_atendimento_indicador_hora', 'limite_atendimento_instancia_hora', 'limite_atendimento_instancia_dia',
] as const

async function ctx(slug: string, acao: 'can_view' | 'can_edit') {
  const { user } = await requirePermission(RECURSO, acao)
  const db: any = await createAdminClient()
  const { data: camp, error } = await db.from('promocao_campanhas').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  if (!camp) throw new Error('Campanha não encontrada.')
  return { db, camp, userId: user.id as string }
}

const configDe = (camp: any): ConfigAtendimento => ({
  parceiro_atendimento_id: camp.parceiro_atendimento_id ?? null,
  instancia_atendimento_id: camp.instancia_atendimento_id ?? null,
  instancia_atendimento_reserva_id: camp.instancia_atendimento_reserva_id ?? null,
  atendimento_liberado_em: camp.atendimento_liberado_em ?? null,
  atendimento_pausado: !!camp.atendimento_pausado,
  limite_atendimento_indicador_hora: camp.limite_atendimento_indicador_hora ?? LIMITES_PADRAO.indicador_hora,
  limite_atendimento_instancia_hora: camp.limite_atendimento_instancia_hora ?? LIMITES_PADRAO.instancia_hora,
  limite_atendimento_instancia_dia: camp.limite_atendimento_instancia_dia ?? LIMITES_PADRAO.instancia_dia,
})

const nomeParceiro = (a: any) => String(a.fantasy_name || a.name || '—')

async function instanciasDoParceiro(db: any, parceiroId: string | null): Promise<InstanciaOpcao[]> {
  if (!parceiroId) return []
  const { data: contas } = await db.from('chat_contas').select('id').eq('agente_parceiro_id', parceiroId)
  const ids = (contas || []).map((c: any) => c.id)
  if (!ids.length) return []
  const { data } = await db.from('chat_instancias').select('id, nome, papel, status, numero, chatwoot_inbox_id').in('conta_id', ids).is('deleted_at', null).order('papel').order('ordem')
  return (data || []).map((i: any) => {
    const d = String(i.numero ?? '').replace(/\D/g, '')
    return {
      id: String(i.id), nome: i.nome ?? null, papel: i.papel ?? null, status: String(i.status), inbox: i.chatwoot_inbox_id ?? null,
      numeroMascarado: !d ? '—' : d.length <= 4 ? d : `${'•'.repeat(d.length - 4)}${d.slice(-4)}`,
    }
  })
}

function resumo(config: ConfigAtendimento, instancias: InstanciaOpcao[]): { estado: EstadoAtendimento; principal: InstanciaOpcao | null; reserva: InstanciaOpcao | null } {
  const principal = instancias.find((i) => i.id === config.instancia_atendimento_id) ?? null
  const reserva = instancias.find((i) => i.id === config.instancia_atendimento_reserva_id) ?? null
  return {
    principal, reserva,
    estado: estadoAtendimento({ ...config, principalStatus: principal?.status ?? null, reservaStatus: reserva?.status ?? null }, new Date()),
  }
}

export async function getConfigAtendimento(slug: string): Promise<R<{ config: ConfigAtendimento; colunasAusentes: boolean; parceiro: ParceiroOpcao | null; instancias: InstanciaOpcao[]; estado: EstadoAtendimento; principal: InstanciaOpcao | null; reserva: InstanciaOpcao | null }>> {
  try {
    const { db, camp } = await ctx(slug, 'can_view')
    const config = configDe(camp)
    let parceiro: ParceiroOpcao | null = null
    if (config.parceiro_atendimento_id) {
      const { data } = await db.from('agentes_parceiros').select('id, arw_code, name, fantasy_name').eq('id', config.parceiro_atendimento_id).maybeSingle()
      if (data) parceiro = { id: data.id, arw_code: data.arw_code ?? null, nome: nomeParceiro(data) }
    }
    const instancias = await instanciasDoParceiro(db, config.parceiro_atendimento_id)
    return { ok: true, config, colunasAusentes: !('limite_atendimento_indicador_hora' in camp), parceiro, instancias, ...resumo(config, instancias) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/** Busca por código ARW ou nome; só parceiros que têm conta de chat. */
export async function buscarParceirosAtendimento(slug: string, q: string): Promise<R<{ parceiros: ParceiroOpcao[] }>> {
  try {
    const { db } = await ctx(slug, 'can_view')
    const termo = q.replace(/[%,()*]/g, ' ').trim()
    let qb = db.from('agentes_parceiros').select('id, arw_code, name, fantasy_name').order('arw_code').limit(15)
    if (termo) qb = qb.or(`arw_code.ilike.%${termo}%,name.ilike.%${termo}%,fantasy_name.ilike.%${termo}%`)
    const { data } = await qb
    const ids = (data || []).map((a: any) => a.id)
    const { data: contas } = ids.length ? await db.from('chat_contas').select('agente_parceiro_id').in('agente_parceiro_id', ids) : { data: [] }
    const comConta = new Set((contas || []).map((c: any) => c.agente_parceiro_id))
    return { ok: true, parceiros: (data || []).filter((a: any) => comConta.has(a.id)).map((a: any) => ({ id: a.id, arw_code: a.arw_code ?? null, nome: nomeParceiro(a) })) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function listarInstanciasDoParceiro(slug: string, parceiroId: string): Promise<R<{ instancias: InstanciaOpcao[] }>> {
  try {
    const { db } = await ctx(slug, 'can_view')
    return { ok: true, instancias: await instanciasDoParceiro(db, parceiroId) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

/** Polling leve (10 s): estado + status da principal/reserva. */
export async function statusInstanciasAtendimento(slug: string): Promise<R<{ estado: EstadoAtendimento; principal: InstanciaOpcao | null; reserva: InstanciaOpcao | null }>> {
  const r = await getConfigAtendimento(slug)
  return r.ok ? { ok: true, estado: r.estado, principal: r.principal, reserva: r.reserva } : r
}

export async function salvarConfigAtendimento(slug: string, patch: PatchAtendimento): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, 'can_edit')
    if (!('limite_atendimento_indicador_hora' in camp)) throw new Error('As colunas do atendimento ainda não existem no banco (migration promocao_atendimento não aplicada).')
    const row: PatchAtendimento = {
      parceiro_atendimento_id: patch.parceiro_atendimento_id || null,
      instancia_atendimento_id: patch.instancia_atendimento_id || null,
      instancia_atendimento_reserva_id: patch.instancia_atendimento_reserva_id || null,
      atendimento_liberado_em: patch.atendimento_liberado_em || null,
      atendimento_pausado: !!patch.atendimento_pausado,
      limite_atendimento_indicador_hora: Number(patch.limite_atendimento_indicador_hora),
      limite_atendimento_instancia_hora: Number(patch.limite_atendimento_instancia_hora),
      limite_atendimento_instancia_dia: Number(patch.limite_atendimento_instancia_dia),
    }
    if (row.parceiro_atendimento_id) {
      const { data: p } = await db.from('agentes_parceiros').select('id').eq('id', row.parceiro_atendimento_id).maybeSingle()
      if (!p) throw new Error('Parceiro não encontrado.')
    }
    const instancias = await instanciasDoParceiro(db, row.parceiro_atendimento_id)
    const antes = configDe(camp)
    // ponytail: trocar o parceiro limpa instâncias que não são dele (contrato §6) em vez de falhar
    const ids = new Set(instancias.map((i) => i.id))
    if (row.parceiro_atendimento_id !== antes.parceiro_atendimento_id) {
      if (row.instancia_atendimento_id && !ids.has(row.instancia_atendimento_id)) row.instancia_atendimento_id = null
      if (row.instancia_atendimento_reserva_id && !ids.has(row.instancia_atendimento_reserva_id)) row.instancia_atendimento_reserva_id = null
    }
    const erro = validarConfigAtendimento(row, {
      instanciaOtpId: camp.instancia_id ?? null,
      instancias: instancias.map((i) => ({ id: i.id, status: i.status })),
      anterior: { principalId: antes.instancia_atendimento_id, reservaId: antes.instancia_atendimento_reserva_id },
    })
    if (erro) throw new Error(erro)

    const mudancas: Record<string, { antes: unknown; depois: unknown }> = {}
    for (const k of COLUNAS) {
      const a = antes[k], d = row[k]
      const igual = k === 'atendimento_liberado_em' ? (a ? new Date(a as string).getTime() : null) === (d ? new Date(d as string).getTime() : null) : a === d
      if (!igual) mudancas[k] = { antes: a ?? null, depois: d ?? null }
    }
    const { error } = await db.from('promocao_campanhas').update({ ...row, updated_at: new Date().toISOString() }).eq('id', camp.id)
    if (error) throw error
    await db.from('promocao_eventos').insert({
      campanha_id: camp.id, entidade: 'campanha', entidade_id: camp.id, tipo: 'campanha.atendimento_config_alterada',
      dados: { campos: Object.keys(mudancas), mudancas }, ator_user_id: userId,
    })
    revalidatePath(`/promocoes/${slug}/config`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}
