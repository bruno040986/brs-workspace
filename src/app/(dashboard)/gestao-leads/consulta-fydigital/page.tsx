/**
 * Consulta Fy.Digital — Gestão de Leads. Item novo no menu (24/09/2026),
 * só "Em breve" por enquanto: a integração com a API da FyDigital está em
 * homologação, aguardando a definição do webhook do lado deles (ver
 * GRUPO.md § APIs de Instituições Financeiras de Crédito). Mesmo visual do
 * card "Em Breve" de Provedores e APIs
 * (rh/parceiros/config/provedores/breve/page.tsx).
 */
import { redirect } from 'next/navigation'
import { Clock } from 'lucide-react'
import { requirePermission } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export default async function ConsultaFyDigitalPage() {
  try {
    await requirePermission('alvoconsig-consulta-fydigital')
  } catch {
    redirect('/gestao-leads')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
      <div
        className="card"
        style={{
          maxWidth: '500px',
          padding: '2.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ backgroundColor: 'rgba(212, 163, 89, 0.1)', color: 'var(--brs-gold)', padding: '1rem', borderRadius: '50%', marginBottom: '0.5rem' }}>
          <Clock size={40} />
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--brs-navy)', margin: 0 }}>
          Consulta Fy.Digital — Em breve
        </h2>

        <div style={{ fontSize: '0.925rem', color: 'var(--brs-gray-600)', lineHeight: '1.5', margin: '0.5rem 0' }}>
          A integração de consulta de margem com a <strong>API da FyDigital</strong> está em homologação, aguardando a
          definição do webhook do lado deles.
        </div>

        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--brs-gray-400)',
            backgroundColor: 'var(--brs-gray-50)',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px dashed var(--brs-gray-200)',
            width: '100%',
          }}
        >
          Seu ambiente BRS Gestão está pronto para receber esta funcionalidade automaticamente assim que a homologação terminar.
        </div>
      </div>
    </div>
  )
}
