/**
 * Grade de cards pros filhos de um item do registro de menus
 * (`src/lib/nav/divisoes.ts`) — MESMA fonte que a sidebar usa, pra nunca
 * divergir do que aparece na barra (reorganização 24/09/2026). Usada pelas
 * telas de entrada "Gestão de Leads", "CRM AlvoConsig" e "CRM Vende.Ai CLT".
 */
import Link from 'next/link'
import { LayoutGrid } from 'lucide-react'
import { NAV_DIVISOES, itemVisivel, type NavItemDef } from '@/lib/nav/divisoes'
import type { EffectivePermission } from '@/lib/auth/permissions'

function acharItem(href: string): NavItemDef | null {
  for (const divisao of NAV_DIVISOES) {
    const item = divisao.itens.find((i) => i.href === href)
    if (item) return item
  }
  return null
}

export function CardsDoItem({ href, permissions }: { href: string; permissions: EffectivePermission[] }) {
  const item = acharItem(href)
  const filhos = (item?.children || []).filter((c) => itemVisivel(permissions, c, item?.perms))

  if (!filhos.length) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '0.9rem' }}>
      {filhos.map((c) => {
        const Icone = c.icon || LayoutGrid
        return (
          <Link
            key={c.href}
            href={c.href}
            className="card"
            style={{ padding: '1.1rem', textDecoration: 'none', color: 'var(--brs-gray-800)', display: 'block', position: 'relative' }}
          >
            {c.soon && (
              <span
                style={{
                  position: 'absolute', top: '0.8rem', right: '0.8rem', fontSize: '0.65rem', fontWeight: 700,
                  color: 'var(--brs-gray-400)', background: 'var(--brs-gray-100)', padding: '0.15rem 0.5rem', borderRadius: 999,
                }}
              >
                Em breve
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--brs-navy)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icone size={19} />
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{c.label}</strong>
            </div>
            {c.desc && <p style={{ margin: 0, color: 'var(--brs-gray-400)', fontSize: '0.8rem', lineHeight: 1.45 }}>{c.desc}</p>}
          </Link>
        )
      })}
    </div>
  )
}
