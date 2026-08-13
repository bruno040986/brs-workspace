/**
 * Mapa dos campos do Contrato de Prestação de Serviços PJ (Agente Corban) na
 * Assinafy → chaves canônicas do dicionário do Agente Corban.
 *
 * Este é o vínculo entre "o contrato como template na Assinafy" e "a entidade".
 * Cada entrada vira um campo customizado nomeado na Assinafy (com `field_id`
 * próprio) e sabe de qual `key` do dicionário o valor sai.
 *
 * `assinafyName` é o nome que aparece na paleta do editor de template — use os
 * prefixos "Parceiro —" / "Sócio —" para organizar e evitar colisão com os
 * campos padrão da Assinafy (CNPJ, CEP…).
 *
 * Por enquanto é específico deste contrato. Quando o Construtor de Processos
 * amadurecer, este mapa vira configuração por template.
 */

export type ContractFieldMapping = {
  /** Nome do campo na Assinafy (o que aparece no editor de template). */
  assinafyName: string
  /** system_key do dicionário canônico do Agente Corban. */
  canonicalKey: string
}

export const CONTRATO_PS_PJ_FIELD_MAP: ContractFieldMapping[] = [
  // Dados da empresa (Agente Corban PJ)
  { assinafyName: 'Parceiro — Razão Social', canonicalKey: 'name' },
  { assinafyName: 'Parceiro — CNPJ', canonicalKey: 'cpf_cnpj' },
  { assinafyName: 'Parceiro — Endereço', canonicalKey: 'address_street' },
  { assinafyName: 'Parceiro — Número', canonicalKey: 'address_number' },
  { assinafyName: 'Parceiro — Complemento', canonicalKey: 'address_complement' },
  { assinafyName: 'Parceiro — Bairro', canonicalKey: 'address_neighborhood' },
  { assinafyName: 'Parceiro — Cidade', canonicalKey: 'address_city' },
  { assinafyName: 'Parceiro — UF', canonicalKey: 'address_state' },
  { assinafyName: 'Parceiro — CEP', canonicalKey: 'cep' },

  // Sócio principal (representante legal)
  { assinafyName: 'Sócio — Nome', canonicalKey: 'partner_1_name' },
  { assinafyName: 'Sócio — E-mail', canonicalKey: 'partner_1_email' },
  { assinafyName: 'Sócio — CPF', canonicalKey: 'partner_1_cpf' },
  { assinafyName: 'Sócio — Estado Civil', canonicalKey: 'partner_1_marital_status' },
  { assinafyName: 'Sócio — Profissão', canonicalKey: 'partner_1_profession' },
  { assinafyName: 'Sócio — Cargo/Função', canonicalKey: 'partner_1_company_role' },

  // Quadro-resumo da contratação
  { assinafyName: 'Código de Cadastro ARW', canonicalKey: 'arw_code' },
  { assinafyName: 'Periodicidade de Pagamento', canonicalKey: 'payment_period' },
]

/** Busca a chave canônica a partir do nome do campo na Assinafy (case-insensitive). */
export function canonicalKeyForAssinafyField(assinafyName: string): string | undefined {
  const norm = String(assinafyName || '').trim().toLowerCase()
  return CONTRATO_PS_PJ_FIELD_MAP.find(
    (m) => m.assinafyName.trim().toLowerCase() === norm,
  )?.canonicalKey
}
