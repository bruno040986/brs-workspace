export const STATUS_FUNCIONALIDADE = ['desligado', 'teste', 'pago'] as const
export type StatusFuncionalidade = (typeof STATUS_FUNCIONALIDADE)[number]

/** Ativa se status teste|pago e (ate nulo ou ate >= agora). Desligado nunca. */
export function funcionalidadeAtiva(
  status: string | null | undefined,
  ate: string | Date | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (status !== 'teste' && status !== 'pago') return false
  if (ate == null || ate === '') return true
  const t = new Date(ate).getTime()
  return Number.isFinite(t) && t >= agora.getTime()
}
