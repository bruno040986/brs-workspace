/**
 * Gravação do resultado da higienização NVTI no WeSales — roda em TODA
 * consulta bem-sucedida (manual, lote ou a futura chamada paga do Portal
 * Parceiro; todas passam por `higienizarCpf`), independente de quem pediu.
 *
 * Decisão do Bruno (28-29/08/2026): CLT e AlvoConsig são duas Private
 * Integrations (tokens) diferentes, mas apontam pra MESMA location/base de
 * contatos no WeSales — de propósito. Por isso este módulo usa só o client
 * que o Workspace já tem (`@/lib/wesales/client`), sem credencial nova.
 *
 * Organização por PASTA de contato (decisão 29/08/2026, não mais uma pasta
 * "NVTI" própria — os dados se distribuem pelo TIPO de informação):
 *   - Contact: telefones/e-mail (enriquece os nativos; Telefone 2/3 e as
 *     flags de WhatsApp são campos próprios, sem equivalente nativo).
 *   - Informações Gerais: endereço (enriquece os campos nativos — cidade,
 *     UF, CEP, logradouro já existem prontos no WeSales).
 *   - Informações Adicionais: dados de perfil (sexo, classe econômica,
 *     ocupação, nome da mãe, óbito, fonte de renda, veículo/imóvel/bolsa
 *     família).
 *   - Dados de Crédito: score, faixa, persona, propensão, score digital,
 *     FGTS, data da última consulta.
 *
 * Regras:
 *   - CPF já é contato → ENRIQUECE. Campos nativos (telefone/e-mail/
 *     endereço) só são preenchidos se estiverem VAZIOS — nunca sobrescreve
 *     dado que o time já tem. Campos nvti_* (customFields) são sempre
 *     atualizados — são espaço só da NVTI, ninguém mais escreve ali.
 *   - CPF não é contato ainda → CRIA um novo.
 *   - Best-effort: erro aqui nunca derruba a consulta NVTI em si.
 */

import {
  addContactTags,
  createContact,
  ensureCustomField,
  findContactByCpf,
  getContact,
  normalizeCpfDigits,
  updateContact,
  type ContactPayload,
  type WesalesContact,
} from '@/lib/wesales/client'
import type { NvtiCelular, NvtiResultado } from './types'

/**
 * Campos personalizados que só a NVTI alimenta (fieldKey sem prefixo — o
 * nome visível no WeSales é que carrega a pasta/categoria, ex. "Score" em
 * Dados de Crédito, "Sexo" em Informações Adicionais).
 */
export const NVTI_FIELD_KEYS = {
  // Contact — telefones sem equivalente nativo (Telefone 1 = campo nativo `phone`).
  telefone2: 'nvti_telefone_2',
  whatsapp1: 'nvti_whatsapp_1',
  whatsapp2: 'nvti_whatsapp_2',
  telefone3: 'nvti_telefone_3',
  whatsapp3: 'nvti_whatsapp_3',
  // Informações Adicionais
  nomeMae: 'nvti_nome_mae',
  sexo: 'nvti_sexo',
  classeEconomica: 'nvti_classe_economica',
  ocupacao: 'nvti_ocupacao',
  obito: 'nvti_obito',
  fonteRenda: 'nvti_fonte_renda',
  possuiVeiculo: 'nvti_possui_veiculo',
  possuiImovel: 'nvti_possui_imovel',
  bolsaFamilia: 'nvti_bolsa_familia',
  // Dados de Crédito
  score: 'nvti_score',
  faixaScore: 'nvti_faixa_score',
  personaCredito: 'nvti_persona_credito',
  propensaoPagamento: 'nvti_propensao_pagamento',
  scoreDigital: 'nvti_score_digital',
  possuiFgts: 'nvti_possui_fgts',
  fgtsValorPresumido: 'nvti_fgts_valor_presumido',
  dataConsulta: 'nvti_data_consulta',
} as const

/** Rótulo visível de cada campo — já no nome final da pasta correspondente. */
const NVTI_FIELD_LABELS: Record<keyof typeof NVTI_FIELD_KEYS, string> = {
  telefone2: 'Telefone 2',
  whatsapp1: 'Flag WhatsApp 1',
  whatsapp2: 'Flag WhatsApp 2',
  telefone3: 'Telefone 3',
  whatsapp3: 'Flag WhatsApp 3',
  nomeMae: 'Nome da Mãe',
  sexo: 'Sexo',
  classeEconomica: 'Classe Econômica',
  ocupacao: 'Ocupação',
  obito: 'Óbito',
  fonteRenda: 'Fonte de Renda',
  possuiVeiculo: 'Possui Veículo',
  possuiImovel: 'Possui Imóvel',
  bolsaFamilia: 'Bolsa Família',
  score: 'Score',
  faixaScore: 'Faixa de Score',
  personaCredito: 'Persona de Crédito',
  propensaoPagamento: 'Propensão de Pagamento',
  scoreDigital: 'Score Digital',
  possuiFgts: 'Possui FGTS',
  fgtsValorPresumido: 'FGTS Valor Presumido',
  dataConsulta: 'Data da Última Consulta (NVTI)',
}

