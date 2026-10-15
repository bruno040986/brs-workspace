'use client'

import {
  ArrowRight,
  AtSign,
  BadgeCheck,
  BadgeInfo,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  ChevronDown,
  ContactRound,
  ExternalLink,
  FileCheck,
  FileText,
  Globe,
  Headset,
  Landmark,
  Link2,
  Mail,
  MapPin,
  MessageCircleHeart,
  MonitorSmartphone,
  Phone,
  QrCode,
  ScanLine,
  ShieldCheck,
  Star,
  Target,
  Ticket,
  Users,
  X as XIcon,
  type LucideIcon,
} from 'lucide-react'
import { siFacebook, siGmail, siInstagram, siThreads, siTiktok, siWhatsapp, siX, siYoutube, type SimpleIcon } from 'simple-icons'
import { normalizeExternalLink, type CommercialCompanyLinksProfile } from '@/lib/commercial-card'
import type { PublicCommercialCardData, PublicCommercialCardLink } from '@/lib/commercial-card-public'
import { CardActionButtons } from './CardActionButtons'

type PublicCommercialCardProps = {
  slug: string
  entity: PublicCommercialCardData['entity']
  companyProfile: CommercialCompanyLinksProfile | null
  linkedUser: PublicCommercialCardData['linkedUser']
  cardLinks: PublicCommercialCardLink[]
  parent: PublicCommercialCardData['parent']
  superior: PublicCommercialCardData['superior']
  mode?: 'card' | 'links'
  viewport?: 'mobile' | 'desktop'
}

type SocialLinkEntry = {
  label: string
  value: string
  href: string
  iconKey: string
}

type AppLinkEntry = {
  label: string
  value: string
  href: string
  iconKey: string
}

function getRoleLabel(role: PublicCommercialCardData['entity']['role'], sex: string) {
  const female = isFemaleSex(sex)
  if (role === 'superintendente') return 'Superintendente Comercial'
  if (role === 'supervisor') return female ? 'Supervisora Comercial' : 'Supervisor Comercial'
  if (role === 'independente') return 'Comercial Independente'
  return 'Gerente Comercial'
}

// Título do contato do superior pelo cargo REAL dele (o pai de um
// independente pode ser gerente, supervisor ou superintendente).
function getRelationTitle(role: string | null | undefined, sex: Parameters<typeof isFemaleSex>[0]) {
  const female = isFemaleSex(sex)
  if (role === 'superintendente') return female ? 'Fale com a minha Superintendente' : 'Fale com o meu Superintendente'
  if (role === 'gerente') return female ? 'Fale com a minha Gerente' : 'Fale com o meu Gerente'
  return female ? 'Fale com a minha Supervisora' : 'Fale com o meu Supervisor'
}

function getSupportRoleLabel(role: PublicCommercialCardData['entity']['role'], sex: string) {
  const female = isFemaleSex(sex)
  if (role === 'superintendente') return 'Fale com o Superintendente'
  if (role === 'supervisor') return female ? 'Fale com a Supervisora' : 'Fale com o Supervisor'
  return female ? 'Fale com a Supervisora' : 'Fale com o Supervisor'
}

function isFemaleSex(value: string | Record<string, any> | null | undefined) {
  const raw =
    typeof value === 'string'
      ? value
      : value?.sex || value?.gender || value?.sexo || ''
  const normalized = String(raw || '').trim().toLowerCase()
  return normalized === 'f' || normalized === 'feminino' || normalized === 'female' || normalized === 'mulher'
}

function getPublicCardUrl(slug?: string | null) {
  const safeSlug = String(slug || '').trim().toLowerCase()
  if (!safeSlug) return ''
  return `https://${safeSlug}.brspromotora.com.br`
}

function getWhatsAppLink(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return `https://wa.me/55${digits}`
}

function formatBrazilPhoneDisplay(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''

  const normalized = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  const ddd = normalized.slice(0, 2)
  const rest = normalized.slice(2)
  if (!ddd || !rest) return value

  if (rest.length > 8) {
    const first = rest.slice(0, 5)
    const second = rest.slice(5, 9)
    return `(${ddd}) ${first} ${second}`.trim()
  }

  if (rest.length > 4) {
    const first = rest.slice(0, rest.length - 4)
    const second = rest.slice(rest.length - 4)
    return `(${ddd}) ${first} ${second}`.trim()
  }

  return `(${ddd}) ${rest}`.trim()
}

