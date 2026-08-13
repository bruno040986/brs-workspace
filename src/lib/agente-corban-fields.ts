/**
 * Dicionário canônico de campos do Agente Corban.
 *
 * O Agente Corban é a entidade canônica do sistema e `corban_data` é a fonte da verdade.
 * Este módulo é o único lugar que descreve, para cada campo do cadastro:
 *
 *   - `key`   → o system_key estável usado pelo Construtor de Formulário
 *   - `path`  → onde o valor mora dentro de `corban_data`
 *   - `token` → a tag usada nos modelos de Documento, E-mail e WhatsApp
 *
 * Quatro consumidores compartilham esta única definição:
 *
 *   Construtor de Formulário → escolhe campos da entidade em vez de campos soltos
 *   Modelos de Documento     → mapeia campo → posição no PDF
 *   Modelos de E-mail/Whats  → resolve {{tags}}
 *   Etapas do fluxo (SCP)    → "só sai desta etapa se X estiver preenchido"
 *
 * Ao adicionar um campo novo ao cadastro, adicione-o AQUI. Os quatro consumidores
 * passam a enxergá-lo automaticamente.
 */

import {
  normalizeCepValue,
  normalizeCpfOrCnpjValue,
  normalizeEmailValue,
  normalizePhoneValue,
  normalizeText,
  normalizeUrlValue,
  normalizeDateInputValue,
} from './agente-corban'

// =========================================================================
// Tipos
// =========================================================================

/** Como o valor deve ser normalizado, validado e exibido. */
export type FieldKind =
  | 'text'
  | 'email'
  | 'phone'
  | 'cpf'
  | 'cnpj'
  | 'cpf_cnpj'
  | 'cep'
  | 'uf'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'currency'
  | 'percent'
  | 'url'
  | 'boolean'
  | 'acceptance'
  | 'bank_agency'
  | 'bank_account'

/** Seções de `corban_data`, espelhadas nas abas da tela do Agente Corban. */
export type FieldGroup =
  | 'master'
  | 'contacts'
  | 'address'
  | 'socios'
  | 'witness'
  | 'bank'
  | 'commercial'
  | 'access'
  | 'documents'
  | 'consent'
  | 'compliance'

/** De onde vem a lista de opções, quando `kind === 'select' | 'multiselect'`. */
export type FieldOptionsSource =
  | 'banks'
  | 'ufs'
  | 'genders'
  | 'person_types'
  | 'bank_account_types'
  | 'pix_types'
  | 'receipt_methods'
  | 'payment_periods'
  | 'niveis_acesso'
  | 'tipos_agente'
  | 'regras_fisico'
  | 'marital_statuses'
  | 'contact_origins'
  | 'partner_products'
  | 'service_formats'
  | 'sales_force_sizes'
  | 'coverage_regions'
  | 'pep_status'
  | 'nf_choices'
  | 'empresa_tipos'

/**
 * Valor canônico de um campo `kind: 'acceptance'` (declarações de compliance).
 *
 * Diferente de um boolean simples, o aceite carrega a trilha de auditoria:
 * quando foi dado e contra qual versão de qual(is) documento(s) da central
 * de termos (termos.brspromotora.com.br). O carimbo é dado no servidor no
 * momento do aceite — nunca no cliente.
 */
export type AcceptanceValue = {
  accepted: boolean
  /** ISO 8601, carimbado pelo servidor no momento do aceite. */
  accepted_at: string | null
  /** Slugs dos documentos da central de termos cobertos por este aceite. */
  doc_slugs?: string[]
  /** Versão vigente de cada documento no momento do aceite (slug → versão). */
  doc_versions?: Record<string, string>
}

/**
 * Quem preenche o campo.
 *
 *   `partner`   — o parceiro responde no formulário público
 *   `backoffice`— a equipe da BRS preenche na tela do Agente Corban
 *   `arw`       — vem de volta do ARW após o cadastro manual (aba Acesso)
 *   `system`    — escrito pelo motor/integrações, nunca digitado
 */
export type FieldSource = 'partner' | 'backoffice' | 'arw' | 'system'

export type AgenteCorbanFieldDef = {
  /** system_key estável. É a chave de tudo — não renomeie após entrar em uso. */
  key: string
  /** Caminho canônico dentro de `corban_data` (ex.: `master.cpf_cnpj`, `socios.0.name`). */
  path: string
  label: string
  group: FieldGroup
  kind: FieldKind
  source: FieldSource
  /** Máscara aplicada no input do formulário público. */
  mask?: string
  optionsSource?: FieldOptionsSource
  /** Restringe o campo a um tipo de pessoa. Ausente = vale para PF e PJ. */
  personType?: 'PF' | 'PJ'
  /** Coluna plana legada equivalente, mantida só para leitura de registros antigos. */
  legacyColumn?: string
  /** Dispara enriquecimento externo quando preenchido (CNPJ.ws, CPFHub, ViaCEP). */
  lookup?: 'cnpj' | 'cpf' | 'cep'
  /** Marca campos que podem ser usados como assinante em um fluxo de assinatura. */
  signerRole?: 'agente_principal' | 'agente_socio_2' | 'agente_testemunha'
  notes?: string
}

// =========================================================================
// Dicionário
// =========================================================================