const TAG_HIGIENIZADO = 'nvti-higienizado'

/** Mesma chave/rótulo que o worker do brs-alvoconsig usa (`garantirContato`) —
 * é ESTE campo que `findContactByCpf` consulta. Sem ele no contato criado, a
 * próxima higienização do mesmo CPF não o acha e duplica. */
const CPF_FIELD_KEY = 'cpf'

let camposGarantidos: Promise<Record<string, string>> | null = null

/** Garante (cria se faltar) todos os custom fields nvti_* + cpf — 1x por container quente. */
async function garantirCamposNvti(): Promise<Record<string, string>> {
  if (!camposGarantidos) {
    camposGarantidos = (async () => {
      const entries = await Promise.all([
        ensureCustomField(CPF_FIELD_KEY, 'CPF').then((def) => [CPF_FIELD_KEY, def.id] as const),
        ...(Object.entries(NVTI_FIELD_KEYS) as Array<[keyof typeof NVTI_FIELD_KEYS, string]>).map(
          async ([campo, key]) => {
            const def = await ensureCustomField(key, NVTI_FIELD_LABELS[campo])
            return [key, def.id] as const
          },
        ),
      ])
      return Object.fromEntries(entries)
    })().catch((error) => {
      // Não deixa uma falha transitória (rede/token) ficar cacheada pra sempre.
      camposGarantidos = null
      throw error
    })
  }
  return camposGarantidos
}

function boolLabel(value: boolean | null): string {
  if (value === true) return 'Sim'
  if (value === false) return 'Não'
  return ''
}

function celularTexto(cel: NvtiCelular | undefined): string {
  return cel ? `${cel.ddd}${cel.numero}` : ''
}

function celularE164(cel: NvtiCelular | undefined): string {
  return cel ? `+55${cel.ddd}${cel.numero}` : ''
}

