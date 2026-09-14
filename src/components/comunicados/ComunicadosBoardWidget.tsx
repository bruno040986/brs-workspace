'use client'

import { useEffect, useState } from 'react'
import { pollingVisivel } from '@/lib/polling-visivel'

type BoardComunicado = {
  id: string
  titulo: string
  texto_html: string
  fixo_topo: boolean
  has_read: boolean
  created_at: string
}

export function ComunicadosBoardWidget() {
  const [items, setItems] = useState<BoardComunicado[]>([])
  const [loading, setLoading] = useState(true)

  async function loadItems() {
    try {
      const response = await fetch('/api/comunicados/board')
      const data = await response.json()
      setItems(Array.isArray(data.items) ? data.items : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Comunicado novo chega pelo evento 'comunicados:refresh' (HubHeader, via
    // Realtime); o poll é rede de segurança de 2 min, pausado com a aba oculta.
    const pararPoll = pollingVisivel(loadItems, 2 * 60_000)
    const onRefresh = () => void loadItems()
    window.addEventListener('comunicados:refresh', onRefresh)
    return () => {
      pararPoll()
      window.removeEventListener('comunicados:refresh', onRefresh)
    }
  }, [])

  if (loading) {
    return (
      <div className="widget-card">
        <div className="widget-header">
          <h3 className="widget-title">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--brs-danger)', display: 'inline-block' }} />
            Comunicados
          </h3>
        </div>
        <div className="widget-content" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--brs-gray-400)', margin: 0 }}>Carregando comunicados...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="widget-card">
      <div className="widget-header">
        <h3 className="widget-title">
          <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--brs-danger)', display: 'inline-block' }} />
          Comunicados
        </h3>
      </div>
      <div className="widget-content" style={{ display: 'grid', gap: '0.75rem' }}>
        {items.length === 0 ? (
          <p style={{ fontSize: '0.8125rem', color: 'var(--brs-gray-400)', margin: 0, textAlign: 'center', padding: '1rem 0' }}>
            Nenhum comunicado no momento.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className={`comunicado-card ${item.has_read ? '' : 'is-unread'}`}>
              <div className="comunicado-card-title">{item.titulo}</div>
              <button
                type="button"
                className="comunicado-card-action"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('comunicados:open', {
                      detail: {
                        id: item.id,
                        titulo: item.titulo,
                        texto_html: item.texto_html,
                      },
                    }),
                  )
                }
              >
                Visualizar
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