const MASTER_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'person_type', path: 'master.person_type', label: 'Tipo de Pessoa', group: 'master', kind: 'select', source: 'partner', optionsSource: 'person_types', legacyColumn: 'person_type' },
  { key: 'cpf_cnpj', path: 'master.cpf_cnpj', label: 'CPF / CNPJ', group: 'master', kind: 'cpf_cnpj', source: 'partner', mask: 'cpf_cnpj', legacyColumn: 'cpf_cnpj', lookup: 'cnpj', notes: 'Identificador único do agente. UNIQUE na tabela.' },
  { key: 'name', path: 'master.name', label: 'Nome / Razão Social', group: 'master', kind: 'text', source: 'partner', legacyColumn: 'name' },
  { key: 'fantasy_name', path: 'master.fantasy_name', label: 'Nome Fantasia', group: 'master', kind: 'text', source: 'partner', personType: 'PJ', legacyColumn: 'fantasy_name' },
  { key: 'representante_legal', path: 'master.representante_legal', label: 'Representante Legal', group: 'master', kind: 'text', source: 'partner', personType: 'PJ', legacyColumn: 'representante_legal' },
  { key: 'company_opening_date', path: 'master.data_abertura', label: 'Data de Abertura', group: 'master', kind: 'date', source: 'partner', mask: 'date', personType: 'PJ' },
  { key: 'company_registration_status', path: 'master.situacao_cadastral', label: 'Situação Cadastral', group: 'master', kind: 'text', source: 'partner', personType: 'PJ' },
  { key: 'company_registration_status_date', path: 'master.situacao_cadastral_data', label: 'Data da Situação Cadastral', group: 'master', kind: 'date', source: 'system', personType: 'PJ', notes: 'Vem da consulta de CNPJ (Receita Federal).' },
  { key: 'company_registration_status_reason', path: 'master.situacao_cadastral_motivo', label: 'Motivo da Situação Cadastral', group: 'master', kind: 'text', source: 'system', personType: 'PJ', notes: 'Preenchido quando a situação não é Ativa (ex.: baixada por inaptidão).' },
  { key: 'company_establishment_type', path: 'master.tipo_estabelecimento', label: 'Tipo de Estabelecimento', group: 'master', kind: 'text', source: 'system', personType: 'PJ', notes: 'Matriz ou Filial, conforme a Receita Federal.' },
  { key: 'company_size', path: 'master.porte_empresa', label: 'Porte da Empresa', group: 'master', kind: 'text', source: 'partner', personType: 'PJ' },
  { key: 'company_capital_social', path: 'master.capital_social', label: 'Capital Social', group: 'master', kind: 'currency', source: 'partner', personType: 'PJ' },
  { key: 'company_capital_social_rfb', path: 'master.capital_social_rfb', label: 'Capital Social (Receita Federal)', group: 'master', kind: 'currency', source: 'system', personType: 'PJ', notes: 'Valor registrado na RFB no momento da consulta — serve de conferência contra o declarado.' },
  { key: 'company_legal_nature', path: 'master.natureza_juridica', label: 'Natureza Jurídica', group: 'master', kind: 'text', source: 'partner', personType: 'PJ' },
  { key: 'company_legal_nature_code', path: 'master.natureza_juridica_codigo', label: 'Código da Natureza Jurídica', group: 'master', kind: 'text', source: 'system', personType: 'PJ', notes: 'Código REDESIM (ex.: 2062). Mais confiável que o texto para detectar o tipo empresarial.' },
  { key: 'company_country', path: 'master.pais', label: 'País', group: 'master', kind: 'text', source: 'partner', personType: 'PJ', notes: 'Não existia em corban_data antes do dicionário; endereçado em master.pais.' },
  { key: 'cnae_main_code', path: 'master.cnae_main_code', label: 'Código CNAE Principal', group: 'master', kind: 'text', source: 'partner', personType: 'PJ', notes: 'Preenchido pela consulta de CNPJ. Confere com o catálogo em public.cnaes.' },
  { key: 'cnae_main_desc', path: 'master.cnae_main_desc', label: 'Atividade Econômica Principal', group: 'master', kind: 'text', source: 'partner', personType: 'PJ' },
  { key: 'cnae_secondary', path: 'master.cnaes_secundarios', label: 'CNAEs Secundários', group: 'master', kind: 'text', source: 'system', personType: 'PJ', notes: 'Array JSON [{code, desc}] vindo da consulta de CNPJ. Inclui a checagem do CNAE de correspondente bancário (6619-3/02).' },
  { key: 'company_has_corban_cnae', path: 'master.tem_cnae_corban', label: 'Possui CNAE de Correspondente Bancário', group: 'master', kind: 'boolean', source: 'system', personType: 'PJ', notes: 'true quando 6619-3/02 aparece no CNAE principal ou nos secundários.' },
  { key: 'company_is_mei', path: 'master.is_mei', label: 'Optante pelo MEI', group: 'master', kind: 'boolean', source: 'system', personType: 'PJ' },
  { key: 'company_mei_since', path: 'master.mei_data_opcao', label: 'Data de Opção pelo MEI', group: 'master', kind: 'date', source: 'system', personType: 'PJ' },
  { key: 'company_mei_until', path: 'master.mei_data_exclusao', label: 'Data de Exclusão do MEI', group: 'master', kind: 'date', source: 'system', personType: 'PJ' },
  { key: 'company_simples_optant', path: 'master.simples_optante', label: 'Optante pelo Simples Nacional', group: 'master', kind: 'boolean', source: 'system', personType: 'PJ', notes: 'Alimenta a ramificação fiscal/NF do cadastro.' },
  { key: 'company_simples_since', path: 'master.simples_data_opcao', label: 'Data de Opção pelo Simples', group: 'master', kind: 'date', source: 'system', personType: 'PJ' },
  { key: 'company_simples_until', path: 'master.simples_data_exclusao', label: 'Data de Exclusão do Simples', group: 'master', kind: 'date', source: 'system', personType: 'PJ' },
  { key: 'company_state_registrations', path: 'master.inscricoes_estaduais', label: 'Inscrições Estaduais', group: 'master', kind: 'text', source: 'system', personType: 'PJ', notes: 'Array JSON [{numero, uf, ativo}] vindo da consulta de CNPJ (CNPJ.ws).' },
  { key: 'rg', path: 'master.rg', label: 'RG', group: 'master', kind: 'text', source: 'partner', personType: 'PF', legacyColumn: 'rg' },
  { key: 'rg_expedition_date', path: 'master.rg_expedition_date', label: 'Data de Expedição do RG', group: 'master', kind: 'date', source: 'partner', mask: 'date', personType: 'PF', legacyColumn: 'rg_expedition_date' },
  { key: 'rg_issuer', path: 'master.rg_issuer', label: 'Órgão Emissor do RG', group: 'master', kind: 'text', source: 'partner', personType: 'PF', legacyColumn: 'rg_issuer' },
  { key: 'rg_state', path: 'master.rg_state', label: 'UF do RG', group: 'master', kind: 'uf', source: 'partner', optionsSource: 'ufs', personType: 'PF', legacyColumn: 'rg_state' },
  { key: 'birth_date', path: 'master.birth_date', label: 'Data de Nascimento', group: 'master', kind: 'date', source: 'partner', mask: 'date', personType: 'PF', legacyColumn: 'birth_date' },
  { key: 'gender', path: 'master.gender', label: 'Gênero', group: 'master', kind: 'select', source: 'partner', optionsSource: 'genders', personType: 'PF' },
  { key: 'partner_2_exists', path: 'master.has_secondary_socio', label: 'Possui segundo sócio?', group: 'master', kind: 'boolean', source: 'partner', personType: 'PJ', notes: 'LEGADO: derivável de socios.length > 1 no modelo de N sócios. Mantido para leitura de registros antigos.' },
  { key: 'empresa_tipo', path: 'master.empresa_tipo', label: 'Tipo Empresarial', group: 'master', kind: 'select', source: 'partner', optionsSource: 'empresa_tipos', personType: 'PJ', notes: 'Derivado da natureza jurídica da consulta de CNPJ (detectEmpresaTipo). OUTRO → revisão manual do backoffice. Dirige o progressive disclosure do cadastro.' },
]

