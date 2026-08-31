import Image from 'next/image'
import { requirePermission } from '@/lib/auth/server'
import AtendimentoCompleto from '@/components/conversas/atendimento/AtendimentoCompleto'

export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  await requirePermission('conversas', 'can_view')
  return (
    <div className="page-container brs-messenger" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px - 2rem)', minHeight: 520 }}>
      <div
        style={{
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 16px',
          borderRadius: 10,
          border: '1px solid var(--msn-border)',
          background: 'linear-gradient(180deg, var(--msn-shell-inset) 0%, var(--msn-header-bg) 55%, var(--msn-tab-bg) 100%)',
          boxShadow: 'inset 0 1px 0 var(--msn-inset-highlight)',
        }}
      >
        <Image
          src="/logotipos/logo-brs-messenger-fundo-claro.png"
          alt="BRS Messenger"
          width={42}
          height={42}
          className="brs-messenger-dock-rail-brand-logo-light"
          style={{ height: 42, width: 'auto' }}
        />
        <Image
          src="/logotipos/logo-brs-messenger-fundo-escuro.png"
          alt="BRS Messenger"
          width={42}
          height={42}
          className="brs-messenger-dock-rail-brand-logo-dark"
          style={{ height: 42, width: 'auto' }}
        />
        <div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--msn-header-text)', letterSpacing: '-0.01em', textShadow: '0 1px 0 var(--msn-inset-highlight)' }}>
            Central de Conversas
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--msn-muted)', marginTop: 1 }}>
            WhatsApp, Telegram, Instagram, Facebook e Chat do Site no mesmo lugar.
          </div>
        </div>
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0, padding: 0, overflow: 'hidden', border: '1px solid var(--msn-border)' }}>
        <AtendimentoCompleto />
      </div>
    </div>
  )
}
