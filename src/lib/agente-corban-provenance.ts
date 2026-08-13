/**
 * Proveniência de dados do Agente Corban — quem forneceu cada valor.
 *
 * O cadastro do parceiro é pré-preenchido por consultas externas (CNPJ.ws /
 * BrasilAPI para o CNPJ, CPFHub para os CPFs). O parceiro confirma ou corrige.
 * Este módulo modela a trilha disso dentro de `corban_data`:
 *
 *   - `receita_snapshot`   resposta bruta da consulta de CNPJ + fonte + data
 *   - `cpf_snapshots`      respostas brutas das consultas de CPF (por CPF)
 *   - `field_provenance`   por system_key: valor da API × valor final, com a
 *                          marca `alterado_pelo_parceiro`
 *   - `divergencias_receita`  divergências entre o declarado e a Receita,
 *                          calculadas no envio para revisão do backoffice
 *
 * REGRA DE OURO: o carimbo (`buildFieldProvenance`) acontece SEMPRE no servidor,
 * no submit — nunca confie em marcações vindas do cliente. O cliente apenas
 * informa o que foi pré-preenchido (`prefills`), e o servidor compara com o
 * que chegou de fato.
 */

import { normalizeText } from './agente-corban'

// =========================================================================
// Tipos
// =========================================================================

/** De qual consulta o valor pré-preenchido veio. */
export type ProvenanceOrigin = 'cnpj_ws' | 'brasilapi' | 'cpfhub' | 'viacep' | 'manual'

export const PROVENANCE_ORIGIN_LABELS: Record<ProvenanceOrigin, string> = {
  cnpj_ws: 'CNPJ.ws (Receita Federal)',
  brasilapi: 'BrasilAPI (Receita Federal)',
  cpfhub: 'CPFHub (Consulta de CPF)',
  viacep: 'ViaCEP',
  manual: 'Digitado pelo parceiro',
}

/** Registro de proveniência de UM campo (indexado por system_key). */
export type FieldProvenanceEntry = {
  origem: ProvenanceOrigin
  /** Valor exatamente como veio da API (normalizado como texto). */
  valor_api: string
  /** Valor que o parceiro deixou no envio. */
  valor_final: string
  alterado_pelo_parceiro: boolean
  /** ISO 8601 — quando a API foi consultada. */
  consultado_em?: string
  /** ISO 8601 — carimbo do servidor no envio, quando houve alteração. */
  alterado_em?: string | null
}

/** system_key → proveniência. Mora em `corban_data.field_provenance`. */
export type FieldProvenanceMap = Record<string, FieldProvenanceEntry>

/** O que o cliente informa sobre um campo pré-preenchido (antes do carimbo). */
export type ProvenancePrefill = {
  origem: Exclude<ProvenanceOrigin, 'manual'>
  valor: string
  consultado_em?: string
}

/** Snapshot bruto da consulta de CNPJ. Mora em `corban_data.receita_snapshot`. */
export type ReceitaSnapshot = {
  fonte: 'cnpj_ws' | 'brasilapi'
  cnpj: string
  consultado_em: string
  raw: Record<string, any>
}

/** Snapshot bruto de uma consulta de CPF. Mora em `corban_data.cpf_snapshots[cpf]`. */
export type CpfSnapshot = {
  fonte: 'cpfhub'
  cpf: string
  consultado_em: string
  raw: Record<string, any>
}

export type DivergenciaTipo =
  | 'situacao_cadastral'
  | 'socio_fora_do_qsa'
  | 'socio_qsa_nao_informado'
  | 'cpf_nao_confere_qsa'
  | 'nome_nao_confere'
  | 'capital_social'
  | 'sem_cnae_corban'
  | 'campo_alterado'

/** Divergência declarado × Receita, para revisão do backoffice. */
export type DivergenciaReceita = {
  tipo: DivergenciaTipo
  descricao: string
  /** system_key do campo, quando a divergência é de um campo específico. */
  campo?: string
  valor_declarado?: string
  valor_receita?: string
  /** true = deve impedir o avanço (hoje só situação cadastral ≠ Ativa). */
  bloqueante?: boolean
}

