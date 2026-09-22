import {
  ClientePortabilidade,
  ConfiguracoesGeraisPortabilidade,
  ContratoPortabilidade,
  RegraBancoPortabilidade,
  ResultadoBanco,
  ResultadoEvaluacaoBundle,
} from './types'

export const DEFAULT_PORT_COEFF = 0.02251

export const DEFAULT_GENERAL_RULES: ConfiguracoesGeraisPortabilidade = {
  blockLoas: true,
  loasSpecies: '87,88',
  blockRepresentative: true,
  loasReason: 'Não porta LOAS',
  representativeReason: 'Não faz representante',
  defaultPortCoeff: DEFAULT_PORT_COEFF,
  newCoeffs: { FACTA: 0.023896, BMG: 0.02245 },
  newLoasCoeffs: { CAIXA: 0.0403, BB: 0.0239 },
}

export const NETWORK_BANKS = ['BRADESCO', 'SANTANDER', 'ITAU', 'BANCO DO BRASIL', 'BB', 'CAIXA', 'BANRISUL']
export const PRIORITY_BANKS = ['FINANTO', 'QUALI', 'BMG', 'DIGIO', 'BRB360', 'HAPPY', 'FACTA', 'PARANA', 'C6', 'QUERO', 'DIGA']

export const DEFAULT_BANK_RULES: RegraBancoPortabilidade[] = [
  {
    id: 'DAYCOVAL',
    name: 'Daycoval',
    enabled: true,
    portCoeff: null,
    entry: 1.34,
    refiMin: 1.5,
    refiMax: 1.85,
    ageMin: 21,
    ageMaxYears: 71,
    ageMaxMonths: 11,
    endAgeYears: 80,
    endAgeMonths: 11,
    minInstallment: 20,
    minDebt: null,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'maxFixedOrPercentNew',
    minReleasePercent: 2,
    blocked: ['C6', 'SAFRA', 'ALFA', 'MASTER'],
    paid: { FACTA: 24, AGIBANK: 15, INBURSA: 13, PAN: 12, ITAU: 12, BRB: 6, PINE: 6, QI: 6 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    daycovalSimulator: {
      enabled: true,
      weightedRate: true,
      minRelease: 100,
      minReleasePercentNew: 2,
      tables: [
        { n: 1, rate: 1.85, minFinanced: 20 },
        { n: 2, rate: 1.8, minFinanced: 20 },
        { n: 3, rate: 1.77, minFinanced: 20 },
        { n: 4, rate: 1.74, minFinanced: 20 },
        { n: 5, rate: 1.71, minFinanced: 20 },
        { n: 6, rate: 1.68, minFinanced: 20 },
        { n: 7, rate: 1.66, minFinanced: 20 },
        { n: 8, rate: 1.62, minFinanced: 10000 },
        { n: 9, rate: 1.6, minFinanced: 15000 },
        { n: 10, rate: 1.58, minFinanced: 20000 },
        { n: 11, rate: 1.56, minFinanced: 50000 },
      ],
    },
    notes: 'Unifica até 3 parcelas. Não reduz parcela. Troco mínimo = maior entre R$ 100 e 2% do contrato novo.',
  },
  {
    id: 'C6',
    name: 'C6 Bank',
    enabled: true,
    portCoeff: null,
    entry: 1.35,
    refiMin: 1.55,
    refiMax: null,
    ageMin: 21,
    ageMaxYears: null,
    ageMaxMonths: null,
    endAgeYears: 73,
    endAgeMonths: 0,
    minInstallment: null,
    minDebt: null,
    minFinanced: 2000,
    minRelease: 50,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['DAYCOVAL', 'AGIBANK', 'INBURSA', 'BRB', 'SAFRA'],
    paid: { PAN: 37, PARANA: 25, FACTA: 13 },
    defaultPaid: null,
    networkPaid: null,
    special: ['QI', 'PINE'],
    under12: [],
    term: 108,
    notes: 'QI e Pine em tabela especial. Agrega margem: sim.',
  },
  {
    id: 'FACTA',
    name: 'Facta',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.5,
    refiMax: 1.8,
    ageMin: 21,
    ageMaxYears: 71,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 50,
    minDebt: 2000,
    minFinanced: null,
    minRelease: 50,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['NUBANK', 'NBC', 'INBURSA', 'ZEMA', 'PAULISTA', 'SOCICRED', 'PINE'],
    paid: { PAN: 30, DAYCOVAL: 24, AGIBANK: 15, PARANA: 15, BMG: 12, SANTANDER: 12 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Agrega margem: sim.',
  },
  {
    id: 'HAPPY',
    name: 'Happy',
    enabled: true,
    portCoeff: null,
    entry: 0.6,
    refiMin: 1.77,
    refiMax: 1.85,
    ageMin: 21,
    ageMaxYears: 69,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 3000,
    minFinanced: null,
    minRelease: 350,
    minReleaseMode: 'maxFixedOrPercentDebt',
    minReleasePercent: 5,
    blocked: ['PINE', 'INBURSA', 'QI', 'BRB'],
    paid: { C6: 18, FACTA: 12, PAN: 12 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Redução de parcela somente na portabilidade pura.',
  },
  {
    id: 'BRB',
    name: 'BRB iConta',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.79,
    refiMax: 1.85,
    ageMin: 21,
    ageMaxYears: 72,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 3000,
    minFinanced: null,
    minRelease: null,
    minReleaseMode: 'installment',
    minReleasePercent: null,
    blocked: ['C6', 'SANTINVEST', 'PICPAY', 'AGIBANK', 'DIGIO', 'BRADESCO', 'BRADESCARD', 'INBURSA', 'PAGBANK'],
    paid: { PAN: 12 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Reduz parcela: sim.',
  },
  {
    id: 'BRB360',
    name: 'BRB Consig 360',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.79,
    refiMax: 1.85,
    ageMin: 18,
    ageMaxYears: 72,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 3000,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['BRB', 'PICPAY', 'AGIBANK', 'C6', 'C6 CONSIGNADO'],
    paid: { INBURSA: 11 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: ['QI', 'INTER', 'DAYCOVAL'],
    term: 108,
    notes: 'QI, Inter e Daycoval podem portar com menos de 12 pagas.',
  },
  {
    id: 'ICRED',
    name: 'iCred',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.65,
    refiMax: null,
    ageMin: 21,
    ageMaxYears: 69,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: null,
    minFinanced: 3000,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['INBURSA', 'PINE', 'QI'],
    paid: { PAN: 25, ITAU029: 25 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Itaú 029 porta com 25 pagas. Não reduz parcela.',
  },
  {
    id: 'DIGA',
    name: 'Diga',
    enabled: true,
    portCoeff: null,
    entry: null,
    refiMin: 1.85,
    refiMax: null,
    ageMin: 22,
    ageMaxYears: 68,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 3000,
    minFinanced: null,
    minRelease: 500,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['FACTA', 'QI', 'BRB', 'PINE'],
    paid: { C6: 12, INBURSA: 11 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Safra, Alfa e BNP portam normalmente.',
  },
  {
    id: 'DIGIO',
    name: 'Digio',
    enabled: true,
    portCoeff: null,
    entry: 1.42,
    refiMin: 1.6,
    refiMax: null,
    ageMin: 18,
    ageMaxYears: 65,
    ageMaxMonths: 11,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 70,
    minDebt: null,
    minFinanced: null,
    minRelease: 250,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['BRADESCO', 'BANRISUL', 'BANCO DO BRASIL', 'BB', 'CAIXA'],
    paid: {},
    defaultPaid: 12,
    networkPaid: 0,
    special: [],
    under12: [],
    term: 108,
    notes: 'Sem saldo mínimo. Bancos de rede com 0 pagas. Não reduz parcela.',
  },
  {
    id: 'PARANA',
    name: 'Paraná Banco',
    enabled: true,
    portCoeff: null,
    entry: 1.1,
    refiMin: 1.7,
    refiMax: null,
    ageMin: 18,
    ageMaxYears: 68,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 200,
    minDebt: null,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['BARIGUI', 'FACTA'],
    paid: { PAN: 25, INBURSA: 13, C6: 13, AGIBANK: 13 },
    defaultPaid: 12,
    networkPaid: 0,
    special: [],
    under12: [],
    term: 108,
    notes: '',
  },
  {
    id: 'QUALI',
    name: 'Quali Banking',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.66,
    refiMax: null,
    ageMin: 18,
    ageMaxYears: 71,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 2000,
    minFinanced: null,
    minRelease: null,
    minReleaseMode: 'percentDebtOnly',
    minReleasePercent: 5,
    blocked: ['INBURSA', 'C6', 'PINE', 'QI', 'ALFA', 'ZEMA', 'BRB'],
    paid: {},
    defaultPaid: 1,
    networkPaid: 6,
    special: [],
    under12: [],
    term: 108,
    notes: 'Troco mínimo: 5% do saldo devedor.',
  },
  {
    id: 'BEM',
    name: 'Bem Promotora',
    enabled: true,
    portCoeff: null,
    entry: 1.5,
    refiMin: 1.65,
    refiMax: null,
    ageMin: 18,
    ageMaxYears: 65,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 5000,
    minFinanced: null,
    minRelease: 200,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['SABEMI', 'BRB'],
    paid: { SAFRA: 12, PAN: 25 },
    defaultPaid: 12,
    networkPaid: 1,
    special: [],
    under12: [],
    term: 108,
    notes: 'INSS: troco mínimo de R$ 200.',
  },
  {
    id: 'QUERO',
    name: 'Quero + Crédito',
    enabled: true,
    portCoeff: null,
    entry: 1.34,
    refiMin: 1.56,
    refiMax: null,
    ageMin: 21,
    ageMaxYears: 69,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 20,
    minDebt: null,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['C6', 'SAFRA', 'DAYCOVAL', 'ALFA'],
    paid: { FACTA: 12, AGIBANK: 15, INBURSA: 15, PAN: 12, BMG: 12 },
    defaultPaid: 12,
    networkPaid: 6,
    special: [],
    under12: [],
    term: 108,
    queroSimulator: {
      enabled: true,
      weightedRate: true,
      minRelease: 100,
      tables: [
        { n: 1, rate: 1.85, minFinanced: 20 },
        { n: 2, rate: 1.8, minFinanced: 20 },
        { n: 3, rate: 1.77, minFinanced: 20 },
        { n: 4, rate: 1.74, minFinanced: 20 },
        { n: 5, rate: 1.71, minFinanced: 20 },
        { n: 6, rate: 1.68, minFinanced: 20 },
        { n: 7, rate: 1.66, minFinanced: 20 },
        { n: 8, rate: 1.62, minFinanced: 10000 },
        { n: 9, rate: 1.6, minFinanced: 15000 },
        { n: 10, rate: 1.58, minFinanced: 30000 },
        { n: 11, rate: 1.56, minFinanced: 50000 },
      ],
    },
    notes: 'Simulador Quero Mais: tabelas INSS 108x de 1,85% a 1,56%.',
  },
  {
    id: 'PLAY',
    name: 'Play Consig',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: 1.79,
    refiMax: null,
    ageMin: 21,
    ageMaxYears: 71,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 25,
    minDebt: 1000,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['INBURSA', 'PARANA', 'PINE', 'QI', 'C6', 'NBC'],
    paid: { AGIBANK: 12, FACTA: 12, PAN: 12 },
    defaultPaid: 1,
    networkPaid: 1,
    special: [],
    under12: [],
    term: 108,
    notes: '',
  },
  {
    id: 'BMG',
    name: 'BMG',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: null,
    refiMax: null,
    ageMin: 21,
    ageMaxYears: 70,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 4000,
    minFinanced: null,
    minRelease: 500,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['AGIBANK', 'OLE'],
    paid: { DAYCOVAL: 15, PAN: 25, SAFRA: 12 },
    defaultPaid: 1,
    networkPaid: 0,
    special: [],
    under12: [],
    term: 108,
    notes: 'Contrato novo usa coeficiente próprio na área de margem.',
  },
  {
    id: 'BB',
    name: 'Banco do Brasil',
    enabled: true,
    portCoeff: null,
    entry: 1.0,
    refiMin: null,
    refiMax: null,
    ageMin: null,
    ageMaxYears: null,
    ageMaxMonths: null,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 1000,
    minFinanced: null,
    minRelease: 0,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: [],
    paid: {},
    defaultPaid: 12,
    networkPaid: 1,
    special: [],
    under12: [],
    term: 108,
    notes: '',
  },
  {
    id: 'SAFRA',
    name: 'Safra',
    enabled: true,
    portCoeff: null,
    entry: null,
    refiMin: null,
    refiMax: null,
    ageMin: 26,
    ageMaxYears: 67,
    ageMaxMonths: 0,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: null,
    minDebt: 800,
    minFinanced: null,
    minRelease: 1000,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['DAYCOVAL', 'INBURSA', 'ALFA'],
    paid: { C6: 18, PAN: 15, BANRISUL: 12, FACTA: 24 },
    defaultPaid: 12,
    networkPaid: 0,
    special: [],
    under12: [],
    term: 108,
    notes: '',
  },
  {
    id: 'PAN',
    name: 'PAN',
    enabled: true,
    portCoeff: null,
    entry: null,
    refiMin: null,
    refiMax: null,
    ageMin: null,
    ageMaxYears: null,
    ageMaxMonths: null,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 20,
    minDebt: 6000,
    minFinanced: null,
    minRelease: 50,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['BRB', 'AGIBANK'],
    paid: { C6: 36, BANRISUL: 30, DAYCOVAL: 12, INBURSA: 12, PINE: 12, QI: 12, ZEMA: 12, ITAU: 15, SAFRA: 15, FACTA: 16 },
    defaultPaid: 12,
    networkPaid: 0,
    special: [],
    under12: [],
    term: 108,
    notes: 'Agregação de margem para SIAPE no refin da portabilidade.',
  },
  {
    id: 'FINANTO',
    name: 'Finanto',
    enabled: true,
    portCoeff: null,
    entry: 1.1,
    refiMin: 1.6,
    refiMax: 1.85,
    ageMin: 22,
    ageMaxYears: 68,
    ageMaxMonths: 10,
    endAgeYears: null,
    endAgeMonths: null,
    minInstallment: 50,
    minDebt: null,
    minFinanced: null,
    minRelease: 100,
    minReleaseMode: 'fixed',
    minReleasePercent: null,
    blocked: ['INBURSA', 'QI', 'SAFRA', 'BNP', 'PICPAY', 'C6', 'FACTA', 'ALFA', 'PINE'],
    paid: { SANTANDER: 12, PARATI: 12, MERCANTIL: 12, DAYCOVAL: 12, PARANA: 12, AGIBANK: 12, BANRISUL: 1 },
    defaultPaid: null,
    networkPaid: null,
    special: [],
    under12: [],
    term: 108,
    notes: 'Novo D+90.',
  },
]

export function pvFromPayment(pmt: number, rateDecimal: number, nper: number): number | null {
  if (!pmt || pmt <= 0 || !rateDecimal || rateDecimal <= 0 || !nper || nper <= 0) return null
  const pv = (pmt * (1 - Math.pow(1 + rateDecimal, -nper))) / rateDecimal
  return isFinite(pv) ? pv : null
}

export function isNetworkBank(b: string): boolean {
  return NETWORK_BANKS.includes(b.toUpperCase())
}

export function generalBlockReason(c: ClientePortabilidade, config: ConfiguracoesGeraisPortabilidade = DEFAULT_GENERAL_RULES): string | null {
  if (config.blockRepresentative && c.representative === true) {
    return config.representativeReason || 'Não faz representante'
  }
  if (config.blockLoas && c.speciesCode != null) {
    const codes = String(config.loasSpecies || '87,88')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => !isNaN(x))
    if (codes.includes(c.speciesCode)) {
      return config.loasReason || 'Não porta LOAS'
    }
  }
  return null
}

export function paidReq(r: RegraBancoPortabilidade, originBank: string): number {
  if (r.paid && r.paid[originBank] != null) return +r.paid[originBank]
  if (r.under12 && r.under12.includes(originBank)) return 0
  if (isNetworkBank(originBank) && r.networkPaid != null) return +r.networkPaid
  if (r.defaultPaid != null) return +r.defaultPaid
  return 0
}

export function minRelease(r: RegraBancoPortabilidade, c: { debt: number | null; newPrincipal: number | null; installment: number }): number | null {
  if (r.minReleaseMode === 'maxFixedOrPercentDebt') {
    return Math.max(r.minRelease || 0, ((c.debt || 0) * (r.minReleasePercent || 0)) / 100)
  }
  if (r.minReleaseMode === 'maxFixedOrPercentNew') {
    return Math.max(r.minRelease || 0, ((c.newPrincipal || 0) * (r.minReleasePercent || 0)) / 100)
  }
  if (r.minReleaseMode === 'percentDebtOnly') {
    return ((c.debt || 0) * (r.minReleasePercent || 0)) / 100
  }
  if (r.minReleaseMode === 'installment') {
    return c.installment || 0
  }
  return r.minRelease
}

export function evalRule(
  r: RegraBancoPortabilidade,
  l: ContratoPortabilidade,
  c: ClientePortabilidade,
  generalConfig: ConfiguracoesGeraisPortabilidade = DEFAULT_GENERAL_RULES
): ResultadoBanco {
  const fail: Array<{ code: string; text: string }> = []
  const generalReason = generalBlockReason(c, generalConfig)
  const origin = l.origin

  if (generalReason) fail.push({ code: 'geral', text: generalReason })
  if ((r.blocked || []).includes(origin)) fail.push({ code: 'banco', text: 'Banco não porta' })

  const req = paidReq(r, origin)
  if (l.paid != null && l.paid < req) fail.push({ code: 'pagas', text: `Exige ${req} pagas` })
  if (r.minInstallment != null && l.installment < r.minInstallment) fail.push({ code: 'parcela', text: 'Parcela mínima' })
  if (r.minDebt != null && l.debt != null && l.debt < r.minDebt) fail.push({ code: 'saldo', text: 'Saldo mínimo' })

  if (c.age != null && r.ageMin != null && c.age < r.ageMin) fail.push({ code: 'idade', text: 'Idade mínima' })
  if (c.age != null && r.ageMaxYears != null && c.age > r.ageMaxYears) fail.push({ code: 'idade', text: 'Idade máxima' })
  if (r.entry != null && l.rate != null && l.rate * 100 < r.entry) fail.push({ code: 'taxa', text: 'Taxa mínima de entrada' })

  const cf = r.portCoeff != null && r.portCoeff > 0 ? r.portCoeff : generalConfig.defaultPortCoeff
  const newPrincipal = cf ? l.installment / cf : null
  const release = newPrincipal != null && l.debt != null ? newPrincipal - l.debt : null

  if (r.minFinanced != null && newPrincipal != null && newPrincipal < r.minFinanced) {
    fail.push({ code: 'financiado', text: 'Valor financiado mínimo' })
  }

  const mr = minRelease(r, { debt: l.debt, newPrincipal, installment: l.installment })
  if (mr != null && release != null && release < mr) fail.push({ code: 'troco', text: 'Valor liberado insuficiente' })
  if (release != null && release <= 0) fail.push({ code: 'troco', text: 'Sem valor liberado' })

  const special = !generalReason && (r.special || []).includes(origin)
  const status = fail.length ? 'no' : special ? 'pending' : 'ok'
  const reason = fail[0]?.text || (special ? 'Tabela especial' : 'Aprovado')

  return { status, reason, release }
}

export function evalAll(
  loans: ContratoPortabilidade[],
  c: ClientePortabilidade,
  rules: RegraBancoPortabilidade[] = DEFAULT_BANK_RULES,
  generalConfig: ConfiguracoesGeraisPortabilidade = DEFAULT_GENERAL_RULES
): ResultadoEvaluacaoBundle[] {
  const activeRules = rules.filter((r) => r.enabled)

  return loans.map((loan) => {
    const results = activeRules.map((r) => ({
      bank: r,
      evaluation: evalRule(r, loan, c, generalConfig),
    }))

    results.sort((a, b) => {
      const order = { ok: 0, pending: 1, no: 2 }
      const sa = order[a.evaluation.status]
      const sb = order[b.evaluation.status]
      if (sa !== sb) return sa - sb

      const pa = PRIORITY_BANKS.indexOf(a.bank.id)
      const pb = PRIORITY_BANKS.indexOf(b.bank.id)
      const idxA = pa >= 0 ? pa : 100
      const idxB = pb >= 0 ? pb : 100
      if (idxA !== idxB) return idxA - idxB

      return a.bank.name.localeCompare(b.bank.name, 'pt-BR')
    })

    return { loan, results }
  })
}
