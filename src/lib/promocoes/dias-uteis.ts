/** Calendário: dias úteis com feriados nacionais (CONTRATO §3.5). Datas 'YYYY-MM-DD'. */

export const FERIADOS_NACIONAIS: Record<string, string[]> = {
  '2026': ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25'],
  '2027': ['2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25'],
}

function diaDaSemana(dataIso: string): number {
  // UTC evita deslocamento de fuso ao interpretar a data civil
  return new Date(`${dataIso}T00:00:00Z`).getUTCDay()
}

function somarDias(dataIso: string, n: number): string {
  const d = new Date(`${dataIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function ehFeriado(dataIso: string): boolean {
  return (FERIADOS_NACIONAIS[dataIso.slice(0, 4)] ?? []).includes(dataIso)
}

export function ehDiaUtil(dataIso: string): boolean {
  const dow = diaDaSemana(dataIso)
  return dow !== 0 && dow !== 6 && !ehFeriado(dataIso)
}

/** Avança n dias úteis a partir de dataIso (o próprio dia não conta). */
export function somarDiasUteis(dataIso: string, n: number): string {
  let atual = dataIso
  let faltam = n
  while (faltam > 0) {
    atual = somarDias(atual, 1)
    if (ehDiaUtil(atual)) faltam -= 1
  }
  return atual
}

/** Instante ISO → data civil em America/Sao_Paulo (YYYY-MM-DD). */
export function dataCivilSp(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** Prazo da NuAzul para enviar o link de geração: 3 dias úteis após a confirmação. */
export function prazoLink(confirmadaEmIso: string): string {
  return somarDiasUteis(dataCivilSp(confirmadaEmIso), 3)
}

/** Prazo para o Pix ao indicador: 5 dias úteis após a confirmação. */
export function prazoPix(confirmadaEmIso: string): string {
  return somarDiasUteis(dataCivilSp(confirmadaEmIso), 5)
}
