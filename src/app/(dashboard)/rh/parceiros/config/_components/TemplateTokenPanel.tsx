'use client'

import { useMemo, useState } from 'react'
import { Tag, Search } from 'lucide-react'
import {
  getTemplateTokens,
  AGENTE_CORBAN_FIELD_GROUP_LABELS,
  type FieldGroup,
} from '@/lib/agente-corban-fields'

/**
 * Painel de tokens para os construtores de modelo (e-mail/WhatsApp).
 *
 * Mostra as tags globais (assinatura/processo) + TODOS os campos do dicionário
 * canônico do Agente Corban, agrupados e com busca. Clicar num token o insere
 * na posição do cursor via `onInsert`.
 */

export type GlobalTag = { tag: string; label: string }

const GROUP_ORDER: FieldGroup[] = [
  'master',
  'contacts',
  'address',
  'socios',
  'witness',
  'bank',
  'access',
  'documents',
  'consent',
]

export default function TemplateTokenPanel({
  onInsert,
  globalTags,
  usedTokens = [],
}: {
  onInsert: (token: string) => void
  globalTags: GlobalTag[]
  usedTokens?: string[]
}) {
  const [query, setQuery] = useState('')

  const allTokens = useMemo(() => getTemplateTokens(), [])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<FieldGroup, Array<{ token: string; label: string }>>()
    for (const t of allTokens) {
      if (q && !t.label.toLowerCase().includes(q) && !t.token.toLowerCase().includes(q)) continue
      if (!map.has(t.group)) map.set(t.group, [])
      map.get(t.group)!.push({ token: t.token, label: t.label })
    }
    return map
  }, [allTokens, query])

  const usedSet = useMemo(() => new Set(usedTokens), [usedTokens])

  const q = query.trim().toLowerCase()
  const filteredGlobals = globalTags.filter(
    (g) => !q || g.label.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q),
  )

  return (
    <div className="card" style={{ padding: '0.85rem', border: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ fontWeight: 800, marginBottom: '0.5rem', color: 'var(--brs-gray-800)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Tag size={16} />
        Tags do dicionário
      </div>

      <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar campo…"
          className="form-control"
          style={{ paddingLeft: 32, height: 36 }}
        />
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '0.25rem' }}>
        {/* Tags globais */}
        {filteredGlobals.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)', marginBottom: '0.35rem' }}>
              Globais
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {filteredGlobals.map((g) => (
                <button
                  key={g.tag}
                  type="button"
                  className="btn btn-outline"
                  title={g.label}
                  onClick={() => onInsert(g.tag)}
                  style={{ padding: '3px 8px', fontSize: '0.72rem', fontFamily: 'monospace', borderColor: usedSet.has(g.tag) ? 'var(--brs-navy)' : undefined }}
                >
                  {g.tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dicionário canônico agrupado */}
        {GROUP_ORDER.map((group) => {
          const tokens = grouped.get(group)
          if (!tokens || tokens.length === 0) return null
          return (
            <div key={group} style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)', marginBottom: '0.35rem' }}>
                {AGENTE_CORBAN_FIELD_GROUP_LABELS[group]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {tokens.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    className="btn btn-outline"
                    title={`${t.label} — ${t.token}`}
                    onClick={() => onInsert(t.token)}
                    style={{ padding: '3px 8px', fontSize: '0.72rem', borderColor: usedSet.has(t.token) ? 'var(--brs-navy)' : undefined, background: usedSet.has(t.token) ? 'var(--brs-primary-50)' : undefined }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {filteredGlobals.length === 0 && Array.from(grouped.values()).every((v) => v.length === 0) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', padding: '1rem 0', textAlign: 'center' }}>
            Nenhum campo encontrado para “{query}”.
          </div>
        )}
      </div>
    </div>
  )
}
