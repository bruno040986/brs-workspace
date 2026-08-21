import { notFound } from 'next/navigation'
import { getOrchestrator } from '@/lib/central/orchestrators'
import { getOrchestratorEvents, getOrchestratorErrors, getOrchestratorStats } from '../../actions'
import OrchestratorClient from '../../_components/OrchestratorClient'

export const dynamic = 'force-dynamic'

export default async function OrchestratorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const def = getOrchestrator(slug)
  if (!def) notFound()

  const [events, errors, stats] = await Promise.all([
    getOrchestratorEvents(slug, { limit: 50 }),
    getOrchestratorErrors(slug, { limit: 50 }),
    getOrchestratorStats(slug),
  ])

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          {def.name}
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          {def.description}
        </p>
      </div>

      <OrchestratorClient
        slug={slug}
        initialEvents={events.ok ? events.data.events : []}
        initialErrors={errors.ok ? errors.data.errors : []}
        initialStats={stats.ok ? stats.data : null}
        loadError={!events.ok ? events.error : null}
      />
    </div>
  )
}
