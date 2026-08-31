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
 * Campos e pastas são os que o Bruno montou direto na UI do WeSales em
 * 29/08/2026 (o código NÃO cria campo — só resolve por fieldKey; se faltar,
 * `ensureCustomField` lança com a instrução de criar na UI):
 *   - Contact: Telefone 2/3 e Flag WhatsApp 1/2/3 (Telefone 1 = nativo `phone`).
 *   - Informações Gerais: endereço — logradouro/cidade/UF/CEP nos campos
 *     NATIVOS + Número/Complemento/Bairro personalizados (sem equivalente
 *     nativo no schema americano).
 *   - Informações Adicionais: sexo, classe econômica, ocupação, nome da mãe,
 *     óbito, fonte de renda, veículo/imóvel/bolsa família.
 *   - Dados de Crédito: score (NUMERICAL), faixa, persona, propensão
 *     (NUMERICAL), score digital, Possui FGTS? (Sim/Não) e Valor Presumido de
 *     FGTS (MONETORY). A "Data da Última Consulta (NVTI)" foi REMOVIDA do
 *     WeSales pelo Bruno — a data real da verificação continua em
 *     `nvti_queries.created_at` no Workspace.
 *
 * Regras:
 *   - TELEFONE é o OBJETIVO da consulta (decisão do Bruno 31/08/2026): a
 *     NVTI SOBRESCREVE — celular 1 (prioridade WhatsApp) vai pro `phone`
 *     nativo mesmo que já exista número (ex. fixo importado da planilha);
 *     Telefone 2/3 e as flags são sempre regravados (inclusive limpos
 *     quando a NVTI devolver menos números que antes).
 *   - CPF já é contato → ENRIQUECE o resto. E-mail/nascimento/endereço
 *     nativos e Número/Complemento/Bairro só se estiverem VAZIOS; E-mail 2
 *     recebe o 2º e-mail da NVTI; Vínculo Empresa (Razão Social/CNPJ) é
 *     atualizado quando a NVTI traz empresa (sem limpar — campo
 *     compartilhado com o fluxo CLT/Vende.AI). Campos nvti_* e os de
 *     crédito são sempre atualizados — espaço da NVTI.
 *   - CPF não é contato ainda → CRIA um novo.
 *   - Valores passam por `customFieldEntry` (tipo do campo): número/data/opção
 *     no formato que a API exige; valor incompatível é pulado com aviso, nunca
 *     derruba o update (um DATE inválido rejeita o payload inteiro).
 *   - Best-effort: erro aqui nunca derruba a consulta NVTI em si.
 */

import {
  addContactTags,
  createContact,
  customFieldEntry,
  customFieldValue,
  ensureCustomField,
  findContactByCpf,
  getContact,
  normalizeCpfDigits,
  updateContact,
  type ContactPayload,
  type CustomFieldDef,
  type WesalesContact,
} from '@/lib/wesales/client'
import type { NvtiCelular, NvtiResultado } from './types'

/** fieldKeys REAIS no WeSales (auditados via API em 29/08/2026). */
export const NVTI_FIELD_KEYS = {
  // Contact
  telefone2: 'nvti_telefone_2',
  whatsapp1: 'nvti_whatsapp_1',
  whatsapp2: 'nvti_whatsapp_2',
  telefone3: 'nvti_telefone_3',
  whatsapp3: 'nvti_whatsapp_3',
  email2: 'email_2',
  // Informações Gerais (endereço) — só quando vazio
  numero: 'nmero',
  complemento: 'complemento',
  bairro: 'bairro',
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
  // Vínculo empregatício (compartilhado com CLT/Vende.AI — só atualiza, não limpa)
  empregadorRazao: 'empregador',
  empregadorCnpj: 'cnpj_empregador',
  // Dados de Crédito (compartilhados — sem prefixo nvti_)
  score: 'score',
  faixaScore: 'faixa_de_score',
  personaCredito: 'persona_de_credito',
  propensaoPagamento: 'propensao_de_pagamento',
  scoreDigital: 'score_digital',
  possuiFgts: 'possui_fgts',
  fgtsValorPresumido: 'valor_presumido_de_fgts',
} as const

