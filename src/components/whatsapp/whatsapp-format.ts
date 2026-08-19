/**
 * Formatação de texto do WhatsApp para preview HTML seguro + helpers de editor.
 * (Extraído da tela de modelos de WhatsApp do SCP para reuso no disparador.)
 *
 * WhatsApp aceita: *negrito*, _itálico_, ~tachado~, ```monoespaçado```.
 * NÃO existe sublinhado no WhatsApp.
 */

export function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escapa antes e aplica os marcadores depois (XSS-safe). */
export function renderWhatsappHtml(text: string): string {
  return escapeHtml(text)
    .replace(/```([\s\S]+?)```/g, '<code style="background:rgba(0,0,0,0.06);padding:0 3px;border-radius:3px;font-family:monospace">$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br/>')
}

/** Substitui {{tags}} por valores de exemplo; tags desconhecidas viram [tag]. */
export function fillPreviewVariables(body: string, values: Record<string, string | undefined>): string {
  return String(body || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, name) => {
    const key = String(name).trim()
    const found = values[key] ?? values[key.toLowerCase()]
    return found !== undefined && found !== '' ? String(found) : `[${key}]`
  })
}

export function extractUsedTags(body: string): string[] {
  return Array.from(new Set(String(body || '').match(/\{\{[^}]+\}\}/g) || []))
}

/** Insere texto na posição do cursor de um textarea, devolvendo o novo valor e a nova posição. */
export function insertAtSelection(textarea: HTMLTextAreaElement | null, value: string, insert: string): { value: string; caret: number } {
  if (!textarea) return { value: (value || '') + insert, caret: (value || '').length + insert.length }
  const s = textarea.selectionStart ?? value.length
  const e = textarea.selectionEnd ?? value.length
  const next = value.substring(0, s) + insert + value.substring(e)
  return { value: next, caret: s + insert.length }
}

/** Envolve a seleção com um marcador (*, _, ~, ```). */
export function wrapSelectionWith(textarea: HTMLTextAreaElement | null, value: string, marker: string): { value: string; selStart: number; selEnd: number } {
  if (!textarea) {
    const next = `${value}${marker}texto${marker}`
    return { value: next, selStart: value.length + marker.length, selEnd: value.length + marker.length + 5 }
  }
  const s = textarea.selectionStart ?? value.length
  const e = textarea.selectionEnd ?? value.length
  const sel = value.substring(s, e) || 'texto'
  const next = value.substring(0, s) + marker + sel + marker + value.substring(e)
  return { value: next, selStart: s + marker.length, selEnd: s + marker.length + sel.length }
}
