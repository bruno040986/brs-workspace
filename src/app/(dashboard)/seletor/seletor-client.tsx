'use client'

import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { PublicCommercialPreviewCard } from '@/lib/commercial-card-public'

type SeletorCartaoClientProps = {
  cards: PublicCommercialPreviewCard[]
  cartaoBaseUrl: string
}

function getRoleLabel(role: PublicCommercialPreviewCard['entity']['role']) {
  if (role === 'superintendente') return 'Superintendente'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'independente') return 'Comercial Independente'
  return 'Gerente'
}

function buildCardUrl(baseUrl: string, slug?: string | null) {
  const safeSlug = String(slug || '').trim().toLowerCase()
  if (!safeSlug) return ''
  return `${baseUrl}?slug=${encodeURIComponent(safeSlug)}`
}

export default function SeletorCartaoClient({ cards, cartaoBaseUrl }: SeletorCartaoClientProps) {
  const [selectedId, setSelectedId] = useState(cards[0]?.entity.id || '')

  const selectedCard = useMemo(
    () => cards.find((card) => card.entity.id === selectedId) || cards[0] || null,
    [cards, selectedId],
  )

  const cartaoUrl = buildCardUrl(cartaoBaseUrl, selectedCard?.entity.commercial_slug)

  function openCard() {
    if (!cartaoUrl) return
    window.open(cartaoUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="page-content" style={{ maxWidth: '760px', margin: '0 auto', paddingBottom: '2rem' }}>
      <div className="card" style={{ padding: '1.5rem', borderRadius: '20px', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, color: 'var(--brs-navy)' }}>Preview Real</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--brs-gray-600)' }}>
              Selecione a entidade comercial para gerar o link exato do cartão público.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '0.9rem', marginTop: '1.25rem' }}>
          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--brs-gray-700)', textTransform: 'uppercase' }}>
              Entidade Comercial
            </span>
            <select
              className="form-control"
              value={selectedCard?.entity.id || ''}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={!cards.length}
            >
              {!cards.length ? <option value="">Nenhuma entidade disponível</option> : null}
              {cards.map((card) => {
                const slug = String(card.entity.commercial_slug || '').trim().toLowerCase()
                return (
                  <option key={card.entity.id} value={card.entity.id}>
                    {card.entity.name} - {getRoleLabel(card.entity.role)}
                    {slug ? ` (${slug}.brspromotora.com.br)` : ' (sem slug)'}
                  </option>
                )
              })}
            </select>
          </label>

          <div
            style={{
              padding: '1rem',
              borderRadius: '16px',
              border: '1px solid var(--brs-gray-200)',
              background: 'var(--brs-gray-50)',
              display: 'grid',
              gap: '0.7rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase' }}>
                Link do cartão
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--brs-navy)', wordBreak: 'break-all' }}>
                {cartaoUrl || 'Selecione uma entidade para gerar o link'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={openCard} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <ExternalLink size={16} />
                Abrir cartão
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
