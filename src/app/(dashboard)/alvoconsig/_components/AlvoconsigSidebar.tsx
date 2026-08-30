'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Contact, LayoutDashboard, Send, ShieldCheck, Target, Upload, UserCog, Users } from 'lucide-react'

export default function AlvoconsigSidebar() {
  const pathname = usePathname()

  const linkClass = (href: string, exact = false) =>
    `sidebar-link${(exact ? pathname === href : pathname.startsWith(href)) ? ' active' : ''}`

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />

      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">AlvoConsig — Gestão de Leads</div>
          <Link href="/alvoconsig" className={linkClass('/alvoconsig', true)}>
            <Target size={18} />
            Visão Geral
          </Link>
          <Link href="/alvoconsig/importacoes" className={linkClass('/alvoconsig/importacoes')}>
            <Upload size={18} />
            Importar Mailing
          </Link>
          <Link href="/alvoconsig/alocacao" className={linkClass('/alvoconsig/alocacao')}>
            <Send size={18} />
            Alocação de leads
          </Link>
          <Link href="/alvoconsig/certificacao" className={linkClass('/alvoconsig/certificacao')}>
            <ShieldCheck size={18} />
            Certificação
          </Link>
          <Link href="/alvoconsig/contatos" className={linkClass('/alvoconsig/contatos')}>
            <Contact size={18} />
            Contatos
          </Link>
          <Link href="/alvoconsig/perfis" className={linkClass('/alvoconsig/perfis')}>
            <UserCog size={18} />
            Perfis de Usuário
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Relacionados</div>
          <Link href="/agente-corban" className="sidebar-link">
            <Users size={18} />
            Agente Corban
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