const CONTACT_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'phone_whatsapp', path: 'contacts.phone_whatsapp', label: 'WhatsApp', group: 'contacts', kind: 'phone', source: 'partner', mask: 'phone', legacyColumn: 'phone_whatsapp' },
  { key: 'phone_whatsapp_financeiro', path: 'contacts.phone_whatsapp_financeiro', label: 'WhatsApp Financeiro', group: 'contacts', kind: 'phone', source: 'partner', mask: 'phone', legacyColumn: 'phone_whatsapp_financeiro' },
  { key: 'phone_commercial', path: 'contacts.phone_commercial', label: 'Telefone Comercial', group: 'contacts', kind: 'phone', source: 'partner', mask: 'phone', legacyColumn: 'phone_commercial' },
  { key: 'phone_residential', path: 'contacts.phone_residential', label: 'Telefone Residencial', group: 'contacts', kind: 'phone', source: 'partner', mask: 'phone', legacyColumn: 'phone_residential' },
  { key: 'phone_support', path: 'contacts.phone_support', label: 'Telefone de Suporte', group: 'contacts', kind: 'phone', source: 'partner', mask: 'phone', legacyColumn: 'phone_support' },
  { key: 'email_comissao', path: 'contacts.email_comissao', label: 'E-mail de Comissão', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_comissao' },
  { key: 'email_financeiro', path: 'contacts.email_financeiro', label: 'E-mail Financeiro', group: 'contacts', kind: 'email', source: 'partner', notes: 'Não existia em corban_data antes do dicionário.' },
  { key: 'email_informe', path: 'contacts.email_informe', label: 'E-mail de Informes', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_informe' },
  { key: 'email_formalizacao', path: 'contacts.email_formalizacao', label: 'E-mail de Formalização', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_formalizacao' },
  { key: 'email_proposta', path: 'contacts.email_proposta', label: 'E-mail de Proposta', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_proposta' },
  { key: 'email_mesa_liberacao', path: 'contacts.email_mesa_liberacao', label: 'E-mail da Mesa de Liberação', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_mesa_liberacao' },
  { key: 'email_juridico', path: 'contacts.email_juridico', label: 'E-mail Jurídico', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_juridico' },
  { key: 'email_proprio_cunho', path: 'contacts.email_proprio_cunho', label: 'E-mail Próprio Cunho', group: 'contacts', kind: 'email', source: 'partner', legacyColumn: 'email_proprio_cunho' },

  // Contatos registrados na Receita Federal — vêm da consulta de CNPJ e servem
  // de conferência contra os contatos declarados pelo parceiro.
  { key: 'email_rfb', path: 'contacts.email_rfb', label: 'E-mail registrado na Receita', group: 'contacts', kind: 'email', source: 'system', personType: 'PJ' },
  { key: 'phone_rfb_1', path: 'contacts.phone_rfb_1', label: 'Telefone 1 registrado na Receita', group: 'contacts', kind: 'phone', source: 'system', personType: 'PJ' },
  { key: 'phone_rfb_2', path: 'contacts.phone_rfb_2', label: 'Telefone 2 registrado na Receita', group: 'contacts', kind: 'phone', source: 'system', personType: 'PJ' },
]

const ADDRESS_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'cep', path: 'address.cep', label: 'CEP', group: 'address', kind: 'cep', source: 'partner', mask: 'cep', legacyColumn: 'cep', lookup: 'cep' },
  { key: 'address_street', path: 'address.address_street', label: 'Logradouro', group: 'address', kind: 'text', source: 'partner', legacyColumn: 'address_street' },
  { key: 'address_number', path: 'address.address_number', label: 'Número', group: 'address', kind: 'text', source: 'partner', legacyColumn: 'address_number' },
  { key: 'address_complement', path: 'address.address_complement', label: 'Complemento', group: 'address', kind: 'text', source: 'partner', legacyColumn: 'address_complement' },
  { key: 'address_neighborhood', path: 'address.address_neighborhood', label: 'Bairro', group: 'address', kind: 'text', source: 'partner', legacyColumn: 'address_neighborhood' },
  { key: 'address_city', path: 'address.address_city', label: 'Cidade', group: 'address', kind: 'text', source: 'partner', legacyColumn: 'address_city' },
  { key: 'address_state', path: 'address.address_state', label: 'Estado (UF)', group: 'address', kind: 'uf', source: 'partner', optionsSource: 'ufs', legacyColumn: 'address_state' },
]

/**
 * Sócios vivem em `corban_data.socios[]`. O índice 0 é sempre o sócio principal
 * (`is_principal: true`) — é ele quem assina como representante do agente.
 */
const SOCIO_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'partner_1_name', path: 'socios.0.name', label: 'Nome do Sócio Principal', group: 'socios', kind: 'text', source: 'partner', signerRole: 'agente_principal' },
  { key: 'partner_1_cpf', path: 'socios.0.cpf', label: 'CPF do Sócio Principal', group: 'socios', kind: 'cpf', source: 'partner', mask: 'cpf', lookup: 'cpf', signerRole: 'agente_principal' },
  { key: 'partner_1_birth_date', path: 'socios.0.birth_date', label: 'Nascimento do Sócio Principal', group: 'socios', kind: 'date', source: 'partner', mask: 'date' },
  { key: 'partner_1_gender', path: 'socios.0.gender', label: 'Sexo do Sócio Principal', group: 'socios', kind: 'select', source: 'partner', optionsSource: 'genders' },
  { key: 'partner_1_email', path: 'socios.0.email', label: 'E-mail do Sócio Principal', group: 'socios', kind: 'email', source: 'partner', signerRole: 'agente_principal' },
  { key: 'partner_1_whatsapp', path: 'socios.0.phone', label: 'WhatsApp do Sócio Principal', group: 'socios', kind: 'phone', source: 'partner', mask: 'phone', signerRole: 'agente_principal' },
  { key: 'partner_1_marital_status', path: 'socios.0.marital_status', label: 'Estado Civil do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_profession', path: 'socios.0.profession', label: 'Profissão do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_company_role', path: 'socios.0.company_role', label: 'Cargo/Função do Sócio Principal', group: 'socios', kind: 'text', source: 'partner', notes: 'Cargo/função no CNPJ (ex.: Sócio-Administrador).' },
  { key: 'partner_1_capital_share', path: 'socios.0.capital_share', label: '% do Capital Social (Sócio Principal)', group: 'socios', kind: 'percent', source: 'partner' },
  { key: 'partner_1_cep', path: 'socios.0.residential_cep', label: 'CEP do Sócio Principal', group: 'socios', kind: 'cep', source: 'partner', mask: 'cep', lookup: 'cep' },
  { key: 'partner_1_address_street', path: 'socios.0.residential_address_street', label: 'Logradouro do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_address_number', path: 'socios.0.residential_address_number', label: 'Número do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_address_complement', path: 'socios.0.residential_address_complement', label: 'Complemento do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_address_neighborhood', path: 'socios.0.residential_address_neighborhood', label: 'Bairro do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_address_city', path: 'socios.0.residential_address_city', label: 'Cidade do Sócio Principal', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_1_address_state', path: 'socios.0.residential_address_state', label: 'UF do Sócio Principal', group: 'socios', kind: 'uf', source: 'partner', optionsSource: 'ufs' },

  // Dados do sócio no QSA da Receita Federal (consulta de CNPJ). O CPF vem
  // mascarado (***123456**) — serve para conferir o CPF completo digitado,
  // nunca para preenchê-lo.
  { key: 'partner_1_receita_cpf_parcial', path: 'socios.0.receita.cpf_parcial', label: 'CPF no QSA da Receita (Sócio Principal)', group: 'socios', kind: 'text', source: 'system' },
  { key: 'partner_1_receita_qualificacao', path: 'socios.0.receita.qualificacao', label: 'Qualificação no QSA (Sócio Principal)', group: 'socios', kind: 'text', source: 'system' },
  { key: 'partner_1_receita_data_entrada', path: 'socios.0.receita.data_entrada', label: 'Entrada na Sociedade (Sócio Principal)', group: 'socios', kind: 'date', source: 'system' },
  { key: 'partner_1_receita_faixa_etaria', path: 'socios.0.receita.faixa_etaria', label: 'Faixa Etária no QSA (Sócio Principal)', group: 'socios', kind: 'text', source: 'system' },

  // Segundo sócio com a MESMA qualificação do principal: o formulário de cadastro
  // exige de ambos os mesmos dados (assinam contrato e termos de usuário).
  { key: 'partner_2_name', path: 'socios.1.name', label: 'Nome do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner', signerRole: 'agente_socio_2' },
  { key: 'partner_2_cpf', path: 'socios.1.cpf', label: 'CPF do Segundo Sócio', group: 'socios', kind: 'cpf', source: 'partner', mask: 'cpf', lookup: 'cpf', signerRole: 'agente_socio_2' },
  { key: 'partner_2_birth_date', path: 'socios.1.birth_date', label: 'Nascimento do Segundo Sócio', group: 'socios', kind: 'date', source: 'partner', mask: 'date' },
  { key: 'partner_2_gender', path: 'socios.1.gender', label: 'Sexo do Segundo Sócio', group: 'socios', kind: 'select', source: 'partner', optionsSource: 'genders' },
  { key: 'partner_2_email', path: 'socios.1.email', label: 'E-mail do Segundo Sócio', group: 'socios', kind: 'email', source: 'partner', signerRole: 'agente_socio_2' },
  { key: 'partner_2_whatsapp', path: 'socios.1.phone', label: 'WhatsApp do Segundo Sócio', group: 'socios', kind: 'phone', source: 'partner', mask: 'phone', signerRole: 'agente_socio_2' },
  { key: 'partner_2_marital_status', path: 'socios.1.marital_status', label: 'Estado Civil do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_profession', path: 'socios.1.profession', label: 'Profissão do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_capital_share', path: 'socios.1.capital_share', label: '% do Capital Social (Segundo Sócio)', group: 'socios', kind: 'percent', source: 'partner' },
  { key: 'partner_2_cep', path: 'socios.1.residential_cep', label: 'CEP do Segundo Sócio', group: 'socios', kind: 'cep', source: 'partner', mask: 'cep', lookup: 'cep' },
  { key: 'partner_2_address_street', path: 'socios.1.residential_address_street', label: 'Logradouro do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_address_number', path: 'socios.1.residential_address_number', label: 'Número do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_address_complement', path: 'socios.1.residential_address_complement', label: 'Complemento do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_address_neighborhood', path: 'socios.1.residential_address_neighborhood', label: 'Bairro do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_address_city', path: 'socios.1.residential_address_city', label: 'Cidade do Segundo Sócio', group: 'socios', kind: 'text', source: 'partner' },
  { key: 'partner_2_address_state', path: 'socios.1.residential_address_state', label: 'UF do Segundo Sócio', group: 'socios', kind: 'uf', source: 'partner', optionsSource: 'ufs' },

  { key: 'partner_2_receita_cpf_parcial', path: 'socios.1.receita.cpf_parcial', label: 'CPF no QSA da Receita (Segundo Sócio)', group: 'socios', kind: 'text', source: 'system' },
  { key: 'partner_2_receita_qualificacao', path: 'socios.1.receita.qualificacao', label: 'Qualificação no QSA (Segundo Sócio)', group: 'socios', kind: 'text', source: 'system' },
  { key: 'partner_2_receita_data_entrada', path: 'socios.1.receita.data_entrada', label: 'Entrada na Sociedade (Segundo Sócio)', group: 'socios', kind: 'date', source: 'system' },
  { key: 'partner_2_receita_faixa_etaria', path: 'socios.1.receita.faixa_etaria', label: 'Faixa Etária no QSA (Segundo Sócio)', group: 'socios', kind: 'text', source: 'system' },
]

/**
 * Testemunha do lado do agente. Usada quando não há segundo sócio
 * (`master.has_secondary_socio === false`) — o contrato exige duas assinaturas
 * do lado do agente.
 */
const WITNESS_FIELDS: AgenteCorbanFieldDef[] = [
  // Qualificação completa: a testemunha assina também como avalista/devedor solidário,
  // então precisa estar plenamente qualificada no contrato.
  { key: 'witness_name', path: 'witness.name', label: 'Nome da Testemunha', group: 'witness', kind: 'text', source: 'partner', signerRole: 'agente_testemunha' },
  { key: 'witness_cpf', path: 'witness.cpf', label: 'CPF da Testemunha', group: 'witness', kind: 'cpf', source: 'partner', mask: 'cpf', lookup: 'cpf', signerRole: 'agente_testemunha' },
  { key: 'witness_rg', path: 'witness.rg', label: 'RG da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_rg_issuer', path: 'witness.rg_issuer', label: 'Órgão Emissor do RG (Testemunha)', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_rg_state', path: 'witness.rg_state', label: 'UF do RG (Testemunha)', group: 'witness', kind: 'uf', source: 'partner', optionsSource: 'ufs' },
  { key: 'witness_birth_date', path: 'witness.birth_date', label: 'Nascimento da Testemunha', group: 'witness', kind: 'date', source: 'partner', mask: 'date' },
  { key: 'witness_gender', path: 'witness.gender', label: 'Sexo da Testemunha', group: 'witness', kind: 'select', source: 'partner', optionsSource: 'genders' },
  { key: 'witness_marital_status', path: 'witness.marital_status', label: 'Estado Civil da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_profession', path: 'witness.profession', label: 'Profissão da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_nationality', path: 'witness.nationality', label: 'Nacionalidade da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_email', path: 'witness.email', label: 'E-mail da Testemunha', group: 'witness', kind: 'email', source: 'partner', signerRole: 'agente_testemunha' },
  { key: 'witness_whatsapp', path: 'witness.phone', label: 'WhatsApp da Testemunha', group: 'witness', kind: 'phone', source: 'partner', mask: 'phone', signerRole: 'agente_testemunha' },
  { key: 'witness_cep', path: 'witness.cep', label: 'CEP da Testemunha', group: 'witness', kind: 'cep', source: 'partner', mask: 'cep', lookup: 'cep' },
  { key: 'witness_address_street', path: 'witness.address_street', label: 'Logradouro da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_address_number', path: 'witness.address_number', label: 'Número da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_address_complement', path: 'witness.address_complement', label: 'Complemento da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_address_neighborhood', path: 'witness.address_neighborhood', label: 'Bairro da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_address_city', path: 'witness.address_city', label: 'Cidade da Testemunha', group: 'witness', kind: 'text', source: 'partner' },
  { key: 'witness_address_state', path: 'witness.address_state', label: 'UF da Testemunha', group: 'witness', kind: 'uf', source: 'partner', optionsSource: 'ufs' },
]

const BANK_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'commission_receive_type', path: 'bank.commission_receive_type', label: 'Forma de Recebimento', group: 'bank', kind: 'select', source: 'partner', optionsSource: 'receipt_methods', legacyColumn: 'commission_receive_type' },
  { key: 'bank_code', path: 'bank.bank_code', label: 'Código do Banco', group: 'bank', kind: 'text', source: 'partner', legacyColumn: 'bank_code' },
  { key: 'bank_name', path: 'bank.bank_name', label: 'Banco', group: 'bank', kind: 'select', source: 'partner', optionsSource: 'banks', legacyColumn: 'bank_name' },
  { key: 'bank_agency', path: 'bank.bank_agency', label: 'Agência', group: 'bank', kind: 'bank_agency', source: 'partner', mask: 'bank_agency_with_digit', legacyColumn: 'bank_agency' },
  { key: 'bank_account', path: 'bank.bank_account', label: 'Conta Bancária', group: 'bank', kind: 'bank_account', source: 'partner', mask: 'bank_account', legacyColumn: 'bank_account' },
  { key: 'bank_account_type', path: 'bank.bank_account_type', label: 'Tipo de Conta', group: 'bank', kind: 'select', source: 'partner', optionsSource: 'bank_account_types', legacyColumn: 'bank_account_type' },
  { key: 'pix_type', path: 'bank.pix_type', label: 'Tipo de Chave PIX', group: 'bank', kind: 'select', source: 'partner', optionsSource: 'pix_types', legacyColumn: 'pix_type' },
  { key: 'pix_key', path: 'bank.pix_key', label: 'Chave PIX', group: 'bank', kind: 'text', source: 'partner', legacyColumn: 'pix_key' },
  { key: 'payment_period', path: 'bank.payment_period', label: 'Período de Pagamento', group: 'bank', kind: 'select', source: 'partner', optionsSource: 'payment_periods' },
]

/**
 * Perfil comercial do parceiro — a seção "Dados Comerciais" do cadastro.
 * Alimenta segmentação (produtos, porte de equipe, região) e atribuição de
 * origem/gerente comercial. Sem equivalente nas colunas legadas.
 */
const COMMERCIAL_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'commercial_origin', path: 'commercial.origin', label: 'Origem do Contato', group: 'commercial', kind: 'select', source: 'partner', optionsSource: 'contact_origins', notes: 'Como conheceu a BRS ou qual gerente comercial é o responsável.' },
  { key: 'commercial_products', path: 'commercial.products', label: 'Convênios e Produtos Trabalhados', group: 'commercial', kind: 'multiselect', source: 'partner', optionsSource: 'partner_products' },
  { key: 'commercial_service_formats', path: 'commercial.service_formats', label: 'Formato de Atendimento', group: 'commercial', kind: 'multiselect', source: 'partner', optionsSource: 'service_formats' },
  { key: 'commercial_sales_force', path: 'commercial.sales_force', label: 'Força de Vendas', group: 'commercial', kind: 'select', source: 'partner', optionsSource: 'sales_force_sizes', notes: 'Tamanho da equipe de vendas/atendimento, incluindo o próprio parceiro.' },
  { key: 'commercial_regions', path: 'commercial.regions', label: 'Regiões de Atuação', group: 'commercial', kind: 'multiselect', source: 'partner', optionsSource: 'coverage_regions' },
  { key: 'commercial_instagram', path: 'commercial.instagram', label: 'Instagram', group: 'commercial', kind: 'text', source: 'partner' },
  { key: 'commercial_tiktok', path: 'commercial.tiktok', label: 'TikTok', group: 'commercial', kind: 'text', source: 'partner' },
  { key: 'commercial_facebook', path: 'commercial.facebook', label: 'Página do Facebook', group: 'commercial', kind: 'text', source: 'partner' },
  { key: 'commercial_linkedin', path: 'commercial.linkedin', label: 'LinkedIn', group: 'commercial', kind: 'text', source: 'partner' },
  { key: 'commercial_site', path: 'commercial.site', label: 'Site', group: 'commercial', kind: 'text', source: 'partner' },
  { key: 'commercial_whatsapp', path: 'commercial.whatsapp_atendimento', label: 'WhatsApp de Atendimento ao Cliente', group: 'commercial', kind: 'phone', source: 'partner', mask: 'phone', notes: 'Número principal que os clientes do parceiro usam — não confundir com os WhatsApp de informes.' },
]

