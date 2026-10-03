/** Regras puras do "Solicitar atendimento" (CONTRATO-ATENDIMENTO §4.2). Sem I/O. */
import { estadoCadastro } from './seguranca.ts'

export type GateCampanha = {
  status: string
  inicio_em: string
  fim_em: string
  atendimento_pausado: boolean
  atendimento_liberado_em: string | null
  parceiro_atendimento_id: string | null
  instancia_atendimento_id: string | null
}
export type GateResultado = 'ok' | 'inativa' | 'fora_do_periodo' | 'pausado' | 'nao_liberado' | 'sem_instancia' | 'fora_horario'

export const HORA_INICIO_ATENDIMENTO = 7
export const HORA_FIM_ATENDIMENTO = 21
export const TETO_CAMPANHA_DIA = 300
export const LEASE_VENCE_MS = 5 * 60_000
export const FALLBACK_JOB_MS = 90_000

/** 7 <= hora civil < 21 em America/Sao_Paulo. */
export function dentroDoHorario(agora: Date, fuso = 'America/Sao_Paulo'): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: 'numeric', hour12: false }).format(agora)) % 24
  return h >= HORA_INICIO_ATENDIMENTO && h < HORA_FIM_ATENDIMENTO
}

export function instanciaAindaPermitida(c: { instancia_atendimento_id: string | null; instancia_atendimento_reserva_id: string | null }, instanciaUsadaId: string): boolean {
  return instanciaUsadaId === c.instancia_atendimento_id || instanciaUsadaId === c.instancia_atendimento_reserva_id
}

/** Ordem fixa do contrato 1.7. */
export function gatesGlobais(c: GateCampanha, agora: Date): GateResultado {
  if (c.status !== 'ativa') return 'inativa'
  if (estadoCadastro(c, agora) !== 'aberta') return 'fora_do_periodo'
  if (c.atendimento_pausado) return 'pausado'
  if (!c.atendimento_liberado_em || new Date(c.atendimento_liberado_em).getTime() > agora.getTime()) return 'nao_liberado'
  if (!c.parceiro_atendimento_id || !c.instancia_atendimento_id) return 'sem_instancia'
  if (!dentroDoHorario(agora)) return 'fora_horario'
  return 'ok'
}

export type Candidata = { id: string; status: string; deletedAt: string | null; agenteParceiroId: string | null; enviosHora: number; enviosDia: number }

/** `cands` já vem na ordem principal → reserva. Primeira válida e não cheia vence. */
export function escolherCandidata(
  cands: Candidata[],
  ctx: { parceiroId: string; instanciaOtpId: string | null; limiteHora: number; limiteDia: number },
): { id: string } | 'nenhuma_conectada' | 'todas_cheias' {
  let algumaConectada = false
  for (const c of cands) {
    if (c.deletedAt || c.status !== 'conectada') continue
    if (c.agenteParceiroId !== ctx.parceiroId) continue
    if (ctx.instanciaOtpId && c.id === ctx.instanciaOtpId) continue
    algumaConectada = true
    if (c.enviosHora >= ctx.limiteHora || c.enviosDia >= ctx.limiteDia) continue
    return { id: c.id }
  }
  return algumaConectada ? 'todas_cheias' : 'nenhuma_conectada'
}

const SEM_WHATSAPP = /sem_whatsapp|not.?on.?whatsapp/i

export function mapearResultadoParaStatus(
  r: { resultado: 'confirmado' } | { resultado: 'rejeitado' | 'incerto'; mensagem: string },
): 'enviado' | 'incerto' | 'rejeitado' | 'pendente' {
  if (r.resultado === 'confirmado') return 'enviado'
  if (r.resultado === 'incerto') return 'incerto'
  return SEM_WHATSAPP.test(r.mensagem) ? 'rejeitado' : 'pendente'
}

