/**
 * Convênio do lote da NVTI — DELIBERADAMENTE separado de
 * `nvti-wesales.ts` (decisão do Bruno 02/09/2026): a higienização em si
 * nunca soube e nunca deve saber de convênio, porque a API da NVTI não
 * devolve essa informação — quem sabe é o operador, ao escolher o convênio
 * do lote na tela de upload. Por isso esta é uma escrita separada, chamada
 * pelo worker do lote (não pelo `syncNvtiResultadoParaWesales`), aplicando a
 * MESMA regra do Cadastro de Leads: só grava se o contato ainda não tiver
 * convênio, nunca sobrescreve um já existente.
 */
import { customFieldEntry, customFieldValue, findContactByCpf, normalizeCpfDigits, resolveCustomField, updateContact } from '@/lib/wesales/client'
import { WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'

export type ConvenioDoLote = { id: string; nome: string; nomeReduzido: string | null; codigoSistema: string | null }

function vazio(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/**
 * Grava convenio_codigo/nome_convenio no contato do WeSales SÓ SE ele ainda
 * não tiver convênio. Best-effort: erro aqui nunca derruba o item do lote
 * (a higienização em si já rodou e já foi persistida antes desta chamada).
 */
export async function gravarConvenioDoLoteSeVazio(cpf: string, convenio: ConvenioDoLote): Promise<void> {
  const cpfLimpo = normalizeCpfDigits(cpf)
  if (!cpfLimpo) return
  try {
    const contato = await findContactByCpf(cpfLimpo)
    if (!contato) return // contato novo criado pela própria higienização — próxima passada resolve

    const [codigoDef, nomeDef] = await Promise.all([
      resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
      resolveCustomField(WESALES_FIELD_KEYS.nomeConvenio),
    ])
    const jaTemConvenio = (codigoDef && !vazio(customFieldValue(contato, codigoDef.id))) || (nomeDef && !vazio(customFieldValue(contato, nomeDef.id)))
    if (jaTemConvenio) return

    const customFields = [
      codigoDef && convenio.codigoSistema ? customFieldEntry(codigoDef, convenio.codigoSistema) : null,
      nomeDef ? customFieldEntry(nomeDef, convenio.nomeReduzido || convenio.nome) : null,
    ].filter((e): e is { id: string; fieldValue: string | number } => !!e)
    if (!customFields.length) return

    await updateContact(contato.id, { customFields })
  } catch (error) {
    console.warn('[nvti-lote] falha ao gravar convênio (best-effort):', error)
  }
}
