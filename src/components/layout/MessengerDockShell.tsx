"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, CircleChevronLeft, MessageSquareText, X } from 'lucide-react'
import MessengerDockTabs from '@/components/conversas/MessengerDockTabs'
import { useMessengerDock } from '@/components/layout/MessengerDockContext'
import { getPraiseUnreadCount } from '@/app/(dashboard)/praises/actions'
import { getMyHubContext } from '@/lib/auth/actions'

const HEADER_HEIGHT = 64
const DESKTOP_DOCK_WIDTH = 392
const DESKTOP_COLLAPSED_WIDTH = 72
const DESKTOP_DOCK_GAP = 16
const MOBILE_BREAKPOINT = 768

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const update = () => setIsMobile(media.matches)

    update()
    if (media.addEventListener) {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }

    media.addListener(update)
    return () => media.removeListener(update)
  }, [])

  return isMobile
}

function shouldIgnoreOutsideClose(target: EventTarget | null, root: HTMLElement | null) {
  if (!target || !(target instanceof Node)) return false
  if (!root) return false
  if (root.contains(target)) return true

  if (!(target instanceof Element)) return false

  const ignoreSelectors = [
    '[data-brs-messenger-ignore-close="true"]',
    '[role="dialog"]',
    '.modal',
    '.modal-backdrop',
    '.popover',
    '.dropdown',
    '[data-radix-popper-content-wrapper]',
    '.brs-messenger-toast-stack',
    '.brs-messenger-notice-card',
  ]

  return ignoreSelectors.some((selector) => Boolean(target.closest(selector)))
}

