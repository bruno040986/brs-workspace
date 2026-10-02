import { NextRequest, NextResponse } from 'next/server'
import { hashToken } from './codigos'

export type Admin = any

export type GeracaoCarregada = {
  g: any
  campanha: any
  estado: 'ok' | 'invalido' | 'encerrado'
}

export function erro(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status })
}

export const LINK_INVALIDO = () => erro(404, 'LINK_INVALIDO', 'Este link não é válido ou já foi utilizado. Fale com a NuAzul.')
export const PRAZO_ENCERRADO = () => erro(410, 'PRAZO_ENCERRADO', 'O prazo para gerar seus números terminou.')
export const LIMITE_EXCEDIDO = () => erro(429, 'LIMITE_EXCEDIDO', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.')

export function ipDe(request: NextRequest): string {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
}

export function uaDe(request: NextRequest): string {
  return (request.headers.get('user-agent') || '').slice(0, 300)
}

/** true = estourou o limite (fail-closed se o RPC falhar). */
export async function limiteExcedido(admin: Admin, chave: string, limite: number, janelaSeg: number): Promise<boolean> {
  const { data, error } = await admin.rpc('promocao_limite_tentar', { p_chave: chave, p_limite: limite, p_janela_seg: janelaSeg })
  if (error) return true
  return data !== true
}

export function tokenValido(t: unknown): t is string {
  return typeof t === 'string' && t.length >= 20 && t.length <= 200
}

/** `aceitaUsado`: o comprovante pode ser pedido depois da geração. */
export async function carregarGeracao(admin: Admin, token: string, aceitaUsado = false): Promise<GeracaoCarregada | null> {
  const { data: g } = await admin.from('promocao_geracoes').select('*').eq('token_hash', hashToken(token)).maybeSingle()
  if (!g) return null
  const { data: campanha } = await admin.from('promocao_campanhas').select('*').eq('id', g.campanha_id).maybeSingle()
  if (!campanha || !['ativa', 'encerrada_cadastro'].includes(campanha.status)) return { g, campanha, estado: 'invalido' }

  const agora = Date.now()
  const vivo = g.status === 'pendente' || g.status === 'enviado'
  const limite = Math.min(Date.parse(g.expira_em), Date.parse(campanha.prazo_geracao_ate))
  if (vivo) return { g, campanha, estado: agora > limite ? 'encerrado' : 'ok' }
  if (g.status === 'usado' && aceitaUsado) return { g, campanha, estado: 'ok' }
  return { g, campanha, estado: 'invalido' }
}

export async function carregarTitular(admin: Admin, g: any): Promise<any | null> {
  const tabela = g.titular_tipo === 'indicador' ? 'promocao_indicadores' : 'promocao_inscricoes'
  const { data } = await admin.from(tabela).select('*').eq('id', g.titular_id).maybeSingle()
  return data || null
}

export async function numerosDaGeracao(admin: Admin, geracaoId: string): Promise<number[]> {
  const { data } = await admin.from('promocao_numeros').select('numero').eq('geracao_id', geracaoId).order('numero')
  return (data || []).map((r: any) => Number(r.numero))
}

export async function numerosValidosDoTitular(admin: Admin, g: any): Promise<number[]> {
  const { data } = await admin
    .from('promocao_numeros')
    .select('numero')
    .eq('campanha_id', g.campanha_id)
    .eq('titular_tipo', g.titular_tipo)
    .eq('titular_id', g.titular_id)
    .eq('status', 'valido')
    .order('numero')
  return (data || []).map((r: any) => Number(r.numero))
}

/** Snapshot normalizado (aceita camelCase do montarSnapshotGeracao e snake_case). */
export function lerSnapshot(snap: any) {
  const s = snap || {}
  const num = (...v: any[]) => Number(v.find((x) => x !== undefined && x !== null) ?? 0)
  return {
    operacoes: (Array.isArray(s.operacoes) ? s.operacoes : []).map((o: any) => ({
      id: o.id ? String(o.id) : null,
      tipo: String(o.tipo ?? ''),
      valorCentavos: num(o.valorCentavos, o.valor_centavos, o.valor),
      dataPagamento: (o.dataPagamento ?? o.data_pagamento ?? null) as string | null,
    })),
    totalCentavos: num(s.totalCentavos, s.total),
    usadoAnteriorCentavos: num(s.usadoAnteriorCentavos, s.usado_anterior),
    usadoNestaCentavos: num(s.usadoNestaCentavos, s.usado_nesta),
    saldoCentavos: num(s.saldoCentavos, s.saldo),
  }
}

export async function registrarEvento(admin: Admin, g: any, tipo: string, dados: Record<string, unknown> = {}) {
  await admin.from('promocao_eventos').insert({ campanha_id: g.campanha_id, entidade: 'geracao', entidade_id: g.id, tipo, dados })
}
