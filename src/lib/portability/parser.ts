import { ClientePortabilidade, ContratoPortabilidade, ConvenioTipo } from './types'

export function nexPlain(t: string): string {
  return String(t || '')
    .replace(/\u00a0|\u2007|\u202f/g, ' ')
    .replace(/\u200b|\ufeff/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\*\*/g, ' ')
    .replace(/&#x9;|&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ ]*\|[ ]*/g, ' | ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function nexLines(t: string): string[] {
  return nexPlain(t)
    .split(/\n/)
    .map((x) => x.replace(/^\s*\|?\s*|\s*\|?\s*$/g, '').trim())
    .filter((x) => x && x !== '-' && !/^[-:|\s]+$/.test(x) && !/^svg$/i.test(x))
}

function firstMatch(t: string, regs: RegExp[]): string {
  for (const re of regs) {
    const m = String(t || '').match(re)
    if (m && m[1] != null && String(m[1]).trim() !== '') return String(m[1]).trim()
  }
  return ''
}

function numBR(str: string | null | undefined): number | null {
  if (!str) return null
  const cleaned = String(str).replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  let normalized = cleaned
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.')
  }
  const val = parseFloat(normalized)
  return isFinite(val) ? val : null
}

function parseDateBR(str: string | null | undefined): string {
  if (!str) return ''
  const m = str.match(/(\d{2}\/\d{2}\/\d{4})/)
  return m ? m[1] : ''
}

function ageYears(dob: string): number | null {
  if (!dob) return null
  const parts = dob.split('/')
  if (parts.length !== 3) return null
  const day = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const year = parseInt(parts[2], 10)
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null
  const birthDate = new Date(year, month, day)
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const m = today.getMonth() - birthDate.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age >= 0 && age < 120 ? age : null
}

function daysFromToday(dateStr: string): number | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const d = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10) - 1
  const y = parseInt(parts[2], 10)
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null
  const target = new Date(y, m, d)
  const diff = Date.now() - target.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

const ALIASES: Record<string, string> = {
  '237': 'BRADESCO',
  BRADESCO: 'BRADESCO',
  'BANCO BRADESCO S A': 'BRADESCO',
  '033': 'SANTANDER',
  '33': 'SANTANDER',
  SANTANDER: 'SANTANDER',
  OLE: 'OLE',
  '707': 'DAYCOVAL',
  DAYCOVAL: 'DAYCOVAL',
  'BANCO DAYCOVAL S A': 'DAYCOVAL',
  '341': 'ITAU',
  ITAU: 'ITAU',
  'BANCO ITAU': 'ITAU',
  'BANCO ITAU SA': 'ITAU',
  'ITAU 029': 'ITAU029',
  '029': 'ITAU029',
  C6: 'C6',
  'C6 BANK': 'C6',
  'C6 CONSIGNADO': 'C6 CONSIGNADO',
  FACTA: 'FACTA',
  'FACTA FINANCEIRA': 'FACTA',
  QI: 'QI',
  'QI TECH': 'QI',
  'QI SOCIEDADE DE CREDITO': 'QI',
  PINE: 'PINE',
  'BANCO PINE': 'PINE',
  BRB: 'BRB',
  INBURSA: 'INBURSA',
  AGIBANK: 'AGIBANK',
  SAFRA: 'SAFRA',
  ALFA: 'ALFA',
  MASTER: 'MASTER',
  PAN: 'PAN',
  'BANCO PAN': 'PAN',
  PARANA: 'PARANA',
  'PARANA BANCO': 'PARANA',
  'BANCO DO BRASIL': 'BANCO DO BRASIL',
  BB: 'BB',
  BANRISUL: 'BANRISUL',
  CAIXA: 'CAIXA',
  DIGIO: 'DIGIO',
  NUBANK: 'NUBANK',
  NBC: 'NBC',
  ZEMA: 'ZEMA',
  PAULISTA: 'PAULISTA',
  SOCICRED: 'SOCICRED',
  PICPAY: 'PICPAY',
  PAGBANK: 'PAGBANK',
  BRADESCARD: 'BRADESCARD',
  INTER: 'INTER',
  BMG: 'BMG',
  BARIGUI: 'BARIGUI',
  SABEMI: 'SABEMI',
  BNP: 'BNP',
  'BNP PARIBAS': 'BNP',
  PARATI: 'PARATI',
  MERCANTIL: 'MERCANTIL',
}

export function normBank(b: string): string {
  if (!b) return ''
  const u = b.trim().toUpperCase()
  for (const k in ALIASES) {
    if (u === k || u.includes(k)) return ALIASES[k]
  }
  return u
}

