/**
 * CRM AlvoConsig — o que é específico da carteira de parceiros AlvoConsig
 * (correspondentes bancários): alocação, leads já alocados, carteira de
 * parceiros e perfis de usuário. Separado de "Gestão de Leads" (preparo de
 * leads, agnóstico de frente comercial) em 24/09/2026. Cards vêm do mesmo
 * registro que a sidebar usa (src/lib/nav/divisoes.ts), via CardsDoItem.
 */
import { redirect } from 'next/navigation'
import { requireAnyPermission, getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { CardsDoItem } from '@/components/nav/CardsDoItem'

export const dynamic = 'force-dynamic'

export default async function CrmAlvoConsigPage() {
  try {
    await requireAnyPermission([
      { resource: 'alvoconsig-gestao', action: 'can_view' },
      { resource: 'alvoconsig-certificacao', action: 'can_view' },
    ])
  } catch {
    redirect('/')
  }
  const permissions = await getCurrentUserEffectivePermissions()

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem' }}>CRM AlvoConsig</h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.4rem' }}>
        Alocação, leads alocados, carteira de parceiros e perfis — a operação do AlvoConsig com os parceiros.
      </p>
      <CardsDoItem href="/crm-alvoconsig" permissions={permissions} />
    </div>
  )
}
