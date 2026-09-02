'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, X, ZoomIn, ZoomOut } from 'lucide-react'

export type DocumentViewerFile = { fileName?: string | null; url: string }

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.5

function isImageFile(file: DocumentViewerFile) {
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(file.url) || /\.(png|jpe?g|gif|webp)$/i.test(file.fileName || '')
}

function isPdfFile(file: DocumentViewerFile) {
  return /\.pdf(\?|$)/i.test(file.url) || /\.pdf$/i.test(file.fileName || '')
}

/**
 * Segurança (XSS): URLs de documento vêm de dados enviados pelo parceiro —
 * só renderizamos schemes http(s). Qualquer outra coisa (javascript:, data:)
 * vira string vazia e o viewer mostra o aviso de documento indisponível.
 */
function safeHttpUrl(url: string | null | undefined): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw, window.location.origin)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
  } catch { /* inválida */ }
  return ''
}

function ImageZoomModal({ file, onClose }: { file: DocumentViewerFile; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}
      onClick={onClose}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-acao"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Diminuir zoom"
        >
          <ZoomOut size={18} color="#fff" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-acao"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Aumentar zoom"
        >
          <ZoomIn size={18} color="#fff" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={onClose} aria-label="Fechar ampliação">
          <X size={18} color="#fff" />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: zoom === 1 ? 'center' : 'flex-start',
          justifyContent: 'center',
          padding: '1rem',
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          e.preventDefault()
          setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + (e.deltaY < 0 ? 0.2 : -0.2))))
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeHttpUrl(file.url)}
          alt={file.fileName || 'Documento'}
          onClick={() => setZoom((z) => (z === ZOOM_MIN ? ZOOM_MIN + 1 : ZOOM_MIN))}
          style={{
            width: zoom === 1 ? undefined : `${zoom * 100}%`,
            maxWidth: zoom === 1 ? '92%' : 'none',
            maxHeight: zoom === 1 ? '90%' : 'none',
            cursor: zoom > ZOOM_MIN ? 'zoom-out' : 'zoom-in',
          }}
        />
      </div>
    </div>
  )
}

export default function DocumentViewer({ files }: { files: DocumentViewerFile[] }) {
  const [index, setIndex] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)

  if (!files || files.length === 0) {
    return <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Nenhum arquivo enviado.</div>
  }

  const safeIndex = Math.min(index, files.length - 1)
  const current = files[safeIndex]

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {files.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-acao"
            disabled={safeIndex === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            aria-label="Arquivo anterior"
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {safeIndex + 1} de {files.length}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-acao"
            disabled={safeIndex === files.length - 1}
            onClick={() => setIndex((i) => Math.min(files.length - 1, i + 1))}
            aria-label="Próximo arquivo"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      <div
        style={{
          position: 'relative',
          border: '1px solid var(--brs-gray-200)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--brs-gray-50)',
        }}
      >
        {isImageFile(current) ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={safeHttpUrl(current.url)}
              alt={current.fileName || 'Documento'}
              onClick={() => setZoomOpen(true)}
              style={{ width: '100%', height: 640, objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
            />
            <button
              type="button"
              className="btn btn-sm btn-acao"
              onClick={() => setZoomOpen(true)}
              aria-label="Ampliar imagem"
              title="Ampliar (zoom)"
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none' }}
            >
              <ZoomIn size={16} />
            </button>
          </>
        ) : isPdfFile(current) ? (
          <iframe src={safeHttpUrl(current.url)} title={current.fileName || 'Documento'} style={{ width: '100%', height: 640, border: 'none' }} />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: 240,
              gap: '0.5rem',
              color: 'var(--brs-gray-500)',
            }}
          >
            <FileText size={28} />
            <span>Pré-visualização indisponível para este tipo de arquivo.</span>
          </div>
        )}
      </div>

      <a
        href={safeHttpUrl(current.url)}
        download={current.fileName || undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-outline btn-sm"
        style={{ justifySelf: 'start' }}
      >
        <Download size={15} />
        Baixar {current.fileName || 'arquivo'}
      </a>

      {zoomOpen && isImageFile(current) && <ImageZoomModal file={current} onClose={() => setZoomOpen(false)} />}
    </div>
  )
}