// =========================================================================
// Leitura
// =========================================================================

export function getFieldProvenance(corbanData: Record<string, any> | null | undefined): FieldProvenanceMap {
  const raw = corbanData?.field_provenance
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as FieldProvenanceMap
}

export function getReceitaSnapshot(corbanData: Record<string, any> | null | undefined): ReceitaSnapshot | null {
  const raw = corbanData?.receita_snapshot
  if (!raw || typeof raw !== 'object' || !raw.raw) return null
  return raw as ReceitaSnapshot
}

export function getCpfSnapshots(corbanData: Record<string, any> | null | undefined): Record<string, CpfSnapshot> {
  const raw = corbanData?.cpf_snapshots
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, CpfSnapshot>
}

export function getDivergenciasReceita(corbanData: Record<string, any> | null | undefined): DivergenciaReceita[] {
  const raw = corbanData?.divergencias_receita
  return Array.isArray(raw) ? (raw as DivergenciaReceita[]) : []
}

/** Campos em que o parceiro alterou o valor vindo da API. */
export function listPartnerAlteredFields(corbanData: Record<string, any> | null | undefined): Array<{
  key: string
  entry: FieldProvenanceEntry
}> {
  return Object.entries(getFieldProvenance(corbanData))
    .filter(([, entry]) => entry?.alterado_pelo_parceiro)
    .map(([key, entry]) => ({ key, entry }))
}

// =========================================================================
// Carimbo (servidor)
// =========================================================================

/** Compara valores ignorando espaços/caixa — mudança cosmética não é alteração. */
export function provenanceValuesDiffer(apiValue: string, finalValue: string): boolean {
  const a = normalizeText(apiValue).replace(/\s+/g, ' ').trim().toLowerCase()
  const b = normalizeText(finalValue).replace(/\s+/g, ' ').trim().toLowerCase()
  return a !== b
}

/**
 * Monta o `field_provenance` no servidor: para cada campo pré-preenchido,
 * compara o valor da API com o valor final e marca a alteração.
 * Campos sem prefill não entram no mapa (origem manual é o default implícito).
 */
export function buildFieldProvenance(
  prefills: Record<string, ProvenancePrefill> | null | undefined,
  finalValues: Record<string, any>,
  nowIso: string,
): FieldProvenanceMap {
  const map: FieldProvenanceMap = {}

  for (const [key, prefill] of Object.entries(prefills || {})) {
    if (!prefill || !prefill.origem || prefill.origem === ('manual' as any)) continue
    const valorApi = normalizeText(prefill.valor)
    if (!valorApi) continue

    const valorFinal = normalizeText(finalValues[key])
    const alterado = provenanceValuesDiffer(valorApi, valorFinal)

    map[key] = {
      origem: prefill.origem,
      valor_api: valorApi,
      valor_final: valorFinal,
      alterado_pelo_parceiro: alterado,
      ...(prefill.consultado_em ? { consultado_em: prefill.consultado_em } : {}),
      alterado_em: alterado ? nowIso : null,
    }
  }

  return map
}

// =========================================================================
// Conferências contra a Receita
// =========================================================================

/**
 * Compara um CPF completo com o CPF mascarado do QSA (ex.: `***123456**`).
 * Compara posição a posição, ignorando as posições mascaradas. Retorna false
 * quando não há dígito visível para comparar.
 */
export function cpfMatchesParcial(fullCpf: string, maskedCpf: string): boolean {
  const full = normalizeText(fullCpf).replace(/\D/g, '')
  const masked = normalizeText(maskedCpf).replace(/[^\d*]/g, '')
  if (full.length !== 11 || masked.length !== 11) return false

  let visible = 0
  for (let i = 0; i < 11; i += 1) {
    const m = masked[i]
    if (m === '*') continue
    visible += 1
    if (m !== full[i]) return false
  }
  return visible > 0
}

