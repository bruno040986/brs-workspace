/** Regras puras da config do atendimento (CONTRATO-ATENDIMENTO §6). Sem I/O. */

export type PatchAtendimento = {
  parceiro_atendimento_id: string | null
  instancia_atendimento_id: string | null
  instancia_atendimento_reserva_id: string | null
  atendimento_liberado_em: string | null
  atendimento_pausado: boolean
  limite_atendimento_indicador_hora: number
  limite_atendimento_instancia_hora: number
  limite_atendimento_instancia_dia: number
}

export const LIMITES_PADRAO = { indicador_hora: 30, instancia_hora: 40, instancia_dia: 200 }

/** '556199990000' → '*******0000' (só os 4 últimos dígitos). */
export function mascararNumeroInstancia(numero: string | null | undefined): string {
  const d = String(numero ?? '').replace(/\D/g, '')
  if (!d) return '—'
  return d.length <= 4 ? d : `${'•'.repeat(d.length - 4)}${d.slice(-4)}`
}

const inteiro = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

export type InstanciaDoParceiro = { id: string; status: string }

/**
 * Devolve a mensagem de erro ou null. `instancias` = instâncias não excluídas do parceiro
 * escolhido. "Conectada" só é exigida de instância NOVA (mudou em relação a `anterior`),
 * para que pausar/ajustar limite funcione com a instância fora do ar.
 */
export function validarConfigAtendimento(
  p: PatchAtendimento,
  ctx: { instanciaOtpId: string | null; instancias: InstanciaDoParceiro[]; anterior: { principalId: string | null; reservaId: string | null } },
): string | null {
  const { instancia_atendimento_id: pri, instancia_atendimento_reserva_id: res } = p
  if (!inteiro(p.limite_atendimento_indicador_hora, 1, 500)) return 'Limite por indicador/hora deve ser inteiro de 1 a 500.'
  if (!inteiro(p.limite_atendimento_instancia_hora, 1, 500)) return 'Limite por instância/hora deve ser inteiro de 1 a 500.'
  if (!inteiro(p.limite_atendimento_instancia_dia, 1, 5000)) return 'Limite por instância/24 h deve ser inteiro de 1 a 5000.'
  if (p.atendimento_liberado_em !== null && Number.isNaN(new Date(p.atendimento_liberado_em).getTime())) return 'Data de liberação inválida.'
  if ((pri || res) && !p.parceiro_atendimento_id) return 'Escolha o parceiro antes das instâncias.'
  if (pri && res && pri === res) return 'A instância principal e a reserva devem ser diferentes.'
  for (const [id, rotulo, antes] of [[pri, 'principal', ctx.anterior.principalId], [res, 'reserva', ctx.anterior.reservaId]] as const) {
    if (!id) continue
    if (id === ctx.instanciaOtpId) return 'A instância da promoção (OTP/comprovantes) não pode ser usada para atendimento.'
    const i = ctx.instancias.find((x) => x.id === id)
    if (!i) return `A instância ${rotulo} não pertence ao parceiro escolhido.`
    if (id !== antes && i.status !== 'conectada') return `A instância ${rotulo} precisa estar conectada.`
  }
  if (res && !pri) return 'Defina a instância principal antes da reserva.'
  return null
}

export type EstadoAtendimento = 'pronto' | 'pausado' | 'aguardando_liberacao' | 'sem_instancia'

export function estadoAtendimento(
  c: { atendimento_pausado: boolean; atendimento_liberado_em: string | null; principalStatus: string | null; reservaStatus: string | null },
  agora: Date,
): EstadoAtendimento {
  if (c.atendimento_pausado) return 'pausado'
  if (c.principalStatus !== 'conectada' && c.reservaStatus !== 'conectada') return 'sem_instancia'
  if (!c.atendimento_liberado_em || new Date(c.atendimento_liberado_em).getTime() > agora.getTime()) return 'aguardando_liberacao'
  return 'pronto'
}

/** Parceiro precisa existir e ter conta de chat; erro genérico (não vira oráculo de ids). */
export function validarParceiroAtendimento(existe: boolean, qtdContas: number): string | null {
  return existe && qtdContas > 0 ? null : 'Parceiro inválido.'
}
