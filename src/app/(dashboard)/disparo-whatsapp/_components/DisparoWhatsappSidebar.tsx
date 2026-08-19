'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, MessageSquare, PlusCircle, Ban, Settings } from 'lucide-react'

export default function DisparoWhatsappSidebar() {
  const pathname = usePathname()
  const is = (href: string, exact = false) => (exact ? pathname === href : pathname.startsWith(href))

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Disparo de WhatsApp</div>
          <Link href="/disparo-whatsapp" className={`sidebar-link${is('/disparo-whatsapp', true) || /^\/disparo-whatsapp\/[0-9a-f-]{36}$/.test(pathname) ? ' active' : ''}`}>
            <MessageSquare size={18} /> Campanhas
          </Link>
          <Link href="/disparo-whatsapp/nova" className={`sidebar-link${is('/disparo-whatsapp/nova') ? ' active' : ''}`}>
            <PlusCircle size={18} /> Nova campanha
          </Link>
          <Link href="/disparo-whatsapp/optouts" className={`sidebar-link${is('/disparo-whatsapp/optouts') ? ' active' : ''}`}>
            <Ban size={18} /> Opt-outs
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
          <Link href="/rh/parceiros/config/provedores/whatsapp" className="sidebar-link">
            <Settings size={18} /> Instâncias Z-API
          </Link>
          <Link href="/" className="sidebar-link">
            <LayoutDashboard size={18} /> Voltar ao Workspace
          </Link>
        </div>
      </nav>
    </aside>
  )
}