/**
 * Aba Acesso. Estes campos NÃO são preenchidos pelo parceiro: o operador cadastra
 * o agente manualmente no ARW (que não tem API) e traz os valores de volta.
 * A etapa "Cadastro no ARW" do fluxo só é concluída quando `arw_code` e
 * `temporary_password` estiverem preenchidos.
 */
const ACCESS_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'arw_code', path: 'access.arw_code', label: 'Código ARW', group: 'access', kind: 'text', source: 'arw', legacyColumn: 'arw_code' },
  { key: 'temporary_password', path: 'access.temporary_password', label: 'Senha Inicial ARW', group: 'access', kind: 'text', source: 'arw', legacyColumn: 'temporary_password' },
  { key: 'filial', path: 'access.filial', label: 'Filial', group: 'access', kind: 'text', source: 'arw', legacyColumn: 'filial' },
  { key: 'nivel_acesso', path: 'access.nivel_acesso', label: 'Nível de Acesso', group: 'access', kind: 'select', source: 'arw', optionsSource: 'niveis_acesso', legacyColumn: 'nivel_acesso' },
  { key: 'tipo_agente', path: 'access.tipo_agente', label: 'Tipo de Agente', group: 'access', kind: 'select', source: 'arw', optionsSource: 'tipos_agente', legacyColumn: 'tipo_agente' },
  { key: 'regra_fisico', path: 'access.regra_fisico', label: 'Regra de Físico', group: 'access', kind: 'select', source: 'arw', optionsSource: 'regras_fisico', legacyColumn: 'regra_fisico' },
  { key: 'superintendente_id', path: 'access.superintendente_id', label: 'Superintendente', group: 'access', kind: 'text', source: 'backoffice', legacyColumn: 'superintendente_id' },
  { key: 'supervisor_id', path: 'access.supervisor_id', label: 'Supervisor', group: 'access', kind: 'text', source: 'backoffice', legacyColumn: 'supervisor_id' },
  { key: 'gerente_id', path: 'access.gerente_id', label: 'Gerente Comercial', group: 'access', kind: 'text', source: 'backoffice', legacyColumn: 'gerente_id', notes: 'Assina como testemunha da BRS nos contratos de parceria.' },
]

