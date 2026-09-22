import { getPortabilidadeData } from './actions'
import SimuladorPortabilidadeClient from './_components/SimuladorPortabilidadeClient'

export const metadata = {
  title: 'Simulador de Portabilidade | BRS Workspace',
  description: 'Análise e simulação em tempo real de portabilidade de empréstimos consignados.',
}

export default async function SimuladorPortabilidadePage() {
  const data = await getPortabilidadeData()

  return (
    <div className="page-content">
      <SimuladorPortabilidadeClient
        convenios={data.convenios as Array<{ id: string; nome: string; codigo: string }>}
        financialInstitutions={data.financialInstitutions}
        initialRules={data.rules}
        initialGeneralConfig={data.generalConfig}
      />
    </div>
  )
}