export function botaoDoEstado(p: {
  pedidoStatus: string | null
  gate: GateResultado
  telefoneVerificado: boolean
  bloqueado: boolean
  algumaConectada: boolean
}): 'disponivel' | 'ja_enviado' | 'indisponivel' | 'fora_horario' | 'falhou' {
  if (p.pedidoStatus === 'rejeitado') return 'falhou'
  if (p.pedidoStatus) return 'ja_enviado'
  if ((p.gate !== 'ok' && p.gate !== 'fora_horario') || !p.telefoneVerificado || p.bloqueado || !p.algumaConectada) return 'indisponivel'
  return p.gate === 'fora_horario' ? 'fora_horario' : 'disponivel'
}

/** Janela deslizante: true quando a contagem já atingiu o limite. */
export const atingiuLimite = (contagem: number, limite: number): boolean => contagem >= limite

export type SlotLimite = { chave: string; limite: number; janelaSeg: number; erro: 'LIMITE_INDICADOR' | 'LIMITE_INSTANCIA' }

/** Slots atômicos (B1), na ordem do contrato. */
export function slotsDoPedido(
  c: { limite_atendimento_indicador_hora: number; limite_atendimento_instancia_hora: number; limite_atendimento_instancia_dia: number },
  p: { tipo: 'servidor' | 'indicado'; indicadorId: string | null; instanciaId: string },
): SlotLimite[] {
  const slots: SlotLimite[] = []
  if (p.tipo === 'indicado' && p.indicadorId) slots.push({ chave: `rl:atend:indicador:${p.indicadorId}`, limite: c.limite_atendimento_indicador_hora, janelaSeg: 3600, erro: 'LIMITE_INDICADOR' })
  slots.push(
    { chave: 'rl:atend:camp:d', limite: TETO_CAMPANHA_DIA, janelaSeg: 86400, erro: 'LIMITE_INSTANCIA' },
    { chave: `rl:atend:inst:${p.instanciaId}:h`, limite: c.limite_atendimento_instancia_hora, janelaSeg: 3600, erro: 'LIMITE_INSTANCIA' },
    { chave: `rl:atend:inst:${p.instanciaId}:d`, limite: c.limite_atendimento_instancia_dia, janelaSeg: 86400, erro: 'LIMITE_INSTANCIA' },
  )
  return slots
}

/** Para no 1º slot negado; devolve o código de erro ou null. */
export async function reservarSlots(slots: SlotLimite[], tentar: (chave: string, limite: number, janelaSeg: number) => Promise<boolean>): Promise<SlotLimite['erro'] | null> {
  for (const s of slots) if (!(await tentar(s.chave, s.limite, s.janelaSeg))) return s.erro
  return null
}

/** Reavaliação na hora do envio (A1). null = pode enviar; senão o motivo (nada toca o engine). */
export function motivoReavaliacao(
  camp: GateCampanha & { instancia_atendimento_reserva_id: string | null },
  instanciaUsadaId: string,
  inst: { status: string; deletedAt: string | null; agenteParceiroId: string | null } | null,
  agora: Date,
): string | null {
  if (camp.atendimento_pausado) return 'PAUSADO'
  const g = gatesGlobais(camp, agora)
  if (g !== 'ok') return g.toUpperCase()
  if (!instanciaAindaPermitida(camp, instanciaUsadaId)) return 'INSTANCIA_TROCADA'
  if (!inst || inst.deletedAt || inst.status !== 'conectada') return 'INSTANCIA_OFFLINE'
  if (inst.agenteParceiroId !== camp.parceiro_atendimento_id) return 'PARCEIRO_DIFERENTE'
  return null
}

/** Última tentativa do job (M2). */
export const ehUltimaTentativa = (job: { attempts?: number; max_attempts?: number }): boolean => (job.attempts ?? 0) + 1 >= (job.max_attempts ?? 5)

/** Lease (B2): só executa `fn` quem adquire; os demais recebem `senao`. */
export async function comLease<T>(adquirir: () => Promise<boolean>, fn: () => Promise<T>, senao: T): Promise<T> {
  return (await adquirir()) ? fn() : senao
}
