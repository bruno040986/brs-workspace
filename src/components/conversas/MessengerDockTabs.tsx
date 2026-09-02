'use client'

import { useEffect, useState } from 'react'
import { Cake, Headset, Megaphone, MessagesSquare, Star } from 'lucide-react'
import { GoogleChatComponent } from '@/app/(dashboard)/theme/GoogleChatComponent'
import { podeAtenderConversas } from '@/lib/central-conversas/actions'
import AtendimentoCompacto from './atendimento/AtendimentoCompacto'
import AniversariosTab from './AniversariosTab'
import { ComunicadosBoardWidget } from '@/components/comunicados/ComunicadosBoardWidget'
import PraiseBoard from '@/app/(dashboard)/_components/PraiseBoard'

type Aba = 'interno' | 'atendimento' | 'comunicados' | 'elogios' | 'aniversarios'

/**
 * BRS Messenger = polo social do Workspace (layout aprovado 02/09/2026):
 * Interno (chat da equipe) · Atendimento (Chatwoot, permissão `conversas`) ·
 * Comunicados · Elogios · 🎂 Aniversários. As abas sociais carregam sob
 * demanda para não pesar o dock. A borda superior de cada aba usa a cor da
 * sua notificação no trilho (vermelho/verde/amarelo/azul/roxo).
 */
export default function MessengerDockTabs() {
  const [aba, setAba] = useState<Aba>('interno')
  const [podeAtender, setPodeAtender] = useState(false)
  const [abertas, setAbertas] = useState<Set<Aba>>(new Set(['interno']))

  useEffect(() => {
    podeAtenderConversas().then(setPodeAtender).catch(() => setPodeAtender(false))
  }, [])

  // O trilho e o balão de aniversariante podem pedir uma aba específica.
  useEffect(() => {
    const handler = (e: Event) => {
      const alvo = (e as CustomEvent<{ aba?: Aba }>).detail?.aba
      if (!alvo) return
      if (alvo === 'atendimento' && !podeAtender) return
      trocar(alvo)
    }
    window.addEventListener('brs-messenger-abrir-aba', handler)
    return () => window.removeEventListener('brs-messenger-abrir-aba', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeAtender])

  function trocar(nova: Aba) {
    setAba(nova)
    setAbertas((prev) => {
      if (prev.has(nova)) return prev
      const s = new Set(prev)
      s.add(nova)
      return s
    })
  }

  const abas: Array<{ id: Aba; rotulo: string; Icone: typeof MessagesSquare; cor: string; visivel: boolean }> = [
    { id: 'interno', rotulo: 'Interno', Icone: MessagesSquare, cor: '#cc0000', visivel: true },
    { id: 'atendimento', rotulo: 'Atend.', Icone: Headset, cor: '#25D366', visivel: podeAtender },
    { id: 'comunicados', rotulo: 'Comun.', Icone: Megaphone, cor: '#f2b50c', visivel: true },
    { id: 'elogios', rotulo: 'Elogios', Icone: Star, cor: '#0284c7', visivel: true },
    { id: 'aniversarios', rotulo: '🎂', Icone: Cake, cor: '#8b5cf6', visivel: true },
  ]
  const visiveis = abas.filter((a) => a.visivel)

  return (
    <div className="brs-messenger" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--msn-shell-bg)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${visiveis.length}, 1fr)`,
          gap: 4,
          padding: '6px 6px 0',
          background: 'var(--msn-header-bg)',
          borderBottom: '1px solid var(--msn-border)',
          flexShrink: 0,
        }}
      >
        {visiveis.map(({ id, rotulo, Icone, cor }) => (
          <button
            key={id}
            type="button"
            onClick={() => trocar(id)}
            data-brs-messenger-ignore-close="true"
            title={rotulo}
            style={{
              background: aba === id ? 'var(--msn-tab-active-bg)' : 'var(--msn-tab-bg)',
              border: '1px solid var(--msn-border)',
              borderTop: `3px solid ${cor}`,
              borderBottom: 'none',
              borderRadius: '7px 7px 0 0',
              color: aba === id ? 'var(--msn-tab-active-text)' : 'var(--msn-header-text)',
              fontWeight: 700,
              fontSize: 11.5,
              padding: '6px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            {id === 'aniversarios' ? '🎂' : (
              <>
                <Icone size={13} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo}</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: aba === 'interno' ? 'block' : 'none' }}>
        <GoogleChatComponent variant="dock" />
      </div>
      {podeAtender && abertas.has('atendimento') && (
        <div style={{ flex: 1, minHeight: 0, display: aba === 'atendimento' ? 'block' : 'none' }} className="brs-messenger">
          <AtendimentoCompacto />
        </div>
      )}
      {abertas.has('comunicados') && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: aba === 'comunicados' ? 'block' : 'none', background: 'var(--msn-surface)', padding: '0.6rem' }}>
          <ComunicadosBoardWidget />
        </div>
      )}
      {abertas.has('elogios') && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: aba === 'elogios' ? 'block' : 'none', background: 'var(--msn-surface)', padding: '0.6rem' }}>
          <PraiseBoard />
        </div>
      )}
      {abertas.has('aniversarios') && (
        <div style={{ flex: 1, minHeight: 0, display: aba === 'aniversarios' ? 'block' : 'none' }}>
          <AniversariosTab />
        </div>
      )}
    </div>
  )
}