const DOCUMENT_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'official_document_url', path: 'documents.official_document_url', label: 'Documento Oficial', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'social_contract_url', path: 'documents.social_contract_url', label: 'Contrato Social / Documento de Constituição', group: 'documents', kind: 'url', source: 'partner', personType: 'PJ', notes: 'Contrato Social consolidado, Requerimento de EI ou CCMEI (MEI).' },
  { key: 'bank_proof_url', path: 'documents.bank_proof_url', label: 'Comprovante Bancário', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'address_proof_url', path: 'documents.address_proof_url', label: 'Comprovante de Endereço', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'primary_socio_document_url', path: 'documents.primary_socio_document_url', label: 'Documento do Sócio Principal', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'primary_socio_address_proof_url', path: 'documents.primary_socio_address_proof_url', label: 'Comprovante de Endereço do Sócio Principal', group: 'documents', kind: 'url', source: 'partner', notes: 'Comprovante residencial (vencimento < 30 dias); aceita certidão de casamento/união junto quando em nome de cônjuge/sogros.' },
  { key: 'secondary_socio_document_url', path: 'documents.secondary_socio_document_url', label: 'Documento do Segundo Sócio', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'secondary_socio_address_proof_url', path: 'documents.secondary_socio_address_proof_url', label: 'Comprovante de Endereço do Segundo Sócio', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'witness_document_url', path: 'documents.witness_document_url', label: 'Documento da Testemunha', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'front_photo_url', path: 'documents.front_photo_url', label: 'Foto da Fachada', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'external_number_photo_url', path: 'documents.external_number_photo_url', label: 'Foto Externa com Número do Endereço', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'internal_photo_url', path: 'documents.internal_photo_url', label: 'Foto Interna', group: 'documents', kind: 'url', source: 'partner' },
  { key: 'google_drive_url', path: 'documents.google_drive_url', label: 'Pasta no Google Drive', group: 'documents', kind: 'url', source: 'system' },
  { key: 'contract_pdf_url', path: 'documents.contract_pdf_url', label: 'PDF do Contrato', group: 'documents', kind: 'url', source: 'system' },
]

const CONSENT_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'lgpd_consent', path: 'consent.lgpd', label: 'Consentimento LGPD', group: 'consent', kind: 'boolean', source: 'partner', notes: 'Obrigatório no formulário público. Registrar data/hora junto no motor.' },
  { key: 'signature_email', path: 'consent.signature_email', label: 'E-mail para Assinatura', group: 'consent', kind: 'email', source: 'partner', notes: 'Destino do link de assinatura, quando difere do e-mail de comissão.' },
  { key: 'signature_whatsapp', path: 'consent.signature_whatsapp', label: 'WhatsApp para Assinatura', group: 'consent', kind: 'phone', source: 'partner', mask: 'phone' },
]

/**
 * Declarações de compliance do cadastro público — a porta de entrada do formulário.
 *
 * Cada campo `acceptance` grava um `AcceptanceValue` (aceite + data/hora + versão
 * dos documentos aceitos). Os slugs em `notes` referem-se à central de termos
 * (termos.brspromotora.com.br), que é a fonte da versão vigente de cada política.
 * PEP e Nota Fiscal não são aceites simples: são escolhas que ramificam o fluxo.
 */
