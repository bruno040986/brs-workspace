'use client'

/**
 * Bolha de preview no estilo WhatsApp: texto formatado, mídia (imagem /
 * documento / áudio), cartão de contato e botões de resposta.
 */

import { FileText, Music, User, Phone } from 'lucide-react'
import { renderWhatsappHtml } from './whatsapp-format'

export type WhatsappPreviewMedia =
  | { type: 'image'; url?: string; file_name?: string }
  | { type: 'document'; url?: string; file_name?: string; size?: number }
  | { type: 'audio'; url?: string; file_name?: string }

export type WhatsappPreviewProps = {
  body: string
  media?: WhatsappPreviewMedia | null
  contact?: { name: string; phone: string; description?: string } | null
  buttons?: string[] | null
  /** Bolha separada com título/rodapé (mensagem de botão anti-ban). */
  buttonMessage?: { title?: string; message: string; footer?: string } | null
  time?: string
  compact?: boolean
}

function humanSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const bubbleStyle: React.CSSProperties = {
  background: '#DCF8C6',
  color: '#111',
  borderRadius: 10,
  borderTopRightRadius: 2,
  padding: '0.5rem 0.65rem',
  maxWidth: '100%',
  boxShadow: '0 1px 1px rgba(0,0,0,0.12)',
  fontSize: '0.875rem',
  lineHeight: 1.45,
  wordBreak: 'break-word',
  position: 'relative',
}

function Meta({ time }: { time: string }) {
  return (
    <div style={{ textAlign: 'right', fontSize: '0.65rem', color: '#667781', marginTop: 4 }}>
      {time} <span style={{ color: '#53BDEB' }}>✓✓</span>
    </div>
  )
}

export default function WhatsappPreview({ body, media, contact, buttons, buttonMessage, time = '12:34', compact }: WhatsappPreviewProps) {
  const html = renderWhatsappHtml(body || '')
  const hasMain = !!(body && body.trim()) || !!media

  return (
    <div style={{
      background: '#E5DDD5',
      backgroundImage: 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)',
      backgroundSize: '12px 12px',
      padding: compact ? '0.75rem' : '1rem',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      alignItems: 'flex-end',
      minHeight: compact ? 80 : 140,
    }}>
      {hasMain && (
        <div style={{ ...bubbleStyle, width: media ? '85%' : 'auto' }}>
          {media?.type === 'image' && (
            media.url
              ? <img src={media.url} alt={media.file_name || 'imagem'} style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 6, marginBottom: body ? 6 : 0 }} />
              : <div style={{ height: 120, borderRadius: 6, background: 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667781', marginBottom: 6 }}>imagem</div>
          )}
          {media?.type === 'document' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.05)', borderRadius: 6, padding: '6px 8px', marginBottom: body ? 6 : 0 }}>
              <FileText size={22} style={{ color: '#D14545' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.file_name || 'documento'}</div>
                <div style={{ fontSize: '0.7rem', color: '#667781' }}>{humanSize(media.size)}</div>
              </div>
            </div>
          )}
          {media?.type === 'audio' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: body ? 6 : 0 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Music size={14} /></div>
              {media.url ? <audio controls src={media.url} style={{ height: 30, width: 200 }} /> : <div style={{ flex: 1, height: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 2 }} />}
            </div>
          )}
          {body && <div dangerouslySetInnerHTML={{ __html: html }} />}
          <Meta time={time} />
        </div>
      )}

      {contact?.name && (
        <div style={{ ...bubbleStyle, width: '75%' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#cfd8dc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><User size={18} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{contact.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#667781', display: 'flex', gap: 4, alignItems: 'center' }}><Phone size={11} /> {contact.phone}</div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 6, paddingTop: 6, textAlign: 'center', color: '#027EB5', fontSize: '0.8rem', fontWeight: 600 }}>Adicionar aos contatos</div>
          <Meta time={time} />
        </div>
      )}

      {buttonMessage?.message && (
        <div style={{ ...bubbleStyle, width: '85%' }}>
          {buttonMessage.title && <div style={{ fontWeight: 700, marginBottom: 4 }}>{buttonMessage.title}</div>}
          <div dangerouslySetInnerHTML={{ __html: renderWhatsappHtml(buttonMessage.message) }} />
          {buttonMessage.footer && <div style={{ fontSize: '0.75rem', color: '#667781', marginTop: 4 }}>{buttonMessage.footer}</div>}
          <Meta time={time} />
          {(buttons || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {(buttons || []).map((b, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 8, textAlign: 'center', padding: '6px 8px', color: '#027EB5', fontWeight: 600, fontSize: '0.8rem' }}>{b}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
