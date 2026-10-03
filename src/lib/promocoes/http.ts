/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { limiteTentar } from './rate-limit'
import { escolherIp, estadoCadastro } from './seguranca.ts'
import { telefoneParaE164Digitos } from './validacao'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function erro(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

// Limites por IP são SOFT (rewrite externo da Vercel pode colapsar/forjar o XFF); proteção real = telefone/CPF/global.
export function ipDoRequest(request: NextRequest): string {
  return escolherIp(request.headers)
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${ip}${process.env.PROMO_IP_SALT || ''}`).digest('hex')
}

export async function lerJson(request: NextRequest): Promise<Record<string, any> | null> {
  try {
    const len = Number(request.headers.get('content-length') || 0)
    if (len > 32_000) return null
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

export const JSON_INVALIDO = () => erro('DADOS_INVALIDOS', 'Requisição inválida.', 400)
export const LIMITE_EXCEDIDO = () => erro('LIMITE_EXCEDIDO', 'Muitas tentativas. Aguarde um pouco e tente novamente.', 429)

/** Aplica todos os limites; devolve a resposta 429 se algum estourar. */
export async function aplicarLimites(limites: Array<[string, number, number]>) {
  for (const [chave, limite, janela] of limites) {
    if (!(await limiteTentar(chave, limite, janela))) return LIMITE_EXCEDIDO()
  }
  return null
}

export type Campanha = {
  id: string
  slug: string
  nome: string
  status: string
  inicio_em: string
  fim_em: string
  prazo_geracao_ate: string
  data_sorteio: string
  convenio_id: string | null
  instancia_id: string | null
  otp_obrigatorio: boolean
  telefone_contato: string | null
  site_base_url: string
  regulamento_url: string
  regulamento_versao: string
  wesales_funil_nome: string | null
  wesales_etapa_nome: string | null
  wesales_tags: string[] | null
  prefixo_codigo: string
  prefixo_indicacao: string
  faixas_cartao: unknown
  minimo_centavos: number
  pixel_meta_id: string | null
  ga4_id: string | null
  gads_id: string | null
  parceiro_atendimento_id: string | null
  instancia_atendimento_id: string | null
  instancia_atendimento_reserva_id: string | null
  atendimento_liberado_em: string | null
  atendimento_pausado: boolean
  limite_atendimento_indicador_hora: number
  limite_atendimento_instancia_hora: number
  limite_atendimento_instancia_dia: number
}

export async function buscarCampanha(slug: unknown, statusPermitidos: string[] = ['ativa']): Promise<Campanha | null> {
  const s = String(slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]{1,64}$/.test(s)) return null
  const admin: any = await createAdminClient()
  const { data } = await admin.from('promocao_campanhas').select('*').eq('slug', s).maybeSingle()
  if (!data || !statusPermitidos.includes(String(data.status))) return null
  return data as Campanha
}

/** Só para rotas de CADASTRO (inscrição, indicação, OTP): fora do período devolve 410/409. */
export function cadastroFechado(c: Campanha, agora = new Date()): Response | null {
  const e = estadoCadastro(c, agora)
  if (e === 'encerrada') return erro('CAMPANHA_ENCERRADA', 'O período de inscrição terminou.', 410)
  if (e === 'nao_iniciada') return erro('CAMPANHA_NAO_INICIADA', 'O período de inscrição ainda não começou.', 409)
  return null
}

export const CAMPANHA_INDISPONIVEL = () => erro('CAMPANHA_INDISPONIVEL', 'Campanha indisponível.', 404)

export async function telefoneContatoDigitos(admin: any, c: Campanha): Promise<string | null> {
  if (c.telefone_contato) return paraWhatsappBR(c.telefone_contato)
  if (!c.instancia_id) return null
  const { data } = await admin.from('chat_instancias').select('numero').eq('id', c.instancia_id).maybeSingle()
  return paraWhatsappBR(String(data?.numero || ''))
}

/** Dígitos com 55 p/ wa.me; inválido pelo validador volta só os dígitos (ou null se vazio). */
function paraWhatsappBR(t: string): string | null {
  return telefoneParaE164Digitos(t) ?? (t.replace(/\D/g, '') || null)
}

export function formatarTelefoneContato(d: string | null): string {
  if (!d) return ''
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  return n
}

export function logSeguro(contexto: string, e: unknown) {
  console.error(`[promocoes] ${contexto}:`, e instanceof Error ? e.message : String((e as any)?.message || e).slice(0, 200))
}

export async function registrarEvento(admin: any, campanhaId: string, entidade: string, entidadeId: string, tipo: string, dados: Record<string, unknown> = {}) {
  try {
    await admin.from('promocao_eventos').insert({ campanha_id: campanhaId, entidade, entidade_id: entidadeId, tipo, dados })
  } catch {
    // auditoria nunca derruba o fluxo
  }
}
