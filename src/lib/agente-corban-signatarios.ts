/**
 * Estrutura empresarial e signatários contratuais do Agente Corban.
 *
 * Implementa o modelo Pessoa ≠ Vínculo ≠ Papel Contratual sobre `corban_data`
 * (Opção A do plano — ver docs/plano-definitivo-signatarios-coobrigacao.md):
 *
 *   - `socios[]`            N sócios, PF ou PJ; PJ sócia carrega o próprio
 *                           contrato social e os sócios PF relacionados (1 nível).
 *   - `administracao[]`     administradores/diretores/procuradores.
 *   - `pessoas[]`           pessoas físicas externas à estrutura (ex.: Coobrigado 2).
 *   - `witness`             testemunha do parceiro (grupo legado, reusado).
 *   - `signatarios`         papéis contratuais referenciando pessoas por CPF.
 *   - `revisao_societaria`  pendência obrigatória quando existe sócio PJ.
 *
 * Regra de garantia aprovada pelo jurídico: COOBRIGAÇÃO SOLIDÁRIA pessoal
 * (sem outorga conjugal — cônjuge/regime de bens fora do escopo).
 * Testemunhas: sempre duas — a do parceiro e a da BRS (gerente comercial,
 * resolvido e congelado na geração do contrato).
 */

import { normalizeText } from './agente-corban'

// =========================================================================
// Tipos
// =========================================================================

export type EmpresaTipo = 'MEI' | 'EI' | 'LTDA' | 'SA' | 'OUTRO'

export type PersonKind = 'PF' | 'PJ'

/** Sócio PF de uma PJ sócia (1 nível apenas — sem árvore ilimitada). */
export type SocioPFRelacionado = {
  cpf: string
  name: string
  capital_share?: number | null
}

/** Item de `socios[]`. PF usa os campos de qualificação; PJ usa o bloco próprio. */
export type SocioItem = {
  person_kind?: PersonKind
  is_principal?: boolean
  // PF
  cpf?: string
  name?: string
  birth_date?: string
  gender?: string
  marital_status?: string
  profession?: string
  company_role?: string
  phone?: string
  email?: string
  capital_share?: number | null
  is_administrador?: boolean
  residential_cep?: string
  residential_address_street?: string
  residential_address_number?: string
  residential_address_complement?: string
  residential_address_neighborhood?: string
  residential_address_city?: string
  residential_address_state?: string
  document_url?: string
  address_proof_url?: string
  // PJ sócia
  cnpj?: string
  contrato_social_document_url?: string
  socios_pf_relacionados?: SocioPFRelacionado[]
}

export type AdministracaoTipo = 'administrador' | 'diretor' | 'procurador'

export type AdministracaoItem = {
  cpf: string
  name: string
  tipo: AdministracaoTipo
  /** CPF do sócio correspondente, quando o administrador também é sócio. */
  socio_cpf?: string
  cargo?: string
  representacao?: 'isolada' | 'conjunta'
  email?: string
  phone?: string
  procuracao?: { doc_url?: string; validade?: string }
}

/** Pessoa física externa à estrutura societária (qualificação completa). */
export type PessoaExterna = {
  cpf: string
  name: string
  birth_date?: string
  gender?: string
  marital_status?: string
  profession?: string
  phone?: string
  email?: string
  cep?: string
  address_street?: string
  address_number?: string
  address_complement?: string
  address_neighborhood?: string
  address_city?: string
  address_state?: string
  document_url?: string
  address_proof_url?: string
}

export type PersonRefFonte =
  | 'socio'
  | 'socio_pj_relacionado'
  | 'administracao'
  | 'pessoas'
  | 'witness'
  | 'titular'

export type CoobrigadoOrigem =
  | 'socio'
  | 'socio_pj_relacionado'
  | 'administrador'
  | 'diretor'
  | 'procurador'
  | 'externo'

export type PersonRef = {
  fonte: PersonRefFonte
  cpf: string
  origem?: CoobrigadoOrigem
}

export type TestemunhaBrsRef = {
  fonte: 'gerente_comercial'
  user_id?: string
  snapshot?: { name?: string; cpf?: string; email?: string }
  resolvido_em?: string
}