const COMPLIANCE_FIELDS: AgenteCorbanFieldDef[] = [
  { key: 'compliance_policies', path: 'compliance.policies', label: 'Aderência às Políticas Internas e Integridade', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Cobre: seguranca-da-informacao, codigo-de-conduta, pld-ft, canal-de-denuncias, integridade-e-anticorrupcao.' },
  { key: 'compliance_anticorruption', path: 'compliance.anticorruption', label: 'Declaração Anticorrupção e Antissuborno', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Lei nº 12.846/2013. Cobre: integridade-e-anticorrupcao.' },
  { key: 'compliance_pld_ft', path: 'compliance.pld_ft', label: 'Declaração de PLD/FT e Vedação de Fraudes', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Cobre: pld-ft.' },
  { key: 'compliance_pep_status', path: 'compliance.pep_status', label: 'Declaração PEP/PPE', group: 'compliance', kind: 'select', source: 'partner', optionsSource: 'pep_status', notes: 'Quando "pep", exige a Declaração de PEP específica (ramificação do fluxo).' },
  { key: 'compliance_infosec', path: 'compliance.infosec', label: 'Segurança da Informação e Credenciais', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Cobre: seguranca-da-informacao.' },
  { key: 'compliance_lgpd_client_data', path: 'compliance.lgpd_client_data', label: 'LGPD — Origem Lícita dos Dados de Clientes', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Cobre: lgpd, privacidade.' },
  { key: 'compliance_whistleblower', path: 'compliance.whistleblower', label: 'Ciência do Canal Oficial de Denúncias', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'denuncia@brspromotora.com.br. Cobre: canal-de-denuncias.' },
  { key: 'compliance_kyp', path: 'compliance.kyp_authorization', label: 'Autorização de Consultas (KYP / Background Check)', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'CRCP, RFB, birôs de crédito, SCR/Bacen, listas restritivas e ferramentas antifraude.' },
  { key: 'compliance_bank_ownership', path: 'compliance.bank_ownership', label: 'Titularidade da Conta Bancária', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Repasses só para conta corrente de titularidade do próprio CNPJ/CPF cadastrado.' },
  { key: 'compliance_nf_choice', path: 'compliance.nf_choice', label: 'Regras Fiscais e Emissão de Nota Fiscal', group: 'compliance', kind: 'select', source: 'partner', optionsSource: 'nf_choices', notes: 'Repasses via Blue Pay Solutions Ltda. NF (quando emitida) contra o CNPJ 54.303.453/0001-16, enviada a financeiro@brspromotora.com.br.' },
  { key: 'compliance_legal_capacity', path: 'compliance.legal_capacity', label: 'Declaração de Capacidade e Representação Legal', group: 'compliance', kind: 'acceptance', source: 'partner', notes: 'Declara ser sócio-proprietário ou representante legal autorizado; veracidade das informações sob as penas da lei.' },
]

/** Todos os campos canônicos do Agente Corban, na ordem das abas da tela. */
export const AGENTE_CORBAN_FIELDS: AgenteCorbanFieldDef[] = [
  ...MASTER_FIELDS,
  ...CONTACT_FIELDS,
  ...ADDRESS_FIELDS,
  ...SOCIO_FIELDS,
  ...WITNESS_FIELDS,
  ...BANK_FIELDS,
  ...COMMERCIAL_FIELDS,
  ...ACCESS_FIELDS,
  ...DOCUMENT_FIELDS,
  ...CONSENT_FIELDS,
  ...COMPLIANCE_FIELDS,
]

export const AGENTE_CORBAN_FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  master: 'Dados Cadastrais',
  contacts: 'Contatos',
  address: 'Endereço',
  socios: 'Sócios',
  witness: 'Testemunha',
  bank: 'Dados Bancários',
  commercial: 'Perfil Comercial',
  access: 'Acesso (ARW)',
  documents: 'Documentos',
  consent: 'Consentimento e Assinatura',
  compliance: 'Compliance e Declarações',
}

// =========================================================================
// Índices e consultas
// =========================================================================

const FIELDS_BY_KEY = new Map<string, AgenteCorbanFieldDef>(
  AGENTE_CORBAN_FIELDS.map((field) => [field.key, field]),
)

const FIELDS_BY_PATH = new Map<string, AgenteCorbanFieldDef>(
  AGENTE_CORBAN_FIELDS.map((field) => [field.path, field]),
)

export function getFieldByKey(key: string): AgenteCorbanFieldDef | undefined {
  return FIELDS_BY_KEY.get(String(key || '').trim())
}

export function getFieldByPath(path: string): AgenteCorbanFieldDef | undefined {
  return FIELDS_BY_PATH.get(String(path || '').trim())
}

export function getFieldsByGroup(group: FieldGroup): AgenteCorbanFieldDef[] {
  return AGENTE_CORBAN_FIELDS.filter((field) => field.group === group)
}

/** Campos que o parceiro pode responder no formulário público. */
export function getPartnerFillableFields(personType?: 'PF' | 'PJ'): AgenteCorbanFieldDef[] {
  return AGENTE_CORBAN_FIELDS.filter((field) => {
    if (field.source !== 'partner') return false
    if (personType && field.personType && field.personType !== personType) return false
    return true
  })
}

/** Campos que voltam do ARW — condição de saída da etapa de cadastro manual. */
export function getArwReturnFields(): AgenteCorbanFieldDef[] {
  return AGENTE_CORBAN_FIELDS.filter((field) => field.source === 'arw')
}

/** Campos que podem identificar um assinante em um fluxo de assinatura. */
export function getSignerFields(): AgenteCorbanFieldDef[] {
  return AGENTE_CORBAN_FIELDS.filter((field) => !!field.signerRole)
}

export type SystemKeyOption = { value: string; label: string }

export type SystemKeyOptionGroup = {
  group: FieldGroup
  label: string
  options: SystemKeyOption[]
}

/** Sentinela para campos livres, que não se vinculam à entidade. */
export const SYSTEM_KEY_NONE: SystemKeyOption = {
  value: 'none',
  label: 'Nenhum (campo livre do formulário)',
}

const GROUP_ORDER: FieldGroup[] = [
  'master',
  'contacts',
  'address',
  'socios',
  'witness',
  'bank',
  'commercial',
  'documents',
  'consent',
  'compliance',
  'access',
]

/**
 * Opções do seletor "campo do Agente Corban" no Construtor de Formulário,
 * agrupadas por aba da entidade.
 *
 * Só campos que o parceiro pode responder aparecem por padrão — os da aba Acesso
 * voltam do ARW e não fazem sentido no formulário público.
 */
export function getSystemKeyOptionGroups(includeNonPartnerFields = false): SystemKeyOptionGroup[] {
  const groups: SystemKeyOptionGroup[] = []

  for (const group of GROUP_ORDER) {
    const options = AGENTE_CORBAN_FIELDS.filter((field) => {
      if (field.group !== group) return false
      if (!includeNonPartnerFields && field.source !== 'partner') return false
      return true
    }).map((field) => {
      const hints: string[] = []
      if (field.lookup) hints.push('consulta automática')
      if (field.personType) hints.push(`só ${field.personType}`)
      return {
        value: field.key,
        label: hints.length > 0 ? `${field.label} (${hints.join(', ')})` : field.label,
      }
    })

    if (options.length > 0) {
      groups.push({ group, label: AGENTE_CORBAN_FIELD_GROUP_LABELS[group], options })
    }
  }

  return groups
}

/** Tag usada nos modelos de Documento, E-mail e WhatsApp: `{{cpf_cnpj}}`. */
export function getFieldToken(field: AgenteCorbanFieldDef): string {
  return `{{${field.key}}}`
}

/** Catálogo de tags disponíveis para os construtores de modelo. */
export function getTemplateTokens(): Array<{ token: string; label: string; group: FieldGroup }> {
  return AGENTE_CORBAN_FIELDS.map((field) => ({
    token: getFieldToken(field),
    label: field.label,
    group: field.group,
  }))
}

// =========================================================================
// Leitura e escrita por caminho
// =========================================================================

function parsePath(path: string): string[] {
  return String(path || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/** Lê `master.cpf_cnpj` ou `socios.0.name` de dentro de `corban_data`. */
export function getValueAtPath(source: Record<string, any> | null | undefined, path: string): any {
  const segments = parsePath(path)
  if (segments.length === 0) return undefined

  let current: any = source
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    current = current[segment]
  }
  return current
}

/**
 * Escreve em `corban_data` sem mutar a origem. Segmentos numéricos criam arrays,
 * o que faz `socios.1.name` funcionar mesmo quando `socios` ainda não existe.
 */
export function setValueAtPath<T extends Record<string, any>>(
  target: T,
  path: string,
  value: any,
): T {
  const segments = parsePath(path)
  if (segments.length === 0) return target

  const root: any = Array.isArray(target) ? [...(target as any)] : { ...(target || {}) }
  let cursor: any = root

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const nextSegment = segments[index + 1]
    const nextIsIndex = /^\d+$/.test(nextSegment)
    const existing = cursor[segment]

    if (Array.isArray(existing)) {
      cursor[segment] = [...existing]
    } else if (existing && typeof existing === 'object') {
      cursor[segment] = { ...existing }
    } else {
      cursor[segment] = nextIsIndex ? [] : {}
    }

    cursor = cursor[segment]
  }

  cursor[segments[segments.length - 1]] = value
  return root as T
}

// =========================================================================
// Normalização por tipo
// =========================================================================

function normalizeBooleanValue(value: any): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  return ['true', '1', 'sim', 'yes', 'on', 'checked'].includes(text)
}

/** Lista de opções marcadas (multiselect). Aceita array ou string única. */
function normalizeMultiselectValue(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter((item) => item.length > 0)
  }
  const text = normalizeText(value)
  return text ? [text] : []
}

/**
 * Aceite de compliance. Objetos `AcceptanceValue` passam saneados; valores
 * booleanos viram aceite sem carimbo (o carimbo é responsabilidade do servidor
 * que registra o aceite — nunca confie em data/hora vinda do cliente).
 */
function normalizeAcceptanceValue(value: any): AcceptanceValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const docSlugs = Array.isArray(value.doc_slugs)
      ? value.doc_slugs.map((slug: any) => normalizeText(slug)).filter((slug: string) => slug.length > 0)
      : undefined
    const docVersions =
      value.doc_versions && typeof value.doc_versions === 'object' ? value.doc_versions : undefined
    return {
      accepted: normalizeBooleanValue(value.accepted),
      accepted_at: normalizeText(value.accepted_at) || null,
      ...(docSlugs && docSlugs.length > 0 ? { doc_slugs: docSlugs } : {}),
      ...(docVersions ? { doc_versions: docVersions } : {}),
    }
  }
  return { accepted: normalizeBooleanValue(value), accepted_at: null }
}

/** Aplica a normalização correspondente ao `kind` do campo. */
export function normalizeFieldValue(field: AgenteCorbanFieldDef, value: any): any {
  switch (field.kind) {
    case 'email':
      return normalizeEmailValue(value)
    case 'phone':
      return normalizePhoneValue(value)
    case 'cpf':
    case 'cnpj':
    case 'cpf_cnpj':
      return normalizeCpfOrCnpjValue(value)
    case 'cep':
      return normalizeCepValue(value)
    case 'uf':
      return normalizeText(value).toUpperCase().slice(0, 2)
    case 'date':
      return normalizeDateInputValue(value)
    case 'url':
      return normalizeUrlValue(value)
    case 'boolean':
      return normalizeBooleanValue(value)
    case 'multiselect':
      return normalizeMultiselectValue(value)
    case 'acceptance':
      return normalizeAcceptanceValue(value)
    case 'bank_agency':
    case 'bank_account':
      return normalizeText(value)
    default:
      return normalizeText(value)
  }
}

// =========================================================================
// Roteamento das respostas do formulário → corban_data
// =========================================================================

export type FormAnswerRouting = {
  /** `corban_data` com as respostas canônicas aplicadas. */
  corbanData: Record<string, any>
  /** Respostas sem system_key mapeado, preservadas como antes. */
  additionalData: Record<string, any>
  /** system_keys recebidos que não existem no dicionário — sinal de config desatualizada. */
  unmappedKeys: string[]
}

/**
 * Converte as respostas do formulário público (indexadas por system_key) em
 * escritas nos caminhos canônicos de `corban_data`.
 *
 * Respostas sem system_key — ou com system_key `none`/desconhecido — continuam
 * indo para `additional_data`, preservando o comportamento anterior. Nada se perde.
 */
export function routeFormAnswersToCorbanData(
  answers: Record<string, any>,
  existingCorbanData: Record<string, any> = {},
): FormAnswerRouting {
  let corbanData: Record<string, any> = { ...(existingCorbanData || {}) }
  const additionalData: Record<string, any> = {}
  const unmappedKeys: string[] = []

  for (const [rawKey, rawValue] of Object.entries(answers || {})) {
    const key = String(rawKey || '').trim()
    if (!key || key === 'none') {
      if (key) additionalData[key] = rawValue
      continue
    }

    const field = getFieldByKey(key)
    if (!field) {
      additionalData[key] = rawValue
      unmappedKeys.push(key)
      continue
    }

    const normalized = normalizeFieldValue(field, rawValue)

    // Campos de texto vazios não sobrescrevem valor já existente no cadastro.
    const isEmptyText = typeof normalized === 'string' && normalized.trim() === ''
    if (isEmptyText && getValueAtPath(corbanData, field.path) != null) continue

    corbanData = setValueAtPath(corbanData, field.path, normalized)
  }

  corbanData = ensureSocioInvariants(corbanData)

  return { corbanData, additionalData, unmappedKeys }
}

/**
 * Traduz respostas indexadas pela chave do campo (`field.key`) para respostas
 * indexadas por `system_key`, usando o schema do formulário.
 *
 * Quando mais de um campo declara o mesmo `system_key`, vence o primeiro que
 * estiver preenchido na ordem do schema — mesma semântica de
 * `getFirstValueBySystemKey()` no formulário público.
 */
export function mapFormAnswersToSystemKeys(
  schema: Array<Record<string, any>> | null | undefined,
  answersByFieldKey: Record<string, any> | null | undefined,
): Record<string, any> {
  const answers = answersByFieldKey || {}
  const result: Record<string, any> = {}
  if (!Array.isArray(schema)) return result

  for (const field of schema) {
    const fieldKey = String(field?.key || field?.id || '')
    const systemKey = String(field?.system_key || '')
    if (!fieldKey || !systemKey || systemKey === 'none') continue

    const value = answers[fieldKey]
    if (value === undefined || value === null || String(value).trim() === '') continue
    if (result[systemKey] !== undefined) continue

    result[systemKey] = value
  }

  return result
}

/**
 * Garante que `socios[0]` seja sempre o principal e que a lista não fique com
 * buracos quando só o segundo sócio for respondido.
 */
function ensureSocioInvariants(corbanData: Record<string, any>): Record<string, any> {
  const socios = corbanData?.socios
  if (!Array.isArray(socios) || socios.length === 0) return corbanData

  const normalized = socios.map((socio: any, index: number) => ({
    ...(socio && typeof socio === 'object' ? socio : {}),
    is_principal: index === 0,
  }))

  return { ...corbanData, socios: normalized }
}

// =========================================================================
// Validação de completude — usada pelas etapas do fluxo
// =========================================================================

export type FieldRequirement = {
  /** system_key do campo exigido. */
  key: string
  label: string
}

/**
 * Verifica se todos os campos exigidos estão preenchidos em `corban_data`.
 * É o que sustenta o "só sai desta etapa se X estiver preenchido" do motor —
 * por exemplo, a etapa de cadastro no ARW exige `arw_code` e `temporary_password`.
 */
export function findMissingFields(
  corbanData: Record<string, any> | null | undefined,
  requiredKeys: string[],
): FieldRequirement[] {
  const missing: FieldRequirement[] = []

  for (const key of requiredKeys || []) {
    const field = getFieldByKey(key)
    if (!field) continue

    const value = getValueAtPath(corbanData, field.path)
    const isEmpty =
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '') ||
      (field.kind === 'boolean' && value !== true) ||
      (field.kind === 'multiselect' && (!Array.isArray(value) || value.length === 0)) ||
      (field.kind === 'acceptance' && value?.accepted !== true)

    if (isEmpty) missing.push({ key: field.key, label: field.label })
  }

  return missing
}