/** true se o contato não tem valor nenhum nesse campo nativo ainda. */
function vazio(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

/** NVTI manda a data como DD/MM/AAAA (às vezes já ISO); o WeSales quer AAAA-MM-DD. */
function nascimentoIso(valor: string | null | undefined): string | null {
  const texto = String(valor || '').trim()
  if (!texto) return null
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

/**
 * `dataConsulta`: data REAL em que a NVTI verificou o CPF — não "agora".
 * Numa consulta vinda do cache (reaproveitamento de até 30 dias), "agora" é
 * só o momento em que alguém pediu de novo; gravar isso quebraria o próprio
 * motivo de existir do campo. O chamador (service.ts) passa a data real.
 */
export async function syncNvtiResultadoParaWesales(
  resultado: NvtiResultado,
  dataConsulta: Date,
): Promise<void> {
  const cpf = normalizeCpfDigits(resultado.cpf)
  if (!cpf) return

  const fieldIds = await garantirCamposNvti()
  const endereco = resultado.enderecos[0]
  const empresa = resultado.empresas[0]
  const celulares = resultado.celulares
  const primeiroCelularComWhats = celulares.findIndex((c) => c.whatsapp)
  // Prioriza o celular com WhatsApp confirmado na posição 1; os outros dois
  // seguem a ordem original da NVTI.
  const ordenados = primeiroCelularComWhats > 0
    ? [celulares[primeiroCelularComWhats], ...celulares.filter((_, i) => i !== primeiroCelularComWhats)]
    : celulares

  const customFields: Array<{ id: string; fieldValue: string }> = []
  const push = (key: keyof typeof NVTI_FIELD_KEYS, value: string) => {
    if (value) customFields.push({ id: fieldIds[NVTI_FIELD_KEYS[key]], fieldValue: value })
  }
  push('telefone2', celularTexto(ordenados[1]))
  push('whatsapp1', ordenados[0] ? boolLabel(ordenados[0].whatsapp) : '')
  push('whatsapp2', ordenados[1] ? boolLabel(ordenados[1].whatsapp) : '')
  push('telefone3', celularTexto(ordenados[2]))
  push('whatsapp3', ordenados[2] ? boolLabel(ordenados[2].whatsapp) : '')
  push('nomeMae', resultado.cadastro.nome_mae)
  push('sexo', resultado.cadastro.sexo)
  push('classeEconomica', resultado.cadastro.classe_economica)
  push('ocupacao', resultado.cadastro.descricao_cbo)
  push('obito', boolLabel(resultado.credito.obito))
  push('fonteRenda', resultado.credito.fonte_renda)
  push('possuiVeiculo', boolLabel(resultado.credito.possui_veiculo))
  push('possuiImovel', boolLabel(resultado.credito.possui_imovel))
  push('bolsaFamilia', boolLabel(resultado.credito.bolsa_familia))
  push('score', resultado.credito.score)
  push('faixaScore', resultado.credito.faixa_score)
  push('personaCredito', resultado.credito.persona_credito)
  push('propensaoPagamento', resultado.credito.propensao_pagamento)
  push('scoreDigital', resultado.credito.score_digital)
  push('possuiFgts', empresa ? boolLabel(empresa.possui_fgts) : '')
  push('fgtsValorPresumido', empresa?.fgts_valor_presumido || '')
  push('dataConsulta', dataConsulta.toISOString().slice(0, 10))

  const existing = await findContactByCpf(cpf)

  if (existing) {
    const enrich = buildEnrichment(existing, resultado, endereco, ordenados[0])
    await updateContact(existing.id, { ...enrich, customFields })
    // Tag por endpoint dedicado (aditivo) — updateContact via PUT não é
    // seguro pra tags (arriscaria substituir as que o contato já tinha).
    await addContactTags(existing.id, [TAG_HIGIENIZADO])
    return
  }

  // Contato novo: grava também o CPF (chave de busca) — sem isso o contato
  // nasce "órfão" e a próxima consulta do mesmo CPF duplica.
  const customFieldsNovo = [{ id: fieldIds[CPF_FIELD_KEY], fieldValue: cpf }, ...customFields]

  const criado = await createContact({
    name: resultado.cadastro.nome || undefined,
    phone: celularE164(ordenados[0]) || undefined,
    email: resultado.emails[0] || undefined,
    dateOfBirth: nascimentoIso(resultado.cadastro.nascimento) || undefined,
    address1: endereco ? [endereco.logradouro, endereco.numero].filter(Boolean).join(', ') || undefined : undefined,
    city: endereco?.cidade || undefined,
    state: endereco?.uf || undefined,
    postalCode: endereco?.cep || undefined,
    source: 'nvti-higienizacao',
    tags: [TAG_HIGIENIZADO],
    customFields: customFieldsNovo,
  })

  // O WeSales deduplica por telefone/e-mail: se ele recusou a criação porque
  // já existe um contato com esse telefone (sem CPF cadastrado), enriquece
  // ESSE contato em vez de descartar o resultado — inclusive gravando o CPF,
  // pra que as próximas consultas o encontrem pelo caminho normal.
  if (!criado.contact && criado.duplicateOfId) {
    const duplicado = await getContact(criado.duplicateOfId)
    const enrich = duplicado ? buildEnrichment(duplicado, resultado, endereco, ordenados[0]) : {}
    await updateContact(criado.duplicateOfId, { ...enrich, customFields: customFieldsNovo })
    await addContactTags(criado.duplicateOfId, [TAG_HIGIENIZADO])
  }
}

/**
 * Monta o enriquecimento de campos NATIVOS (telefone 1, e-mail, endereço) —
 * só entra no payload o que estiver VAZIO no contato hoje. Nunca sobrescreve
 * dado que o time já tem.
 */
function buildEnrichment(
  existing: WesalesContact,
  resultado: NvtiResultado,
  endereco: NvtiResultado['enderecos'][number] | undefined,
  celularPrincipal: NvtiCelular | undefined,
): ContactPayload {
  const enrich: ContactPayload = {}
  if (vazio(existing.phone) && celularPrincipal) enrich.phone = celularE164(celularPrincipal)
  if (vazio(existing.email) && resultado.emails[0]) enrich.email = resultado.emails[0]
  const nascimento = nascimentoIso(resultado.cadastro.nascimento)
  if (vazio(existing.dateOfBirth) && nascimento) enrich.dateOfBirth = nascimento
  if (endereco) {
    if (vazio(existing.address1)) {
      const linha = [endereco.logradouro, endereco.numero].filter(Boolean).join(', ')
      if (linha) enrich.address1 = linha
    }
    if (vazio(existing.city) && endereco.cidade) enrich.city = endereco.cidade
    if (vazio(existing.state) && endereco.uf) enrich.state = endereco.uf
    if (vazio(existing.postalCode) && endereco.cep) enrich.postalCode = endereco.cep
  }
  return enrich
}
