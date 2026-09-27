'use client'

import { useState } from 'react'
import { Zap } from 'lucide-react'
import { executarMacro, listarMacrosParaConversa } from '@/lib/central-conversas/macros-actions'

/** Botão "Macro" do cabeçalho (D1): lista as macros do Chatwoot e executa na conversa aberta (execução assíncrona: o efeito aparece em instantes). */
export default function MacroConversa({ conversationId, onResultado, onExecutada }: { conversationId: number; onResultado: (mensagem: string) => void; onExecutada?: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [macros, setMacros] = useState<Array<{ id: number; name: string }> | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function abrir() {
    const vaiAbrir = !aberto
    setAberto(vaiAbrir)
    if (!vaiAbrir || macros) return
    const r = await listarMacrosParaConversa().catch(() => ({ ok: false as const, error: 'Falha ao carregar macros.' }))
    if (r.ok) setMacros(r.macros)
    else {
      setAberto(false)
      onResultado(r.error)
    }
  }

  async function executar(m: { id: number; name: string }) {
    setAberto(false)
    setOcupado(true)
    const r = await executarMacro(m.id, conversationId).catch(() => ({ ok: false as const, error: 'Falha ao comunicar com o servidor.' }))
    setOcupado(false)
    onResultado(r.ok ? `Macro "${m.name}" enviada para execução` : r.error)
    if (r.ok) setTimeout(() => onExecutada?.(), 2500)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => void abrir()} disabled={ocupado} title="Executar macro" className="brs-messenger-toolbar-btn" style={{ width: 34, height: 34 }}>
        <Zap size={15} />
      </button>
      {aberto && (
        <div className="brs-messenger" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, padding: 4, minWidth: 230, maxHeight: 300, overflowY: 'auto', background: 'var(--msn-surface)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
          {!macros ? (
            <div style={{ padding: '6px 10px', fontSize: 12 }}>Carregando…</div>
          ) : macros.length === 0 ? (
            <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--msn-muted)' }}>Nenhuma macro criada (Central de Conversas › Macros).</div>
          ) : (
            macros.map((m) => (
              <button key={m.id} type="button" onClick={() => void executar(m)} style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}>
                {m.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