function getCommercialDisplayName(entity?: { cadastral_data?: Record<string, any> | null; name?: string | null } | null) {
  const commercialName = String(entity?.cadastral_data?.commercial_name || '').trim()
  if (commercialName) return commercialName
  return String(entity?.name || '').trim()
}

function getCardLinkIcon(iconKey: string): LucideIcon {
  const key = String(iconKey || 'link').trim().toLowerCase()
  const registry: Record<string, LucideIcon> = {
    link: Link2,
    globe: Globe,
    mail: Mail,
    phone: Phone,
    message: MessageCircleHeart,
    'message-square': MessageCircleHeart,
    file: FileText,
    book: BadgeInfo,
    megaphone: MessageCircleHeart,
    users: Users,
    qr: QrCode,
    external: ExternalLink,
    more: ChevronDown,
    search: BadgeInfo,
    calendar: CalendarDays,
    shield: ShieldCheck,
    bank: Building2,
    briefcase: Briefcase,
    building: Building2,
    camera: Camera,
    car: MonitorSmartphone,
    check: BadgeCheck,
    card: Target,
    download: ArrowRight,
    folder: FileText,
    gift: Star,
    heart: Star,
    image: Camera,
    info: BadgeInfo,
    key: BadgeCheck,
    lock: ShieldCheck,
    pin: MapPin,
    notebook: FileText,
    play: ExternalLink,
    printer: FileText,
    rocket: Target,
    scan: ScanLine,
    share: ExternalLink,
    settings: BadgeInfo,
    shop: Building2,
    star: Star,
    tag: Ticket,
    target: Target,
    ticket: Ticket,
    timer: BadgeInfo,
    trend: BadgeInfo,
    user: ContactRound,
    wifi: BadgeInfo,
    wrench: BadgeInfo,
    x: XIcon,
    threads: AtSign,
    instagram: Camera,
    facebook: Globe,
    linkedin: Briefcase,
    youtube: MonitorSmartphone,
  }
  return registry[key] || Link2
}

function normalizeSocialUrl(value: string) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  return normalizeExternalLink(trimmed)
}

function getBrandIcon(iconKey: string): SimpleIcon | null {
  const key = String(iconKey || '').trim().toLowerCase()
  const registry: Record<string, SimpleIcon> = {
    whatsapp: siWhatsapp,
    gmail: siGmail,
    instagram: siInstagram,
    facebook: siFacebook,
    tiktok: siTiktok,
    youtube: siYoutube,
    x: siX,
    threads: siThreads,
  }
  return registry[key] || null
}

function BrandIcon({
  iconKey,
  size = 18,
  color,
  fallback,
}: {
  iconKey: string
  size?: number
  color?: string
  fallback?: React.ReactNode
}) {
  const icon = getBrandIcon(iconKey)
  if (!icon) return <>{fallback}</>

  const fill = color || `#${icon.hex}`

  return (
    <svg
      role="img"
      aria-label={icon.title}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <title>{icon.title}</title>
      <path d={icon.path} />
    </svg>
  )
}

function getSocialEntries(cardData: Record<string, any>): SocialLinkEntry[] {
  const entries = [
    { key: 'show_instagram', label: 'Instagram', value: cardData.instagram || '', iconKey: 'instagram' },
    { key: 'show_facebook', label: 'Facebook', value: cardData.facebook || '', iconKey: 'facebook' },
    { key: 'show_linkedin', label: 'LinkedIn', value: cardData.linkedin || '', iconKey: 'linkedin' },
    { key: 'show_tiktok', label: 'TikTok', value: cardData.tiktok || '', iconKey: 'tiktok' },
    { key: 'show_threads', label: 'Threads', value: cardData.threads || '', iconKey: 'threads' },
    { key: 'show_x', label: 'X', value: cardData.x || '', iconKey: 'x' },
    { key: 'show_youtube', label: 'YouTube', value: cardData.youtube || '', iconKey: 'youtube' },
    { key: 'show_community', label: 'Comunidade WhatsApp', value: cardData.community || '', iconKey: 'whatsapp' },
  ]

  return entries
    .filter((entry) => !!cardData?.[entry.key])
    .map((entry) => ({
      label: entry.label,
      value: String(entry.value || '').trim(),
      href: normalizeSocialUrl(String(entry.value || '')),
      iconKey: entry.iconKey,
    }))
}

