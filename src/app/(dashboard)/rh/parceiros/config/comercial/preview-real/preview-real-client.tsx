'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react'
import { type PreviewRealEntity } from './types'
import { COMERCIAL_ROLE_LABELS } from '@/lib/comerciais-hierarquia'

type PreviewRealClientProps = {
  entities: PreviewRealEntity[]
  error?: string | null
}

function buildPublicUrl(entity?: PreviewRealEntity | null) {
  const slug = String(entity?.commercial_slug || '').trim().toLowerCase()
  if (!slug) return ''
  return `https://${slug}.brspromotora.com.br`
}

export default function PreviewRealClient({ entities, error }: PreviewRealClientProps) {
  const [selectedId, setSelectedId] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (selectedId) return
    const firstEntity = entities.find((entity) => String(entity.commercial_slug || '').trim()) || entities[0]
    if (firstEntity) setSelectedId(firstEntity.id)
  }, [entities, selectedId])

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.id === selectedId) || null,
    [entities, selectedId],
  )

  const publicUrl = buildPublicUrl(selectedEntity)
  const linksUrl = publicUrl ? `${publicUrl}/links` : ''
  const hasSlug = !!selectedEntity?.commercial_slug

  async function copyLink(value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Erro ao copiar link do preview real:', err)
    }
  }

  function openLink(value: string) {
    if (!value) return
    window.open(value, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="page-content" style={{ maxWidth: '1180px', margin: '0 auto', paddingBottom: '2rem' }}>
      <div className="card" style={{ padding: '1.5rem', borderRadius: '20px', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, color: 'var(--brs-navy)' }}>Preview Real</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--brs-gray-600)' }}>
              Selecione uma entidade comercial e abra o endereço público real em uma nova janela.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--brs-gray-500)' }}>
            <ShieldCheck size={18} />
            <span style={{ fontSize: '0.9rem' }}>Acesso interno protegido</span>
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.9rem 1rem',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.08)',
              color: '#b91c1c',
              border: '1px solid rgba(239, 68, 68, 0.18)',
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1rem', marginTop: '1.25rem' }}>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--brs-gray-700)', textTransform: 'uppercase' }}>
                Entidade Comercial
              </span>
              <select
                className="form-control"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={!entities.length}
              >
                {!entities.length ? <option value="">Nenhuma entidade disponível</option> : null}
                {entities.map((entity) => {
                  const slug = String(entity.commercial_slug || '').trim().toLowerCase()
                  const roleLabel = COMERCIAL_ROLE_LABELS[entity.role] || entity.role
                  return (
                    <option key={entity.id} value={entity.id}>
                      {entity.name} - {roleLabel}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase' }}>
                    Endereço público
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--brs-navy)', wordBreak: 'break-all' }}>
                    {publicUrl || 'Defina um slug para gerar o link'}
                  </div>
                </div>
                {hasSlug ? (
                  <span
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '999px',
                      background: 'rgba(16, 185, 129, 0.12)',
                      color: '#047857',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Slug pronto
                  </span>
                ) : (
                  <span
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '999px',
                      background: 'rgba(234, 88, 12, 0.12)',
                      color: '#c2410c',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Sem slug
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <a
                  href={publicUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!publicUrl) event.preventDefault()
                  }}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <ExternalLink size={16} />
                  Abrir cartão público
                </a>
                <button type="button" className="btn btn-outline" onClick={() => copyLink(publicUrl)}>
                  <Copy size={16} />
                  {copied ? 'Link copiado' : 'Copiar link'}
                </button>
                <a
                  href={linksUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    if (!linksUrl) event.preventDefault()
                  }}
                  className="btn btn-outline"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Sparkles size={16} />
                  Abrir links
                </a>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '1rem',
              borderRadius: '16px',
              border: '1px solid var(--brs-gray-200)',
              background: 'white',
              display: 'grid',
              gap: '0.6rem',
              alignContent: 'start',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase' }}>
              Resumo
            </div>
            <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.95rem', color: 'var(--brs-gray-700)' }}>
              <div>
                <strong>Nome:</strong> {selectedEntity?.name || '-'}
              </div>
              <div>
                <strong>Cargo:</strong>{' '}
                {selectedEntity ? COMERCIAL_ROLE_LABELS[selectedEntity.role] || selectedEntity.role : '-'}
              </div>
              <div>
                <strong>Status:</strong> {selectedEntity?.status || '-'}
              </div>
              <div>
                <strong>Card público:</strong> {selectedEntity?.card_enabled ? 'Habilitado' : 'Desabilitado'}
              </div>
              <div>
                <strong>Slug:</strong> {selectedEntity?.commercial_slug || '-'}
              </div>
              <div>
                <strong>Link:</strong> {publicUrl || '-'}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: '1rem',
            padding: '0.9rem 1rem',
            borderRadius: '14px',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.14)',
            color: 'var(--brs-gray-700)',
            lineHeight: 1.5,
          }}
        >
          Este espaço serve para validar o endereço público real do cartão antes de fecharmos o layout definitivo.
        </div>
      </div>
    </div>
  )
}