type CampoNvti = keyof typeof NVTI_FIELD_KEYS

/** Nome visível no WeSales — só pra mensagem de erro quando o campo não existir. */
const NVTI_FIELD_LABELS: Record<CampoNvti, string> = {
  telefone2: 'Telefone 2',
  whatsapp1: 'Flag WhatsApp 1',
  whatsapp2: 'Flag WhatsApp 2',
  telefone3: 'Telefone 3',
  whatsapp3: 'Flag WhatsApp 3',
  email2: 'E-mail 2',
  numero: 'Número',
  complemento: 'Complemento',
  bairro: 'Bairro',
  nomeMae: 'Nome da Mãe',
  sexo: 'Sexo',
  classeEconomica: 'Classe Econômica',
  ocupacao: 'Ocupação',
  obito: 'Óbito',
  fonteRenda: 'Fonte de Renda',
  possuiVeiculo: 'Possui Veículo',
  possuiImovel: 'Possui Imóvel',
  bolsaFamilia: 'Bolsa Família',
  empregadorRazao: 'Vínculo Empresa: Razão Social',
  empregadorCnpj: 'Vínculo Empresa: CNPJ',
  score: 'Score',
  faixaScore: 'Faixa de Score',
  personaCredito: 'Persona de Crédito',
  propensaoPagamento: 'Propensão de Pagamento',
  scoreDigital: 'Score Digital',
  possuiFgts: 'Possui FGTS?',
  fgtsValorPresumido: 'Valor Presumido de FGTS',
}

/** Campos de endereço: só preenche se o contato ainda não tiver valor. */
const CAMPOS_SO_SE_VAZIO: ReadonlySet<CampoNvti> = new Set(['numero', 'complemento', 'bairro'])

/**
 * Campos que a NVTI é dona e SEMPRE regrava, inclusive com '' pra LIMPAR
 * valor antigo (telefones/flags/e-mail 2): se a consulta de hoje trouxe
 * menos números que a de ontem, o que sobrar estaria desatualizado.
 */
const CAMPOS_SEMPRE_GRAVA: ReadonlySet<CampoNvti> = new Set([
  'telefone2', 'telefone3', 'whatsapp1', 'whatsapp2', 'whatsapp3', 'email2',
])

const TAG_HIGIENIZADO = 'nvti-higienizado'

/** Mesma chave que o CRM AlvoConsig usa — é ESTE campo que `findContactByCpf` consulta. */
const CPF_FIELD_KEY = 'cpf'

let camposResolvidos: Promise<Record<string, CustomFieldDef>> | null = null

