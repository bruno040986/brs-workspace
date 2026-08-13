export type HubBannerRecord = {
  id?: string
  title: string
  image_url: string
  storage_path?: string | null
  display_seconds: number
  starts_at?: string | null
  ends_at?: string | null
  sort_order?: number
  is_active?: boolean
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export const HUB_BANNER_MIN_SECONDS = 1
export const HUB_BANNER_MAX_SECONDS = 600
export const HUB_BANNER_DEFAULT_SECONDS = 8

export function normalizeHubBannerTitle(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeHubBannerSeconds(value: unknown) {
  const seconds = Math.round(Number(value))
  if (!Number.isFinite(seconds)) return HUB_BANNER_DEFAULT_SECONDS
  return Math.min(HUB_BANNER_MAX_SECONDS, Math.max(HUB_BANNER_MIN_SECONDS, seconds))
}

// Vigência: limites nulos significam "sem restrição" naquele lado.
export function isHubBannerWithinSchedule(banner: Pick<HubBannerRecord, 'starts_at' | 'ends_at'>, now: Date = new Date()) {
  const time = now.getTime()
  if (banner.starts_at && time < new Date(banner.starts_at).getTime()) return false
  if (banner.ends_at && time > new Date(banner.ends_at).getTime()) return false
  return true
}