export type Signatarios = {
  /** Array para suportar representação conjunta. */
  representante_cnpj?: PersonRef[]
  coobrigado_solidario_1?: PersonRef
  coobrigado_solidario_2?: PersonRef
  testemunha_parceiro?: PersonRef
  testemunha_brs?: TestemunhaBrsRef
}

export type RevisaoSocietariaStatus = 'pendente' | 'aprovado' | 'reprovado'

export type RevisaoSocietaria = {
  status: RevisaoSocietariaStatus
  por?: string
  em?: string
  observacao?: string
}

/** Pessoa resolvida a partir de um PersonRef, com a qualificação disponível. */
export type ResolvedPerson = {
  fonte: PersonRefFonte
  cpf: string
  name: string
  email?: string
  phone?: string
  birth_date?: string
  gender?: string
  marital_status?: string
  profession?: string
}

// =========================================================================
// Tipo empresarial — derivado da natureza jurídica da consulta de CNPJ
// =========================================================================

export const EMPRESA_TIPO_LABELS: Record<EmpresaTipo, string> = {
  MEI: 'Microempreendedor Individual (MEI)',
  EI: 'Empresário Individual',
  LTDA: 'Sociedade Limitada',
  SA: 'Sociedade Anônima',
  OUTRO: 'Outro / não identificado',
}

/**
 * Deriva o tipo empresarial do texto de natureza jurídica retornado pela
 * consulta de CNPJ (a base grava o texto descritivo, não o código REDESIM)
 * e do sinalizador de MEI quando a consulta o fornecer.
 *
 * Texto não reconhecido → 'OUTRO' (revisão manual do backoffice) — nunca
 * inventar enquadramento. EIRELI legada segue o fluxo da LTDA unipessoal.
 */
export function detectEmpresaTipo(naturezaJuridica: string, isMei?: boolean): EmpresaTipo {
  if (isMei === true) return 'MEI'
  const text = normalizeText(naturezaJuridica)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (!text) return 'OUTRO'
  if (text.includes('empresario') && text.includes('individual')) return 'EI'
  if (text.includes('responsabilidade limitada') && text.includes('individual')) return 'LTDA' // EIRELI legada
  if (text.includes('sociedade') && text.includes('limitada')) return 'LTDA'
  if (text.includes('sociedade anonima') || /\bs\.?a\.?\b/.test(text)) return 'SA'
  return 'OUTRO'
}

/** MEI/EI têm fluxo simplificado: titular único, sem quadro societário. */
export function isFluxoSimplificado(tipo: EmpresaTipo): boolean {
  return tipo === 'MEI' || tipo === 'EI'
}

// =========================================================================
// Leitura da estrutura em corban_data
// =========================================================================

function onlyDigits(value: any): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function getSocios(corbanData: Record<string, any> | null | undefined): SocioItem[] {
  const socios = corbanData?.socios
  return Array.isArray(socios) ? socios.filter((s) => s && typeof s === 'object') : []
}

export function getSociosPF(corbanData: Record<string, any> | null | undefined): SocioItem[] {
  return getSocios(corbanData).filter((s) => (s.person_kind || 'PF') === 'PF' && normalizeText(s.cpf))
}

export function getSociosPJ(corbanData: Record<string, any> | null | undefined): SocioItem[] {
  return getSocios(corbanData).filter((s) => s.person_kind === 'PJ')
}

export function getAdministracao(
  corbanData: Record<string, any> | null | undefined,
): AdministracaoItem[] {
  const items = corbanData?.administracao
  return Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : []
}

export function getPessoasExternas(
  corbanData: Record<string, any> | null | undefined,
): PessoaExterna[] {
  const items = corbanData?.pessoas
  return Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : []
}

export function getSignatarios(corbanData: Record<string, any> | null | undefined): Signatarios {
  const sig = corbanData?.signatarios
  return sig && typeof sig === 'object' ? sig : {}
}

export function getRevisaoSocietaria(
  corbanData: Record<string, any> | null | undefined,
): RevisaoSocietaria | null {
  const rev = corbanData?.revisao_societaria
  return rev && typeof rev === 'object' && rev.status ? rev : null
}

/** Existe PJ no quadro societário? (dispara a revisão societária obrigatória) */
export function hasSocioPJ(corbanData: Record<string, any> | null | undefined): boolean {
  return getSociosPJ(corbanData).length > 0
}

