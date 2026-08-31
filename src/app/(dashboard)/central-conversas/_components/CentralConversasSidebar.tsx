'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, MessageSquareText, Radio, Smartphone } from 'lucide-react'

const LINKS = [
  { href: '/central-conversas', label: 'Instâncias WhatsApp', icon: Smartphone, exact: true },
  { href: '/central-conversas/canais', label: 'Canais', icon: Radio, exact: false },
]

export default function CentralConversasSidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Central de Atendimento</div>
          {LINKS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            return (
              <Link key={href} href={href} className={`sidebar-link${active ? ' active' : ''}`}>
                <Icon size={18} /> {label}
              </Link>
            )
          })}

          <div className="sidebar-section-label sidebar-section-label-spaced">Atendimento</div>
          <Link href="/conversas" className="sidebar-link">
            <MessageSquareText size={18} /> Abrir conversas
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
          <Link href="/" className="sidebar-link">
            <LayoutDashboard size={18} /> Voltar ao Workspace
          </Link>
        </div>
      </nav>
    </aside>
  )
}
