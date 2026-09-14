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
  estilo?: CSSProperties
}

/**
 * Avatar com fallback: thumbnail do contato/grupo (`meta.sender.thumbnail`) e,
 * se a URL falhar ao carregar (ou não existir), as iniciais — mesma aparência
 * `--msn-avatar-*` de sempre. Reseta a falha quando a URL do thumbnail muda,
 * para não prender um contato a um avatar quebrado ao trocar de conversa.
 */
export default function AvatarContato({ thumbnail, nome, tamanho, fontSize, quadrado, raio, iconeAlternativo, estilo }: Props) {
  const [falhou, setFalhou] = useState(false)
  // Reseta a falha quando a URL do thumbnail muda (troca de conversa/contato),
  // sem prender o avatar a um erro de uma foto anterior. Ajuste de estado
  // durante a renderização (padrão React p/ "resetar estado quando uma prop
  // muda"), não dentro de um efeito — evita o passe extra de commit.
  const [thumbnailAnterior, setThumbnailAnterior] = useState(thumbnail)
  if (thumbnail !== thumbnailAnterior) {
    setThumbnailAnterior(thumbnail)
    setFalhou(false)
  }

  const mostrarThumbnail = Boolean(thumbnail) && !falhou

  return (
    <span
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: raio ?? (quadrado ? 10 : 99),
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
  )
}
