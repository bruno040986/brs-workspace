'use client'

/**
 * Sidebar global do Workspace (layout aprovado 02/09/2026): acordeão de
 * divisões que substitui os cards da home. Expandida = acordeão; recolhida
 * (classe `sidebar-recolhida` no body, persistida pelo SidebarCollapseToggle)
 * = trilho de ícones com flyout ao passar o mouse (estilo Conta Azul).
 * A divisão da rota atual abre sozinha; permissão governa grupo e item.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, House, Menu, X } from 'lucide-react'
import {
  NAV_DIVISOES,
  divisaoDaRota,
  divisaoVisivel,
  itemVisivel,
  type NavDivisao,
  type NavItemDef,
} from '@/lib/nav/divisoes'
import { carregarMinhasPermissoes } from '@/lib/auth/permissions-client-cache'
import type { EffectivePermission } from '@/lib/auth/permissions'

export default function WorkspaceSidebar() {
  const pathname = usePathname()
  const [permissions, setPermissions] = useState<EffectivePermission[]>([])
  const [carregou, setCarregou] = useState(false)
  const [abertas, setAbertas] = useState<Record<string, boolean>>({})
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let ativo = true
    carregarMinhasPermissoes().then((perms) => {
      if (!ativo) return
      setPermissions(perms)
      setCarregou(true)
    })
    return () => {
      ativo = false
    }
  }, [])

  const divisaoAtual = useMemo(() => divisaoDaRota(pathname || '/'), [pathname])

  // A divisão da rota atual abre sozinha (sem fechar o que o usuário abriu).
  useEffect(() => {
    if (divisaoAtual) setAbertas((prev) => ({ ...prev, [divisaoAtual]: true }))
  }, [divisaoAtual])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const visiveis = useMemo(
    () => (carregou ? NAV_DIVISOES.filter((d) => divisaoVisivel(permissions, d)) : []),
    [permissions, carregou],
  )

  function rotaAtiva(href: string): boolean {
    if (!href.startsWith('/')) return false
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function renderItem(divisao: NavDivisao, item: NavItemDef, contexto: 'acordeao' | 'flyout') {
    const filhos = (item.children || []).filter((c) => itemVisivel(permissions, c, item.perms))
    const filhoAtivo = filhos.some((c) => rotaAtiva(c.href))
    const ativo = rotaAtiva(item.href) || filhoAtivo
    const mostrarFilhos = contexto === 'acordeao' && ativo && filhos.length > 0
    return (
      <div key={`${divisao.id}:${item.href}:${item.label}`}>
        {item.soon ? (
          <span className="ws-nav-item is-soon">
            {item.label}
            <span className="ws-soon-badge">breve</span>
          </span>
        ) : (
          <Link href={item.href} className={`ws-nav-item${ativo ? ' is-active' : ''}`}>
            {item.label}
          </Link>
        )}
        {mostrarFilhos && filhos.length > 0 && (
          <div className="ws-nav-children">
            {filhos.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className={`ws-nav-item ws-nav-child${pathname === c.href || pathname.startsWith(`${c.href}/`) ? ' is-active' : ''}`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderDivisao(d: NavDivisao) {
    const Icon = d.icon
    const aberta = Boolean(abertas[d.id])
    const atual = divisaoAtual === d.id
    const itens = d.itens.filter((i) => itemVisivel(permissions, i))
    return (
      <div key={d.id} className={`ws-nav-group${aberta ? ' is-open' : ''}${atual ? ' is-current' : ''}`}>
        <button
          type="button"
          className="ws-group-head"
          onClick={() => setAbertas((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
          title={d.label}
        >
          <span className="ws-group-icon">
            <Icon size={18} />
          </span>
          <span className="ws-group-label">{d.label}</span>
          <ChevronRight size={14} className="ws-group-chevron" />
        </button>
        <div className="ws-group-items">{itens.map((item) => renderItem(d, item, 'acordeao'))}</div>
        {/* flyout do modo trilho — mesmo conteúdo, aberto por hover via CSS */}
        <div className="ws-flyout">
          <div className="ws-flyout-title">{d.label}</div>
          {itens.map((item) => renderItem(d, item, 'flyout'))}
        </div>
      </div>
    )
  }

  if (carregou && visiveis.length === 0) return null

  return (
    <>
      <button
        type="button"
        className="ws-sidebar-mobile-toggle"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {mobileOpen && <div className="ws-sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={`workspace-sidebar${mobileOpen ? ' is-mobile-open' : ''}`}>
        <nav className="ws-sidebar-nav">
          {/* Home fixo acima das divisões — visível em toda tela (e no trilho) */}
          <Link href="/" className={`ws-home-link${pathname === '/' ? ' is-active' : ''}`} title="Home">
            <span className="ws-group-icon">
              <House size={18} />
            </span>
            <span className="ws-group-label">Home</span>
          </Link>
          {visiveis.map(renderDivisao)}
        </nav>
      </aside>
    </>
  )
}
