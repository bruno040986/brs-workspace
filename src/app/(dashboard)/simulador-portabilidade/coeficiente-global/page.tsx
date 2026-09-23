import { getPortabilidadeData } from '../actions'
import CoeficienteGlobalClient from './_components/CoeficienteGlobalClient'

export const metadata = {
  title: 'Coeficiente Global | Simulador de Portabilidade — BRS Gestão',
}

export default async function CoeficienteGlobalPage() {
  const data = await getPortabilidadeData()

  return (
    <CoeficienteGlobalClient
      defaultPortCoeff={data.generalConfig.defaultPortCoeff}
    />
  )
}