export function MessengerDockShell() {
  const isMobile = useIsMobile()
  const dock = useMessengerDock()
  const desktopDockRef = useRef<HTMLDivElement | null>(null)
  const mobileSheetRef = useRef<HTMLDivElement | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setIsReady(true))
    return () => window.cancelAnimationFrame(raf)
  }, [])

  // Notificações coloridas do trilho (uma bolinha por aba, cor da borda da
  // aba; some quando zerada) + 🎂 roxo só no dia do aniversário.
  const [comunicadosNaoLidos, setComunicadosNaoLidos] = useState(0)
  const [elogiosNaoLidos, setElogiosNaoLidos] = useState(0)
  const [aniversarianteHoje, setAniversarianteHoje] = useState<{ name: string; avatar_url: string | null } | null>(null)

  useEffect(() => {
    let ativo = true
    async function atualizarSociais() {
      try {
        const res = await fetch('/api/comunicados/board')
        if (res.ok) {
          const data = await res.json()
          const lista = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
          if (ativo) setComunicadosNaoLidos(lista.filter((c: { has_read?: boolean }) => !c.has_read).length)
        }
      } catch { /* silencioso */ }
      try {
        const n = await getPraiseUnreadCount()
        if (ativo && typeof n === 'number') setElogiosNaoLidos(n)
      } catch { /* silencioso */ }
    }
    async function atualizarAniversario() {
      try {
        const ctx = await getMyHubContext()
        if (!ativo || !ctx.success) return
        const hoje = new Date()
        const dia = hoje.getDate()
        const mes = hoje.getMonth() + 1
        const doDia = (ctx.birthdays || []).find((u: { birth_date?: string | null }) => {
          const partes = String(u.birth_date || '').split('-')
          return parseInt(partes[2] || '0', 10) === dia && parseInt(partes[1] || '0', 10) === mes
        }) as { name: string; avatar_url?: string | null } | undefined
        setAniversarianteHoje(doDia ? { name: doDia.name, avatar_url: doDia.avatar_url || null } : null)
      } catch { /* silencioso */ }
    }
    atualizarSociais()
    atualizarAniversario()
    const t = window.setInterval(atualizarSociais, 5 * 60 * 1000)
    return () => {
      ativo = false
      window.clearInterval(t)
    }
  }, [])

  const abrirAba = useCallback(
    (aba: string) => {
      dock.expandDock()
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('brs-messenger-abrir-aba', { detail: { aba } }))
      }, 50)
    },
    [dock],
  )

  useEffect(() => {
    if (typeof document === 'undefined') return

    // Expandido sobrepõe o conteúdo (não comprime): a reserva é sempre a do
    // trilho — decisão do layout aprovado 02/09/2026.
    const reservedWidth = isMobile ? 0 : DESKTOP_COLLAPSED_WIDTH + DESKTOP_DOCK_GAP

    document.documentElement.style.setProperty('--brs-messenger-dock-reserve', `${reservedWidth}px`)

    return () => {
      document.documentElement.style.removeProperty('--brs-messenger-dock-reserve')
    }
  }, [dock.isCollapsed, isMobile])

  useEffect(() => {
    if (isMobile) {
      dock.closeMobileDock()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isMobile) {
        if (!dock.isMobileOpen) return
        if (shouldIgnoreOutsideClose(event.target, mobileSheetRef.current)) return
        dock.closeMobileDock()
        return
      }

      if (dock.isCollapsed) return
      if (shouldIgnoreOutsideClose(event.target, desktopDockRef.current)) return
      dock.collapseDock()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [dock, isMobile])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isMobile && dock.isMobileOpen) {
        dock.closeMobileDock()
      } else if (!isMobile && !dock.isCollapsed) {
        dock.collapseDock()
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [dock, isMobile])

  const desktopRail = useMemo(
    () => (
      <button
        type="button"
        className="brs-messenger-dock-rail"
        onClick={() => dock.expandDock()}
        aria-label="Abrir BRS Messenger"
        title="Abrir BRS Messenger"
      >
        <span className="brs-messenger-rail-badges">
          {dock.hasUnread ? (
            <span
              className="brs-messenger-rail-badge is-interno"
              title={`Chat Interno: ${dock.unreadCount} não lida(s)`}
              onClick={(e) => { e.stopPropagation(); abrirAba('interno') }}
            >
              {Math.min(99, dock.unreadCount)}
            </span>
          ) : null}
          {comunicadosNaoLidos > 0 ? (
            <span
              className="brs-messenger-rail-badge is-comunicados"
              title={`Comunicados: ${comunicadosNaoLidos} novo(s)`}
              onClick={(e) => { e.stopPropagation(); abrirAba('comunicados') }}
            >
              {Math.min(99, comunicadosNaoLidos)}
            </span>
          ) : null}
          {elogiosNaoLidos > 0 ? (
            <span
              className="brs-messenger-rail-badge is-elogios"
              title={`Elogios: ${elogiosNaoLidos} novo(s)`}
              onClick={(e) => { e.stopPropagation(); abrirAba('elogios') }}
            >
              {Math.min(99, elogiosNaoLidos)}
            </span>
          ) : null}
          {aniversarianteHoje ? (
            <span
              className="brs-messenger-rail-badge is-aniversario"
              onClick={(e) => { e.stopPropagation(); abrirAba('aniversarios') }}
            >
              🎂
              <span className="brs-messenger-bday-tip" onClick={(e) => e.stopPropagation()}>
                <span className="brs-messenger-bday-foto">
                  {aniversarianteHoje.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={aniversarianteHoje.avatar_url} alt="" />
                  ) : (
                    aniversarianteHoje.name.charAt(0).toUpperCase()
                  )}
                </span>
                Hoje é aniversário de <b>{aniversarianteHoje.name}</b> — mande uma mensagem parabenizando!
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); abrirAba('interno') }}
                >
                  Abrir chat interno →
                </button>
              </span>
            </span>
          ) : null}
        </span>
        <span className="brs-messenger-dock-rail-brand">
          <img
            src="/logotipos/logotipo-brs-messenger-fundo-escuro.png"
            alt="BRS Messenger"
            className="brs-messenger-dock-rail-brand-logo brs-messenger-dock-rail-brand-logo-light"
          />
          <img
            src="/logotipos/logotipo-brs-messenger-fundo-escuro.png"
            alt="BRS Messenger"
            className="brs-messenger-dock-rail-brand-logo brs-messenger-dock-rail-brand-logo-dark"
          />
        </span>
        <span className="brs-messenger-dock-rail-chevron" aria-hidden="true">
          <CircleChevronLeft size={28} strokeWidth={2.25} />
        </span>
      </button>
    ),
    [dock],
  )

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className={`brs-messenger-fab ${isReady ? 'is-ready' : ''}`}
          data-brs-messenger-ignore-close="true"
          onClick={() => (dock.isMobileOpen ? dock.closeMobileDock() : dock.openMobileDock())}
          aria-label="Abrir BRS Messenger"
        >
          <MessageSquareText size={20} />
          {dock.hasUnread ? <span className="brs-messenger-fab-badge">{Math.min(99, dock.unreadCount)}</span> : null}
        </button>

        <div className={`brs-messenger-mobile-backdrop ${dock.isMobileOpen ? 'is-open' : ''}`} />

        <div className={`brs-messenger-mobile-sheet ${dock.isMobileOpen ? 'is-open' : ''}`} ref={mobileSheetRef}>
          <button type="button" className="brs-messenger-sheet-close-overlay" onClick={() => dock.closeMobileDock()}>
            <X size={18} />
          </button>
          <div className="brs-messenger-dock-content">
            <MessengerDockTabs />
          </div>
        </div>
      </>
    )
  }

  return (
    <aside
      className={`brs-messenger-dock ${isReady ? 'is-ready' : ''} ${dock.isCollapsed ? 'is-collapsed' : 'is-expanded'}`}
      style={{
        top: `${HEADER_HEIGHT}px`,
        width: dock.isCollapsed ? `${DESKTOP_COLLAPSED_WIDTH}px` : `${DESKTOP_DOCK_WIDTH}px`,
      }}
      aria-label="BRS Messenger"
    >
      {dock.isCollapsed ? (
        desktopRail
      ) : (
        <div className="brs-messenger-dock-panel" ref={desktopDockRef}>
          <button
            type="button"
            className="brs-messenger-sheet-close-overlay brs-messenger-sheet-close-overlay--dock"
            onClick={() => dock.collapseDock()}
            aria-label="Recolher BRS Messenger"
            title="Recolher BRS Messenger"
          >
            <ChevronRight size={18} />
          </button>
          <div className="brs-messenger-dock-content">
            <MessengerDockTabs />
          </div>
        </div>
      )}
    </aside>
  )
}