function getCompanySocialEntries(companyProfile: CommercialCompanyLinksProfile | null): AppLinkEntry[] {
  const data = companyProfile?.company_data || {}
  return [
    { label: 'Instagram', value: String(data.instagram || '').trim(), href: normalizeExternalLink(String(data.instagram || '')), iconKey: 'instagram' },
    { label: 'Facebook', value: String(data.facebook || '').trim(), href: normalizeExternalLink(String(data.facebook || '')), iconKey: 'facebook' },
    { label: 'LinkedIn', value: String(data.linkedin || '').trim(), href: normalizeExternalLink(String(data.linkedin || '')), iconKey: 'linkedin' },
    { label: 'TikTok', value: String(data.tiktok || '').trim(), href: normalizeExternalLink(String(data.tiktok || '')), iconKey: 'tiktok' },
    { label: 'YouTube', value: String(data.youtube || '').trim(), href: normalizeExternalLink(String(data.youtube || '')), iconKey: 'youtube' },
    { label: 'Comunidade WhatsApp', value: String(data.whatsapp_community || '').trim(), href: normalizeExternalLink(String(data.whatsapp_community || '')), iconKey: 'whatsapp' },
  ].filter((item) => !!item.value)
}

function getSupportEntries(companyProfile: CommercialCompanyLinksProfile | null): AppLinkEntry[] {
  const data = companyProfile?.company_data || {}
  const supportWhatsApp = String(data.whatsapp_support || '').trim()
  const supportEmail = String(data.email_support || '').trim()
  const items: AppLinkEntry[] = []

  if (supportWhatsApp) {
    items.push({
      label: 'WhatsApp Suporte',
      value: formatBrazilPhoneDisplay(supportWhatsApp) || supportWhatsApp,
      href: getWhatsAppLink(supportWhatsApp) || normalizeExternalLink(supportWhatsApp),
      iconKey: 'whatsapp',
    })
  }

  if (supportEmail) {
    items.push({
      label: 'E-mail Suporte',
      value: supportEmail,
      href: normalizeExternalLink(`mailto:${supportEmail}`),
      iconKey: 'gmail',
    })
  }

  return items
}

function getSiteEntry(companyProfile: CommercialCompanyLinksProfile | null): AppLinkEntry | null {
  const site = String(companyProfile?.company_data?.site || '').trim()
  if (!site) return null
  return {
    label: 'Site Institucional',
    value: site,
    href: normalizeExternalLink(site),
    iconKey: 'link',
  }
}

function getRelationLinks(
  parent: PublicCommercialCardData['parent'],
  superior: PublicCommercialCardData['superior'],
) {
  const items: {
    parent: null | {
      title: string
      href: string
      phone: string
      initials: string
      avatarUrl?: string | null
      displayName: string
      icon: LucideIcon
    }
    superior: null | {
      title: string
      href: string
      phone: string
      initials: string
      avatarUrl?: string | null
      displayName: string
      icon: LucideIcon
    }
  } = {
    parent: null,
    superior: null,
  }

  const parentSlug = String(parent?.commercial_slug || '').trim()
  const parentSex = parent?.cadastral_data || null
  const parentPhone = String(parent?.cadastral_data?.phone_whatsapp || '').trim()
  if (parentSlug) {
    items.parent = {
      title: getRelationTitle(parent?.role, parentSex),
      displayName: getCommercialDisplayName(parent) || 'Contato vinculado',
      href: getPublicCardUrl(parentSlug),
      icon: Briefcase,
      phone: formatBrazilPhoneDisplay(parentPhone) || parentPhone || 'Contato vinculado',
      initials: getInitials(getCommercialDisplayName(parent) || 'C'),
      avatarUrl: parent?.avatar_url || null,
    }
  }

  const superiorSlug = String(superior?.commercial_slug || '').trim()
  const superiorSex = superior?.cadastral_data || null
  const superiorPhone = String(superior?.cadastral_data?.phone_whatsapp || '').trim()
  if (superiorSlug) {
    items.superior = {
      title: getRelationTitle(superior?.role, superiorSex),
      displayName: getCommercialDisplayName(superior) || 'Contato vinculado',
      href: getPublicCardUrl(superiorSlug),
      icon: BriefcaseBusiness,
      phone: formatBrazilPhoneDisplay(superiorPhone) || superiorPhone || 'Contato vinculado',
      initials: getInitials(getCommercialDisplayName(superior) || 'C'),
      avatarUrl: superior?.avatar_url || null,
    }
  }

  return items
}

