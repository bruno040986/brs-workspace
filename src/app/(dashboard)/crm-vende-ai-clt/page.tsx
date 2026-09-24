/**
 * CRM Vende.Ai CLT — disparo/orquestração do CLT (CallFace + WhatsApp
 * oficial + Vende.Ai), via Central de Integrações. Separado de "Gestão de
 * Leads" em 24/09/2026. Cards vêm do mesmo registro que a sidebar usa
 * (src/lib/nav/divisoes.ts), via CardsDoItem.
 */
import { redirect } from 'next/navigation'
import { requireAnyPermission, getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { CardsDoItem } from '@/components/nav/CardsDoItem'

export const dynamic = 'force-dynamic'

export default async function CrmVendeAiCltPage() {
  try {
    await requireAnyPermission([{ resource: 'central-integracoes', action: 'can_view' }])
  } catch {
    redirect('/')
  }
  const permissions = await getCurrentUserEffectivePermissions()

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem' }}>CRM Vende.Ai CLT</h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.4rem' }}>
        Disparos do CLT (CallFace, WhatsApp oficial, Vende.Ai) — ações manuais e importação de bases.
      </p>
      <CardsDoItem href="/crm-vende-ai-clt" permissions={permissions} />
    </div>
  )
}
