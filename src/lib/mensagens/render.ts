/**
 * Renderização dos Templates de Mensagens (fatia 5, 26/09/2026).
 *
 * Sintaxe, propositalmente pequena:
 *   {{nome}}                 valor da variável (no HTML, escapado; no texto, cru)
 *   {{#codigo}}...{{/codigo}} bloco só aparece se a variável tiver valor
 *   variável de lista (array de strings) vira <ul><li> no HTML e "• item" por
 *   linha no texto.
 * Variável desconhecida ou vazia rende vazio — nunca quebra o envio.
 *
 * Módulo folha (sem imports) para ser testável com `node --test`.
 */

export type VarValor = string | number | null | undefined | string[]
export type Vars = Record<string, VarValor>

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function temValor(v: VarValor): boolean {
  if (Array.isArray(v)) return v.length > 0
  return v !== null && v !== undefined && String(v).trim() !== ''
}

function blocos(template: string, vars: Vars): string {
  // {{#x}}...{{/x}} — sem aninhamento do mesmo nome; o suficiente aqui.
  return template.replace(/\{\{#([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, nome: string, corpo: string) =>
    temValor(vars[nome]) ? corpo : '',
  )
}

function valorTexto(v: VarValor): string {
  if (Array.isArray(v)) return v.map((i) => `• ${i}`).join('\n')
  return String(v ?? '')
}

function valorHtml(v: VarValor): string {
  if (Array.isArray(v)) return v.length ? `<ul>${v.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''
  return escapeHtml(v)
}

/** Texto puro (WhatsApp, assunto do e-mail). */
export function renderizarTexto(template: string, vars: Vars): string {
  return blocos(String(template || ''), vars).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, nome: string) => valorTexto(vars[nome]))
}

/** HTML do e-mail: valores escapados; listas viram <ul>. */
export function renderizarHtml(template: string, vars: Vars): string {
  return blocos(String(template || ''), vars).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, nome: string) => valorHtml(vars[nome]))
}

/** Nomes de variáveis usados num template (para avisar sobre desconhecidas). */
export function variaveisUsadas(template: string): string[] {
  const out = new Set<string>()
  for (const m of String(template || '').matchAll(/\{\{#?\/?([a-zA-Z0-9_]+)\}\}/g)) out.add(m[1])
  return [...out]
}

/**
 * WhatsApp aceita só *negrito*, _itálico_, ~tachado~ e ```mono```. Qualquer
 * tag HTML que escape do editor é removida antes do envio.
 */
export function limparWhatsApp(texto: string): string {
  return String(texto || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