/** Resolve todos os campos nvti + cpf (1x por container quente). Lança se algum não existir no WeSales. */
async function resolverCamposNvti(): Promise<Record<string, CustomFieldDef>> {
  if (!camposResolvidos) {
    camposResolvidos = (async () => {
      const entries = await Promise.all([
        ensureCustomField(CPF_FIELD_KEY, 'CPF').then((def) => [CPF_FIELD_KEY, def] as const),
        ...(Object.entries(NVTI_FIELD_KEYS) as Array<[CampoNvti, string]>).map(async ([campo, key]) => {
          const def = await ensureCustomField(key, NVTI_FIELD_LABELS[campo])
          return [key, def] as const
        }),
      ])
      return Object.fromEntries(entries)
    })().catch((error) => {
      // Não deixa uma falha transitória (rede/token) ficar cacheada pra sempre.
      camposResolvidos = null
      throw error
    })
  }
  return camposResolvidos
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

/**
 * NVTI manda o nascimento como AAAAMMDD (8 dígitos colados — confirmado pelo
 * formatNasc da tela de higienização); aceita também DD/MM/AAAA e ISO.
 * O WeSales só grava AAAA-MM-DD.
 */
function nascimentoIso(valor: string | null | undefined): string | null {
  const texto = String(valor || '').trim()
  if (!texto) return null
  const compacto = texto.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compacto) return `${compacto[1]}-${compacto[2]}-${compacto[3]}`
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

type CustomFieldWrite = { id: string; fieldValue: string | number }

/**
 * Grava o resultado no WeSales. A data real da consulta NÃO é mais gravada
 * (campo removido do WeSales em 29/08/2026) — fica em `nvti_queries`.
 */
export async function syncNvtiResultadoParaWesales(resultado: NvtiResultado): Promise<void> {
  const cpf = normalizeCpfDigits(resultado.cpf)
  if (!cpf) return

  const defs = await resolverCamposNvti()
  const endereco = resultado.enderecos[0]
  const empresa = resultado.empresas[0]
  const celulares = resultado.celulares
  const primeiroCelularComWhats = celulares.findIndex((c) => c.whatsapp)
  // Prioriza o celular com WhatsApp confirmado na posição 1; os outros dois
  // seguem a ordem original da NVTI.
  const ordenados = primeiroCelularComWhats > 0
    ? [celulares[primeiroCelularComWhats], ...celulares.filter((_, i) => i !== primeiroCelularComWhats)]
    : celulares

  /** Valores desejados por campo (vazio = não mexe). */
  const valores: Partial<Record<CampoNvti, string>> = {
    telefone2: celularTexto(ordenados[1]),
    whatsapp1: ordenados[0] ? boolLabel(ordenados[0].whatsapp) : '',
    whatsapp2: ordenados[1] ? boolLabel(ordenados[1].whatsapp) : '',
    telefone3: celularTexto(ordenados[2]),
    whatsapp3: ordenados[2] ? boolLabel(ordenados[2].whatsapp) : '',
    email2: resultado.emails[1] || '',
    empregadorRazao: empresa?.razao || '',
    empregadorCnpj: empresa?.cnpj || '',
    numero: endereco?.numero || '',
    complemento: endereco?.complemento || '',
    bairro: endereco?.bairro || '',
    nomeMae: resultado.cadastro.nome_mae,
    sexo: resultado.cadastro.sexo,
    classeEconomica: resultado.cadastro.classe_economica,
    ocupacao: resultado.cadastro.descricao_cbo,
    obito: boolLabel(resultado.credito.obito),
    fonteRenda: resultado.credito.fonte_renda,
    possuiVeiculo: boolLabel(resultado.credito.possui_veiculo),
    possuiImovel: boolLabel(resultado.credito.possui_imovel),
    bolsaFamilia: boolLabel(resultado.credito.bolsa_familia),
    score: resultado.credito.score,
    faixaScore: resultado.credito.faixa_score,
    personaCredito: resultado.credito.persona_credito,
    propensaoPagamento: resultado.credito.propensao_pagamento,
    scoreDigital: resultado.credito.score_digital,
    possuiFgts: empresa ? boolLabel(empresa.possui_fgts) : '',
    fgtsValorPresumido: empresa?.fgts_valor_presumido || '',
  }

  /** Monta o payload respeitando o tipo de cada campo e a regra "só se vazio". */
  const montarCustomFields = (existente: WesalesContact | null): CustomFieldWrite[] => {
    const out: CustomFieldWrite[] = []
    for (const [campo, valor] of Object.entries(valores) as Array<[CampoNvti, string]>) {
      if (!valor && !CAMPOS_SEMPRE_GRAVA.has(campo)) continue
      const def = defs[NVTI_FIELD_KEYS[campo]]
      if (!def) continue
      if (CAMPOS_SO_SE_VAZIO.has(campo) && existente && !vazio(customFieldValue(existente, def.id))) continue
      const entry = customFieldEntry(def, valor)
      if (entry) out.push(entry)
    }
    return out
  }

  const existing = await findContactByCpf(cpf)

  if (existing) {
    const enrich = buildEnrichment(existing, resultado, endereco)
    await updateContact(existing.id, { ...enrich, customFields: montarCustomFields(existing) })
    // Tag por endpoint dedicado (aditivo) — updateContact via PUT não é
    // seguro pra tags (arriscaria substituir as que o contato já tinha).
    await addContactTags(existing.id, [TAG_HIGIENIZADO])
    await sobrescreverTelefone(existing.id, existing.phone, ordenados[0])
    return
  }

  // Contato novo: grava também o CPF (chave de busca) — sem isso o contato
  // nasce "órfão" e a próxima consulta do mesmo CPF duplica.
  const customFieldsNovo: CustomFieldWrite[] = [{ id: defs[CPF_FIELD_KEY].id, fieldValue: cpf }, ...montarCustomFields(null)]

  const criado = await createContact({
    name: resultado.cadastro.nome || undefined,
    phone: celularE164(ordenados[0]) || undefined,
    email: resultado.emails[0] || undefined,
    dateOfBirth: nascimentoIso(resultado.cadastro.nascimento) || undefined,
    // Número/Complemento/Bairro vão nos campos próprios (Informações Gerais);
    // o nativo `address1` fica só com o logradouro.
    address1: endereco?.logradouro || undefined,
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
    const enrich = duplicado ? buildEnrichment(duplicado, resultado, endereco) : {}
    const customFieldsDup: CustomFieldWrite[] = [{ id: defs[CPF_FIELD_KEY].id, fieldValue: cpf }, ...montarCustomFields(duplicado)]
    await updateContact(criado.duplicateOfId, { ...enrich, customFields: customFieldsDup })
    await addContactTags(criado.duplicateOfId, [TAG_HIGIENIZADO])
  }
}

/**
 * Telefone 1 nativo: a NVTI SOBRESCREVE (objetivo da consulta é atualizar
 * telefone — decisão do Bruno 31/08/2026). Vai numa chamada separada porque a
 * location deduplica contato por telefone: se o número já pertencer a OUTRO
 * contato o WeSales recusa, e isso não pode derrubar o resto da gravação
 * (que já aconteceu na chamada principal) — só loga.
 */
async function sobrescreverTelefone(
  contactId: string,
  telefoneAtual: unknown,
  celularPrincipal: NvtiCelular | undefined,
): Promise<void> {
  if (!celularPrincipal) return
  const novo = celularE164(celularPrincipal)
  const atual = String(telefoneAtual || '').replace(/\D/g, '')
  if (atual && atual === novo.replace(/\D/g, '')) return
  try {
    await updateContact(contactId, { phone: novo })
  } catch (error) {
    console.warn(`[nvti->wesales] não deu pra atualizar o telefone do contato ${contactId} pra ${novo} (provável duplicidade com outro contato):`, error)
  }
}

/**
 * Monta o enriquecimento de campos NATIVOS (e-mail, nascimento, endereço) —
 * só entra no payload o que estiver VAZIO no contato hoje. Telefone NÃO passa
 * por aqui: é sobrescrito à parte (ver sobrescreverTelefone).
 */
function buildEnrichment(
  existing: WesalesContact,
  resultado: NvtiResultado,
  endereco: NvtiResultado['enderecos'][number] | undefined,
): ContactPayload {
  const enrich: ContactPayload = {}
  if (vazio(existing.email) && resultado.emails[0]) enrich.email = resultado.emails[0]
  const nascimento = nascimentoIso(resultado.cadastro.nascimento)
  if (vazio(existing.dateOfBirth) && nascimento) enrich.dateOfBirth = nascimento
  if (endereco) {
    if (vazio(existing.address1) && endereco.logradouro) enrich.address1 = endereco.logradouro
    if (vazio(existing.city) && endereco.cidade) enrich.city = endereco.cidade
    if (vazio(existing.state) && endereco.uf) enrich.state = endereco.uf
    if (vazio(existing.postalCode) && endereco.cep) enrich.postalCode = endereco.cep
  }
  return enrich
}
