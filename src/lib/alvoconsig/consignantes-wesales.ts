/**
 * Consignante/Empregador — objeto Empresa do WeSales, um registro por
 * convênio (decisão 24/08/2026, ver docs/SPEC-CRM-WESALES-CAMPANHAS.md).
 * Guarda quem é o consignante do contato (prefeitura, secretaria, instituto
 * de previdência...) de forma sempre visível e filtrável no WeSales, com
 * CNPJ/Razão Social vindos do cadastro de convênios do Workspace.
 *
 * O id do registro fica gravado em `convenios.wesales_business_id` — 1x
 * criado, sempre reaproveitado (nunca cria duplicado nem casa por nome).
 */

import { createBusinessRecord, ensureBusinessCustomField, updateBusinessRecord } from '@/lib/wesales/client'

export type AdminClient = { from: (table: string) => any }

export const CONSIGNANTE_FIELD_KEYS = {
  tipo: 'alvoconsig_tipo',
  cnpj: 'alvoconsig_cnpj',
  razaoSocial: 'alvoconsig_razao_social',
} as const

export type ConvenioParaConsignante = {
  id: string
  nome: string
  nome_reduzido: string
  cnpj: string | null
  razao_social: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  wesales_business_id: string | null
}

let camposGarantidos = false

async function garantirCamposConsignante(): Promise<void> {
  if (camposGarantidos) return
  await Promise.all([
    ensureBusinessCustomField(CONSIGNANTE_FIELD_KEYS.tipo, 'AlvoConsig — Tipo'),
    ensureBusinessCustomField(CONSIGNANTE_FIELD_KEYS.cnpj, 'AlvoConsig — CNPJ'),
    ensureBusinessCustomField(CONSIGNANTE_FIELD_KEYS.razaoSocial, 'AlvoConsig — Razão Social'),
  ])
  camposGarantidos = true
}

/**
 * Resolve o Consignante do convênio no WeSales — atualiza se já existe
 * (`wesales_business_id`), cria e grava o id de volta em `convenios` se não.
 * Esta função só é usada pelo fluxo de convênio (REFIN/margem); o Tipo fica
 * fixo como "Convênio Público" — "Empregador CLT" é do futuro fluxo do CLT,
 * fora deste subsistema.
 */
export async function resolverOuCriarConsignante(admin: AdminClient, convenio: ConvenioParaConsignante): Promise<string> {
  await garantirCamposConsignante()

  const properties: Record<string, string> = {
    name: convenio.nome_reduzido,
    description: convenio.nome,
    country: 'br',
    [CONSIGNANTE_FIELD_KEYS.tipo]: 'Convênio Público',
  }
  if (convenio.cnpj) properties[CONSIGNANTE_FIELD_KEYS.cnpj] = convenio.cnpj
  if (convenio.razao_social) properties[CONSIGNANTE_FIELD_KEYS.razaoSocial] = convenio.razao_social
  if (convenio.cidade) properties.city = convenio.cidade
  if (convenio.uf) properties.state = convenio.uf
  if (convenio.cep) properties.postalcode = convenio.cep

  if (convenio.wesales_business_id) {
    await updateBusinessRecord(convenio.wesales_business_id, properties)
    return convenio.wesales_business_id
  }

  const record = await createBusinessRecord(properties)
  await admin.from('convenios').update({ wesales_business_id: record.id }).eq('id', convenio.id)
  return record.id
}
