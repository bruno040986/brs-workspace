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

function IconeCanalBadge({ canal, tamanhoAvatar }: { canal?: string | null; tamanhoAvatar: number }) {
  const tipo = (canal || 'whatsapp').toLowerCase()
  const badgeSize = Math.max(12, Math.round(tamanhoAvatar * 0.36))
  const iconSize = Math.max(8, Math.round(badgeSize * 0.65))

  let bg = '#25D366'
  if (tipo.includes('telegram')) bg = '#0088cc'
  else if (tipo.includes('instagram')) bg = '#e1306c'
  else if (tipo.includes('facebook')) bg = '#1877f2'
  else if (tipo.includes('web') || tipo.includes('site') || tipo.includes('widget')) bg = '#4f46e5'

  return (
    <span
      style={{
        position: 'absolute',
        bottom: -1,
        right: -1,
        width: badgeSize,
        height: badgeSize,
        borderRadius: 99,
        background: bg,
        color: '#ffffff',
        display: 'grid',
        placeItems: 'center',
        border: '1.5px solid var(--msn-surface, #ffffff)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        zIndex: 2,
      }}
      title={canal || 'WhatsApp'}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 001.333 4.993L2 22l5.233-1.237a9.96 9.96 0 004.779 1.221h.004c5.505 0 9.988-4.478 9.989-9.984 0-2.669-1.038-5.176-2.925-7.062A9.925 9.925 0 0012.012 2z" />
      </svg>
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

