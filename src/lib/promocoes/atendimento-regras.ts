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
export type GateResultado = 'ok' | 'inativa' | 'fora_do_periodo' | 'pausado' | 'nao_liberado' | 'sem_instancia'

/** Ordem fixa do contrato 1.7. */
export function gatesGlobais(c: GateCampanha, agora: Date): GateResultado {
  if (c.status !== 'ativa') return 'inativa'
  if (estadoCadastro(c, agora) !== 'aberta') return 'fora_do_periodo'
  if (c.atendimento_pausado) return 'pausado'
  if (!c.atendimento_liberado_em || new Date(c.atendimento_liberado_em).getTime() > agora.getTime()) return 'nao_liberado'
  if (!c.parceiro_atendimento_id || !c.instancia_atendimento_id) return 'sem_instancia'
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
}): 'disponivel' | 'ja_enviado' | 'indisponivel' | 'falhou' {
  if (p.pedidoStatus === 'rejeitado') return 'falhou'
  if (p.pedidoStatus) return 'ja_enviado'
  if (p.gate !== 'ok' || !p.telefoneVerificado || p.bloqueado || !p.algumaConectada) return 'indisponivel'
  return 'disponivel'
}

/** Janela deslizante: true quando a contagem já atingiu o limite. */
export const atingiuLimite = (contagem: number, limite: number): boolean => contagem >= limite
