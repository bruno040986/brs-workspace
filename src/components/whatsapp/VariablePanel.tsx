'use client'

/**
 * Painel genérico de variáveis {{coluna}} para inserir no editor.
 */

import { useMemo, useState } from 'react'
import { Braces, Search } from 'lucide-react'

export default function VariablePanel({
  variables,
  usedTokens = [],
  onInsert,
  title = 'Variáveis',
}: {
  variables: string[]
  usedTokens?: string[]
  onInsert: (token: string) => void
  title?: string
}) {
  const [filter, setFilter] = useState('')
  const list = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return variables.filter((v) => !f || v.toLowerCase().includes(f))
  }, [variables, filter])
  const used = new Set(usedTokens.map((t) => t.replace(/[{}\s]/g, '').toLowerCase()))

  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.75rem', background: 'var(--brs-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.8rem', color: 'var(--brs-gray-700)', marginBottom: 6 }}>
        <Braces size={14} /> {title}
      </div>
      {variables.length > 6 && (
        <div style={{ position: 'relative', marginBottom: 6 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--brs-gray-400)' }} />
          <input className="form-control" style={{ paddingLeft: 24, fontSize: '0.75rem', padding: '4px 6px 4px 24px' }} placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Nenhuma variável disponível. Defina a base de disparo no passo 1.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((v) => {
            const token = `{{${v}}}`
            const isUsed = used.has(v.toLowerCase())
            return (
              <button
                key={v}
                type="button"
                onClick={() => onInsert(token)}
                title={`Inserir ${token}`}
                style={{
                  fontFamily: 'monospace', fontSize: '0.75rem', padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${isUsed ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
                  background: isUsed ? 'rgba(27,58,107,0.08)' : 'var(--brs-gray-50)', color: 'var(--brs-gray-800)',
                }}
              >
                {token}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
