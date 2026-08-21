import { listCentralJobs } from '../actions'
import BasesClient from '../_components/BasesClient'

export const dynamic = 'force-dynamic'

const SLUG = 'clt'

export default async function BasesPage() {
  const jobs = await listCentralJobs(SLUG)

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Bases do motor de crédito
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Suba aqui a base exportada da Vende.AI (higienizada no motor de crédito dos bancos).
          Cada linha vira/atualiza um contato no WeSales com as regras de elegibilidade, e a base
          ganha uma tag <code>base-*</code> — que vira público nas ações manuais.
        </p>
      </div>

      <BasesClient
        slug={SLUG}
        initialJobs={jobs.ok ? jobs.data.jobs.filter((j) => j.action === 'credit_base_import') : []}
        jobsError={jobs.ok ? null : jobs.error}
      />
    </div>
  )
}
