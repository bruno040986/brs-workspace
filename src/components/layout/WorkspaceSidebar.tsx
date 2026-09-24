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
  type NavSubItem,
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

  /** Como rotaAtiva, mas respeita `exact` — necessário quando o href de um filho
   * é prefixo de outro item irmão (ex.: /alvoconsig × /alvoconsig/alocacao). */
  function rotaAtivaFilho(c: NavSubItem): boolean {
    if (!c.href.startsWith('/')) return false
    return c.exact ? pathname === c.href : rotaAtiva(c.href)
  }

  function renderItem(divisao: NavDivisao, item: NavItemDef, contexto: 'acordeao' | 'flyout') {
    const filhos = (item.children || []).filter((c) => itemVisivel(permissions, c, item.perms))
    const filhoAtivo = filhos.some((c) => rotaAtivaFilho(c))
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
          <Link href={item.href} prefetch={false} className={`ws-nav-item${ativo ? ' is-active' : ''}`}>
            {item.label}
          </Link>
        )}
        {mostrarFilhos && filhos.length > 0 && (
          <div className="ws-nav-children">
            {filhos.map((c) =>
              c.soon ? (
                <Link key={c.href} href={c.href} prefetch={false} className={`ws-nav-item ws-nav-child is-soon${rotaAtivaFilho(c) ? ' is-active' : ''}`}>
                  {c.label}
                  <span className="ws-soon-badge">breve</span>
                </Link>
              ) : (
                <Link
                  key={c.href}
                  href={c.href}
                  prefetch={false}
                  className={`ws-nav-item ws-nav-child${rotaAtivaFilho(c) ? ' is-active' : ''}`}
                >
                  {c.label}
                </Link>
              ),
            )}
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
          {/* prefetch={false} em todo link de menu (13/09/2026): o menu inteiro fica no
              viewport, e o Next pré-buscava cada item a cada navegação/hover — milhares
              de requisições/dia sem clique (custo de Observability na Vercel). Sem
              loading.tsx a pré-busca nem entregava a página. */}
          <Link href="/" prefetch={false} className={`ws-home-link${pathname === '/' ? ' is-active' : ''}`} title="Home">
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
