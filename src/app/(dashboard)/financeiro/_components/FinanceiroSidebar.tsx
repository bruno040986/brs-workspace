'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Banknote, History, LayoutDashboard, Wallet } from 'lucide-react'

export default function FinanceiroSidebar() {
  const pathname = usePathname()

  const linkClass = (href: string, exact = false) =>
    `sidebar-link${(exact ? pathname === href : pathname.startsWith(href)) ? ' active' : ''}`

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />

      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Portal Financeiro</div>
          <Link href="/financeiro/conta-parceiros" className={linkClass('/financeiro/conta-parceiros')}>
            <Wallet size={18} />
            Lançamentos Manuais
          </Link>
          <Link href="/financeiro/saques" className={linkClass('/financeiro/saques')}>
            <Banknote size={18} />
            Pedidos de Saque
          </Link>
          <Link href="/financeiro/historico" className={linkClass('/financeiro/historico')}>
            <History size={18} />
            Histórico
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
          <Link href="/" className="sidebar-link">
            <LayoutDashboard size={18} />
            Voltar ao Workspace
          </Link>
        </div>
      </nav>
    </aside>
  )
}
