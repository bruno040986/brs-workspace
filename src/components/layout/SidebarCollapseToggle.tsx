'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const STORAGE_KEY = 'workspace-sidebar-recolhida'
const BODY_CLASS = 'sidebar-recolhida'

/**
 * Botão global para recolher/expandir a sidebar dos subsistemas.
 * Só aparece (via CSS :has) nas páginas que renderizam .rh-layout-container;
 * a preferência persiste por navegador.
 */
export default function SidebarCollapseToggle() {
  const [recolhida, setRecolhida] = useState(false)

  useEffect(() => {
    let inicial = false
    try {
      inicial = window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // localStorage indisponível: começa expandida.
    }
    setRecolhida(inicial)
    document.body.classList.toggle(BODY_CLASS, inicial)
  }, [])

  function toggle() {
    const proxima = !recolhida
    setRecolhida(proxima)
    document.body.classList.toggle(BODY_CLASS, proxima)
    try {
      window.localStorage.setItem(STORAGE_KEY, proxima ? '1' : '0')
    } catch {
      // Sem persistência, só alterna nesta aba.
    }
  }

  return (
    <button
      type="button"
      className="sidebar-collapse-btn"
      onClick={toggle}
      title={recolhida ? 'Mostrar menu lateral' : 'Recolher menu lateral'}
      aria-label={recolhida ? 'Mostrar menu lateral' : 'Recolher menu lateral'}
    >
      {recolhida ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
    </button>
  )
}
