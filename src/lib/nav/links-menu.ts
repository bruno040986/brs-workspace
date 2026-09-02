'use server'

/**
 * Dropdown "Links" da topbar — fonte ÚNICA é o banco (decisão 02/09/2026):
 * 1. `sector_links` (gerenciável na tela /links, permissão sistema-links) —
 *    o catálogo que era fixo em código foi SEEDADO pra lá pela migration
 *    20260902200000, então tudo é editável;
 * 2. os sistemas das fichas de Instituições Financeiras e Promotoras
 *    (aba "Sistemas" de cada cadastro — entram sozinhos, sem duplicar).
 * Permissão por setor: `workspace-<id>`, como era nos cards da home antiga.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser, getEffectivePermissionsForUser } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { normalizeSystems } from '@/lib/promotoras'

export type LinkMenuItem = { label: string; href: string; external: boolean }
export type LinkMenuGroup = { id: string; label: string; itens: LinkMenuItem[] }

const SETORES: Array<{ id: string; label: string }> = [
  { id: 'adm', label: 'Administrativo' },
  { id: 'fin', label: 'Financeiro' },
  { id: 'rh', label: 'RH' },
  { id: 'ops', label: 'Operacional' },
  { id: 'com', label: 'Comercial' },
  { id: 'mkt', label: 'Marketing' },
  { id: 'tec', label: 'Tecnologia' },
  { id: 'acc', label: 'Acessos' },
]

export async function getWorkspaceLinksMenu(): Promise<{ success: boolean; groups?: LinkMenuGroup[]; error?: string }> {
  try {
    const user = await requireCurrentUser()
    const permissions = await getEffectivePermissionsForUser(user.id)
    const admin = await createAdminClient()

    const podeSetor = (id: string) => hasPermission(permissions, `workspace-${id}`, 'can_view')

    const grupos: LinkMenuGroup[] = []

    const { data: dbLinks } = await admin
      .from('sector_links')
      .select('sector_id, label, url, is_external')
      .order('label')
    const dbPorSetor = new Map<string, LinkMenuItem[]>()
    for (const row of dbLinks || []) {
      if (!row.url) continue
      const arr = dbPorSetor.get(String(row.sector_id)) || []
      arr.push({ label: String(row.label || ''), href: String(row.url), external: row.is_external !== false })
      dbPorSetor.set(String(row.sector_id), arr)
    }

    for (const setor of SETORES) {
      if (!podeSetor(setor.id)) continue
      const itens = dbPorSetor.get(setor.id) || []
      if (itens.length) grupos.push({ id: setor.id, label: setor.label, itens })
    }

    // Sistemas das fichas (aba Sistemas), só ativos e com URL
    if (hasPermission(permissions, 'sistema-config-instituicoes', 'can_view')) {
      const { data: ifs } = await admin
        .from('financial_institutions')
        .select('name, systems, is_active')
        .is('deleted_at', null)
      const itens: LinkMenuItem[] = []
      for (const inst of ifs || []) {
        if (inst.is_active === false) continue
        for (const sys of normalizeSystems(inst.systems)) {
          if (!sys.is_active || !sys.url) continue
          itens.push({ label: `${inst.name}${sys.descricao ? ` — ${sys.descricao}` : ''}`, href: sys.url, external: true })
        }
      }
      if (itens.length) grupos.push({ id: 'sistemas-if', label: 'Instituições Financeiras — Sistemas', itens })
    }

    if (hasPermission(permissions, 'promotoras', 'can_view')) {
      const { data: promotoras } = await admin.from('promotoras').select('name, systems, is_active')
      const itens: LinkMenuItem[] = []
      for (const pr of promotoras || []) {
        if (pr.is_active === false) continue
        for (const sys of normalizeSystems(pr.systems)) {
          if (!sys.is_active || !sys.url) continue
          itens.push({ label: `${pr.name}${sys.descricao ? ` — ${sys.descricao}` : ''}`, href: sys.url, external: true })
        }
      }
      if (itens.length) grupos.push({ id: 'sistemas-promotoras', label: 'Promotoras — Sistemas', itens })
    }

    return { success: true, groups: grupos }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar links.' }
  }
}
