'use client'

/**
 * Botão flutuante "Reportar problema" — SÓ no Workspace (layout do
 * dashboard). Abre o mesmo formulário da página /helpdesk em modo rápido:
 * sistema 'workspace', tela atual e contexto técnico do navegador já
 * capturados. Some na própria /helpdesk e para quem não tem helpdesk-abrir.
 * Fica acima do trilho do Messenger (respeita --brs-messenger-dock-reserve).
 */
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LifeBuoy } from 'lucide-react'
import NovoTicketModal, { areaDaRota } from '@/components/helpdesk/NovoTicketModal'
import { carregarMinhasPermissoes } from '@/lib/auth/permissions-client-cache'
import { hasPermission } from '@/lib/auth/permissions'
import type { HelpdeskContextoTecnico } from '@/lib/helpdesk/tipos'

export default function BotaoReportarProblema() {
  const pathname = usePathname() || '/'
  const [pode, setPode] = useState(false)
  const [aberto, setAberto] = useState<{ contexto: HelpdeskContextoTecnico; menu: string; area: string } | null>(null)
  const [enviado, setEnviado] = useState(false)
  const botao = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let ativo = true
    carregarMinhasPermissoes().then((perms) => ativo && setPode(hasPermission(perms, 'helpdesk-abrir', 'can_include')))
    return () => {
      ativo = false
    }
  }, [])

  if (!pode || pathname === '/helpdesk' || pathname.startsWith('/helpdesk/')) return null

  function abrir() {
    setEnviado(false)
    setAberto({
      ...areaDaRota(pathname),
      contexto: {
        url: window.location.href,
        pathname,
        titulo: document.title,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp_cliente: new Date().toISOString(),
      },
    })
  }

  function fechar() {
    setAberto(null)
    botao.current?.focus()
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={abrir}
        aria-label="Reportar problema ao HelpDesk"
        title={enviado ? 'Ticket aberto! Acompanhe em HelpDesk.' : 'Reportar problema'}
        className="btn btn-outline"
        style={{
          position: 'fixed',
          bottom: 16,
          right: 'calc(16px + var(--brs-messenger-dock-reserve, 0px))',
          zIndex: 90, // = --z-dock: abaixo do header e dos modais
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          borderRadius: 99,
          padding: '0.4rem 0.8rem',
          fontSize: '0.78rem',
          background: 'var(--brs-surface)',
          boxShadow: '0 4px 14px rgba(15, 35, 71, 0.18)',
          opacity: 0.92,
        }}
      >
        <LifeBuoy size={15} aria-hidden /> {enviado ? 'Ticket aberto ✓' : 'Reportar problema'}
      </button>
      {aberto && <NovoTicketModal rapido={aberto} onFechar={fechar} onCriado={() => setEnviado(true)} />}
    </>
  )
}
