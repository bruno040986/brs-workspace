'use client'

/**
 * Clima enxuto da home — substitui o iframe do weatherwidget.org (terceiro
 * lento que atrasava o carregamento). Busca a temperatura na API pública do
 * Open-Meteo (sem chave) DEPOIS da página pintar; geolocalização do
 * navegador com fallback para Brasília. Falhou? O pill simplesmente não
 * aparece — clima nunca atrapalha a home.
 */
import { useEffect, useState } from 'react'

const FALLBACK = { lat: -15.78, lon: -47.93, cidade: 'Brasília' }

const CODIGO_ICONE: Array<[Set<number>, string, string]> = [
  [new Set([0]), '☀️', 'Céu limpo'],
  [new Set([1, 2]), '🌤️', 'Parcialmente nublado'],
  [new Set([3]), '☁️', 'Nublado'],
  [new Set([45, 48]), '🌫️', 'Névoa'],
  [new Set([51, 53, 55, 56, 57]), '🌦️', 'Garoa'],
  [new Set([61, 63, 65, 66, 67, 80, 81, 82]), '🌧️', 'Chuva'],
  [new Set([71, 73, 75, 77, 85, 86]), '🌨️', 'Neve'],
  [new Set([95, 96, 99]), '⛈️', 'Tempestade'],
]

function iconeDoCodigo(code: number): { icone: string; rotulo: string } {
  for (const [codigos, icone, rotulo] of CODIGO_ICONE) {
    if (codigos.has(code)) return { icone, rotulo }
  }
  return { icone: '🌡️', rotulo: 'Tempo' }
}

type Clima = { temperatura: number; icone: string; rotulo: string; cidade: string }

/**
 * Nome da cidade via reverse-geocode do BigDataCloud (gratuito, sem chave,
 * feito para chamada direta do navegador). Roda em paralelo com o clima e
 * DEPOIS da pintura — não adiciona nada ao carregamento da home; se falhar,
 * fica o rótulo genérico.
 */
async function nomeDaCidade(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`,
      { cache: 'force-cache' },
    )
    if (!res.ok) return null
    const data = await res.json()
    const cidade = String(data?.city || data?.locality || '').trim()
    const uf = String(data?.principalSubdivisionCode || '').split('-')[1] || ''
    if (!cidade) return null
    return uf ? `${cidade}/${uf}` : cidade
  } catch {
    return null
  }
}

export default function WeatherPill() {
  const [clima, setClima] = useState<Clima | null>(null)

  useEffect(() => {
    let cancelado = false

    async function buscar(lat: number, lon: number, cidadePadrao: string) {
      try {
        // clima e nome da cidade em paralelo — o nome real substitui o rótulo
        const [res, cidadeReal] = await Promise.all([
          fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
            { cache: 'no-store' },
          ),
          nomeDaCidade(lat, lon),
        ])
        if (!res.ok) return
        const data = await res.json()
        const temperatura = Math.round(Number(data?.current?.temperature_2m))
        const code = Number(data?.current?.weather_code)
        if (!Number.isFinite(temperatura)) return
        const { icone, rotulo } = iconeDoCodigo(Number.isFinite(code) ? code : -1)
        if (!cancelado) setClima({ temperatura, icone, rotulo, cidade: cidadeReal || cidadePadrao })
      } catch {
        // sem clima, sem drama
      }
    }

    // Depois da pintura: idle callback (com fallback) para nunca competir
    // com o carregamento principal da home.
    const iniciar = () => {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => buscar(pos.coords.latitude, pos.coords.longitude, 'sua região'),  // nomeDaCidade troca o rótulo
          () => buscar(FALLBACK.lat, FALLBACK.lon, FALLBACK.cidade),
          { timeout: 4000, maximumAge: 30 * 60 * 1000 },
        )
      } else {
        buscar(FALLBACK.lat, FALLBACK.lon, FALLBACK.cidade)
      }
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const handle = idle ? idle(iniciar) : window.setTimeout(iniciar, 800)
    return () => {
      cancelado = true
      if (!idle) window.clearTimeout(handle as number)
    }
  }, [])

  if (!clima) return null

  return (
    <span className="hub-weather-pill" title={`${clima.rotulo} · Open-Meteo`}>
      {clima.icone} {clima.temperatura}°C <small>{clima.cidade}</small>
    </span>
  )
}
