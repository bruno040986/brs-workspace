/**
 * Gravação do resultado da higienização NVTI no WeSales — roda em TODA
 * consulta bem-sucedida (manual, lote ou a futura chamada paga do Portal
 * Parceiro; todas passam por `higienizarCpf`), independente de quem pediu.
 *
 * Decisão do Bruno (28-29/08/2026): CLT e AlvoConsig são duas Private
 * Integrations (tokens) diferentes, mas apontam pra MESMA location/base de
 * contatos no WeSales — de propósito, porque um servidor público de hoje
 * pode virar CLT amanhã (ou vice-versa) e o histórico é único. Por isso este
 * módulo usa só o client que o Workspace já tem (`@/lib/wesales/client`,
 * mesmo usado pelo CRM AlvoConsig) — sem precisar de credencial nova.
 *
 * Regras:
 *   - CPF já é contato → ENRIQUECE (grava só os campos nvti_*; nunca mexe em
 *     nome/telefone que o time já cadastrou — quem decide isso é o vendedor).
 *   - CPF não é contato ainda → CRIA um novo (toda consulta vira
 *     relacionamento na base, mesmo antes de virar lead formal).
 *   - Best-effort: erro aqui nunca derruba a consulta NVTI em si (o resultado
 *     já foi salvo em nvti_queries de qualquer forma) — só loga.
 */

import {
  addContactTags,
  createContact,
  ensureCustomField,
  findContactByCpf,
  normalizeCpfDigits,
  updateContact,
  type ContactPayload,
} from '@/lib/wesales/client'
import type { NvtiResultado } from './types'

export const NVTI_FIELD_KEYS = {
  score: 'nvti_score',
  faixaScore: 'nvti_faixa_score',
  personaCredito: 'nvti_persona_credito',
  nomeMae: 'nvti_nome_mae',
  celularWhatsapp: 'nvti_celular_whatsapp',
  email: 'nvti_email',
  cidadeUf: 'nvti_cidade_uf',
  cep: 'nvti_cep',
  possuiVeiculo: 'nvti_possui_veiculo',
  possuiImovel: 'nvti_possui_imovel',
  bolsaFamilia: 'nvti_bolsa_familia',
  obito: 'nvti_obito',
  fgtsValorPresumido: 'nvti_fgts_valor_presumido',
  atualizadoEm: 'nvti_atualizado_em',
} as const

const TAG_HIGIENIZADO = 'nvti-higienizado'

let camposGarantidos: Promise<Record<string, string>> | null = null

/** Garante (cria se faltar) todos os custom fields nvti_* — 1x por container quente. */
async function garantirCamposNvti(): Promise<Record<string, string>> {
  if (!camposGarantidos) {
    camposGarantidos = (async () => {
      const entries = await Promise.all(
        Object.values(NVTI_FIELD_KEYS).map(async (key) => {
          const label = `NVTI — ${key.replace(/^nvti_/, '').replace(/_/g, ' ')}`
          const def = await ensureCustomField(key, label)
          return [key, def.id] as const
        }),
      )
      return Object.fromEntries(entries)
    })()
  }
  return camposGarantidos
}

function boolLabel(value: boolean | null): string {
  if (value === true) return 'Sim'
  if (value === false) return 'Não'
  return ''
}

/** Prioriza celular com WhatsApp confirmado; senão o primeiro celular. */
function melhorCelular(resultado: NvtiResultado): string {
  const comWhats = resultado.celulares.find((c) => c.whatsapp)
  const cel = comWhats ?? resultado.celulares[0]
  return cel ? `${cel.ddd}${cel.numero}` : ''
}

/** Telefone pra CRIAR o contato (celular > fixo) — só usado quando ele ainda não existe. */
function melhorTelefoneParaCriacao(resultado: NvtiResultado): string {
  const cel = melhorCelular(resultado)
  if (cel) return cel
  const tel = resultado.telefones[0]
  return tel ? `${tel.ddd}${tel.numero}` : ''
}

export async function syncNvtiResultadoParaWesales(resultado: NvtiResultado): Promise<void> {
  const cpf = normalizeCpfDigits(resultado.cpf)
  if (!cpf) return

  const fieldIds = await garantirCamposNvti()
  const endereco = resultado.enderecos[0]
  const empresa = resultado.empresas[0]

  const customFields: Array<{ id: string; fieldValue: string }> = []
  const push = (key: keyof typeof NVTI_FIELD_KEYS, value: string) => {
    if (value) customFields.push({ id: fieldIds[NVTI_FIELD_KEYS[key]], fieldValue: value })
  }
  push('score', resultado.credito.score)
  push('faixaScore', resultado.credito.faixa_score)
  push('personaCredito', resultado.credito.persona_credito)
  push('nomeMae', resultado.cadastro.nome_mae)
  push('celularWhatsapp', melhorCelular(resultado))
  push('email', resultado.emails[0] || '')
  push('cidadeUf', endereco ? [endereco.cidade, endereco.uf].filter(Boolean).join('/') : '')
  push('cep', endereco?.cep || '')
  push('possuiVeiculo', boolLabel(resultado.credito.possui_veiculo))
  push('possuiImovel', boolLabel(resultado.credito.possui_imovel))
  push('bolsaFamilia', boolLabel(resultado.credito.bolsa_familia))
  push('obito', boolLabel(resultado.credito.obito))
  push('fgtsValorPresumido', empresa?.fgts_valor_presumido || '')
  push('atualizadoEm', new Date().toISOString().slice(0, 10))

  const existing = await findContactByCpf(cpf)

  if (existing) {
    const payload: ContactPayload = { customFields }
    await updateContact(existing.id, payload)
    // Tag por endpoint dedicado (aditivo) — updateContact via PUT não é
    // seguro pra tags (arriscaria substituir as que o contato já tinha).
    await addContactTags(existing.id, [TAG_HIGIENIZADO])
    return
  }

  await createContact({
    name: resultado.cadastro.nome || undefined,
    phone: melhorTelefoneParaCriacao(resultado) || undefined,
    source: 'nvti-higienizacao',
    tags: [TAG_HIGIENIZADO],
    customFields,
  })
}