function getInitials(name: string) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function getPlatformBadge(label: string) {
  const key = String(label || '').trim().toLowerCase()
  const common = {
    width: 46,
    height: 46,
    borderRadius: 14,
    display: 'grid',
    placeItems: 'center',
    boxShadow: '0 10px 18px rgba(15, 23, 42, 0.12)',
    background: '#fff',
  } as const

  if (key === 'instagram') {
    return <div style={{ ...common, background: 'linear-gradient(135deg, #f58529, #dd2a7b 48%, #8134af 78%, #515bd4)' }}>IG</div>
  }
  if (key === 'facebook') {
    return <div style={{ ...common, background: '#1877f2' }}>f</div>
  }
  if (key === 'linkedin') {
    return (
      <div
        style={{
          ...common,
          background: '#0a66c2',
          color: '#fff',
          fontWeight: 900,
          fontSize: '0.95rem',
        }}
      >
        in
      </div>
    )
  }
  if (key === 'tiktok') {
    return <div style={{ ...common, background: '#000' }}>♪</div>
  }
  if (key === 'threads') {
    return <div style={{ ...common, background: '#000' }}>@</div>
  }
  if (key === 'x') {
    return <div style={{ ...common, background: '#000' }}>X</div>
  }
  if (key === 'youtube') {
    return <div style={{ ...common, background: '#ff0000' }}>▶</div>
  }
  if (key === 'comunidade whatsapp') {
    return <div style={{ ...common, background: '#25d366' }}>WA</div>
  }
  return <div style={{ ...common, background: 'linear-gradient(135deg, #2d5cff, #ff5da7)' }}>•</div>
}

function AccordionSection({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="cartao-accordion"
      style={{
        borderRadius: 18,
        background: 'rgba(245, 245, 245, 0.9)',
        border: '1px solid rgba(30, 30, 30, 0.25)',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.05)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '0.95rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.9rem',
          color: '#111111',
          fontWeight: 900,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(0,0,0,0.12)',
              color: '#111111',
              flexShrink: 0,
            }}
          >
            <Icon size={18} />
          </div>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontSize: '1.02rem', lineHeight: 1.2 }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 4, fontSize: '0.76rem', fontWeight: 600, color: '#666' }}>{subtitle}</div> : null}
          </div>
        </div>
        <ChevronDown size={24} className="accordion-chevron" style={{ color: '#666', flexShrink: 0, transition: 'transform 160ms ease' }} />
      </summary>
      <div style={{ padding: '0 0.8rem 0.8rem' }}>{children}</div>
    </details>
  )
}

function LinkRow({
  label,
  value,
  href,
  iconKey,
}: {
  label: string
  value: string
  href?: string
  iconKey: string
}) {
  const inner = (
    <div
      style={{
        width: '100%',
        borderRadius: 14,
        background: '#d9d9d9',
        border: '1px solid rgba(0,0,0,0.2)',
        padding: '0.85rem 0.9rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        color: '#111',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            color: '#111',
            flexShrink: 0,
          }}
        >
          {(() => {
            const Icon = getCardLinkIcon(iconKey)
            return <BrandIcon iconKey={iconKey} size={18} fallback={<Icon size={18} />} />
          })()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: '0.96rem', lineHeight: 1.1 }}>{label}</div>
          <div style={{ marginTop: 3, color: '#222', fontSize: '0.84rem', wordBreak: 'break-word' }}>{value}</div>
        </div>
      </div>
      <ExternalLink size={16} color="#222" style={{ flexShrink: 0 }} />
    </div>
  )

  if (!href || !value) return inner
  return (
    <a href={href} target={href.startsWith('/') ? undefined : '_blank'} rel={href.startsWith('/') ? undefined : 'noopener noreferrer'} style={{ textDecoration: 'none' }}>
      {inner}
    </a>
  )
}

function QuickActionCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(45, 92, 255, 0.12)',
        background: 'rgba(255,255,255,0.88)',
        padding: '0.85rem 0.9rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: '0 10px 22px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(135deg, rgba(170, 94, 199, 0.14), rgba(255, 93, 167, 0.14))',
            color: '#9d59c8',
            flexShrink: 0,
          }}
        >
          <Icon size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: '#111', fontSize: '0.9rem', lineHeight: 1.1 }}>{title}</div>
          <div style={{ marginTop: 2, fontSize: '0.72rem', color: '#666' }}>{subtitle}</div>
        </div>
      </div>
    </div>
  )
}

function SocialTile({
  entry,
}: {
  entry: SocialLinkEntry
}) {
  const content = (
    <div
      style={{
        borderRadius: 16,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.18)',
        minHeight: 64,
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 8px 16px rgba(15, 23, 42, 0.04)',
      }}
    >
      <BrandIcon
        iconKey={entry.iconKey}
        size={28}
        color={
          entry.iconKey === 'whatsapp'
            ? '#25D366'
            : entry.iconKey === 'x'
              ? '#000'
              : undefined
        }
        fallback={getPlatformBadge(entry.label)}
      />
    </div>
  )

  if (!entry.href || !entry.value) return content
  return (
    <a href={entry.href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} title={entry.label}>
      {content}
    </a>
  )
}

function RelationCard({
  entry,
}: {
  entry: { href: string; phone: string; icon: LucideIcon; initials: string; avatarUrl?: string | null; displayName: string }
}) {
  return (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderRadius: 14,
        background: '#d9d9d9',
        border: '1px solid rgba(0,0,0,0.2)',
        padding: '0.75rem 0.85rem',
      }}
      >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 46, height: 46, borderRadius: 999, padding: 2.5, background: 'linear-gradient(135deg, #ff5da7, #2d5cff)', flexShrink: 0 }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: '#fff',
              color: '#fff',
              fontWeight: 900,
              fontSize: '0.76rem',
              overflow: 'hidden',
            }}
          >
            {entry.avatarUrl ? (
              <img src={entry.avatarUrl} alt={entry.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(135deg, rgba(255,93,167,0.1), rgba(45,92,255,0.1))',
                  color: '#2d5cff',
                }}
              >
                {entry.initials || <entry.icon size={18} />}
              </div>
            )}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'grid', gap: 3, fontSize: '0.84rem', color: '#222', wordBreak: 'break-word' }}>
            <span style={{ fontWeight: 800, fontSize: '0.94rem', color: '#111' }}>{entry.displayName}</span>
            <span>{entry.phone}</span>
          </div>
        </div>
      </div>
      <ExternalLink size={16} color="#222" style={{ flexShrink: 0 }} />
    </a>
  )
}

