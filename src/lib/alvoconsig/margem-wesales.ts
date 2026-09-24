/**
 * Núcleo compartilhado da "foto de margem" no WeSales (D8 do handoff da API
 * Kaizom, 24/09/2026). Extraído de `api/alvoconsig/upload/route.ts` (bloco
 * `tipo === 'margem'`) pra ser usado pelos DOIS caminhos de importação —
 * planilha Excel e staging da Kaizom — sem duplicar regra:
 *
 * - 1 foto por CPF: margem MONETORY vai como NÚMERO, data como AAAA-MM-DD;
 * - contato encontrado por CPF (cria se não existe; telefone duplicado
 *   vincula sem sobrescrever nome/telefone);
 * - matrícula NUNCA sobrescreve a já registrada (decisão 02/09/2026);
 * - Convênio (Código Workspace = `codigo_sistema`) e Convênio (Nome =
 *   `nome_reduzido`) gravados em todo contato tocado;
 * - tags `base:<slug>` + `disponivel`; vínculo ao Consignante do convênio em
 *   lote no fim (não bloqueia se falhar);
 * - concorrência 5 (incidente de 429 em 24/08/2026).
 */
import {
  addContactTags,
  createContact,
  customFieldValue,
  ensureCustomField,
  findContactByCpf,
  normalizeCpfDigits,
  setContactsBusiness,
  updateContact,
  type WesalesContact,
} from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from './campos-sync'
import { MARGEM_FIELD_KEYS, MARGEM_FIELD_LABELS } from './ofertas-wesales'
import { resolverOuCriarConsignante, type AdminClient, type ConvenioParaConsignante } from './consignantes-wesales'

export const CONCORRENCIA_WESALES = 5

export type FieldDefs = Record<string, { id: string }>
export type ProdutoMargem = 'novo' | 'rmc' | 'rcc'
export type ConvenioMargem = ConvenioParaConsignante & { codigo_sistema: string }

export type LinhaMargem = {
  /** 11 dígitos, já validado. */
  cpf: string
  nome?: string | null
  /** Só dígitos (10-13); convertido pra E.164 aqui. */
  telefone?: string | null
  matricula?: string | null
  /** Valor DISPONÍVEL por produto; ausente/null = não grava o produto. */
  margens: Partial<Record<ProdutoMargem, number | null>>
  /** Data da foto, AAAA-MM-DD. */
  data: string
}

export type ResultadoLinhaMargem = { cpf: string; contactId?: string; erro?: string }

const DUPLAS_MARGEM: Record<ProdutoMargem, { valor: string; data: string; rotuloValor: string; rotuloData: string }> = {
  novo: { valor: MARGEM_FIELD_KEYS.novoValor, data: MARGEM_FIELD_KEYS.novoData, rotuloValor: MARGEM_FIELD_LABELS.novoValor, rotuloData: MARGEM_FIELD_LABELS.novoData },
  rmc: { valor: MARGEM_FIELD_KEYS.rmcValor, data: MARGEM_FIELD_KEYS.rmcData, rotuloValor: MARGEM_FIELD_LABELS.rmcValor, rotuloData: MARGEM_FIELD_LABELS.rmcData },
  rcc: { valor: MARGEM_FIELD_KEYS.rccValor, data: MARGEM_FIELD_KEYS.rccData, rotuloValor: MARGEM_FIELD_LABELS.rccValor, rotuloData: MARGEM_FIELD_LABELS.rccData },
}

/** Um segmento de tag: minúsculo, sem acento, sem espaço — pra compor tags automáticas. */
export function slugSegmento(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x'
}

