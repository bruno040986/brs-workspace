import Link from 'next/link'
import { Landmark, LayoutDashboard } from 'lucide-react'

function ConveniosSidebar() {
  return (
    <aside className="sidebar">
      <div style={{ height: '1.5rem' }} />
      <nav className="sidebar-nav">
        <div className="sidebar-nav-stack">
          <div className="sidebar-section-label">Convênios</div>
          <Link href="/convenios" className="sidebar-link active">
            <Landmark size={18} />
            Convênios
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

export default function ConveniosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rh-layout-container">
      <ConveniosSidebar />
      <div className="rh-content">{children}</div>
    </div>
  )
}
