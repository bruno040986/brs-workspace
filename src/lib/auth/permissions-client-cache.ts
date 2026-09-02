'use client'

/**
 * Cache de permissões no cliente: HubHeader, Sidebar e Home consultavam
 * getMyEffectivePermissions cada um por conta própria (3 chamadas por
 * navegação). Aqui a promise é memoizada por sessão de página — todo mundo
 * espera a MESMA chamada. `invalidate` existe para telas de administração
 * de permissões forçarem releitura.
 */
import { getMyEffectivePermissions } from '@/lib/auth/actions'
import type { EffectivePermission } from '@/lib/auth/permissions'

let promessa: Promise<EffectivePermission[]> | null = null

export function carregarMinhasPermissoes(): Promise<EffectivePermission[]> {
  if (!promessa) {
    promessa = getMyEffectivePermissions()
      .then((res) => (res.success ? res.permissions || [] : []))
      .catch(() => {
        promessa = null // deixa tentar de novo depois de uma falha
        return []
      })
  }
  return promessa
}

export function invalidarCachePermissoes(): void {
  promessa = null
}
