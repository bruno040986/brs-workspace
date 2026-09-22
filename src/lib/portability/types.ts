export type ConvenioTipo = 'INSS' | 'SIAPE' | 'OUTROS'

export interface ClientePortabilidade {
  name: string
  cpf: string
  nb: string
  dob: string
  age: number | null
  species: string
  speciesCode: number | null
  representative: boolean | null
  margin: number | null
  phone: string
  bankCode: string
  agency: string
  account: string
  dib: string
  ddb: string
  qtdContracts: number | null
  dibRecent: boolean
  convenio: ConvenioTipo
}

export interface ContratoPortabilidade {
  id: string
  origin: string
  originLabel: string
  contract: string
  installment: number
  debt: number
  paid: number | null
  total: number | null
  remaining: number | null
  rate: number | null
  startDate: string
  code: string
}

export type MinReleaseMode =
  | 'fixed'
  | 'percentNew'
  | 'maxFixedOrPercentNew'
  | 'percentDebtOnly'
  | 'maxFixedOrPercentDebt'
  | 'installment'
  | null

export interface TabelaSimuladorEspecial {
  n: number
  rate: number
  minFinanced: number
}

export interface RegraBancoPortabilidade {
  id: string
  name: string
  enabled: boolean
  portCoeff: number | null
  entry: number | null
  refiMin: number | null
  refiMax: number | null
  ageMin: number | null
  ageMaxYears: number | null
  ageMaxMonths: number | null
  endAgeYears: number | null
  endAgeMonths: number | null
  minInstallment: number | null
  minDebt: number | null
  minFinanced: number | null
  minRelease: number | null
  minReleaseMode: MinReleaseMode
  minReleasePercent: number | null
  blocked: string[]
  paid: Record<string, number>
  defaultPaid: number | null
  networkPaid: number | null
  special: string[]
  under12: string[]
  term: number
  notes: string
  daycovalSimulator?: {
    enabled: boolean
    weightedRate: boolean
    minRelease: number
    minReleasePercentNew: number
    tables: TabelaSimuladorEspecial[]
  }
  queroSimulator?: {
    enabled: boolean
    weightedRate: boolean
    minRelease: number
    tables: TabelaSimuladorEspecial[]
  }
}

export interface ResultadoBanco {
  status: 'ok' | 'pending' | 'no'
  reason: string
  release: number | null
  weightedRate?: number | null
  minFinanced?: number | null
}

export interface ResultadoEvaluacaoBundle {
  loan: ContratoPortabilidade
  results: Array<{
    bank: RegraBancoPortabilidade
    evaluation: ResultadoBanco
  }>
}

export interface ConfiguracoesGeraisPortabilidade {
  blockLoas: boolean
  loasSpecies: string
  blockRepresentative: boolean
  loasReason: string
  representativeReason: string
  defaultPortCoeff: number
  newCoeffs: Record<string, number>
  newLoasCoeffs: Record<string, number>
}
