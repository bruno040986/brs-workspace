/**
 * Hierarquia comercial do parceiro (regra do Bruno, 25/09/2026).
 *
 * Cada campo (Superintendente / Supervisor / Gerente Comercial) aceita
 * comerciais ATIVOS com cargo igual ou superior ao do campo: o superintendente
 * pode ser o supervisor e o gerente do parceiro; o supervisor pode ser o
 * gerente; o gerente só gerente. Não há filtro por `parent_id` — hoje o único
 * ativo é o superintendente e ele precisa aparecer nos três campos.
 *
 * Usado pela aba Acesso do editor do Agente Corban e pelo retorno do ARW em
 * Cadastros Recebidos (mesmos campos, mesma regra, servidor valida com a
 * mesma função).
 */

export type ComercialCargo = 'superintendente' | 'supervisor' | 'gerente'

export type ComercialResumo = {
  id: string
  name: string
  role?: string | null
  status?: string | null
  cadastral_data?: { commercial_name?: string | null } | null
}

const NIVEL: Record<ComercialCargo, number> = { superintendente: 3, supervisor: 2, gerente: 1 }

export const COMERCIAL_CARGO_LABELS: Record<ComercialCargo, string> = {
  superintendente: 'Superintendente',
  supervisor: 'Supervisor',
  gerente: 'Gerente Comercial',
}

/**
 * Opções válidas para um campo. Inativo só permanece na lista quando já é o
 * valor gravado (`selecionadoId`), para o dado antigo não sumir da tela.
 * Ordem: cargo mais alto primeiro, depois nome.
 */
/**
 * Cargo da entidade comercial (coluna `commercial_entities.role`). O
 * "Comercial Independente" (15/10/2026) fica ABAIXO do Gerente: não ocupa os
 * campos de hierarquia do parceiro (opcoesComerciais o ignora), mas pode
 * responder direto a um Gerente, Supervisor ou Superintendente.
 */
export type ComercialRole = ComercialCargo | 'independente'

export const COMERCIAL_ROLES: ComercialRole[] = ['superintendente', 'supervisor', 'gerente', 'independente']

export const COMERCIAL_ROLE_LABELS: Record<ComercialRole, string> = {
  ...COMERCIAL_CARGO_LABELS,
  independente: 'Comercial Independente',
}

/** Cargos aceitos como superior direto (`parent_id`) de cada cargo. */
export const SUPERIORES_PERMITIDOS: Record<ComercialRole, ComercialCargo[]> = {
  superintendente: [],
  supervisor: ['superintendente'],
  gerente: ['supervisor'],
  independente: ['gerente', 'supervisor', 'superintendente'],
}

export function isComercialRole(value: unknown): value is ComercialRole {
  return COMERCIAL_ROLES.includes(value as ComercialRole)
}

/**
 * Opções do select "Superior Vinculado" no cadastro do comercial. Mesma regra
 * de inativo de opcoesComerciais; nunca oferece a própria entidade.
 */
export function opcoesSuperior<T extends ComercialResumo>(
  comerciais: T[],
  role: ComercialRole,
  selecionadoId?: string | null,
  proprioId?: string | null,
): T[] {
  const aceitos = SUPERIORES_PERMITIDOS[role] || []
  return comerciais
    .filter((c) => {
      if (c.id === proprioId || !aceitos.includes(c.role as ComercialCargo)) return false
      return c.status !== 'inativo' || c.id === selecionadoId
    })
    .sort((a, b) => {
      const dn = NIVEL[b.role as ComercialCargo] - NIVEL[a.role as ComercialCargo]
      return dn !== 0 ? dn : nomeComercial(a).localeCompare(nomeComercial(b), 'pt-BR')
    })
}

export function opcoesComerciais<T extends ComercialResumo>(
  comerciais: T[],
  campo: ComercialCargo,
  selecionadoId?: string | null,
): T[] {
  const minimo = NIVEL[campo]
  return comerciais
    .filter((c) => {
      const nivel = NIVEL[String(c.role || '') as ComercialCargo]
      if (!nivel || nivel < minimo) return false
      return c.status !== 'inativo' || c.id === selecionadoId
    })
    .sort((a, b) => {
      const dn = NIVEL[b.role as ComercialCargo] - NIVEL[a.role as ComercialCargo]
      return dn !== 0 ? dn : nomeComercial(a).localeCompare(nomeComercial(b), 'pt-BR')
    })
}

/** Nome comercial (apelido) ou nome, com sufixo quando inativo. */
export function nomeComercial(c?: ComercialResumo | null): string {
  const nome = String(c?.cadastral_data?.commercial_name || c?.name || '').trim()
  if (!nome) return ''
  return c?.status === 'inativo' ? `${nome} (Inativo)` : nome
}
