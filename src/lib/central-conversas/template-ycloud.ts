/**
 * Prévia e validação de template YCloud (puro). `componentes` vem do DTO
 * `TemplateYcloud` (formato Meta: BODY/HEADER/FOOTER/BUTTONS com `text`).
 * Variáveis posicionais `{{1}}..{{n}}`; o valor de cada uma é digitado pela pessoa.
 */
type Comp = { type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; text?: string; url?: string }> }

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g

const comps = (componentes: unknown[]): Comp[] => (Array.isArray(componentes) ? (componentes as Comp[]).filter((c) => c && typeof c === 'object') : [])
const achar = (componentes: unknown[], tipo: string) => comps(componentes).find((c) => String(c.type).toUpperCase() === tipo)

export function preencher(texto: string, valores: Record<string, string>): string {
  return texto.replace(VAR_RE, (m, n) => (valores[n]?.trim() ? valores[n] : m))
}

export type PreviaTemplate = { header: string | null; corpo: string; rodape: string | null; botoes: string[] }

export function renderizarPrevia(componentes: unknown[], valores: Record<string, string>): PreviaTemplate {
  const h = achar(componentes, 'HEADER')
  const f = achar(componentes, 'FOOTER')
  const b = achar(componentes, 'BODY')
  const botoes = (achar(componentes, 'BUTTONS')?.buttons || []).map((x) => String(x.text || '')).filter(Boolean)
  return {
    header: h ? (h.format && h.format !== 'TEXT' ? `[${h.format}]` : h.text ? preencher(h.text, valores) : null) : null,
    corpo: preencher(String(b?.text || ''), valores),
    rodape: f?.text ? String(f.text) : null,
    botoes,
  }
}

/** Posições `1..n` do template (n = `variaveis` do DTO). */
export const posicoesVariaveis = (n: number): string[] => Array.from({ length: Math.max(0, n | 0) }, (_, i) => String(i + 1))

/** Posições ainda sem valor (vazio/só espaços). */
export function variaveisFaltando(n: number, valores: Record<string, string>): string[] {
  return posicoesVariaveis(n).filter((p) => !valores[p]?.trim())
}

/** Só as posições do template, com trim — o que vai pro engine. */
export function variaveisParaEnvio(n: number, valores: Record<string, string>): Record<string, string> {
  return Object.fromEntries(posicoesVariaveis(n).map((p) => [p, (valores[p] || '').trim()]))
}

/** Motivo (pt-BR) pelo qual a tela ainda não sabe enviar o template; `null` = suportado (só variáveis do BODY). */
export function motivoNaoSuportado(componentes: unknown[]): string | null {
  const h = achar(componentes, 'HEADER')
  if (h?.format && h.format.toUpperCase() !== 'TEXT') return `cabeçalho de mídia (${h.format}) exige URL de arquivo`
  if (h?.text && /\{\{\s*\d+\s*\}\}/.test(h.text)) return 'variável no cabeçalho'
  if ((achar(componentes, 'BUTTONS')?.buttons || []).some((b) => /\{\{/.test(String(b.url || '')))) return 'variável no botão (URL dinâmica)'
  return null
}
