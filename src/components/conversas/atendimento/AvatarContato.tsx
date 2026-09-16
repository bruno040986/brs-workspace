'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { iniciais } from './types'

type Props = {
  thumbnail?: string | null
  nome?: string | null
  /** Largura/altura do círculo (px). */
  tamanho: number
  /** Tamanho da fonte das iniciais (px). Padrão: `tamanho * 0.36`, igual aos usos de hoje. */
  fontSize?: number
  /** Avatar de grupo (raio menor, "quadrado" arredondado) em vez de contato (círculo). */
  quadrado?: boolean
  /** `borderRadius` explícito — sobrepõe o padrão de `quadrado` quando o ponto de uso de hoje usa um raio próprio (9/10/14). */
  raio?: number
  /** Conteúdo alternativo (ex.: ícone de grupo) no lugar das iniciais quando não há thumbnail. */
  iconeAlternativo?: ReactNode
  /** Canal de origem (ex.: 'whatsapp', 'telegram', 'site') pra sobrepor o mini-ícone no canto inferior direito. */
  canal?: string | null
  exibirIconeCanal?: boolean
  estilo?: CSSProperties
}

export function IconeCanal({ canal, tamanho = 14, estilo }: { canal?: string | null; tamanho?: number; estilo?: CSSProperties }) {
  const tipo = (canal || 'whatsapp').toLowerCase()

  if (tipo.includes('telegram')) {
    return (
      <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...estilo }}>
        <circle cx="12" cy="12" r="12" fill="#24A1DE" />
        <path d="M5.4 11.9L16.8 7.5c0.6-0.2 1.1 0.1 0.9 0.9l-2 9.4c-0.1 0.6-0.5 0.7-1 0.4l-2.9-2.1-1.4 1.3c-0.2 0.2-0.3 0.3-0.6 0.3l0.2-2.9 5.3-4.8c0.2-0.2 0-0.3-0.3-0.1l-6.6 4.1-2.8-0.9c-0.6-0.2-0.6-0.6 0.1-0.9z" fill="#FFFFFF" />
      </svg>
    )
  }

  if (tipo.includes('web') || tipo.includes('site') || tipo.includes('widget')) {
    return (
      <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...estilo }}>
        <circle cx="12" cy="12" r="12" fill="#4F46E5" />
        <path d="M12 6C8.686 6 6 8.686 6 12C6 15.314 8.686 18 12 18C15.314 18 18 15.314 18 12C18 8.686 15.314 6 12 6ZM11 8.083V9.5H13V8.083C14.77 8.448 16.124 9.773 16.45 11.5H14.5V12.5H16.45C16.124 14.227 14.77 15.552 13 15.917V14.5H11V15.917C9.23 15.552 7.876 14.227 7.55 12.5H9.5V11.5H7.55C7.876 9.773 9.23 8.448 11 8.083Z" fill="#FFFFFF" />
      </svg>
    )
  }

  if (tipo.includes('instagram')) {
    return (
      <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...estilo }}>
        <circle cx="12" cy="12" r="12" fill="#E1306C" />
        <path d="M12 7c-2.716 0-3.056.012-4.123.06-1.065.049-1.79.218-2.427.465a4.902 4.902 0 00-1.772 1.153 4.902 4.902 0 00-1.153 1.772c-.247.637-.416 1.363-.465 2.427C2.012 13.944 2 14.284 2 17s.012 3.056.06 4.123c.049 1.065.218 1.79.465 2.427a4.902 4.902 0 001.153 1.772 4.902 4.902 0 001.772 1.153c.637.247 1.363.416 2.427.465C8.944 26.988 9.284 27 12 27s3.056-.012 4.123-.06c1.065-.049 1.79-.218 2.427-.465a4.902 4.902 0 001.772-1.153 4.902 4.902 0 001.153-1.772c.247-.637.416-1.363.465-2.427.048-1.067.06-1.407.06-4.123s-.012-3.056-.06-4.123c-.049-1.065-.218-1.79-.465-2.427a4.902 4.902 0 00-1.153-1.772 4.902 4.902 0 00-1.772-1.153c-.637-.247-1.363-.416-2.427-.465C15.056 7.012 14.716 7 12 7zm0 2.432c2.67 0 2.987.01 4.042.058.976.045 1.505.207 1.858.344.466.182.798.398 1.15.75.351.351.567.683.75 1.15.137.353.3.882.344 1.857.048 1.056.058 1.373.058 4.043s-.01 2.987-.058 4.042c-.045.976-.207 1.505-.344 1.858a3.097 3.097 0 01-.75 1.15 3.097 3.097 0 01-1.15.75c-.353.137-.882.3-1.857.344-1.056.048-1.373.058-4.043.058s-2.987-.01-4.042-.058c-.976-.045-1.505-.207-1.858-.344a3.097 3.097 0 01-1.15-.75 3.097 3.097 0 01-.75-1.15c-.137-.353-.3-.882-.344-1.857-.048-1.056-.058-1.373-.058-4.043s.01-2.987.058-4.042c.045-.976.207-1.505.344-1.858.182-.466.398-.798.75-1.15.351-.351.683-.567 1.15-.75.353-.137.882-.3 1.857-.344 1.055-.048 1.372-.058 4.042-.058zM12 11.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zm0 2a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm5.871-3.121a1.284 1.284 0 11-2.568 0 1.284 1.284 0 012.568 0z" fill="#FFFFFF" />
      </svg>
    )
  }

  // Official WhatsApp Logo
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...estilo }}>
      <circle cx="12" cy="12" r="12" fill="#25D366" />
      <path d="M12.011 4.5a7.5 7.5 0 00-6.47 11.27L4.5 19.5l3.856-1.011A7.498 7.498 0 1012.01 4.5zm4.4 10.638c-.186.523-1.077 1.009-1.488 1.042-.397.032-.916.15-2.997-.69-2.664-1.075-4.364-3.791-4.496-3.968-.133-.177-1.077-1.432-1.077-2.73 0-1.298.677-1.938.918-2.203.24-.265.525-.332.7-.332.176 0 .352.002.505.009.162.008.38-.061.594.453.222.53.754 1.84.82 1.973.067.133.111.288.022.465-.088.177-.133.288-.265.443-.133.155-.28.346-.4.464-.133.133-.272.277-.117.543.155.265.69 1.139 1.481 1.844 1.017.907 1.874 1.187 2.14 1.32.266.133.42.11.576-.067.155-.177.665-.774.842-1.04.177-.265.354-.221.598-.133.244.088 1.55.73 1.816.863.266.133.443.199.509.31.066.11.066.641-.12 1.164z" fill="#FFFFFF" />
    </svg>
  )
}

