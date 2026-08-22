'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Landmark, LayoutDashboard, Percent, Table2 } from 'lucide-react'

export default function CadastrosCreditoSidebar() {
  const pathname = usePathname()

  const linkClass = (href: string) =>
    `sidebar-link${pathname.startsWith(href) ? ' active' : ''}`

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />

      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Cadastros de Crédito</div>
          <Link href="/cadastros-credito/convenios" className={linkClass('/cadastros-credito/convenios')}>
            <Landmark size={18} />
            Convênios
          </Link>
          <Link href="/cadastros-credito/tabelas" className={linkClass('/cadastros-credito/tabelas')}>
            <Table2 size={18} />
            Tabelas de Crédito
          </Link>
          <Link href="/cadastros-credito/coeficientes" className={linkClass('/cadastros-credito/coeficientes')}>
            <Percent size={18} />
            Coeficientes
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Relacionados</div>
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
  )
}
