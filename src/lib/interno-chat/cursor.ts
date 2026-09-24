/**
 * Helpers puros para paginação por cursor e mesclagem de mensagens (sem dependências de servidor/Supabase/headers).
 * Seguro para importação em Client Components ('use client') e testes unitários.
 */

export function construirFiltroCursorComposto(before?: string, beforeId?: string): string | null {
  if (before && beforeId) {
    return `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`
  }
  if (before) {
    return `created_at.lt.${before}`
  }
  return null
}

export function mergeMessages<T extends { id: string; timestamp: string }>(existing: T[], fresh: T[]): T[] {
  if (existing.length === 0) return fresh
  if (fresh.length === 0) return existing

  const freshMap = new Map(fresh.map((m) => [m.id, m]))
  const merged: T[] = []
  const seenIds = new Set<string>()

  for (const msg of existing) {
    const updated = freshMap.get(msg.id) || msg
    merged.push(updated)
    seenIds.add(msg.id)
  }

  for (const msg of fresh) {
    if (!seenIds.has(msg.id)) {
      merged.push(msg)
      seenIds.add(msg.id)
    }
  }

  merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || a.id.localeCompare(b.id))
  return merged
}
