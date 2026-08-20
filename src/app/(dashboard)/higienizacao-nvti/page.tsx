import NvtiClient from './_components/NvtiClient'
import { getNvtiPanorama, listNvtiBatches } from './actions'

export const dynamic = 'force-dynamic'

export default async function HigienizacaoNvtiPage() {
  const [panorama, batches] = await Promise.all([getNvtiPanorama(), listNvtiBatches()])

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Higienização de CPF NVTI
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Consulta de dados cadastrais, celulares com WhatsApp e indicadores de crédito na Nova Vida TI —
          unitária ou em lote, com controle de gasto mensal.
        </p>
      </div>

      <NvtiClient initialPanorama={panorama} initialBatches={batches} />
    </div>
  )
}
