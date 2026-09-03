'use client'

/**
 * Logotipo oficial da Nuvidio nos títulos do subsistema — sensível ao tema:
 *   claro  → /logotipos/nuvidio-tema-claro.png
 *   escuro → /logotipos/nuvidio-tema-escuro.png
 * (os dois com fundo transparente, salvos pelo Bruno). Enquanto o arquivo do
 * tema atual não existir, cai no fallback ícone + texto — nada quebra.
 * Detecção de tema pelo data-theme do <html> (mesmo padrão do HubHeader).
 */
import { useEffect, useState } from 'react'
import { Video } from 'lucide-react'

export default function NuvidioLogo({ sufixo, altura = 52 }: { sufixo?: string; altura?: number }) {
  // sufixo sem travessão (pedido do Bruno): o logotipo já separa visualmente
  const sufixoLimpo = (sufixo || '').replace(/^[—–-]\s*/, '')
  const [semLogo, setSemLogo] = useState(false)
  const [temaEscuro, setTemaEscuro] = useState(false)

  useEffect(() => {
    const atualizar = () => {
      setTemaEscuro(document.documentElement.getAttribute('data-theme') === 'dark')
      setSemLogo(false) // troca de tema re-tenta o arquivo do outro tema
    }
    atualizar()
    const observer = new MutationObserver(atualizar)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const src = temaEscuro ? '/logotipos/nuvidio-tema-escuro.png' : '/logotipos/nuvidio-tema-claro.png'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {semLogo ? (
        <>
          <Video size={22} /> Nuvidio
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src} /* troca de tema recarrega e re-tenta o arquivo */
          src={src}
          alt="Nuvidio"
          style={{ height: altura, width: 'auto', display: 'block' }}
          onError={() => setSemLogo(true)}
          onLoad={() => setSemLogo(false)}
        />
      )}
      {sufixoLimpo && <span>{sufixoLimpo}</span>}
    </span>
  )
}
