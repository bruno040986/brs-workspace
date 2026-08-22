'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Calculator, Landmark, LayoutDashboard, Table2 } from 'lucide-react'

export default function CoeficientesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const linkClass = (href: string, exact = false) =>
    `sidebar-link${(exact ? pathname === href : pathname.startsWith(href)) ? ' active' : ''}`

  return (
    <div className="rh-layout-container">
      <aside className="sidebar">
        <div style={{ height: '1.5rem' }} />
        <nav className="sidebar-nav">
          <div className="sidebar-nav-stack">
            <div className="sidebar-section-label">Coeficientes Financeiros</div>
            <Link href="/coeficientes" className={linkClass('/coeficientes', true)}>
              <Calculator size={18} />
              Coeficientes
            </Link>

            <div className="sidebar-section-label sidebar-section-label-spaced">Relacionados</div>
            <Link href="/comissionamento/tabelas" className="sidebar-link">
              <Table2 size={18} />
              Tabelas de Comissão
            </Link>
            <Link href="/convenios" className="sidebar-link">
              <Landmark size={18} />
              Convênios
            </Link>
            <Link href="/instituicoes-financeiras" className="sidebar-link">
              <Building2 size={18} />
              Instituições Financeiras
            </Link>

            <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
            <Link href="/" className="sidebar-link">
              <LayoutDashboard size={18} />
              Voltar ao Workspace
            </Link>
          </div>
        </nav>
      </aside>
      <div className="rh-content">{children}</div>
    </div>
  )
}