/**
 * Campos de testemunha só são exigidos quando o agente declarou não ter
 * segundo sócio — o contrato precisa de duas assinaturas do lado do agente.
 */
export function isWitnessRequired(corbanData: Record<string, any> | null | undefined): boolean {
  const personType = getValueAtPath(corbanData, 'master.person_type')
  if (personType !== 'PJ') return false

  const hasSecondary = getValueAtPath(corbanData, 'master.has_secondary_socio')
  if (hasSecondary === true) return false

  const socios = getValueAtPath(corbanData, 'socios')
  const secondSocio = Array.isArray(socios) ? socios[1] : null
  const secondSocioFilled = !!(secondSocio && normalizeText(secondSocio.name))

  return !secondSocioFilled
}

// =========================================================================
// Compatibilidade com as colunas planas legadas
// =========================================================================

/**
 * Lê um campo aceitando registros antigos: tenta o caminho canônico em
 * `corban_data` e cai para a coluna plana equivalente quando ausente.
 *
 * Use durante a transição. Escrita nova deve ir só para `corban_data`.
 */
export function readFieldWithLegacyFallback(
  row: Record<string, any> | null | undefined,
  key: string,
): any {
  const field = getFieldByKey(key)
  if (!field || !row) return undefined

  const canonical = getValueAtPath(row?.corban_data, field.path)
  if (canonical !== null && canonical !== undefined && canonical !== '') return canonical

  if (field.legacyColumn) return row[field.legacyColumn]
  return undefined
}

