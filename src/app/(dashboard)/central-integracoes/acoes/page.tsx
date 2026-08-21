import { listCentralJobs, getWesalesMeta, getVendeaiMeta } from '../actions'
import ActionsClient from '../_components/ActionsClient'

export const dynamic = 'force-dynamic'

const SLUG = 'clt'

export default async function AcoesPage() {
  const [jobs, wesalesMeta, vendeaiMeta] = await Promise.all([
    listCentralJobs(SLUG),
    getWesalesMeta(SLUG),
    getVendeaiMeta(SLUG),
  ])

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Ações manuais
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Escolha a ação, monte o público com filtros do WeSales (ou uma base subida), confira o
          preview e dispare. O orquestrador executa com ritmo controlado — dá para pausar a qualquer momento.
        </p>
      </div>

      <ActionsClient
        slug={SLUG}
        initialJobs={jobs.ok ? jobs.data.jobs : []}
        jobsError={jobs.ok ? null : jobs.error}
        wesalesMeta={wesalesMeta.ok ? wesalesMeta.data : null}
        vendeaiMeta={vendeaiMeta.ok ? vendeaiMeta.data : null}
      />
    </div>
  )
}