// =========================================================================
// Resolução de pessoas (PersonRef → dados)
// =========================================================================

/**
 * Procura uma pessoa física pelo CPF em todas as fontes possíveis.
 * A mesma pessoa nunca é duplicada: papéis referenciam o CPF.
 */
export function resolvePersonByCpf(
  corbanData: Record<string, any> | null | undefined,
  cpf: string,
): ResolvedPerson | null {
  const wanted = onlyDigits(cpf)
  if (!wanted) return null

  for (const socio of getSociosPF(corbanData)) {
    if (onlyDigits(socio.cpf) === wanted) {
      return {
        fonte: 'socio',
        cpf: wanted,
        name: normalizeText(socio.name),
        email: normalizeText(socio.email) || undefined,
        phone: normalizeText(socio.phone) || undefined,
        birth_date: normalizeText(socio.birth_date) || undefined,
        gender: normalizeText(socio.gender) || undefined,
        marital_status: normalizeText(socio.marital_status) || undefined,
        profession: normalizeText(socio.profession) || undefined,
      }
    }
  }

  for (const socioPJ of getSociosPJ(corbanData)) {
    for (const pf of socioPJ.socios_pf_relacionados || []) {
      if (onlyDigits(pf.cpf) === wanted) {
        return { fonte: 'socio_pj_relacionado', cpf: wanted, name: normalizeText(pf.name) }
      }
    }
  }

  for (const admin of getAdministracao(corbanData)) {
    if (onlyDigits(admin.cpf) === wanted) {
      return {
        fonte: 'administracao',
        cpf: wanted,
        name: normalizeText(admin.name),
        email: normalizeText(admin.email) || undefined,
        phone: normalizeText(admin.phone) || undefined,
      }
    }
  }

  for (const pessoa of getPessoasExternas(corbanData)) {
    if (onlyDigits(pessoa.cpf) === wanted) {
      return {
        fonte: 'pessoas',
        cpf: wanted,
        name: normalizeText(pessoa.name),
        email: normalizeText(pessoa.email) || undefined,
        phone: normalizeText(pessoa.phone) || undefined,
        birth_date: normalizeText(pessoa.birth_date) || undefined,
        gender: normalizeText(pessoa.gender) || undefined,
        marital_status: normalizeText(pessoa.marital_status) || undefined,
        profession: normalizeText(pessoa.profession) || undefined,
      }
    }
  }

  const witness = corbanData?.witness
  if (witness && onlyDigits(witness.cpf) === wanted) {
    return {
      fonte: 'witness',
      cpf: wanted,
      name: normalizeText(witness.name),
      email: normalizeText(witness.email) || undefined,
      phone: normalizeText(witness.phone) || undefined,
      birth_date: normalizeText(witness.birth_date) || undefined,
      gender: normalizeText(witness.gender) || undefined,
      marital_status: normalizeText(witness.marital_status) || undefined,
      profession: normalizeText(witness.profession) || undefined,
    }
  }

  return null
}

/** Resolve um papel de `signatarios` para a pessoa correspondente. */
export function resolveSignatario(
  corbanData: Record<string, any> | null | undefined,
  ref: PersonRef | null | undefined,
): ResolvedPerson | null {
  if (!ref?.cpf) return null
  return resolvePersonByCpf(corbanData, ref.cpf)
}

// =========================================================================
// Elegibilidade dos Coobrigados Solidários
// =========================================================================

export type CoobrigadoCandidato = {
  cpf: string
  name: string
  origem: CoobrigadoOrigem
  fonte: PersonRefFonte
  capital_share?: number | null
  /** Nome da PJ sócia, quando a pessoa vem de `socios_pf_relacionados`. */
  via_pj?: string
}

/**
 * Candidatos a Coobrigado Solidário, na ordem de elegibilidade definida:
 *   1º sócios PF diretos (sugestão: maior participação);
 *   2º na ausência de PF direto, sócios PF das PJs sócias;
 *   3º sem duas pessoas elegíveis → pendência manual do backoffice
 *      (`externo` NÃO é oferecido automaticamente nesse cenário).
 */
