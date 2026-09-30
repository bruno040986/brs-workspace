'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PromotoraOption = { id: string; name: string; logo_url: string; is_active: boolean }

export default function PromotoraAutocomplete({
  value,
  promotoras,
  disabled,
  onChange,
}: {
  value: { id: string; name: string; logo_url: string }
  promotoras: PromotoraOption[]
  disabled: boolean
  onChange: (next: { id: string; name: string; logo_url: string }) => void
}) {
  const [query, setQuery] = useState(value.name || '')
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)

  useEffect(() => {
    setQuery(value.name || '')
    setIsOpen(false)
  }, [value.id, value.name])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (text.length < 3) return []
    return promotoras.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(text)).slice(0, 8)
  }, [promotoras, query])

  const showSuggestions = !disabled && isOpen && query.trim().length >= 3 && filtered.length > 0

  // Lista em portal + position:fixed: cards/seções com overflow:hidden cortavam o dropdown absoluto.
  useLayoutEffect(() => {
    if (!showSuggestions) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const cabeEmbaixo = window.innerHeight - r.bottom >= 8 * 48 || window.innerHeight - r.bottom >= r.top
      setPos(cabeEmbaixo
        ? { left: r.left, width: r.width, top: r.bottom + 4 }
        : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [showSuggestions])

  return (
    <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
      <label className="form-label">Promotora</label>
      <input
        ref={inputRef}
        className="form-control"
        disabled={disabled}
        value={query}
        placeholder="Digite ao menos 3 caracteres"
        onFocus={() => {
          if (query.trim().length >= 3) setIsOpen(true)
        }}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
          setIsOpen(true)
          if (value.id && next.trim() !== value.name) {
            onChange({ id: '', name: '', logo_url: '' })
          }
          if (!next.trim()) onChange({ id: '', name: '', logo_url: '' })
        }}
        onBlur={() => {
          window.setTimeout(() => setIsOpen(false), 120)
        }}
      />
      {showSuggestions && pos ? createPortal(
        <div
          style={{
            position: 'fixed',
            zIndex: 2000,
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: '60vh',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid var(--brs-gray-200)',
            borderRadius: 14,
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
          }}
        >
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                onChange({ id: item.id, name: item.name, logo_url: item.logo_url || '' })
                setQuery(item.name)
                setIsOpen(false)
              }}
              style={{
                width: '100%',
                border: 0,
                background: '#fff',
                textAlign: 'left',
                padding: '0.75rem 0.9rem',
                borderBottom: '1px solid var(--brs-gray-100)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.75rem',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>{item.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>{item.is_active ? 'Ativa' : 'Inativa'}</span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
      {!disabled && query.trim().length > 0 && query.trim().length < 3 ? (
        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
          A pesquisa começa com 3 caracteres.
        </div>
      ) : null}
    </div>
  )
}
