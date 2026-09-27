'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { separarNumeros, terminouNumero } from '@/lib/central-conversas/numeros'

/**
 * Campo de números (W3): digite ou cole vários; vírgula, ponto e vírgula, Enter ou espaço (depois de
 * 10+ dígitos) transformam o que foi digitado em badge; o "x" remove. `valores` = só dígitos.
 */
export default function NumerosInput({ valores, onChange, placeholder, classe = 'brs-messenger-search-input' }: { valores: string[]; onChange: (v: string[]) => void; placeholder?: string; classe?: string }) {
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  function confirmar(bruto: string) {
    const { validos, invalidos } = separarNumeros(bruto)
    if (validos.length) onChange([...valores, ...validos.filter((v) => !valores.includes(v))])
    setAviso(invalidos.length ? `Ignorado (número inválido): ${invalidos.join(', ')}` : null)
    setTexto('')
  }

  return (
    <div>
      {valores.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {valores.map((v) => (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, padding: '2px 4px 2px 8px', borderRadius: 99, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', color: 'var(--msn-text)' }}>
              +{v}
              <button type="button" onClick={() => onChange(valores.filter((x) => x !== v))} title="Remover" style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', padding: 1, color: 'var(--msn-muted)' }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={classe}
        style={{ width: '100%' }}
        placeholder={placeholder || 'Ex.: 5561999991234 — vários: separe por vírgula ou Enter'}
        value={texto}
        onChange={(e) => {
          const t = e.target.value
          if (terminouNumero(t)) confirmar(t)
          else setTexto(t)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (texto.trim()) confirmar(texto)
          }
        }}
        onBlur={() => texto.trim() && confirmar(texto)}
        onPaste={(e) => {
          const colado = e.clipboardData.getData('text')
          if (/[,;\n]/.test(colado)) {
            e.preventDefault()
            confirmar(texto + colado)
          }
        }}
      />
      {aviso && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{aviso}</div>}
    </div>
  )
}