export function parseClient(t: string, convenio: ConvenioTipo = 'INSS'): ClientePortabilidade {
  const raw = String(t || '')
  const p = nexPlain(raw)

  const name = firstMatch(raw, [
    /\bNome\b\s*\|?\s*\*{0,2}\s*[:\-]?\s*\*{0,2}([A-ZÀ-Ÿ][A-ZÀ-Ÿ'´`.\- ]{2,100})/i,
    /\bNome\b\s*[:\-]\s*([^\n\r|]{3,100})/i,
    /Nome\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\s]{5,})/i,
  ])

  const cpf = firstMatch(raw, [
    /CPF\s*\/\s*Benef[ií]cio\*{0,2}\s*([\d.\-]{11,14})\s*\/\s*\d+/i,
    /\bCPF\b\s*[:\-]?\s*\*?\s*([\d.\-]{11,14})/i,
    /CPF\s*[:\s]*([\d.\-]{11,14})/i,
  ])

  let nb = ''
  let m = raw.match(/Receptivo\s*-\s*INSS\s*\((\d{9,12})\)/i)
  if (m) nb = m[1]
  if (!nb) {
    m = raw.match(/CPF\s*\/\s*Benef[ií]cio\*{0,2}\s*[\d.\-]{11,14}\s*\/\s*(\d{9,12})/i)
    if (m) nb = m[1]
  }
  if (!nb) {
    m = raw.match(/Benef[ií]cio\s*(\d{9,12})/i) || raw.match(/Matr[ií]cula\s*(\d{5,12})/i)
    if (m) nb = m[1]
  }
  if (!nb) {
    m = raw.match(/NB\s*-\s*UF\s*(\d{9,12})/i)
    if (m) nb = m[1]
  }

  const dob = parseDateBR(
    firstMatch(raw, [
      /Nascimento[^\d]*(\d{2}\/\d{2}\/\d{4})/i,
      /Nascimento\s*(\d{2}\/\d{2}\/\d{4})/i,
      /Data\s+Nasc\.?\s*(\d{2}\/\d{2}\/\d{4})/i,
    ])
  )
  const ageM = raw.match(/Nascimento[\s\S]{0,80}?(\d{1,3})\s*anos/i)
  const age = ageM ? parseInt(ageM[1], 10) : ageYears(dob)

  let species = firstMatch(raw, [
    /\bEsp[eé]cie\b[^\n\r]*\*\*([^*\n\r]+)\*\*/i,
    /\bEsp[eé]cie\b\s*[:\s]*([0-9]{1,3}\s*-\s*[^\n\r|]+)/i,
    /Benef[ií]cio\s+[0-9]{9,12}\s+([0-9]{1,3}\s*-\s*[A-ZÀ-Ÿ][^\n\r]{5,90}?)(?:Representante|Bloqueado|Pensão|Situa[cç][aã]o)/i,
    /^\s*[0-9]{9,12}\s+([0-9]{1,3}\s*-\s*[^\n\r]{5,90})/im,
    /\b[ÓO]rg[ãa]o\b\s*[:\s]*([^\n\r|]+)/i,
  ])
  species = species.replace(/\s+(Representante Legal|Bloqueado para Empréstimos|Pensão Alimentícia|Situa[cç][aã]o).*$/i, '').trim()
  const speciesCodeM = species.match(/^\s*(\d{1,3})\b/)
  const speciesCode = speciesCodeM ? parseInt(speciesCodeM[1], 10) : null

  const marginM =
    raw.match(/MARGEM DISPON[IÍ]VEL(?:\s*\([^)]*\))?[\s\S]{0,70}?R\$\s*([\d.]+,\d{2})/i) ||
    p.match(/Margem Dispon[ií]vel(?:\s*\([^)]*\))?\s*R\$\s*([\d.]+,\d{2})/i) ||
    raw.match(/Margem\s+Empr[eé]stimo\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i)
  const margin = marginM ? numBR(marginM[1]) : null

  const phM = raw.match(/\(?\d{2}\)?\s*\d{4,5}-\d{4}/)
  const phone = phM ? phM[0] : ''

  let representative: boolean | null = null
  const rm = raw.match(/Rep\.?\s*legal[^\n\r]*(SIM|N[ÃA]O|NAO)/i) || p.match(/Representante Legal\s*(Sim|N[ãa]o)/i)
  if (rm) representative = /SIM|Sim/i.test(rm[1])

  let bankCode = ''
  let agency = ''
  let account = ''
  let ddb = ''

  const row = p.match(
    /([0-9]{2,4}\s+[A-ZÀ-Ÿ ]{2,40})\s+(CONTA [A-ZÀ-Ÿ ]+|CART[ÃA]O [A-ZÀ-Ÿ ]+|MAGN[EÉ]TICO|CONTA POUPAN[CÇ]A)\s+([0-9]{1,8})\s+([0-9Xx\-]{3,20})\s+(\d{2}\/\d{2}\/\d{4})/i
  )
  if (row) {
    bankCode = row[1].trim()
    agency = row[3].trim()
    account = row[4].trim()
    ddb = row[5].trim()
  }

  if (!bankCode) bankCode = firstMatch(raw, [/\bBanco\b[^\n\r]*\*\*([^*|\n\r]+)\*\*/i, /Banco\s*[:\s]*([0-9]{2,4}\s*[A-ZÀ-Ÿ ]{2,40})/i])
  if (!agency) agency = firstMatch(raw, [/\bAg\.\s*Banco\b[^\n\r]*\*\*([^*|\n\r]+)\*\*/i, /Ag[eê]ncia\s*[:\s]*([0-9]{1,8})/i])
  if (!account) account = firstMatch(raw, [/\bConta Corrente\b[^\n\r]*\*\*([^*|\n\r]+)\*\*/i, /N[úu]mero da Conta\s*[:\s]*([0-9Xx\-]{3,20})/i])
  if (!ddb) ddb = parseDateBR(firstMatch(raw, [/\bDDB\b[^\n\r]*\*\*(\d{2}\/\d{2}\/\d{4})\*\*/i]))

  const dib = parseDateBR(firstMatch(raw, [/\bDIB\b[^\n\r]*\*\*(\d{2}\/\d{2}\/\d{4})\*\*/i, /DIB\s*[:|\s]*(\d{2}\/\d{2}\/\d{4})/i]))
  const qtdM = raw.match(/Qtd\.\s*Contratos[\s\S]{0,40}?\*\*(\d+)\*\*/i) || raw.match(/Qtd\.\s*Contratos\s*(\d+)/i)

  const dibDays = daysFromToday(dib)

  return {
    name: name || 'Cliente não identificado',
    cpf: cpf ? cpf.replace(/\D/g, '') : '',
    nb: nb ? nb.replace(/\D/g, '') : '',
    dob: dob || '—',
    age,
    species: species || '—',
    speciesCode,
    representative,
    margin,
    phone,
    bankCode,
    agency,
    account,
    dib,
    ddb,
    qtdContracts: qtdM ? parseInt(qtdM[1], 10) : null,
    dibRecent: dibDays != null && dibDays < 90,
    convenio,
  }
}

