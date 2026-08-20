// Tipos do subsistema de Higienização de CPF via Nova Vida TI (NVTI).

export type NvtiMetodo = 'NVBOOK_CEL_OBG' | 'NvBookCelObWhats'

export type NvtiPriceTier = {
  /** Limite superior da faixa (inclusive). null = faixa final, sem teto. */
  up_to: number | null
  /** Valor unitário em BRL dentro da faixa. */
  unit: number
}

export type NvtiConfigRow = {
  id: string
  usuario: string
  senha: string
  cliente: string
  metodo: NvtiMetodo
  token: string
  token_generated_at: string | null
  monthly_cap_brl: number
  user_monthly_cap_brl: number
  cache_days: number
  price_tiers: NvtiPriceTier[]
  is_active: boolean
  created_at?: string | null
  updated_at?: string | null
}

export type NvtiCadastro = {
  cpf: string
  nome: string
  nome_mae: string
  sexo: string
  nascimento: string
  idade: string
  geracao: string
  classe_economica: string
  demografica: string
  descricao_cbo: string
}

export type NvtiEndereco = {
  tipo: string
  titulo: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  latitude: string
  longitude: string
}

export type NvtiCelular = {
  ddd: string
  numero: string
  procon: boolean
  whatsapp: boolean
}

export type NvtiTelefone = {
  ddd: string
  numero: string
  procon: boolean
}

export type NvtiCredito = {
  possui_veiculo: boolean | null
  bolsa_familia: boolean | null
  obito: boolean | null
  possui_imovel: boolean | null
  fonte_renda: string
  score: string
  faixa_score: string
  persona_credito: string
  score_digital: string
  propensao_pagamento: string
}

export type NvtiEmpresa = {
  possui_fgts: boolean | null
  fgts_valor_presumido: string
  fgts_probabilidade_saque: string
  cnpj: string
  razao: string
}

export type NvtiResultado = {
  cpf: string
  cadastro: NvtiCadastro
  enderecos: NvtiEndereco[]
  celulares: NvtiCelular[]
  telefones: NvtiTelefone[]
  emails: string[]
  credito: NvtiCredito
  empresas: NvtiEmpresa[]
}

export type NvtiOrigin = 'manual' | 'batch' | 'service'

export type NvtiQueryRow = {
  id: string
  cpf: string
  requested_by: string | null
  origin: NvtiOrigin
  batch_id: string | null
  service_name: string | null
  from_cache: boolean
  billed: boolean
  unit_cost_brl: number
  success: boolean
  error: string | null
  response: NvtiResultado | null
  created_at: string
}

export type NvtiBatchStatus = 'pending' | 'processing' | 'paused_limit' | 'done' | 'canceled' | 'error'

export type NvtiBatchRow = {
  id: string
  file_name: string
  status: NvtiBatchStatus
  total: number
  processed: number
  cached: number
  errors: number
  created_by: string
  last_error: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export type HigienizacaoOutcome =
  | { status: 'ok'; queryId: string; fromCache: boolean; unitCost: number; resultado: NvtiResultado }
  | { status: 'invalid'; error: string }
  | { status: 'blocked_global'; error: string }
  | { status: 'blocked_user'; error: string }
  | { status: 'not_configured'; error: string }
  | { status: 'error'; error: string; queryId?: string }