/** Telefone BR (10-11 dígitos) → E.164 (+55...). */
export function phoneToE164(telefone: string | null | undefined): string | null {
  const d = String(telefone || '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  if (d.startsWith('55') && d.length >= 12) return `+${d}`
  return `+55${d}`
}

/** Executa `tarefas` com no máximo `limite` em paralelo. */
export async function comConcorrenciaLimitada<T>(tarefas: Array<() => Promise<T>>, limite: number): Promise<T[]> {
  const resultados: T[] = new Array(tarefas.length)
  let indice = 0
  async function worker() {
    while (indice < tarefas.length) {
      const i = indice++
      resultados[i] = await tarefas[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, worker))
  return resultados
}

/**
 * Data de "hoje" em America/Sao_Paulo (AAAA-MM-DD) e o numerador da
 * importação do dia (crm_imports do mesmo tipo/convênio) — compõem a tag
 * `base:` automática (decisão 02/09/2026).
 */
export async function numeradorImportacaoHoje(admin: AdminClient, tipo: string, convenioId: string): Promise<{ hojeBr: string; dataTag: string; numerador: number }> {
  const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const inicioDoDiaIso = new Date(`${hojeBr}T00:00:00-03:00`).toISOString()
  const { count } = await admin
    .from('crm_imports')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', tipo)
    .eq('convenio_id', convenioId)
    .gte('created_at', inicioDoDiaIso)
  return { hojeBr, dataTag: hojeBr.replace(/-/g, ''), numerador: (count || 0) + 1 }
}

/** Garante (1x, fora do loop) os campos personalizados de CONTATO que serão gravados. */
export async function garantirCamposContato(opts: { matricula: boolean; convenio: boolean; nomeConvenio: boolean; margens?: ProdutoMargem[] }): Promise<FieldDefs> {
  const pares: Array<[string, string]> = [[WESALES_FIELD_KEYS.cpf, 'CPF']]
  if (opts.matricula) pares.push([WESALES_FIELD_KEYS.matricula, 'Matrícula Funcional'])
  if (opts.convenio) {
    pares.push([WESALES_FIELD_KEYS.convenioCodigo, 'Convênio (Código Workspace)'])
    // nome_reduzido cadastrado no convênio — mesmo fieldKey que o CLT usa,
    // pra padronizar "nome do convênio" entre os dois fluxos (Bruno, 29/08).
    if (opts.nomeConvenio) pares.push([WESALES_FIELD_KEYS.nomeConvenio, 'Convênio (Nome)'])
  }
  // Convênio da margem NÃO é campo por produto — é o mesmo "Convênio
  // (Código)/(Nome)" acima (Bruno, 29/08/2026): uma pessoa só tem um
  // convênio por vez.
  for (const produto of opts.margens || []) {
    const d = DUPLAS_MARGEM[produto]
    pares.push([d.valor, d.rotuloValor], [d.data, d.rotuloData])
  }
  const resolved = await Promise.all(pares.map(([key, name]) => ensureCustomField(key, name, 'contact')))
  return Object.fromEntries(pares.map(([key], i) => [key, resolved[i]]))
}

/**
 * Escreve os campos comuns (CPF/matrícula/convênio) + nome/telefone + tags no
 * contato (cria se preciso) e devolve o contactId. `customFields` já traz os
 * campos específicos do tipo (margens etc.).
 */
export async function gravarContatoWesales(p: {
  cpf: string
  nome?: string | null
  telefone?: string | null
  matricula?: string | null
  convenio: { codigo: string | null; nomeReduzido: string | null } | null
  customFields: Array<{ id: string; fieldValue: string | number }>
  existente: WesalesContact | null
  fieldDefs: FieldDefs
  tags: string[]
  source?: string
}): Promise<string> {
  const { customFields, existente, fieldDefs } = p
  customFields.unshift({ id: fieldDefs[WESALES_FIELD_KEYS.cpf].id, fieldValue: normalizeCpfDigits(p.cpf) })
  const matricula = String(p.matricula ?? '').trim()
  if (matricula && fieldDefs[WESALES_FIELD_KEYS.matricula]) {
    // Preenche, mas NUNCA sobrescreve matrícula já registrada (decisão
    // 02/09/2026: importação de margem/REFIN é oportunidade, não cadastro
    // — quem manda no dado do lead é o Cadastro/a Atualização NVTI).
    const matriculaAtual = existente ? customFieldValue(existente, fieldDefs[WESALES_FIELD_KEYS.matricula].id) : null
    if (!String(matriculaAtual || '').trim()) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.matricula].id, fieldValue: matricula })
  }
  if (p.convenio && fieldDefs[WESALES_FIELD_KEYS.convenioCodigo]) {
    if (p.convenio.codigo) customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.convenioCodigo].id, fieldValue: p.convenio.codigo })
    if (p.convenio.nomeReduzido && fieldDefs[WESALES_FIELD_KEYS.nomeConvenio]) {
      customFields.push({ id: fieldDefs[WESALES_FIELD_KEYS.nomeConvenio].id, fieldValue: p.convenio.nomeReduzido })
    }
  }
  const nome = String(p.nome ?? '').trim()

  if (existente) {
    await updateContact(existente.id, { customFields })
    await addContactTags(existente.id, p.tags)
    return existente.id
  }
  const { contact, duplicateOfId } = await createContact({
    name: nome || undefined,
    phone: phoneToE164(p.telefone),
    tags: p.tags,
    source: p.source || 'AlvoConsig — Importação API',
    customFields,
  })
  const contactId = contact?.id || duplicateOfId
  if (!contactId) throw new Error('Criação bloqueada pela location (duplicado sem contactId).')
  if (!contact) {
    // Telefone já pertence a outro contato: vincula sem sobrescrever nome/telefone.
    await updateContact(contactId, { customFields })
    await addContactTags(contactId, p.tags)
  }
  return contactId
}