export function listCoobrigadoCandidatos(
  corbanData: Record<string, any> | null | undefined,
): CoobrigadoCandidato[] {
  const diretos: CoobrigadoCandidato[] = getSociosPF(corbanData).map((socio) => ({
    cpf: onlyDigits(socio.cpf),
    name: normalizeText(socio.name),
    origem: 'socio',
    fonte: 'socio',
    capital_share: typeof socio.capital_share === 'number' ? socio.capital_share : null,
  }))

  if (diretos.length > 0) {
    return diretos.sort((a, b) => (b.capital_share ?? 0) - (a.capital_share ?? 0))
  }

  const indiretos: CoobrigadoCandidato[] = []
  for (const socioPJ of getSociosPJ(corbanData)) {
    for (const pf of socioPJ.socios_pf_relacionados || []) {
      const cpf = onlyDigits(pf.cpf)
      if (!cpf || indiretos.some((c) => c.cpf === cpf)) continue
      indiretos.push({
        cpf,
        name: normalizeText(pf.name),
        origem: 'socio_pj_relacionado',
        fonte: 'socio_pj_relacionado',
        capital_share: typeof pf.capital_share === 'number' ? pf.capital_share : null,
        via_pj: normalizeText(socioPJ.name),
      })
    }
  }
  return indiretos
}

/** Sugestão inicial de Coobrigado 1: sócio PF de maior participação (editável). */
export function suggestCoobrigado1(
  corbanData: Record<string, any> | null | undefined,
): CoobrigadoCandidato | null {
  return listCoobrigadoCandidatos(corbanData)[0] || null
}

/** Pessoas com poder de representação (administradores, diretores, procuradores e sócios-admin). */
export function listRepresentanteCandidatos(
  corbanData: Record<string, any> | null | undefined,
): CoobrigadoCandidato[] {
  const out: CoobrigadoCandidato[] = []
  for (const socio of getSociosPF(corbanData)) {
    if (socio.is_administrador) {
      out.push({
        cpf: onlyDigits(socio.cpf),
        name: normalizeText(socio.name),
        origem: 'socio',
        fonte: 'socio',
      })
    }
  }
  for (const admin of getAdministracao(corbanData)) {
    const cpf = onlyDigits(admin.cpf)
    if (!cpf || out.some((c) => c.cpf === cpf)) continue
    out.push({
      cpf,
      name: normalizeText(admin.name),
      origem: admin.tipo === 'procurador' ? 'procurador' : admin.tipo === 'diretor' ? 'diretor' : 'administrador',
      fonte: 'administracao',
    })
  }
  return out
}

// =========================================================================
// Validações — capital social e matriz de compatibilidade de papéis
// =========================================================================

export type SignatarioIssue = {
  code: string
  message: string
}

/** Soma das participações dos sócios declarados (PF + PJ). */
export function sumCapitalShare(corbanData: Record<string, any> | null | undefined): number {
  return getSocios(corbanData).reduce((total, socio) => {
    const share = Number(socio.capital_share)
    return total + (Number.isFinite(share) ? share : 0)
  }, 0)
}

/** LTDA/S.A. com quadro informado: capital declarado precisa fechar 100%. */
export function validateCapitalSocial(
  corbanData: Record<string, any> | null | undefined,
  empresaTipo: EmpresaTipo,
): SignatarioIssue[] {
  if (isFluxoSimplificado(empresaTipo)) return []
  const total = sumCapitalShare(corbanData)
  if (Math.abs(total - 100) <= 0.01) return []
  return [
    {
      code: 'capital_incompleto',
      message: `Capital distribuído: ${total.toFixed(2).replace(/\.00$/, '')}%. O quadro societário precisa totalizar 100%.`,
    },
  ]
}

/**
 * Matriz de compatibilidade de papéis (regras fechadas com o Bruno):
 *
 *   PERMITIDO  representante + coobrigado (1 ou 2); acúmulos societários.
 *   BLOQUEADO  coobrigado 1 == coobrigado 2;
 *              testemunha do parceiro == qualquer parte obrigada
 *              (representante, coobrigado 1, coobrigado 2);
 *              coobrigado que não seja PF.
 */
