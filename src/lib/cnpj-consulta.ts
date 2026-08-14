// Normalização rica do payload da API pública CNPJ.ws (https://publica.cnpj.ws/cnpj/{cnpj}).
// Extrai TODOS os campos úteis do retorno para pré-preencher cadastros no Workspace.

export type CnaeInfo = {
  code: string
  desc: string
}

export type InscricaoEstadualInfo = {
  numero: string
  uf: string
  ativo: boolean
}

export type SocioReceitaInfo = {
  nome: string
  cpf_cnpj: string
  tipo: string
  qualificacao: string
  data_entrada: string
  faixa_etaria: string
}

export type CnpjConsultaCompleta = {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  data_abertura: string
  natureza_juridica: string
  natureza_juridica_codigo: string
  porte: string
  capital_social: string
  situacao_cadastral: string
  situacao_cadastral_data: string
  situacao_cadastral_motivo: string
  tipo_estabelecimento: string
  cnae_principal_codigo: string
  cnae_principal_descricao: string
  cnaes_secundarios: CnaeInfo[]
  simples_optante: boolean
  simples_data_opcao: string
  simples_data_exclusao: string
  is_mei: boolean
  mei_data_opcao: string
  mei_data_exclusao: string
  inscricoes_estaduais: InscricaoEstadualInfo[]
  email_rfb: string
  telefone_rfb_1: string
  telefone_rfb_2: string
  socios: SocioReceitaInfo[]
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  consultado_em: string
}

function text(value: any, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function digits(value: any, max = 20) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max)
}

function simNao(value: any) {
  return String(value ?? '').trim().toLowerCase() === 'sim'
}

function formatPhone(ddd: any, numero: any) {
  const d = digits(ddd, 2)
  const n = digits(numero, 9)
  if (!n) return ''
  return d ? `${d}${n}` : n
}

// Deduplica sócios (a CNPJ.ws pode repetir a mesma pessoa por ano-base),
// preferindo a entrada com CPF sem máscara e faixa etária preenchida.
function dedupeSocios(rows: SocioReceitaInfo[]): SocioReceitaInfo[] {
  const byName = new Map<string, SocioReceitaInfo>()
  for (const row of rows) {
    const key = row.nome.toLowerCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, row)
      continue
    }
    const rowUnmasked = row.cpf_cnpj && !row.cpf_cnpj.includes('*')
    const existingUnmasked = existing.cpf_cnpj && !existing.cpf_cnpj.includes('*')
    if ((rowUnmasked && !existingUnmasked) || (!existing.faixa_etaria && row.faixa_etaria)) {
      byName.set(key, {
        ...existing,
        ...Object.fromEntries(Object.entries(row).filter(([, v]) => Boolean(v))),
      } as SocioReceitaInfo)
    }
  }
  return Array.from(byName.values())
}

export function normalizeCnpjWsCompleto(data: any): CnpjConsultaCompleta {
  const est = data?.estabelecimento || {}
  const simples = data?.simples || {}

  const cnaesSecundarios: CnaeInfo[] = Array.isArray(est?.atividades_secundarias)
    ? est.atividades_secundarias
        .map((item: any) => ({
          code: text(item?.subclasse ?? item?.id ?? '', 10),
          desc: text(item?.descricao ?? '', 300),
        }))
        .filter((item: CnaeInfo) => item.code || item.desc)
    : []

  const inscricoes: InscricaoEstadualInfo[] = Array.isArray(est?.inscricoes_estaduais)
    ? est.inscricoes_estaduais
        .map((item: any) => ({
          numero: text(item?.inscricao_estadual ?? '', 30),
          uf: text(item?.estado?.sigla ?? '', 2).toUpperCase(),
          ativo: item?.ativo !== false,
        }))
        .filter((item: InscricaoEstadualInfo) => item.numero)
    : []

  const socios: SocioReceitaInfo[] = Array.isArray(data?.socios)
    ? dedupeSocios(
        data.socios
          .map((item: any) => ({
            nome: text(item?.nome ?? '', 200),
            cpf_cnpj: text(item?.cpf_cnpj_socio ?? '', 20),
            tipo: text(item?.tipo ?? '', 40),
            qualificacao: text(item?.qualificacao_socio?.descricao ?? '', 120),
            data_entrada: text(item?.data_entrada ?? '', 10),
            faixa_etaria: text(item?.faixa_etaria ?? '', 40),
          }))
          .filter((item: SocioReceitaInfo) => item.nome),
      )
    : []

  return {
    cnpj: digits(est?.cnpj ?? data?.cnpj_raiz ?? '', 14),
    razao_social: text(data?.razao_social ?? '', 200),
    nome_fantasia: text(est?.nome_fantasia ?? '', 200),
    data_abertura: text(est?.data_inicio_atividade ?? '', 10),
    natureza_juridica: text(data?.natureza_juridica?.descricao ?? '', 200),
    natureza_juridica_codigo: text(data?.natureza_juridica?.id ?? '', 10),
    porte: text(data?.porte?.descricao ?? '', 80),
    capital_social: text(data?.capital_social ?? '', 30),
    situacao_cadastral: text(est?.situacao_cadastral ?? '', 40),
    situacao_cadastral_data: text(est?.data_situacao_cadastral ?? '', 10),
    situacao_cadastral_motivo: text(est?.motivo_situacao_cadastral ?? '', 200),
    tipo_estabelecimento: text(est?.tipo ?? '', 20),
    cnae_principal_codigo: text(est?.atividade_principal?.subclasse ?? est?.atividade_principal?.id ?? '', 10),
    cnae_principal_descricao: text(est?.atividade_principal?.descricao ?? '', 300),
    cnaes_secundarios: cnaesSecundarios,
    simples_optante: simNao(simples?.simples),
    simples_data_opcao: text(simples?.data_opcao_simples ?? '', 10),
    simples_data_exclusao: text(simples?.data_exclusao_simples ?? '', 10),
    is_mei: simNao(simples?.mei),
    mei_data_opcao: text(simples?.data_opcao_mei ?? '', 10),
    mei_data_exclusao: text(simples?.data_exclusao_mei ?? '', 10),
    inscricoes_estaduais: inscricoes,
    email_rfb: text(est?.email ?? '', 120).toLowerCase(),
    telefone_rfb_1: formatPhone(est?.ddd1, est?.telefone1),
    telefone_rfb_2: formatPhone(est?.ddd2, est?.telefone2),
    socios,
    cep: digits(est?.cep ?? '', 8),
    logradouro: text([est?.tipo_logradouro, est?.logradouro].filter(Boolean).join(' '), 200),
    numero: text(est?.numero ?? '', 20),
    complemento: text(est?.complemento ?? '', 120),
    bairro: text(est?.bairro ?? '', 120),
    cidade: text(est?.cidade?.nome ?? '', 120),
    uf: text(est?.estado?.sigla ?? '', 2).toUpperCase(),
    consultado_em: new Date().toISOString(),
  }
}

export function formatCapitalSocialBr(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const parsed = Number(raw.replace(',', '.'))
  if (Number.isNaN(parsed)) return raw
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
