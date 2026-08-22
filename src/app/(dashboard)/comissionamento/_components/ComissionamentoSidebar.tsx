'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Calculator, Clock, FileCheck, FileText, Landmark, LayoutDashboard, Percent, Table2 } from 'lucide-react'

export default function ComissionamentoSidebar() {
  const pathname = usePathname()

  const linkClass = (href: string, exact = false) =>
    `sidebar-link${(exact ? pathname === href : pathname.startsWith(href)) ? ' active' : ''}`

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />

      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Comissionamento (ARW)</div>
          <Link href="/comissionamento/tabelas" className={linkClass('/comissionamento/tabelas')}>
            <Table2 size={18} />
            Tabelas de Comissão
          </Link>
          <Link href="/comissionamento/prazos" className={linkClass('/comissionamento/prazos')}>
            <Clock size={18} />
            Prazos Comissão
          </Link>
          <Link href="/comissionamento/spreads" className={linkClass('/comissionamento/spreads')}>
            <Percent size={18} />
            Spreads (Margem Mínima)
          </Link>
          <Link href="/comissionamento/formas-contrato" className={linkClass('/comissionamento/formas-contrato')}>
            <FileText size={18} />
            Formas de Contrato
          </Link>
          <Link href="/comissionamento/tipos-formalizacao" className={linkClass('/comissionamento/tipos-formalizacao')}>
            <FileCheck size={18} />
            Tipos de Formalização
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Relacionados</div>
          <Link href="/coeficientes" className="sidebar-link">
            <Calculator size={18} />
            Coeficientes
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
  )
}
