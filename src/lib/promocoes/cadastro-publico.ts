/* eslint-disable @typescript-eslint/no-explicit-any */
import { enqueueJob } from '@/lib/scp-engine/queue'
import { formatarCodigo } from './codigos'
import { hashIp, logSeguro, UUID_RE, registrarEvento, telefoneContatoDigitos, type Campanha } from './http'
import { sincronizarInscricaoWesales } from './wesales-sync'
import { maiorDe18, nomeCompletoValido, cpfValido, somenteDigitos, textoConvenioLivre, telefoneBrValido, telefoneParaE164Digitos } from './validacao'
import { textoAberturaAtendimento } from './mensagens'
import { enviarEventoCapi, montarEventoLead } from './capi-meta'
import { lerConfigMetaCapi } from '@/lib/meta/config'

export type CampoInvalido = { campo: string; msg: string }

export function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function dataIsoValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1900-01-01' && d <= new Date()
}

export type ConvenioCadastro = { convenio_id: string | null; convenio_texto_livre: string | null }

/** Convênio do POST público: `convenioId` (uuid de convênio ativo) OU `convenioTexto` ("não encontrei meu convênio") — exatamente um. */
export async function lerConvenio(admin: any, rawId: unknown, rawTexto: unknown): Promise<ConvenioCadastro | { code: string; message: string }> {
  const temId = rawId !== undefined && rawId !== null && rawId !== ''
  const texto = textoConvenioLivre(rawTexto)
  if (!temId && !texto) return { code: 'CONVENIO_OBRIGATORIO', message: 'Selecione o seu convênio ou informe o nome dele.' }
  if (temId && texto) return { code: 'CONVENIO_INVALIDO', message: 'Informe o convênio da lista ou o nome digitado, não os dois.' }
  if (texto) return { convenio_id: null, convenio_texto_livre: texto }
  const id = str(rawId, 36).toLowerCase()
  const { data } = UUID_RE.test(id)
    ? await admin.from('convenios').select('id').eq('id', id).eq('is_active', true).is('deleted_at', null).maybeSingle()
    : { data: null }
  if (!data?.id) return { code: 'CONVENIO_INVALIDO', message: 'Convênio não encontrado. Selecione outro ou informe o nome.' }
  return { convenio_id: data.id, convenio_texto_livre: null }
}

export function lerNome(raw: unknown, campo: string, erros: CampoInvalido[]): string {
  const nome = str(raw, 120).replace(/\s+/g, ' ')
  if (!nomeCompletoValido(nome)) erros.push({ campo, msg: 'Informe o nome completo.' })
  return nome
}

export function lerCpf(raw: unknown, campo: string, erros: CampoInvalido[]): string {
  const cpf = somenteDigitos(str(raw, 20))
  if (!cpfValido(cpf)) erros.push({ campo, msg: 'CPF inválido.' })
  return cpf
}

/** Telefone BR (com ou sem 55) → E.164 sem '+'. */
export function lerTelefone(raw: unknown, campo: string, erros: CampoInvalido[]): string {
  let d = somenteDigitos(str(raw, 30))
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  const e164 = telefoneBrValido(d) ? telefoneParaE164Digitos(d) : null
  if (!e164) {
    erros.push({ campo, msg: 'WhatsApp inválido. Informe DDD e número.' })
    return ''
  }
  return e164
}

export function lerData(raw: unknown, campo: string, erros: CampoInvalido[], obrigatoria: boolean): string | null {
  const v = str(raw, 10)
  if (!v) {
    if (obrigatoria) erros.push({ campo, msg: 'Informe a data de nascimento.' })
    return null
  }
  if (!dataIsoValida(v)) {
    erros.push({ campo, msg: 'Data de nascimento inválida.' })
    return null
  }
  return v
}

export function lerEmail(raw: unknown, campo: string, erros: CampoInvalido[]): string | null {
  const v = str(raw, 160).toLowerCase()
  if (!v) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    erros.push({ campo, msg: 'E-mail inválido.' })
    return null
  }
  return v
}

export { maiorDe18 }

export function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

export async function cpfBloqueado(admin: any, campanhaId: string, cpfs: string[]): Promise<boolean> {
  const { data, error } = await admin
    .from('promocao_cpfs_bloqueados')
    .select('id')
    .in('cpf', cpfs)
    .or(`campanha_id.is.null,campanha_id.eq.${campanhaId}`)
    .limit(1)
  return Boolean(error) || (data?.length || 0) > 0
}

/** nextval da promocao_codigo_seq via RPC (a sequence é compartilhada por inscrição e indicação). */
export async function proximoCodigo(admin: any, prefixo: string): Promise<string> {
  const { data, error } = await admin.rpc('promocao_proximo_codigo')
  if (error || data === null || data === undefined) throw new Error('falha ao obter sequência de código')
  return formatarCodigo(prefixo, Number(data))
}

