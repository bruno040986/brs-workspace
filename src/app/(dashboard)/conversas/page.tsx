import { requirePermission } from '@/lib/auth/server'
import CentralConversasPanel from '@/components/conversas/CentralConversasPanel'

export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  await requirePermission('conversas', 'can_view')
  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 2rem)', minHeight: 520 }}>
      <div className="page-header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <h1 className="page-title">Central de Conversas</h1>
          <p className="page-subtitle">WhatsApp, oficial, site e demais canais da BRS, num lugar só.</p>
        </div>
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0, padding: 0, overflow: 'hidden' }}>
        <CentralConversasPanel />
      </div>
    </div>
  )
}