export function validateSignatarios(
  corbanData: Record<string, any> | null | undefined,
  empresaTipo: EmpresaTipo,
): SignatarioIssue[] {
  const issues: SignatarioIssue[] = []
  const sig = getSignatarios(corbanData)

  const rep = (sig.representante_cnpj || []).map((r) => onlyDigits(r?.cpf)).filter(Boolean)
  const c1 = onlyDigits(sig.coobrigado_solidario_1?.cpf)
  const c2 = onlyDigits(sig.coobrigado_solidario_2?.cpf)
  const test = onlyDigits(sig.testemunha_parceiro?.cpf)

  if (rep.length === 0) {
    issues.push({ code: 'representante_ausente', message: 'Informe o representante do CNPJ.' })
  }
  if (!c1) {
    issues.push({ code: 'coobrigado_1_ausente', message: 'Informe o Coobrigado Solidário 1.' })
  }
  if (!c2) {
    issues.push({ code: 'coobrigado_2_ausente', message: 'Informe o Coobrigado Solidário 2.' })
  }
  if (!test) {
    issues.push({ code: 'testemunha_ausente', message: 'Informe a Testemunha do Parceiro.' })
  }

  if (c1 && c2 && c1 === c2) {
    issues.push({
      code: 'coobrigados_iguais',
      message: 'Os Coobrigados Solidários 1 e 2 devem ser pessoas diferentes.',
    })
  }

  if (test) {
    if (rep.includes(test)) {
      issues.push({
        code: 'testemunha_representante',
        message: 'A Testemunha do Parceiro não pode ser o representante do CNPJ.',
      })
    }
    if (test === c1 || test === c2) {
      issues.push({
        code: 'testemunha_coobrigado',
        message: 'A Testemunha do Parceiro não pode ser um dos Coobrigados Solidários.',
      })
    }
  }

  // Coobrigado 1 deve respeitar a ordem de elegibilidade quando há sócios.
  if (c1) {
    const candidatos = listCoobrigadoCandidatos(corbanData)
    const elegivel = candidatos.some((cand) => cand.cpf === c1)
    if (!isFluxoSimplificado(empresaTipo) && candidatos.length > 0 && !elegivel) {
      issues.push({
        code: 'coobrigado_1_inelegivel',
        message:
          'O Coobrigado Solidário 1 deve ser um sócio PF da empresa (ou, na ausência, sócio PF de uma PJ sócia).',
      })
    }
  }

  // Pessoas referenciadas precisam existir na estrutura.
  for (const [papel, cpf] of [
    ['Representante', rep[0]],
    ['Coobrigado 1', c1],
    ['Coobrigado 2', c2],
    ['Testemunha do Parceiro', test],
  ] as Array<[string, string | undefined]>) {
    if (cpf && !resolvePersonByCpf(corbanData, cpf)) {
      issues.push({
        code: 'pessoa_nao_encontrada',
        message: `${papel}: pessoa (CPF ${cpf.slice(0, 3)}…) não encontrada no cadastro.`,
      })
    }
  }

  return issues
}

/**
 * Condições para liberar a geração do contrato:
 * signatários válidos + revisão societária aprovada quando houver sócio PJ.
 * (A resolução da Testemunha BRS acontece na própria geração.)
 */
export function validateProntoParaContrato(
  corbanData: Record<string, any> | null | undefined,
  empresaTipo: EmpresaTipo,
): SignatarioIssue[] {
  const issues = [
    ...validateCapitalSocial(corbanData, empresaTipo),
    ...validateSignatarios(corbanData, empresaTipo),
  ]

  if (hasSocioPJ(corbanData)) {
    const revisao = getRevisaoSocietaria(corbanData)
    if (!revisao || revisao.status !== 'aprovado') {
      issues.push({
        code: 'revisao_societaria_pendente',
        message:
          'Revisão societária necessária: o quadro possui pessoa jurídica. O backoffice precisa aprovar antes da geração do contrato.',
      })
    }
    for (const socioPJ of getSociosPJ(corbanData)) {
      if (!normalizeText(socioPJ.contrato_social_document_url)) {
        issues.push({
          code: 'contrato_social_pj_ausente',
          message: `Contrato social da PJ sócia "${normalizeText(socioPJ.name) || socioPJ.cnpj}" não anexado.`,
        })
      }
    }
  }

  return issues
}

/** Estado inicial da revisão societária quando o quadro tem PJ. */
export function buildRevisaoSocietariaInicial(
  corbanData: Record<string, any> | null | undefined,
): RevisaoSocietaria | null {
  return hasSocioPJ(corbanData) ? { status: 'pendente' } : null
}
