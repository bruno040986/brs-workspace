export type ChatAttachment = {
  name?: string
  url?: string
  size?: number
  type?: string
  path?: string
}

export const CHAT_ATTACHMENT_BUCKET = 'workspace-chat'
export const CHAT_SIGNED_URL_TTL = 60 * 60 // 1h

// Deriva o path no bucket a partir do anexo. Novos anexos guardam `path`;
// anexos antigos guardam a URL pública, então extraímos o path dela.
export function chatAttachmentPath(att: ChatAttachment | null | undefined): string | null {
  if (!att) return null
  if (att.path) return String(att.path)
  const url = String(att.url || '')
  const marker = `/${CHAT_ATTACHMENT_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]) || null
}
