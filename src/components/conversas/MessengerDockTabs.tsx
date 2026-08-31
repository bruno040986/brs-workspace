'use client'

import { useEffect, useState } from 'react'
import { Headset, MessagesSquare } from 'lucide-react'
import { GoogleChatComponent } from '@/app/(dashboard)/theme/GoogleChatComponent'
import { podeAtenderConversas } from '@/lib/central-conversas/actions'
import AtendimentoCompacto from './atendimento/AtendimentoCompacto'

/**
 * O BRS Messenger vira a "lataria" da Central de Conversas: aba Interno
 * (chat da equipe, como sempre) + aba Atendimento (Chatwoot: Meus/Fila/Geral)
 * pra quem tem a permissão `conversas`.
 */
export default function MessengerDockTabs() {
  const [aba, setAba] = useState<'interno' | 'atendimento'>('interno')
  const [podeAtender, setPodeAtender] = useState(false)

  useEffect(() => {
    podeAtenderConversas().then(setPodeAtender).catch(() => setPodeAtender(false))
  }, [])

  if (!podeAtender) return <GoogleChatComponent variant="dock" />

  return (
    <div className="brs-messenger" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--msn-shell-bg)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '6px 6px 0', background: 'var(--msn-header-bg)', borderBottom: '1px solid var(--msn-border)', flexShrink: 0 }}>
        {(
          [
            { id: 'interno', rotulo: 'Interno', Icone: MessagesSquare },
            { id: 'atendimento', rotulo: 'Atendimento', Icone: Headset },
          ] as const
        ).map(({ id, rotulo, Icone }) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            data-brs-messenger-ignore-close="true"
            style={{
              background: aba === id ? 'var(--msn-tab-active-bg)' : 'var(--msn-tab-bg)',
              border: '1px solid var(--msn-border)',
              borderBottom: 'none',
              borderRadius: '7px 7px 0 0',
              color: aba === id ? 'var(--msn-tab-active-text)' : 'var(--msn-header-text)',
              fontWeight: 700,
              fontSize: 12.5,
              padding: '7px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Icone size={14} /> {rotulo}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: aba === 'interno' ? 'block' : 'none' }}>
        <GoogleChatComponent variant="dock" />
      </div>
      {aba === 'atendimento' && (
        <div style={{ flex: 1, minHeight: 0 }} className="brs-messenger">
          <AtendimentoCompacto />
        </div>
      )}
    </div>
  )
}
