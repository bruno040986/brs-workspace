'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BarChart3, CalendarDays, Clock3, KanbanSquare, LayoutDashboard } from 'lucide-react'

export default function AgendaSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get('view') || 'tarefas'

  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Agenda &amp; Tarefas</div>
          <Link
            href="/agenda?view=agenda"
            className={`sidebar-link${pathname === '/agenda' && view === 'agenda' ? ' active' : ''}`}
          >
            <CalendarDays size={18} /> Agenda
          </Link>
          <Link
            href="/agenda"
            className={`sidebar-link${pathname === '/agenda' && view === 'tarefas' ? ' active' : ''}`}
          >
            <KanbanSquare size={18} /> Painel de Tarefas
          </Link>
          <Link
            href="/agenda?view=compromissos"
            className={`sidebar-link${pathname === '/agenda' && view === 'compromissos' ? ' active' : ''}`}
          >
            <Clock3 size={18} /> Compromissos
          </Link>
          <Link
            href="/agenda?view=relatorio"
            className={`sidebar-link${pathname === '/agenda' && view === 'relatorio' ? ' active' : ''}`}
          >
            <BarChart3 size={18} /> Relatórios
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
