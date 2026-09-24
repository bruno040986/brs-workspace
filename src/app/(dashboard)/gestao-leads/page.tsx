/**
 * Gestão de Leads — preparo de leads, independente de convênio ou frente
 * comercial: visão geral, cadastro, importações e as consultas de margem
 * (Amigoz/Kaizom/Fy.Digital). Reorganizado 24/09/2026 — separado do que é
 * específico do AlvoConsig (CRM AlvoConsig) e do CLT (CRM Vende.Ai CLT).
 * Cards vêm do MESMO registro que a sidebar usa (src/lib/nav/divisoes.ts),
 * via CardsDoItem — nunca diverge do que aparece na barra.
 */
import { redirect } from 'next/navigation'
import { requireAnyPermission, getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { CardsDoItem } from '@/components/nav/CardsDoItem'

export const dynamic = 'force-dynamic'

export default async function GestaoLeadsPage() {
  try {
    await requireAnyPermission([
      { resource: 'alvoconsig-gestao', action: 'can_view' },
      { resource: 'alvoconsig-higienizacao-amigoz', action: 'can_view' },
      { resource: 'alvoconsig-motor-credito', action: 'can_view' },
      { resource: 'alvoconsig-consulta-fydigital', action: 'can_view' },
    ])
  } catch {
    redirect('/')
  }
  const permissions = await getCurrentUserEffectivePermissions()

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem' }}>Gestão de Leads</h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.4rem' }}>
        Preparo de leads num lugar só — cadastro, importações e consultas de margem, independente do convênio.
        Alocação e carteira de parceiros ficam em CRM AlvoConsig; disparos do CLT ficam em CRM Vende.Ai CLT.
      </p>
      <CardsDoItem href="/gestao-leads" permissions={permissions} />
    </div>
  )
}
