/**
 * Cadastros › Status e Situações de Proposta — placeholder "em construção".
 * As tabelas (propostas_status / propostas_situacoes / propostas_esteira_config,
 * migration 20260930140135) já existem com o seed do ARW; o CRUD com abas
 * Status · Situações · Configuração é a fatia 2 (telas) da esteira
 * (docs/SPEC-ESTEIRA-DIGITACAO-PROPOSTAS-2026-09-29.md §6.5).
 * Mesmo visual do "Em breve" de gestao-leads/consulta-fydigital.
 */
import { redirect } from 'next/navigation'
import { ListChecks } from 'lucide-react'
import { requirePermission } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export default async function PropostasCatalogosPage() {
  try {
    await requirePermission('operacional-propostas-catalogos')
  } catch {
    redirect('/')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
      <div className="card" style={{ maxWidth: '500px', padding: '2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', borderRadius: '16px' }}>
        <div style={{ backgroundColor: 'rgba(212, 163, 89, 0.1)', color: 'var(--brs-gold)', padding: '1rem', borderRadius: '50%', marginBottom: '0.5rem' }}>
          <ListChecks size={40} />
        </div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--brs-navy)', margin: 0 }}>
          Status e Situações de Proposta — Em construção
        </h2>
        <div style={{ fontSize: '0.925rem', color: 'var(--brs-gray-600)', lineHeight: '1.5', margin: '0.5rem 0' }}>
          Os catálogos de <strong>Status</strong> (8) e <strong>Situação</strong> (30) de proposta já foram carregados
          a partir do ARW. A tela de manutenção (grupo, cores, flags e status sugerido) chega na próxima entrega da esteira.
        </div>
      </div>
    </div>
  )
}
