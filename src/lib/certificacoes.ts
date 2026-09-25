/**
 * Regras de certificação (fatia 3, decisões do Bruno em 25/09/2026).
 *
 * - Uma certificação cobre 1..N tipos (LGPD, PLDFT, Crédito Consignado...).
 * - A validade de um lançamento vale para TODOS os tipos que ele cobre.
 * - Vigência por tipo = MAIOR validade entre os lançamentos da pessoa.
 * - Só lançamento VERIFICADO (conferido no CRCP) conta para a exigência.
 * - TODOS os tipos obrigatórios precisam estar vigentes na MESMA pessoa; o
 *   cadastro cumpre quando pelo menos um sócio/administrador cumpre.
 * - Desmarcar "obrigatório" não apaga lançamento: só deixa de exigir.
 *
 * Módulo folha (sem imports) para ser testável com `node --test`.
 */

export type CertTipo = { id: string; nome: string; obrigatorio: boolean; is_active?: boolean | null }
export type CertVinculo = { certificacao_id: string; tipo_id: string }
export type CertLancamento = { cpf: string; certificacao_id: string; data_validade: string; verificado_em?: string | null }

export type AvaliacaoObrigatorios = {
  cumpre: boolean
  /** Tipos obrigatórios considerados (ativos e marcados). */
  obrigatorios: CertTipo[]
  vigentes: Array<CertTipo & { validade: string }>
  vencidos: Array<CertTipo & { validade: string }>
  faltantes: CertTipo[]
}

const dia = (iso: string) => String(iso || '').slice(0, 10)

/** Data de hoje em AAAA-MM-DD (fuso local). */
export function hojeIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Vigência por tipo (id → AAAA-MM-DD da maior validade). */
export function vigenciaPorTipo(lancamentos: CertLancamento[], vinculos: CertVinculo[], somenteVerificados = true): Map<string, string> {
  const tiposPorCert = new Map<string, string[]>()
  for (const v of vinculos) tiposPorCert.set(v.certificacao_id, [...(tiposPorCert.get(v.certificacao_id) || []), v.tipo_id])
  const out = new Map<string, string>()
  for (const l of lancamentos) {
    if (somenteVerificados && !l.verificado_em) continue
    const validade = dia(l.data_validade)
    if (!validade) continue
    for (const tipoId of tiposPorCert.get(l.certificacao_id) || []) {
      const atual = out.get(tipoId)
      if (!atual || validade > atual) out.set(tipoId, validade)
    }
  }
  return out
}

export function tiposObrigatorios(tipos: CertTipo[]): CertTipo[] {
  return tipos.filter((t) => t.obrigatorio && t.is_active !== false)
}

/** Avalia UMA pessoa (passe só os lançamentos dela). Sem obrigatórios cadastrados, cumpre. */
export function avaliarObrigatorios(
  lancamentosDaPessoa: CertLancamento[],
  vinculos: CertVinculo[],
  tipos: CertTipo[],
  hoje = hojeIso(),
): AvaliacaoObrigatorios {
  const obrigatorios = tiposObrigatorios(tipos)
  const vig = vigenciaPorTipo(lancamentosDaPessoa, vinculos, true)
  const vigentes: AvaliacaoObrigatorios['vigentes'] = []
  const vencidos: AvaliacaoObrigatorios['vencidos'] = []
  const faltantes: CertTipo[] = []
  for (const t of obrigatorios) {
    const validade = vig.get(t.id)
    if (!validade) faltantes.push(t)
    else if (validade >= hoje) vigentes.push({ ...t, validade })
    else vencidos.push({ ...t, validade })
  }
  return { cumpre: faltantes.length === 0 && vencidos.length === 0, obrigatorios, vigentes, vencidos, faltantes }
}

/** Primeiro CPF (na ordem dada) que cumpre todos os obrigatórios; null se ninguém. */
export function pessoaQueCumpre(
  cpfs: string[],
  lancamentos: CertLancamento[],
  vinculos: CertVinculo[],
  tipos: CertTipo[],
  hoje = hojeIso(),
): string | null {
  for (const cpf of cpfs) {
    if (avaliarObrigatorios(lancamentos.filter((l) => l.cpf === cpf), vinculos, tipos, hoje).cumpre) return cpf
  }
  return null
}

/** Dias até vencer (negativo = vencida). */
export function diasParaVencer(dataValidade: string, hoje = hojeIso()): number {
  const a = Date.UTC(+dia(dataValidade).slice(0, 4), +dia(dataValidade).slice(5, 7) - 1, +dia(dataValidade).slice(8, 10))
  const b = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10))
  return Math.round((a - b) / 86400000)
}