function IconeCanalBadge({ canal, tamanhoAvatar }: { canal?: string | null; tamanhoAvatar: number }) {
  const badgeSize = Math.max(14, Math.round(tamanhoAvatar * 0.38))

  return (
    <span
      style={{
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: badgeSize,
        height: badgeSize,
        borderRadius: 99,
        display: 'grid',
        placeItems: 'center',
        background: '#ffffff',
        border: '1.5px solid var(--msn-surface, #ffffff)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        zIndex: 2,
      }}
      title={canal || 'WhatsApp'}
    >
      <IconeCanal canal={canal} tamanho={badgeSize - 2} />
    </span>
  )
}

/**
 * Avatar com fallback: thumbnail do contato/grupo (`meta.sender.thumbnail`) e,
 * se a URL falhar ao carregar (ou não existir), as iniciais — mesma aparência
 * `--msn-avatar-*` de sempre. Reseta a falha quando a URL do thumbnail muda,
 * para não prender um contato a um avatar quebrado ao trocar de conversa.
 */
export default function AvatarContato({ thumbnail, nome, tamanho, fontSize, quadrado, raio, iconeAlternativo, canal, exibirIconeCanal = true, estilo }: Props) {
  const [falhou, setFalhou] = useState(false)
  const [thumbnailAnterior, setThumbnailAnterior] = useState(thumbnail)
  if (thumbnail !== thumbnailAnterior) {
    setThumbnailAnterior(thumbnail)
    setFalhou(false)
  }

  const mostrarThumbnail = Boolean(thumbnail) && !falhou

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, width: tamanho, height: tamanho }}>
      <span
        style={{
          width: tamanho,
          height: tamanho,
          borderRadius: raio ?? (quadrado ? 9 : 99),
          background: 'var(--msn-avatar-bg)',
          color: 'var(--msn-avatar-text)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: fontSize ?? Math.round(tamanho * 0.36),
          flexShrink: 0,
          border: '1px solid var(--msn-border)',
          overflow: 'hidden',
          ...estilo,
        }}
      >
        {mostrarThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail as string}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setFalhou(true)}
          />
        ) : (
          (iconeAlternativo ?? iniciais(nome))
        )}
      </span>
      {exibirIconeCanal && <IconeCanalBadge canal={canal} tamanhoAvatar={tamanho} />}
    </span>
  )
}


