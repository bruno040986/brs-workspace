import { getPortabilidadeData } from '../actions'
import RegrasIfsClient from './_components/RegrasIfsClient'

export const metadata = {
  title: 'Regras Individuais por IF | Simulador de Portabilidade — BRS Gestão',
}

export default async function RegrasIfsPage() {
  const data = await getPortabilidadeData()

  return (
    <RegrasIfsClient
      convenios={data.convenios}
      financialInstitutions={data.financialInstitutions}
      initialRules={data.rules}
    />
  )
}