/** Mapa system_key → coluna plana legada, para scripts de backfill. */
export const LEGACY_COLUMN_BY_KEY: Record<string, string> = Object.fromEntries(
  AGENTE_CORBAN_FIELDS.filter((field) => !!field.legacyColumn).map((field) => [
    field.key,
    field.legacyColumn as string,
  ]),
)

// =========================================================================
// Catálogos de opções dos campos novos (perfil comercial e compliance)
//
// São as respostas canônicas do cadastro de parceiros. O `value` é estável
// (nunca renomear depois de entrar em uso); o `label` é o texto exibido.
// Catálogos que já viviam em outro lugar (bancos, UFs, níveis ARW) NÃO se
// repetem aqui.
// =========================================================================

export type FieldOption = { value: string; label: string }

export const MARITAL_STATUS_OPTIONS: FieldOption[] = [
  { value: 'solteiro', label: 'Solteiro(a)' },
  { value: 'uniao_estavel', label: 'União Estável' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'viuvo', label: 'Viúvo(a)' },
]

export const CONTACT_ORIGIN_OPTIONS: FieldOption[] = [
  { value: 'redes_sociais', label: 'Redes Sociais (Instagram, Facebook, TikTok, LinkedIn, WhatsApp)' },
  { value: 'site', label: 'Site' },
  { value: 'pesquisa_web', label: 'Pesquisa na Web (Google, Bing)' },
  { value: 'indicacao_parceiro', label: 'Indicação de Parceiro BRS Promotora' },
  { value: 'indicacao_conhecido', label: 'Indicação de um conhecido' },
  { value: 'comercial_adriene_marcelino', label: 'Adriene Marcelino (Comercial)' },
  { value: 'comercial_bruno_padro', label: 'Bruno Padro (Comercial)' },
  { value: 'comercial_eduardo_de_sousa', label: 'Eduardo de Sousa (Comercial)' },
  { value: 'comercial_ketellen_freires', label: 'Ketellen Freires (Comercial)' },
  { value: 'comercial_mirella_domingos', label: 'Mirella Domingos (Comercial)' },
  { value: 'comercial_veridiana_costa', label: 'Veridiana Costa (Comercial)' },
]

export const PARTNER_PRODUCT_OPTIONS: FieldOption[] = [
  { value: 'convenios_municipais', label: 'Convênios Municipais' },
  { value: 'convenios_estaduais', label: 'Convênios Estaduais' },
  { value: 'convenios_federais', label: 'Convênios Federais (Siape e Tribunais)' },
  { value: 'inss', label: 'INSS' },
  { value: 'consignado_clt', label: 'Consignado do Trabalhador CLT' },
  { value: 'saque_fgts', label: 'Saque FGTS' },
  { value: 'credito_pessoal', label: 'Crédito Pessoal' },
  { value: 'bolsa_familia', label: 'Empréstimo do Bolsa Família (Programa Acredita/Progredir)' },
  { value: 'conta_energia', label: 'Empréstimo na Conta de Energia Elétrica' },
  { value: 'garantia_imovel_veiculo', label: 'Imóvel (CGI) ou Veículo (CGV) em Garantia' },
  { value: 'pix_parcelado', label: 'Pix Parcelado / Crédito no Cartão de Crédito' },
  { value: 'linhas_empresariais', label: 'Linhas Empresariais (Pronampe, FCO, Finame e BNDES)' },
  { value: 'seguros_credito', label: 'Seguros de Crédito' },
  { value: 'consorcios', label: 'Consórcios' },
  { value: 'plano_saude', label: 'Plano de Saúde / Seguro Saúde / Assistência Médica' },
  { value: 'veiculo_assinatura', label: 'Veículo por Assinatura' },
  { value: 'protecao_veicular', label: 'Proteção Veicular' },
  { value: 'seguro_bens', label: 'Seguro de Bens' },
  { value: 'assinatura_energia_solar', label: 'Assinatura de Energia Solar' },
  { value: 'financiamento_energia_solar', label: 'Financiamento de Implantação de Energia Solar' },
  { value: 'instalacao_energia_solar', label: 'Instalação de Energia Solar' },
]

export const SERVICE_FORMAT_OPTIONS: FieldOption[] = [
  { value: 'balcao_presencial', label: 'Balcão Presencial (Ponto Comercial)' },
  { value: 'call_center', label: 'Call Center com atendimento digital (1 ou mais atendentes)' },
  { value: 'internet', label: 'Internet (Tráfego Pago e Disparo de Mensagem)' },
  { value: 'home_office', label: 'Home Office (Atendimento Digital)' },
  { value: 'visita_clientes', label: 'Visita aos Clientes' },
  { value: 'atendentes_home_office', label: 'Atendentes em Home Office (01 ou mais atendentes)' },
]

export const SALES_FORCE_OPTIONS: FieldOption[] = [
  { value: 'apenas_eu', label: 'Apenas eu' },
  { value: '2_a_4', label: 'De 2 a 4 atendentes' },
  { value: '5_a_10', label: 'De 5 a 10 atendentes' },
  { value: '11_a_20', label: 'De 11 a 20 atendentes' },
  { value: '21_a_30', label: 'De 21 a 30 atendentes' },
  { value: '31_a_49', label: 'De 31 a 49 atendentes' },
  { value: '50_ou_mais', label: '50 ou mais atendentes' },
]

export const COVERAGE_REGION_OPTIONS: FieldOption[] = [
  { value: 'nacional', label: 'Atuação Nacional (100% Digital)' },
  { value: 'norte', label: 'Norte' },
  { value: 'nordeste', label: 'Nordeste' },
  { value: 'centro_oeste', label: 'Centro-Oeste' },
  { value: 'sudeste', label: 'Sudeste' },
  { value: 'sul', label: 'Sul' },
]

export const PEP_STATUS_OPTIONS: FieldOption[] = [
  { value: 'nao_pep', label: 'NENHUM dos sócios, administradores ou representantes se enquadra como PEP/PPE, nem possui parentesco até 2º grau ou relacionamento próximo com PEP.' },
  { value: 'pep', label: 'DECLARO QUE SOU / POSSUÍMOS integrante(s) na condição de PEP/PPE (exige a Declaração de PEP específica).' },
]

export const NF_CHOICE_OPTIONS: FieldOption[] = [
  { value: 'nao_emitirei', label: 'Estou ciente e NÃO emitirei Nota Fiscal pelos valores remunerados, conforme orientação da minha assessoria contábil.' },
  { value: 'emitirei', label: 'Estou ciente e EMITIREI Nota Fiscal contra o CNPJ 54.303.453/0001-16, enviando para financeiro@brspromotora.com.br.' },
]

export const EMPRESA_TIPO_OPTIONS: FieldOption[] = [
  { value: 'MEI', label: 'Microempreendedor Individual (MEI)' },
  { value: 'EI', label: 'Empresário Individual' },
  { value: 'LTDA', label: 'Sociedade Limitada' },
  { value: 'SA', label: 'Sociedade Anônima' },
  { value: 'OUTRO', label: 'Outro / não identificado' },
]

/** Resolve o catálogo de um `optionsSource` dos campos novos. */
export const FIELD_OPTION_CATALOGS: Partial<Record<FieldOptionsSource, FieldOption[]>> = {
  marital_statuses: MARITAL_STATUS_OPTIONS,
  contact_origins: CONTACT_ORIGIN_OPTIONS,
  partner_products: PARTNER_PRODUCT_OPTIONS,
  service_formats: SERVICE_FORMAT_OPTIONS,
  sales_force_sizes: SALES_FORCE_OPTIONS,
  coverage_regions: COVERAGE_REGION_OPTIONS,
  pep_status: PEP_STATUS_OPTIONS,
  nf_choices: NF_CHOICE_OPTIONS,
  empresa_tipos: EMPRESA_TIPO_OPTIONS,
}