const CAMPOS_TRACKING: Record<string, string> = {
  eventId: 'event_id',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_term: 'utm_term',
  utm_content: 'utm_content',
  gclid: 'gclid',
  fbclid: 'fbclid',
  fbp: 'fbp',
  fbc: 'fbc',
  referrer: 'referrer',
  landingUrl: 'landing_url',
}

export async function gravarTracking(admin: any, base: { campanhaId: string; inscricaoId: string; indicacaoId?: string; ip: string; userAgent: string }, tracking: unknown) {
  try {
    const t = tracking && typeof tracking === 'object' ? (tracking as Record<string, unknown>) : {}
    const row: Record<string, unknown> = {
      campanha_id: base.campanhaId,
      inscricao_id: base.inscricaoId,
      indicacao_id: base.indicacaoId ?? null,
      evento: 'lead_conclusao',
      ip_hash: hashIp(base.ip),
      user_agent: base.userAgent.slice(0, 300),
    }
    for (const [k, col] of Object.entries(CAMPOS_TRACKING)) {
      const v = str(t[k], 500)
      if (v) row[col] = v
    }
    await admin.from('promocao_tracking').insert(row)
  } catch (e) {
    logSeguro('tracking', e)
  }
}

/**
 * Lead server-side na API de Conversões da Meta. Para usar dentro de after(): nunca lança.
 * Sem consentimento, sem config ou evento inválido: evento capi.lead_descartado com o motivo. Falha/sucesso viram evento sem PII/token.
 */
export async function enviarLeadCapi(
  admin: any,
  base: { campanhaId: string; entidade: string; entidadeId: string; telefone: string; ip: string; userAgent: string },
  tracking: unknown,
) {
  const descartar = (motivo: 'sem_consentimento' | 'sem_config' | 'evento_invalido') =>
    registrarEvento(admin, base.campanhaId, base.entidade, base.entidadeId, 'capi.lead_descartado', { motivo })
  try {
    const t = tracking && typeof tracking === 'object' ? (tracking as Record<string, unknown>) : {}
    if (t.consentimento_cookies !== true) return await descartar('sem_consentimento')
    const cfg = await lerConfigMetaCapi()
    if (!cfg) return await descartar('sem_config')
    const corpo = montarEventoLead({ tracking, telefone: base.telefone, ip: base.ip, userAgent: base.userAgent, testEventCode: cfg.testEventCode })
    if (!corpo) return await descartar('evento_invalido')
    const r = await enviarEventoCapi(corpo, cfg)
    await registrarEvento(admin, base.campanhaId, base.entidade, base.entidadeId, r.ok ? 'capi.lead_enviado' : 'capi.lead_falhou', { status: r.status })
  } catch (e) {
    logSeguro('capi lead', e)
  }
}

export async function gravarAceites(
  admin: any,
  base: { campanhaId: string; sujeitoTipo: 'inscricao' | 'indicador'; sujeitoId: string; versao: string; ip: string; userAgent: string },
  aceites: Array<{ finalidade: 'promocao' | 'contato_comercial' | 'relacao_legitima_indicado'; aceito: boolean }>,
) {
  await admin.from('promocao_aceites').insert(
    aceites.map((a) => ({
      campanha_id: base.campanhaId,
      sujeito_tipo: base.sujeitoTipo,
      sujeito_id: base.sujeitoId,
      finalidade: a.finalidade,
      aceito: a.aceito,
      versao_texto: base.versao,
      ip: base.ip,
      user_agent: base.userAgent.slice(0, 300),
    })),
  )
}

/** Enfileira o sync e tenta inline (8 s). Devolve o status para a resposta. */
export async function sincronizarComTimeout(inscricaoId: string): Promise<'ok' | 'pendente'> {
  await enqueueJob({ kind: 'promocoes.wesales_sync', payload: { inscricaoId }, dedupeKey: `promo-wesales:${inscricaoId}`, maxAttempts: 8 })
  try {
    const r = await Promise.race([
      sincronizarInscricaoWesales(inscricaoId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ])
    return r?.status === 'ok' ? 'ok' : 'pendente'
  } catch (e) {
    logSeguro('sync inline', e)
    return 'pendente'
  }
}

export async function urlWhatsapp(admin: any, camp: Campanha, codigo: string, numeroIndicacao?: string): Promise<string | null> {
  const contato = await telefoneContatoDigitos(admin, camp)
  if (!contato) return null
  const texto = textoAberturaAtendimento({ codigo, numeroIndicacao })
  return `https://wa.me/${contato}?text=${encodeURIComponent(texto)}`
}