/** Normaliza nome para comparação: caixa alta, sem acentos, espaços únicos. */
export function normalizeNameForCompare(name: string): string {
  return normalizeText(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function namesLooselyMatch(a: string, b: string): boolean {
  const na = normalizeNameForCompare(a)
  const nb = normalizeNameForCompare(b)
  if (!na || !nb) return false
  return na === nb
}

/** Item do QSA já normalizado pela consulta (formato comum CNPJ.ws/BrasilAPI). */
export type QsaSocioReceita = {
  nome: string
  /** CPF mascarado (PF) ou CNPJ (PJ). */
  cpf_parcial: string
  tipo: 'PF' | 'PJ'
  qualificacao: string
  data_entrada?: string
  faixa_etaria?: string
}

/** Sócio declarado, no mínimo com nome + CPF/CNPJ para conferência. */
export type SocioDeclarado = {
  nome: string
  cpf_cnpj: string
  tipo: 'PF' | 'PJ'
}

/**
 * Cruza os sócios declarados com o QSA da Receita. Gera divergências para:
 * sócio declarado ausente do QSA, sócio do QSA não declarado e CPF declarado
 * que não confere com o parcial do QSA (mesmo nome, dígitos diferentes).
 */
export function compareSociosComQsa(
  declarados: SocioDeclarado[],
  qsa: QsaSocioReceita[],
): DivergenciaReceita[] {
  const divergencias: DivergenciaReceita[] = []
  const qsaMatched = new Set<number>()

  for (const socio of declarados) {
    const nome = normalizeNameForCompare(socio.nome)
    if (!nome) continue

    const byName = qsa.findIndex((q, i) => !qsaMatched.has(i) && namesLooselyMatch(q.nome, socio.nome))

    if (byName >= 0) {
      qsaMatched.add(byName)
      const q = qsa[byName]
      if (
        socio.tipo === 'PF' &&
        q.tipo === 'PF' &&
        normalizeText(socio.cpf_cnpj).replace(/\D/g, '').length === 11 &&
        q.cpf_parcial.includes('*') &&
        !cpfMatchesParcial(socio.cpf_cnpj, q.cpf_parcial)
      ) {
        divergencias.push({
          tipo: 'cpf_nao_confere_qsa',
          descricao: `O CPF informado para ${socio.nome} não confere com o CPF parcial do QSA da Receita.`,
          valor_declarado: socio.cpf_cnpj,
          valor_receita: q.cpf_parcial,
        })
      }
      continue
    }

    // Sem match por nome: tenta por CPF parcial antes de acusar ausência.
    const byCpf = qsa.findIndex(
      (q, i) =>
        !qsaMatched.has(i) &&
        socio.tipo === 'PF' &&
        q.tipo === 'PF' &&
        q.cpf_parcial.includes('*') &&
        cpfMatchesParcial(socio.cpf_cnpj, q.cpf_parcial),
    )

    if (byCpf >= 0) {
      qsaMatched.add(byCpf)
      divergencias.push({
        tipo: 'nome_nao_confere',
        descricao: `O nome informado "${socio.nome}" difere do nome no QSA da Receita ("${qsa[byCpf].nome}") para o mesmo CPF.`,
        valor_declarado: socio.nome,
        valor_receita: qsa[byCpf].nome,
      })
      continue
    }

    divergencias.push({
      tipo: 'socio_fora_do_qsa',
      descricao: `O sócio informado "${socio.nome}" não consta no QSA da Receita Federal.`,
      valor_declarado: socio.nome,
    })
  }

  qsa.forEach((q, i) => {
    if (qsaMatched.has(i)) return
    divergencias.push({
      tipo: 'socio_qsa_nao_informado',
      descricao: `O sócio "${q.nome}" (${q.qualificacao || q.tipo}) consta no QSA da Receita mas não foi informado no cadastro.`,
      valor_receita: q.nome,
    })
  })

  return divergencias
}

/** CNAE de correspondente bancário (correspondentes de instituições financeiras). */
export const CNAE_CORBAN = '6619302'

export function hasCnaeCorban(cnaeCodes: Array<string | null | undefined>): boolean {
  return cnaeCodes.some((code) => normalizeText(code).replace(/\D/g, '') === CNAE_CORBAN)
}
