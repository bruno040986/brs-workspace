/**
 * Regras PURAS do sync YCloud (F3): o que mudou entre o snapshot anterior e o
 * atual, e o que vira alerta. Sem I/O — testado em __tests__/ycloud-sync.test.ts.
 */

export type SaudeAnterior = {
  quality_rating: string | null
  messaging_limit: string | null
  bm_messaging_limit: string | null
  status: string | null
  name_status: string | null
}

export type SaudeAtual = {
  qualityRating?: string
  messagingLimit?: string
  whatsappBusinessManagerMessagingLimit?: string
  status?: string
  nameStatus?: string
}

export type MudancaSaude = { campo: keyof SaudeAnterior; de: string | null; para: string | null }

const CAMPOS: Array<[keyof SaudeAnterior, keyof SaudeAtual]> = [
  ['quality_rating', 'qualityRating'],
  ['messaging_limit', 'messagingLimit'],
  ['bm_messaging_limit', 'whatsappBusinessManagerMessagingLimit'],
  ['status', 'status'],
  ['name_status', 'nameStatus'],
]

/** Só campos que mudaram de valor conhecido → conhecido (null anterior = primeiro snapshot, não é mudança). */
export function diffSaude(anterior: SaudeAnterior | null, atual: SaudeAtual): MudancaSaude[] {
  if (!anterior) return []
  const mudancas: MudancaSaude[] = []
  for (const [col, campo] of CAMPOS) {
    const de = anterior[col] ?? null
    const para = atual[campo] ?? null
    if (de !== null && para !== null && de !== para) mudancas.push({ campo: col, de, para })
  }
  return mudancas
}

const RANK_QUALIDADE: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1, UNKNOWN: 0 }
const STATUS_RUINS = new Set(['FLAGGED', 'RESTRICTED', 'BANNED', 'DISCONNECTED', 'RATE_LIMITED', 'DELETED'])

/**
 * Alerta = piora de qualidade, QUALQUER mudança de limite (sobe ou desce: o
 * operador precisa saber), status ruim, ou nome reprovado. Melhora de
 * qualidade não alerta (ruído).
 */
export function alertasDeSaude(nome: string, mudancas: MudancaSaude[]): Array<{ titulo: string; corpo: string }> {
  const out: Array<{ titulo: string; corpo: string }> = []
  for (const m of mudancas) {
    if (m.campo === 'quality_rating') {
      if ((RANK_QUALIDADE[m.para || ''] ?? 0) < (RANK_QUALIDADE[m.de || ''] ?? 0)) {
        out.push({ titulo: `WhatsApp Oficial: qualidade do número ${nome} caiu`, corpo: `${m.de} → ${m.para}. Reduza o ritmo e revise os templates.` })
      }
    } else if (m.campo === 'bm_messaging_limit' || m.campo === 'messaging_limit') {
      out.push({ titulo: `WhatsApp Oficial: limite de conversas mudou (${nome})`, corpo: `${m.campo === 'bm_messaging_limit' ? 'Portfólio' : 'Número'}: ${m.de} → ${m.para}.` })
    } else if (m.campo === 'status' && STATUS_RUINS.has(String(m.para))) {
      out.push({ titulo: `WhatsApp Oficial: número ${nome} está ${m.para}`, corpo: `Status anterior: ${m.de}. Verifique a conta na YCloud/Meta.` })
    } else if (m.campo === 'name_status' && ['DECLINED', 'EXPIRED'].includes(String(m.para))) {
      out.push({ titulo: `WhatsApp Oficial: nome de exibição do ${nome} ${m.para === 'DECLINED' ? 'reprovado' : 'expirado'}`, corpo: 'Revise o nome verificado no Gerenciador da Meta.' })
    }
  }
  return out
}

export type TemplateAnterior = { nome: string; idioma: string; status: string | null; quality_rating: string | null }
export type TemplateAtual = { name: string; language: string; status?: string; qualityRating?: string }

const STATUS_TEMPLATE_RUIM = new Set(['REJECTED', 'PAUSED', 'DISABLED'])

/** Templates que passaram a um status ruim ou cuja qualidade caiu pra RED. Sumiram da lista = DELETED. */
export function alertasDeTemplates(anteriores: TemplateAnterior[], atuais: TemplateAtual[]): Array<{ titulo: string; corpo: string }> {
  const chave = (n: string, l: string) => `${n}::${l}`
  const mapaAnterior = new Map(anteriores.map((t) => [chave(t.nome, t.idioma), t]))
  const out: Array<{ titulo: string; corpo: string }> = []
  for (const t of atuais) {
    const ant = mapaAnterior.get(chave(t.name, t.language))
    if (!ant) continue
    const st = String(t.status || '')
    if (ant.status !== st && STATUS_TEMPLATE_RUIM.has(st)) out.push({ titulo: `Template ${t.name} (${t.language}) ficou ${st}`, corpo: `Status anterior: ${ant.status}. Campanhas que o usam precisam de outro template.` })
    if (ant.quality_rating !== 'RED' && t.qualityRating === 'RED') out.push({ titulo: `Template ${t.name} (${t.language}) com qualidade RED`, corpo: 'A Meta pode pausá-lo; evite usá-lo até melhorar.' })
  }
  return out
}

/** Frescor (contrato §5.2: `obsoleto`). 24 h cobre o cron de 15 min com folga p/ falhas. */
export const LIMIAR_FRESCOR_MS = 24 * 60 * 60 * 1000
export function obsoleto(observadoEm: string | null | undefined, agoraMs = Date.now()): boolean {
  if (!observadoEm) return true
  const t = Date.parse(observadoEm)
  return !Number.isFinite(t) || agoraMs - t > LIMIAR_FRESCOR_MS
}

/** Conta {{n}} do BODY (posições distintas). */
export function contarVariaveisBody(componentes: unknown[] | null | undefined): number {
  const body = (componentes || []).find((c) => String((c as { type?: string })?.type || '').toUpperCase() === 'BODY') as { text?: string } | undefined
  const vistas = new Set<string>()
  for (const m of String(body?.text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) vistas.add(m[1])
  return vistas.size
}
