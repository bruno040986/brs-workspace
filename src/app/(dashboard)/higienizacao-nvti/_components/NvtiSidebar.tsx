'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Search, Settings } from 'lucide-react'

export default function NvtiSidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Higienização NVTI</div>
          <Link href="/higienizacao-nvti" className={`sidebar-link${pathname === '/higienizacao-nvti' ? ' active' : ''}`}>
            <Search size={18} /> Consultas e Lotes
          </Link>

          <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
          <Link href="/rh/parceiros/config/provedores/nvti" className="sidebar-link">
            <Settings size={18} /> API Nova Vida TI
          </Link>
          <Link href="/" className="sidebar-link">
            <LayoutDashboard size={18} /> Voltar ao Workspace
          </Link>
        </div>
      </nav>
    </aside>
  )
}
