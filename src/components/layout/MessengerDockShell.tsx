"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, CircleChevronLeft, MessageSquareText, X } from 'lucide-react'
import MessengerDockTabs from '@/components/conversas/MessengerDockTabs'
import { useMessengerDock } from '@/components/layout/MessengerDockContext'

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

  useEffect(() => {
    if (typeof document === 'undefined') return

    const reservedWidth = isMobile
      ? 0
      : dock.isCollapsed
        ? DESKTOP_COLLAPSED_WIDTH + DESKTOP_DOCK_GAP
        : DESKTOP_DOCK_WIDTH + DESKTOP_DOCK_GAP

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
        <span className="brs-messenger-dock-rail-badge-wrap">
          {dock.hasUnread ? <span className="brs-messenger-dock-rail-badge">{Math.min(99, dock.unreadCount)}</span> : null}
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
