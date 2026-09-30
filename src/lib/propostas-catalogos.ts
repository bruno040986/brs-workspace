/**
 * Validação (pura) dos catálogos de proposta — Status, Situação e config da
 * esteira. Espelha os checks da migration 20260930140135; o servidor valida
 * aqui antes de gravar e o banco segue como última barreira (únicos).
 */
export const GRUPOS_STATUS = ['em_andamento', 'pendente', 'pago', 'cancelado'] as const
export type GrupoStatus = (typeof GRUPOS_STATUS)[number]
export const GRUPO_LABEL: Record<GrupoStatus, string> = {
  em_andamento: 'Em andamento',
  pendente: 'Pendente',
  pago: 'Pago',
  cancelado: 'Cancelado',
}

export type StatusInput = {
  nome: string
  grupo: string
  cor?: string | null
  atualiza_data_atualizacao?: boolean
  libera_contratos?: boolean
  acao_na_alteracao?: string | null
  alerta_observacao?: boolean
  pendente?: boolean
  padrao_cadastro?: boolean
  descricao?: string | null
}
export type StatusRow = {
  nome: string; grupo: GrupoStatus; cor: string | null; atualiza_data_atualizacao: boolean; libera_contratos: boolean
  acao_na_alteracao: string | null; alerta_observacao: boolean; pendente: boolean; padrao_cadastro: boolean; descricao: string
}
export type SituacaoInput = { codigo_arw: string; nome: string; descricao?: string | null; status_sugerido_id?: string | null }
export type ConfigInput = { cancelamento_automatico_dias: number | string; exigir_contato_ao_pendenciar?: boolean }

type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const COR = /^#[0-9A-Fa-f]{6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizarStatus(i: StatusInput): Result<StatusRow> {
  const nome = String(i.nome ?? '').trim()
  if (!nome) return { ok: false, error: 'Informe o nome do status.' }
  if (!(GRUPOS_STATUS as readonly string[]).includes(i.grupo)) return { ok: false, error: 'Grupo inválido.' }
  const cor = String(i.cor ?? '').trim()
  if (cor && !COR.test(cor)) return { ok: false, error: 'Cor inválida — use o formato #RRGGBB.' }
  return {
    ok: true,
    value: {
      nome,
      grupo: i.grupo as GrupoStatus,
      cor: cor ? cor.toUpperCase() : null, // vazio = fallback do grupo
      atualiza_data_atualizacao: i.atualiza_data_atualizacao ?? true,
      libera_contratos: !!i.libera_contratos,
      acao_na_alteracao: String(i.acao_na_alteracao ?? '').trim() || null,
      alerta_observacao: !!i.alerta_observacao,
      pendente: !!i.pendente,
      padrao_cadastro: !!i.padrao_cadastro,
      descricao: String(i.descricao ?? '').trim(),
    },
  }
}

export function normalizarSituacao(i: SituacaoInput): Result<{ codigo_arw: string; nome: string; descricao: string; status_sugerido_id: string | null }> {
  const nome = String(i.nome ?? '').trim()
  const codigo = String(i.codigo_arw ?? '').trim()
  if (!codigo) return { ok: false, error: 'Informe o código do ARW.' }
  if (!nome) return { ok: false, error: 'Informe o nome da situação.' }
  const sug = String(i.status_sugerido_id ?? '').trim()
  if (sug && !UUID.test(sug)) return { ok: false, error: 'Status sugerido inválido.' }
  return { ok: true, value: { codigo_arw: codigo, nome, descricao: String(i.descricao ?? '').trim(), status_sugerido_id: sug || null } }
}

export function normalizarConfig(i: ConfigInput): Result<{ cancelamento_automatico_dias: number; exigir_contato_ao_pendenciar: boolean }> {
  const dias = Number(i.cancelamento_automatico_dias)
  if (!Number.isInteger(dias) || dias <= 0) return { ok: false, error: 'Dias para cancelamento automático deve ser um inteiro maior que zero.' }
  return { ok: true, value: { cancelamento_automatico_dias: dias, exigir_contato_ao_pendenciar: !!i.exigir_contato_ao_pendenciar } }
}
