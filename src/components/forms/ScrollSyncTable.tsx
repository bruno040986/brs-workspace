'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Wrapper para tabelas largas: barra de rolagem horizontal ADICIONAL no topo,
 * sincronizada com a de baixo, e cabeçalho fixo (sticky) na rolagem vertical.
 * Assim o operador rola para o lado sem perder o cabeçalho, de qualquer ponto.
 *
 * Uso: <ScrollSyncTable><table className="data-table">...</table></ScrollSyncTable>
 */
export default function ScrollSyncTable({ children, maxHeight }: { children: ReactNode; maxHeight?: string | number }) {
  const topRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [scrollWidth, setScrollWidth] = useState(0)
  const syncing = useRef(false)

  // Mantém a largura do "trilho" de cima igual à largura real da tabela.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const update = () => setScrollWidth(body.scrollWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(body)
    const table = body.querySelector('table')
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [children])

  function sync(from: HTMLDivElement | null, to: HTMLDivElement | null) {
    if (!from || !to || syncing.current) return
    syncing.current = true
    to.scrollLeft = from.scrollLeft
    syncing.current = false
  }

  return (
    <div className="scroll-sync-table">
      <div ref={topRef} className="scroll-sync-table__top" onScroll={() => sync(topRef.current, bodyRef.current)}>
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div
        ref={bodyRef}
        className="scroll-sync-table__body"
        style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
        onScroll={() => sync(bodyRef.current, topRef.current)}
      >
        {children}
      </div>
    </div>
  )
}
