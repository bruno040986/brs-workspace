'use client'

/**
 * Dropdown "Links" da topbar: mini-cards por setor com busca. Nada carrega
 * até o primeiro clique (o menu é o substituto leve dos links que pesavam
 * na home). Fonte: getWorkspaceLinksMenu (catálogo fixo + sector_links +
 * sistemas das fichas de IF/Promotoras).
 */
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Link2, Loader2 } from 'lucide-react'
import { getWorkspaceLinksMenu, type LinkMenuGroup } from '@/lib/nav/links-menu'

export default function LinksDropdown() {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<LinkMenuGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && groups === null && !loading) {
      setLoading(true)
      try {
        const res = await getWorkspaceLinksMenu()
        setGroups(res.success ? res.groups || [] : [])
      } catch {
        setGroups([])
      } finally {
        setLoading(false)
      }
    }
  }

  const q = busca.trim().toLowerCase()
  const filtrados = (groups || [])
    .map((g) => ({ ...g, itens: q ? g.itens.filter((i) => i.label.toLowerCase().includes(q)) : g.itens }))
    .filter((g) => g.itens.length > 0)

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-button" onClick={toggle} title="Links e sistemas externos" style={{ width: 'auto', padding: '0 0.8rem', gap: 6, display: 'inline-flex', alignItems: 'center', fontWeight: 700, fontSize: '0.82rem' }}>
        <Link2 size={17} /> Links
      </button>
      {open && (
        <div
          data-brs-messenger-ignore-close="true"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: 'min(680px, 92vw)',
            maxHeight: 'min(560px, calc(100dvh - 110px))', overflow: 'auto',
            background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-200)', borderRadius: 14,
            boxShadow: '0 14px 40px rgba(15,35,71,0.22)', padding: '0.9rem', zIndex: 120,
          }}
        >
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar link ou sistema… (ex.: ARW, Quark, Conta Azul)"
            style={{
              width: '100%', height: 38, border: '1px solid var(--brs-gray-200)', borderRadius: 9,
              background: 'var(--brs-gray-50)', color: 'var(--brs-gray-800)', padding: '0 0.8rem',
              fontFamily: 'inherit', fontSize: '0.85rem', marginBottom: '0.8rem',
            }}
          />
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '0.8rem' }}>
              <Loader2 size={16} className="animate-spin" /> Carregando links…
            </div>
          )}
          {!loading && filtrados.length === 0 && (
            <div style={{ color: 'var(--brs-gray-400)', padding: '0.8rem', fontSize: '0.85rem' }}>Nenhum link encontrado.</div>
          )}
          {filtrados.map((g) => (
            <div key={g.id} style={{ marginBottom: '0.9rem' }}>
              <div style={{ fontSize: '0.66rem', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--brs-gray-400)', fontWeight: 700, margin: '0 0 0.45rem' }}>
                {g.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                {g.itens.map((item, idx) => (
                  <a
                    key={`${item.href}:${idx}`}
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noreferrer' : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.6rem',
                      border: '1px solid var(--brs-gray-200)', borderRadius: 10, background: 'var(--brs-gray-50)',
                      textDecoration: 'none', color: 'var(--brs-gray-800)', fontSize: '0.78rem', fontWeight: 500,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {item.external && <ExternalLink size={12} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--brs-gray-400)' }} />}
                  </a>
                ))}
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px dashed var(--brs-gray-200)', paddingTop: '0.6rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
            Os sistemas das fichas de Instituições Financeiras e Promotoras entram aqui automaticamente pela aba
            &quot;Sistemas&quot; de cada cadastro. Links avulsos são gerenciados em <a href="/links" style={{ color: 'var(--brs-navy-light)' }}>/links</a>.
          </div>
        </div>
      )}
    </div>
  )
}
