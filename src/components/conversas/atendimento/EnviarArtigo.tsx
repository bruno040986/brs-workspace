'use client'

import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { artigosParaEnviar } from '@/lib/central-conversas/ajuda-actions'

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Botão "Enviar artigo" do composer (D5): busca por título nos artigos publicados e insere o link no texto. */
export default function EnviarArtigo({ onInserir, onErro }: { onInserir: (link: string) => void; onErro: (mensagem: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [artigos, setArtigos] = useState<Array<{ id: number; titulo: string; url: string }> | null>(null)
  const [busca, setBusca] = useState('')

  async function abrir() {
    const vai = !aberto
    setAberto(vai)
    if (!vai || artigos) return
    const r = await artigosParaEnviar().catch(() => ({ ok: false as const, error: 'Falha ao carregar artigos.' }))
    if (r.ok) setArtigos(r.artigos)
    else {
      setAberto(false)
      onErro(r.error)
    }
  }

  const filtrados = (artigos || []).filter((a) => semAcento(a.titulo).includes(semAcento(busca))).slice(0, 8)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="brs-messenger-toolbar-btn" onClick={() => void abrir()} title="Enviar artigo da central de ajuda">
        <BookOpen size={13} />
      </button>
      {aberto && (
        <div className="brs-messenger" style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 60, padding: 6, width: 280, background: 'var(--msn-surface)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
          <input className="brs-messenger-search-input" placeholder="Buscar artigo pelo título…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
          {!artigos ? (
            <div style={{ padding: 6, fontSize: 12 }}>Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div style={{ padding: 6, fontSize: 12, color: 'var(--msn-muted)' }}>{artigos.length ? 'Nenhum artigo encontrado.' : 'Nenhum artigo publicado (Central de Conversas › Central de ajuda).'}</div>
          ) : (
            filtrados.map((a) => (
              <button key={a.id} type="button" onClick={() => { onInserir(a.url); setAberto(false); setBusca('') }} style={{ display: 'block', width: '100%', padding: '6px 8px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}>
                {a.titulo}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
