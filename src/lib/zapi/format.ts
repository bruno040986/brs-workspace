/**
 * Renderização de templates de WhatsApp (isomórfico).
 *
 * - `renderTemplate`: substitui `{{variavel}}` pelos valores do destinatário
 *   (nomes case-insensitive, espaços tolerados). Variável ausente → ''.
 * - `renderPartnerTags`: tags fixas do parceiro usadas pelo fluxo de
 *   boas-vindas e pelo motor SCP (migrado de rh/parceiros/actions.ts).
 */

const TAG_RE = /\{\{\s*([^}]+?)\s*\}\}/g

export function extractTemplateVariables(body: string): string[] {
  const found = new Set<string>()
  String(body || '').replace(TAG_RE, (_m, name) => {
    found.add(String(name).trim())
    return ''
  })
  return Array.from(found)
}

function normalizeKey(key: string): string {
  return String(key || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
}

export function renderTemplate(body: string, variables: Record<string, unknown> | null | undefined): string {
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(variables || {})) {
    map.set(normalizeKey(k), v === null || v === undefined ? '' : String(v))
  }
  return String(body || '').replace(TAG_RE, (_m, name) => {
    const key = normalizeKey(String(name))
    return map.has(key) ? map.get(key)! : ''
  })
}

export type PartnerTagSource = {
  name?: string | null
  fantasy_name?: string | null
  cpf_cnpj?: string | null
  email_comissao?: string | null
  phone_whatsapp?: string | null
  arw_code?: string | null
  temporary_password?: string | null
  google_drive_url?: string | null
  assinafy_signature_url?: string | null
  [key: string]: unknown
}

/** Tags fixas do parceiro: {{name}}, {{fantasy_name}}, {{cpf_cnpj}}, {{email}}, … */
export function renderPartnerTags(
  body: string,
  partner: PartnerTagSource | null | undefined,
  extras: Record<string, unknown> = {},
): string {
  const p = partner || {}
  const vars: Record<string, unknown> = {
    name: p.name || '',
    nome: p.name || '',
    fantasy_name: p.fantasy_name || '',
    fantasia: p.fantasy_name || '',
    cpf_cnpj: p.cpf_cnpj || '',
    email: p.email_comissao || '',
    phone_whatsapp: p.phone_whatsapp || '',
    arw_code: p.arw_code || extras.arw_code || '',
    temporary_password: p.temporary_password || extras.temporary_password || '',
    google_drive_url: p.google_drive_url || '',
    assinafy_signature_url: p.assinafy_signature_url || extras.assinafy_signature_url || '',
    ...extras,
  }
  return renderTemplate(body, vars)
}

/** Monta a mensagem de um botão-lista: título em negrito + corpo + rodapé. */
export function composeButtonMessage(input: { title?: string; message: string; footer?: string }): string {
  const parts: string[] = []
  const title = String(input.title || '').trim()
  const message = String(input.message || '').trim()
  const footer = String(input.footer || '').trim()
  if (title) parts.push(`*${title}*`)
  if (message) parts.push(message)
  if (footer) parts.push(`_${footer}_`)
  return parts.join('\n\n')
}
