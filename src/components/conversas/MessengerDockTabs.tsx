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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--color-line)', flexShrink: 0 }}>
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
            style={{ background: 'none', border: 'none', borderBottom: `2px solid ${aba === id ? 'var(--color-primary)' : 'transparent'}`, color: aba === id ? 'var(--color-primary)' : 'var(--color-ink-subtle)', fontWeight: 700, fontSize: 12.5, padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
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
