'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { fraseCopiavel, textoSpec, type ImagemSlot } from '@/lib/convenios-publico/imagem-specs'

/** Medidas ideais do campo de upload + botão que copia a frase pronta para ChatGPT/Canva. */
export default function ImagemSpecDica({ slot }: { slot: ImagemSlot }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    const texto = fraseCopiavel(slot)
    try {
      await navigator.clipboard.writeText(texto)
    } catch {
      // fallback para contexto sem Clipboard API (http, permissão negada)
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        return
      } finally {
        document.body.removeChild(ta)
      }
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
      <span>{textoSpec(slot)}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ padding: '0 0.4rem', fontSize: '0.75rem', minHeight: 0 }}
        onClick={copiar}
        title="Copia as medidas em uma frase pronta para o ChatGPT ou o Canva"
      >
        {copiado ? <Check size={12} /> : <Copy size={12} />} {copiado ? 'Copiado!' : 'Copiar medidas'}
      </button>
    </span>
  )
}
