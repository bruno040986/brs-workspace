'use client'

import { useEffect } from 'react'
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'

/** Painel lateral (não modal: o formulário e a barra de ações seguem clicáveis) com o preview do rascunho salvo. */
export default function PreviewPainel({
  url,
  chave,
  dirty,
  recarregando,
  onRecarregar,
  onNovoLink,
  onFechar,
}: {
  url: string
  /** Muda a cada link novo: remonta o iframe. */
  chave: number
  dirty: boolean
  recarregando: boolean
  onRecarregar: () => void
  /** Pede o link à action (reaproveitado se ainda válido). Útil se o iframe mostrar "token inválido". */
  onNovoLink: () => void
  onFechar: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  return (
    <aside
      aria-label="Preview da landing page"
      style={{
        position: 'fixed',
        top: 'var(--header-height, 0px)',
        right: 0,
        bottom: 0,
        width: 'min(100%, 480px)',
        zIndex: 90,
        background: 'var(--brs-surface)',
        borderLeft: '1px solid var(--brs-gray-200)',
        boxShadow: '-8px 0 24px rgba(15,23,42,0.15)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--brs-gray-200)', display: 'grid', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <strong>Preview</strong>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onRecarregar} disabled={recarregando} aria-label="Recarregar preview">
              {recarregando ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onNovoLink} disabled={recarregando} title="Use se o preview mostrar erro de token inválido">
              Gerar novo link
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink size={14} /> Abrir em nova aba
            </a>
            <button type="button" className="btn btn-outline btn-sm" onClick={onFechar} aria-label="Fechar preview">
              <X size={14} />
            </button>
          </div>
        </div>
        <div style={{ fontSize: '0.8rem', color: dirty ? '#b45309' : 'var(--brs-gray-600)' }}>
          O preview mostra o rascunho salvo.{dirty ? ' Você tem alterações não salvas: salve para vê-las aqui.' : ''}
        </div>
      </div>
      <iframe key={chave} src={`${url}&t=${chave}`} title="Preview da landing page" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" style={{ flex: 1, width: '100%', border: 0, background: '#fff' }} />
    </aside>
  )
}