/**
 * Grava a foto de margem de N pessoas (1 por CPF — o chamador já deduplicou
 * e descartou quem não tem margem). Não lança por linha: cada erro volta em
 * `resultados[i].erro`, pra o chamador decidir (Excel: lista de erros;
 * Kaizom: `erro_envio` por linha da staging).
 */
export async function gravarFotoMargemWesales(p: {
  admin: AdminClient
  convenio: ConvenioMargem
  linhas: LinhaMargem[]
  baseTagSlug: string
  source?: string
}): Promise<{ importadas: number; erros: string[]; contactIds: string[]; resultados: ResultadoLinhaMargem[] }> {
  const { convenio, linhas } = p
  const produtos = (Object.keys(DUPLAS_MARGEM) as ProdutoMargem[]).filter((prod) => linhas.some((l) => typeof l.margens[prod] === 'number'))
  const fieldDefs = await garantirCamposContato({
    matricula: linhas.some((l) => String(l.matricula ?? '').trim()),
    convenio: true,
    nomeConvenio: Boolean(convenio.nome_reduzido),
    margens: produtos,
  })

  // Consignante/Empregador do convênio — não bloqueia a importação se falhar.
  let consignanteBusinessId: string | null = null
  try {
    consignanteBusinessId = await resolverOuCriarConsignante(p.admin, convenio)
  } catch (error: any) {
    console.error('Falha ao resolver Consignante/Empregador no WeSales:', error?.message || error)
  }

  const tags = [tagBase(p.baseTagSlug), TAG_DISPONIVEL]
  const convenioCampos = { codigo: convenio.codigo_sistema, nomeReduzido: convenio.nome_reduzido || null }

  const resultados = await comConcorrenciaLimitada(
    linhas.map((linha) => async (): Promise<ResultadoLinhaMargem> => {
      try {
        // Margem é MONETORY e data é DATE no WeSales: NÚMERO e AAAA-MM-DD
        // (string com vírgula viraria 123456; data BR dá 400).
        const customFields: Array<{ id: string; fieldValue: string | number }> = []
        for (const prod of produtos) {
          const valor = linha.margens[prod]
          if (typeof valor !== 'number') continue
          customFields.push({ id: fieldDefs[DUPLAS_MARGEM[prod].valor].id, fieldValue: valor })
          customFields.push({ id: fieldDefs[DUPLAS_MARGEM[prod].data].id, fieldValue: linha.data })
        }
        const existente = await findContactByCpf(linha.cpf)
        const contactId = await gravarContatoWesales({ ...linha, convenio: convenioCampos, customFields, existente, fieldDefs, tags, source: p.source })
        return { cpf: linha.cpf, contactId }
      } catch (error: any) {
        return { cpf: linha.cpf, erro: error?.message || String(error) }
      }
    }),
    CONCORRENCIA_WESALES,
  )

  const contactIds = resultados.map((r) => r.contactId).filter((id): id is string => Boolean(id))
  // Vincula em lotes de 50 (limite da API) — bem mais leve que 1 por contato no loop.
  if (consignanteBusinessId && contactIds.length) {
    try {
      await setContactsBusiness(contactIds, consignanteBusinessId)
    } catch (error: any) {
      console.error('Falha ao vincular contatos ao Consignante/Empregador no WeSales:', error?.message || error)
    }
  }
  return {
    importadas: contactIds.length,
    erros: resultados.filter((r) => r.erro).map((r) => `CPF ${r.cpf}: ${r.erro}`),
    contactIds,
    resultados,
  }
}