export default function PublicCommercialCard({
  slug,
  entity,
  companyProfile,
  linkedUser,
  cardLinks,
  parent,
  superior,
  mode = 'card',
  viewport = 'mobile',
}: PublicCommercialCardProps) {
  const cardData = (entity.card_data || {}) as Record<string, any>
  const name = String(entity.cadastral_data?.commercial_name || entity.cadastral_data?.full_name || entity.name || 'Cartao Virtual').trim()
  const role = getRoleLabel(entity.role, String(entity.cadastral_data?.sex || ''))
  const whatsapp = String(entity.cadastral_data?.phone_whatsapp || entity.phone_whatsapp || '').trim()
  const email = String(entity.cadastral_data?.email_professional || entity.email_comissao || '').trim()
  const socials = getSocialEntries(cardData)
  const supportEntries = getSupportEntries(companyProfile)
  const companySocialEntries = getCompanySocialEntries(companyProfile)
  const siteEntry = getSiteEntry(companyProfile)
  const relationEntries = getRelationLinks(parent, superior)
  const isLinksMode = mode === 'links'
  const companyLegal = `2026 BRS Promotora de Vendas Ltda. CNPJ: 54.303.453/0001-16 Todos os direitos reservados.`
  const currentYear = new Date().getFullYear()
  const isDesktopViewport = viewport === 'desktop'

  const heroPhoto = entity.photo_url || linkedUser?.avatar_url
  const heroAvatar = heroPhoto ? (
    <img
      src={heroPhoto}
      alt={name}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  ) : (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: '#123a77',
        fontSize: '1.2rem',
        fontWeight: 900,
        background: 'linear-gradient(180deg, rgba(245,248,255,0.98), rgba(233,240,255,0.98))',
      }}
    >
      {getInitials(linkedUser?.name || name)}
    </div>
  )

  return (
    <main
      style={{
        minHeight: '100vh',
        color: '#111',
        background: '#f0ecff',
        position: 'relative',
        overflow: 'hidden',
        padding: '20px 14px 36px',
      }}
    >
      <style>{`
        .cartao-accordion[open] .accordion-chevron { transform: rotate(180deg); }
        .cartao-accordion summary::-webkit-details-marker { display: none; }
        .cartao-accordion summary { user-select: none; }
      `}</style>

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(248,246,255,0.92), rgba(243,238,255,0.82))',
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          width: 112,
          height: 112,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #e51f48, #a435c9 55%, #5d79ff)',
          opacity: 0.92,
          transform: 'skewY(-10deg)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 152,
          right: 16,
          width: 104,
          height: 104,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #9a4ccf, #5d79ff)',
          opacity: 0.88,
          transform: 'skewY(-10deg)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 296,
          left: -6,
          width: 132,
          height: 90,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #e22149, #d6477c)',
          opacity: 0.95,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 520,
          left: 0,
          width: 118,
          height: 118,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #6f55ff, #39b7ff)',
          opacity: 0.82,
          transform: 'skewY(-10deg)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 114,
          right: 0,
          width: 118,
          height: 82,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #c22c8f, #6f55ff)',
          opacity: 0.9,
          transform: 'skewY(-10deg)',
        }}
      />

      <div style={{ position: 'relative', width: '100%', maxWidth: isDesktopViewport ? 760 : 430, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <img
            src="/logotipos/BRS%20PROMOTORA%20LOGO%20DEGRADE%20COM%20LETRA%20PRETA%20SEM%20FUNDO.png"
            alt="BRS Promotora"
            style={{ width: isDesktopViewport ? 240 : 190, height: 'auto', display: 'block' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 14, position: 'relative', zIndex: 1 }}>
          {!isLinksMode ? (
            <section style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
                <div
                  style={{
                    width: `min(100%, ${isDesktopViewport ? 300 : 250}px)`,
                    aspectRatio: '1 / 1',
                    borderRadius: 999,
                    padding: 5,
                    background: 'linear-gradient(135deg, #ff5d78 0%, #c459cf 50%, #6f55ff 100%)',
                    boxShadow: '0 18px 40px rgba(45, 92, 255, 0.10)',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: 999,
                      overflow: 'hidden',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.97), rgba(240,244,255,0.92))',
                    }}
                  >
                    {heroAvatar}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'center', paddingInline: 8 }}>
                <div style={{ fontSize: isDesktopViewport ? 'clamp(2rem, 3.2vw, 3rem)' : 'clamp(1.9rem, 4.7vw, 2.9rem)', lineHeight: 1.02, fontWeight: 900, color: '#111' }}>
                  {name}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    color: 'transparent',
                    background: 'linear-gradient(90deg, #e5638d, #b65ccf, #7f62ff)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                  }}
                >
                  {role}
                </div>
              </div>

              <a
                href={whatsapp ? getWhatsAppLink(whatsapp) : '#'}
                target={whatsapp ? '_blank' : undefined}
                rel={whatsapp ? 'noopener noreferrer' : undefined}
                style={{
                  borderRadius: 12,
                  padding: '0.8rem 0.95rem',
                  background: '#15bf4a',
                  color: '#fff',
                  textDecoration: 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.9rem',
                  boxShadow: '0 10px 20px rgba(21, 191, 74, 0.18)',
                }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(255,255,255,0.18)',
                      flexShrink: 0,
                    }}
                  >
                    <BrandIcon iconKey="whatsapp" size={18} color="#fff" fallback={<MessageCircleHeart size={18} />} />
                  </div>
                  <div style={{ minWidth: 0, fontWeight: 900, fontSize: '1.02rem' }}>WhatsApp</div>
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, opacity: 0.96, whiteSpace: 'nowrap' }}>
                  {formatBrazilPhoneDisplay(whatsapp) || '(61) 99955 1641'}
                </div>
                <ExternalLink size={18} style={{ flexShrink: 0 }} />
              </a>

              <a
                href={email ? `mailto:${email}` : '#'}
                style={{
                  borderRadius: 12,
                  padding: '0.78rem 0.95rem',
                  background: '#fff',
                  border: '1px solid rgba(0,0,0,0.18)',
                  color: '#111',
                  textDecoration: 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.9rem',
                  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      display: 'grid',
                      placeItems: 'center',
                      background: '#fff',
                      border: '3px solid #ff4f4f',
                      color: '#ff4f4f',
                      flexShrink: 0,
                    }}
                  >
                    <BrandIcon iconKey="gmail" size={17} color="#ff4f4f" fallback={<Mail size={17} />} />
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.08 }}>
                    <div style={{ fontWeight: 900, fontSize: '1.02rem' }}>E-mail</div>
                    <div style={{ fontSize: '0.78rem', color: '#333', wordBreak: 'break-word' }}>
                      {email || 'ketellen.freires@brspromotora.com.br'}
                    </div>
                  </div>
                </div>
                <ExternalLink size={18} style={{ flexShrink: 0 }} />
              </a>

              <AccordionSection icon={MessageCircleHeart} title="Redes Sociais" defaultOpen={false}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 10,
                  }}
                >
                  {socials.map((entry) => (
                    <SocialTile key={entry.label} entry={entry} />
                  ))}
                </div>
              </AccordionSection>

              <CardActionButtons fullName={name} phone={whatsapp} email={email} cardUrl={getPublicCardUrl(slug)} />
            </section>
          ) : null}

          <div
            aria-hidden="true"
            style={{
              height: 4,
              borderRadius: 999,
              background: 'linear-gradient(90deg, #ff5d78, #c459cf, #6f55ff)',
              margin: '0.2rem 2.2rem 0.15rem',
            }}
          />

          <section style={{ display: 'grid', gap: 10 }}>
            <AccordionSection icon={Headset} title="Suporte Operacional" defaultOpen={false}>
              <div style={{ display: 'grid', gap: 10 }}>
                {supportEntries.length ? (
                  supportEntries.map((entry) => <LinkRow key={entry.label} label={entry.label} value={entry.value} href={entry.href} iconKey={entry.iconKey} />)
                ) : (
                  <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444' }}>
                    Nenhum contato de suporte vinculado.
                  </div>
                )}
              </div>
            </AccordionSection>

            <AccordionSection icon={Globe} title="Site">
              {siteEntry ? (
                <LinkRow label={siteEntry.label} value={siteEntry.value} href={siteEntry.href} iconKey={siteEntry.iconKey} />
              ) : (
                <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444' }}>
                  Site não vinculado.
                </div>
              )}
            </AccordionSection>

            <AccordionSection icon={MessageCircleHeart} title="Redes Sociais">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 10,
                }}
              >
                {companySocialEntries.length ? (
                  companySocialEntries.map((entry) => <SocialTile key={entry.label} entry={{ label: entry.label, value: entry.value, href: entry.href, iconKey: entry.iconKey }} />)
                ) : (
                  <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444', gridColumn: '1 / -1' }}>
                    Nenhuma rede social da empresa vinculada.
                  </div>
                )}
              </div>
            </AccordionSection>

            <AccordionSection icon={Link2} title="Links da BRS Promotora">
              <div style={{ display: 'grid', gap: 10 }}>
                {cardLinks.length ? (
                  cardLinks.map((link) => {
                    const Icon = getCardLinkIcon(link.icon_key)
                    const href = normalizeExternalLink(link.destination_url)
                    return (
                      <a
                        key={link.id}
                        href={href}
                        target={href.startsWith('/') ? undefined : '_blank'}
                        rel={href.startsWith('/') ? undefined : 'noopener noreferrer'}
                        style={{
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          borderRadius: 14,
                          background: '#d9d9d9',
                          border: '1px solid rgba(0,0,0,0.2)',
                          padding: '0.85rem 0.9rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <Icon size={18} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900, color: '#111', fontSize: '0.92rem' }}>{link.name}</div>
                            <div style={{ marginTop: 3, fontSize: '0.8rem', color: '#222', wordBreak: 'break-word' }}>{link.destination_url}</div>
                          </div>
                        </div>
                        <ExternalLink size={16} color="#222" style={{ flexShrink: 0 }} />
                      </a>
                    )
                  })
                ) : (
                  <div style={{ padding: '0.9rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444' }}>
                    Nenhum link cadastrado ainda.
                  </div>
                )}
              </div>
            </AccordionSection>

            <AccordionSection icon={Landmark} title="Instituições Financeiras">
              <div style={{ padding: '0.95rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444', lineHeight: 1.6 }}>
                Em breve todos os links dos sistemas das instituições financeiras em um mesmo local.
              </div>
            </AccordionSection>

            <AccordionSection icon={FileCheck} title="Averbadores">
              <div style={{ padding: '0.95rem 1rem', borderRadius: 14, background: '#d9d9d9', border: '1px solid rgba(0,0,0,0.2)', color: '#444', lineHeight: 1.6 }}>
                Em breve todos os links dos sistemas dos averbadores em um mesmo local.
              </div>
            </AccordionSection>

            {relationEntries.parent ? (
              <AccordionSection
                icon={Briefcase}
                title={relationEntries.parent.title}
                defaultOpen={false}
              >
                <RelationCard entry={relationEntries.parent} />
              </AccordionSection>
            ) : null}

            {relationEntries.superior ? (
              <AccordionSection
                icon={BriefcaseBusiness}
                title={relationEntries.superior.title}
                defaultOpen={false}
              >
                <RelationCard entry={relationEntries.superior} />
              </AccordionSection>
            ) : null}
          </section>

          <footer
            style={{
              marginTop: 12,
              display: 'grid',
              justifyItems: 'center',
              gap: 8,
              textAlign: 'center',
              padding: '0.4rem 0 0.2rem',
              color: '#333',
            }}
          >
            <img
              src="/logotipos/BRS%20PROMOTORA%20LOGO%20DEGRADE%20COM%20LETRA%20PRETA%20SEM%20FUNDO.png"
              alt="BRS Promotora"
              style={{ width: 170, height: 'auto', display: 'block' }}
            />
            <div style={{ lineHeight: 1.45, fontSize: '0.92rem' }}>
              {currentYear} BRS Promotora de Vendas Ltda.
              <br />
              CNPJ: 54.303.453/0001-16
              <br />
              Todos os direitos reservados.
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.9rem' }}>
              <a href="/politicas" style={{ color: '#9d59c8' }}>
                Políticas de Privacidade
              </a>
              <a href="/lgpd" style={{ color: '#9d59c8' }}>
                LGPD
              </a>
              <a href="/termos" style={{ color: '#9d59c8' }}>
                Termos de Uso
              </a>
            </div>
          </footer>

          {!isLinksMode ? null : (
            <div
              style={{
                marginTop: 10,
                padding: '0.95rem 1rem',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.88)',
                border: '1px solid rgba(0,0,0,0.15)',
                color: '#444',
                lineHeight: 1.6,
              }}
            >
              O cartão público usa os mesmos dados reais do cadastro para validar o layout final antes do subdomínio definitivo.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
