'use client'

import { useEffect, useMemo, useState } from 'react'
import { getActiveHubBanners } from '../rh/parceiros/config/provedores/banners/actions'
import {
  HUB_BANNER_DEFAULT_SECONDS,
  isHubBannerWithinSchedule,
  type HubBannerRecord,
} from '@/lib/hub-banners'

const FALLBACK_BANNER = '/banners/banner-inicial-9mm.png'

export default function HubBannerCarousel() {
  const [banners, setBanners] = useState<HubBannerRecord[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Reavaliado a cada troca de slide para derrubar banners com vigência encerrada sem recarregar a página.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    getActiveHubBanners()
      .then((res) => {
        if (cancelled) return
        setBanners(res.success ? ((res.banners || []) as HubBannerRecord[]) : [])
      })
      .catch(() => {
        if (!cancelled) setBanners([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visibleBanners = useMemo(
    () => (banners || []).filter((banner) => isHubBannerWithinSchedule(banner, now)),
    [banners, now],
  )

  const currentIndex = visibleBanners.length ? activeIndex % visibleBanners.length : 0

  useEffect(() => {
    if (visibleBanners.length < 2) return
    const current = visibleBanners[currentIndex]
    const seconds = Number(current?.display_seconds) || HUB_BANNER_DEFAULT_SECONDS
    const timer = window.setTimeout(() => {
      setNow(new Date())
      setActiveIndex((value) => value + 1)
    }, seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [visibleBanners, currentIndex])

  // Antes da resposta do servidor não renderiza nada para evitar piscar o fallback.
  if (banners === null) {
    return <div className="hub-banner" aria-label="Banner principal do Workspace" />
  }

  if (!visibleBanners.length) {
    return (
      <div className="hub-banner" aria-label="Banner principal do Workspace">
        <img
          className="hub-banner-img"
          src={`${FALLBACK_BANNER}?v=${Date.now()}`}
          alt="Banner principal do Workspace"
          loading="eager"
        />
      </div>
    )
  }

  return (
    <div className="hub-banner" aria-label="Banner principal do Workspace">
      {visibleBanners.map((banner, index) => (
        <img
          key={banner.id || index}
          className={`hub-banner-img hub-banner-slide${index === currentIndex ? ' active' : ''}`}
          src={banner.image_url}
          alt={banner.title || 'Banner do Workspace'}
          loading={index === 0 ? 'eager' : 'lazy'}
        />
      ))}
      {visibleBanners.length > 1 && (
        <div className="hub-banner-dots" aria-hidden="true">
          {visibleBanners.map((banner, index) => (
            <button
              key={banner.id || index}
              type="button"
              className={`hub-banner-dot${index === currentIndex ? ' active' : ''}`}
              onClick={() => {
                setNow(new Date())
                setActiveIndex(index)
              }}
              tabIndex={-1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
