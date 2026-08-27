'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, Bell, Database, LayoutDashboard, Radio, Rocket, Workflow,
} from 'lucide-react'

const LINKS = [
  { href: '/central-integracoes', label: 'Visão Geral', icon: Activity, exact: true },
  { href: '/central-integracoes/orquestradores/clt', label: 'Orquestrador CLT', icon: Workflow, exact: false },
  { href: '/central-integracoes/sistemas', label: 'Sistemas', icon: Radio, exact: false },
  { href: '/central-integracoes/acoes', label: 'Ações Manuais', icon: Rocket, exact: false },
  { href: '/central-integracoes/bases', label: 'Bases (Upload)', icon: Database, exact: false },
  { href: '/central-integracoes/monitoramento', label: 'Monitoramento', icon: Bell, exact: false },
]

export default function CentralSidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Central de Integrações</div>
          {LINKS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            return (
              <Link key={href} href={href} className={`sidebar-link${active ? ' active' : ''}`}>
                <Icon size={18} /> {label}
              </Link>
            )
          })}

          <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
          <Link href="/" className="sidebar-link">
            <LayoutDashboard size={18} /> Voltar ao Workspace
          </Link>
        </div>
      </nav>
    </aside>
  )
}
