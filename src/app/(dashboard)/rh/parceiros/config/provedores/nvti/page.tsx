import { NvtiConfigForm } from './NvtiConfigForm'
import { getNvtiConfigView } from './actions'

export const dynamic = 'force-dynamic'

export default async function NvtiConfigPage() {
  const config = await getNvtiConfigView()

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Configurações de API - Nova Vida TI
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Credenciais e parâmetros da higienização de CPF (Nova Vida TI). O consumo é cobrado por consulta,
          conforme a tabela em cascata.
        </p>
      </div>

      <NvtiConfigForm config={config} />
    </div>
  )
}
