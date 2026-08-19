/**
 * Utilitários (isomórficos) para montar a lista de destinatários a partir de
 * planilha, Agentes Corban ou inclusão manual, com normalização e dedupe.
 */

import { normalizeBrPhone } from '@/lib/zapi/phone'
import type { RecipientDraft } from './types'

export function slugifyVariable(header: string): string {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'coluna'
}

/** Garante nomes únicos de variáveis (coluna, coluna_2, …). */
export function uniqueVariableNames(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((h) => {
    const base = slugifyVariable(h)
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

/** Heurística para achar a coluna de telefone numa planilha. */
export function guessPhoneColumn(variables: string[]): string | null {
  const preferred = ['telefone', 'whatsapp', 'celular', 'fone', 'phone', 'numero', 'número', 'contato']
  for (const p of preferred) {
    const hit = variables.find((v) => v.includes(p))
    if (hit) return hit
  }
  return null
}

export function guessNameColumn(variables: string[]): string | null {
  const preferred = ['nome', 'name', 'razao', 'fantasia', 'cliente', 'parceiro']
  for (const p of preferred) {
    const hit = variables.find((v) => v.includes(p))
    if (hit) return hit
  }
  return null
}

export type BuildRecipientsResult = {
  recipients: RecipientDraft[]
  invalid: Array<{ index: number; phone_raw: string; reason: string }>
  duplicates: number
}

/**
 * Converte linhas (objeto por variável) em destinatários normalizados,
 * descartando telefones inválidos e duplicados (mantém a 1ª ocorrência).
 */
export function buildRecipientsFromRows(
  rows: Array<Record<string, string>>,
  phoneVar: string,
  nameVar: string | null,
  sourceRefFor?: (row: Record<string, string>, index: number) => Record<string, unknown> | null,
): BuildRecipientsResult {
  const seen = new Set<string>()
  const recipients: RecipientDraft[] = []
  const invalid: BuildRecipientsResult['invalid'] = []
  let duplicates = 0
  rows.forEach((row, index) => {
    const raw = String(row[phoneVar] ?? '')
    const phone = normalizeBrPhone(raw)
    if (!phone) {
      invalid.push({ index, phone_raw: raw, reason: raw.trim() ? 'Telefone inválido' : 'Telefone vazio' })
      return
    }
    if (seen.has(phone)) {
      duplicates += 1
      return
    }
    seen.add(phone)
    recipients.push({
      phone,
      phone_raw: raw,
      name: nameVar ? String(row[nameVar] ?? '').trim() : '',
      variables: { ...row },
      source_ref: sourceRefFor ? sourceRefFor(row, index) : null,
    })
  })
  return { recipients, invalid, duplicates }
}

/** Gera o CSV modelo (separador ; e BOM para o Excel abrir com acentos). */
export function buildCsvTemplate(variables: string[] = ['nome', 'telefone', 'empresa', 'valor']): string {
  const header = variables.join(';')
  const example = variables
    .map((v) => (v === 'telefone' ? '11999998888' : v === 'nome' ? 'Maria Silva' : v === 'valor' ? 'R$ 1.250,00' : v === 'empresa' ? 'BRS Promotora' : ''))
    .join(';')
  return `\uFEFF${header}\n${example}\n`
}

/** Divide texto colado (tab, ; ou ,) em linhas/colunas. */
export function parsePastedTable(text: string): string[][] {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')))
}

/** Lê um valor por path "a.b.c" ou "a[].b" (retorna lista para arrays). */
export function readPath(obj: any, path: string): string[] {
  const segs = path.split('.')
  let current: any[] = [obj]
  for (const seg of segs) {
    const isArray = seg.endsWith('[]')
    const key = isArray ? seg.slice(0, -2) : seg
    const next: any[] = []
    for (const c of current) {
      const v = c?.[key]
      if (v === undefined || v === null) continue
      if (isArray) {
        if (Array.isArray(v)) next.push(...v)
      } else next.push(v)
    }
    current = next
  }
  return current.filter((v) => v !== undefined && v !== null && v !== '').map((v) => String(v))
}
