'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { enviarImagemLanding } from '../../imagens-actions'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 2 * 1024 * 1024

/** Foto da landing: envia para o bucket público e devolve a URL (quem grava é o rascunho). */
export default function FotoUpload({
  convenioId,
  url,
  onChange,
  altura = 200,
}: {
  convenioId: string
  url: string | null | undefined
  onChange: (url: string | null) => void
  altura?: number
}) {
  const input = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return
    setErro(null)
    if (arquivo.size > MAX_BYTES) {
      setErro('Imagem maior que 2 MB.')
      return
    }
    const fd = new FormData()
    fd.append('convenio_id', convenioId)
    fd.append('arquivo', arquivo)
    setEnviando(true)
    try {
      const res = await enviarImagemLanding(fd)
      if (res.success && res.url) onChange(res.url)
      else setErro(res.error || 'Erro ao enviar a foto.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar a foto.')
    } finally {
      setEnviando(false)
      if (input.current) input.current.value = ''
    }
  }

  const escolher = () => input.current?.click()

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: '100%', height: altura, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--brs-gray-200)' }} />
      ) : (
        <button
          type="button"
          onClick={escolher}
          disabled={enviando}
          style={{
            height: altura,
            borderRadius: 10,
            border: '2px dashed var(--brs-gray-200)',
            background: 'var(--brs-gray-50)',
            color: 'var(--brs-gray-600)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          {enviando ? <Loader2 size={22} className="spinner" /> : <ImagePlus size={22} />}
          {enviando ? 'Enviando...' : 'Escolher foto'}
          <span style={{ fontSize: '0.75rem' }}>PNG, JPEG ou WebP, até 2 MB</span>
        </button>
      )}
      {url && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={escolher} disabled={enviando}>
            {enviando ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
            Trocar foto
          </button>
          <button type="button" className="btn btn-outline btn-sm" style={{ color: '#dc2626' }} onClick={() => onChange(null)} disabled={enviando}>
            <Trash2 size={14} />
            Remover
          </button>
        </div>
      )}
      {erro && <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>{erro}</div>}
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => enviar(e.target.files?.[0])} />
    </div>
  )
}
