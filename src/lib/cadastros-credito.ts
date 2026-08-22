export const CONVENIO_ESFERAS = [
  { value: 'municipal', label: 'Municipal' },
  { value: 'estadual', label: 'Estadual' },
  { value: 'federal', label: 'Federal' },
  { value: 'inss', label: 'INSS' },
  { value: 'outro', label: 'Outro' },
] as const

export type ConvenioEsfera = (typeof CONVENIO_ESFERAS)[number]['value']

export const PRODUTOS_CREDITO = [
  { value: 'novo', label: 'Empréstimo Novo' },
  { value: 'refin', label: 'Refinanciamento' },
  { value: 'cartao_rmc', label: 'Cartão de Crédito (RMC)' },
  { value: 'cartao_rcc', label: 'Cartão Consignado (RCC)' },
] as const

export type ProdutoCredito = (typeof PRODUTOS_CREDITO)[number]['value']

export function esferaLabel(value: string | null | undefined) {
  return CONVENIO_ESFERAS.find((item) => item.value === value)?.label || '-'
}

export function produtoLabel(value: string | null | undefined) {
  return PRODUTOS_CREDITO.find((item) => item.value === value)?.label || '-'
}
