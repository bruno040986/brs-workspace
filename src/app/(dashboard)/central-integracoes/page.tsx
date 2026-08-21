import { getCentralOverview } from './actions'
import OverviewClient from './_components/OverviewClient'

export const dynamic = 'force-dynamic'

export default async function CentralIntegracoesPage() {
  const overview = await getCentralOverview()

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Central de Integrações
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Acompanhamento e comando dos orquestradores e dos sistemas integrados
          (WeSales, CallFace, Vende.AI, NVTI) — o que não dá para fazer nas plataformas, faz aqui.
        </p>
      </div>

      <OverviewClient initial={overview} />
    </div>
  )
}