export function parseLoans(t: string): ContratoPortabilidade[] {
  const s = nexPlain(t)
  const loans: ContratoPortabilidade[] = []

  const blockMatches = [...s.matchAll(/(Empr[eé]stimo\s+Banc[aá]rio\s+[\s\S]*?)(?=(Empr[eé]stimo\s+Banc[aá]rio|$))/gi)]
  const blocks = blockMatches.length ? blockMatches.map((m) => m[1]) : [s]

  let globalIdx = 0

  for (const b of blocks) {
    if (!/Empr[eé]stimo|Contrato|Parcela|Saldo|Banco/i.test(b)) continue

    const contractM = b.match(/Contrato\s*[:\-]?\s*([A-Za-z0-9\-\/.]+)/i)
    const instM = b.match(/Parcela\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i) || b.match(/Valor\s+Parcela\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i)
    const debtM = b.match(/Saldo\s*(?:Devedor|Apx\.?|Aproximado)?\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i)
    const paidM = b.match(/Pagas\s*\/\s*Total\s*[:\-]?\s*(\d+)\s*\/\s*(\d+)/i) || b.match(/Pagas\s*[:\-]?\s*(\d+)/i)
    const totalM = b.match(/Total\s*(?:de\s*Parcelas)?\s*[:\-]?\s*(\d+)/i)
    const remM = b.match(/Restantes\s*[:\-]?\s*(\d+)/i)
    const rateM = b.match(/Taxa\s*[:\-]?\s*([\d.,]+)\s*%/i)
    const bankM =
      b.match(/Banco\s*[:\-]?\s*([0-9]{2,4}\s*-\s*[A-ZÀ-Ÿ ]+|[A-ZÀ-Ÿ ]+)/i) ||
      b.match(/Empr[eé]stimo\s+Banc[aá]rio\s*-\s*([^\n\r]+)/i)

    const startM = b.match(/(?:In[ií]cio|Data\s+In[ií]cio)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i)

    if (instM && debtM) {
      const inst = numBR(instM[1])
      const debt = numBR(debtM[1])
      if (inst && debt && inst > 0 && debt > 0) {
        globalIdx++
        const originRaw = bankM ? bankM[1].trim() : 'Desconhecido'
        const originNormalized = normBank(originRaw)
        const paidVal = paidM ? parseInt(paidM[1], 10) : null
        const totalVal = paidM && paidM[2] ? parseInt(paidM[2], 10) : totalM ? parseInt(totalM[1], 10) : 108

        loans.push({
          id: `loan_${globalIdx}_${Date.now()}`,
          origin: originNormalized || originRaw,
          originLabel: originRaw,
          contract: contractM ? contractM[1] : `${globalIdx}`,
          installment: inst,
          debt,
          paid: paidVal,
          total: totalVal,
          remaining: remM ? parseInt(remM[1], 10) : paidVal && totalVal ? totalVal - paidVal : null,
          rate: rateM ? numBR(rateM[1]) : null,
          startDate: startM ? startM[1] : '',
          code: contractM ? contractM[1] : '',
        })
      }
    }
  }

  return loans
}
