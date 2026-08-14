import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCpfHubApiKey } from '@/lib/cpfhub-config'

export const runtime = 'nodejs'

// Rate limit em memória (best-effort) para conter enumeração de CPF e abuso de créditos.
// Anônimo (fluxo público de onboarding): janela curta e teto baixo por IP.
// Autenticado: teto generoso para o uso interno de telas administrativas.
const RATE_WINDOW_MS = 1000 * 60 * 10 // 10 min
const RATE_LIMIT_ANON = 8
const RATE_LIMIT_AUTH = 120
type RateBucket = { count: number; resetAt: number }
function getRateMap(): Map<string, RateBucket> {
  const g = globalThis as typeof globalThis & { __cpfhubRate?: Map<string, RateBucket> }
  if (!g.__cpfhubRate) g.__cpfhubRate = new Map()
  return g.__cpfhubRate
}
function checkRateLimit(key: string, limit: number, now: number): boolean {
  const map = getRateMap()
  const bucket = map.get(key)
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

type CacheEntry = { expiresAt: number; status: number; body: unknown }
type CpfHubCacheRow = {
  cpf: string
  success: boolean
  response: unknown
  last_error: unknown
  cached_until: string | Date | null
  hit_count: number | null
  last_accessed_at: string
}

const CACHE_TTL_SUCCESS_MS = 1000 * 60 * 60 * 24 // 24h
const CACHE_TTL_ERROR_MS = 1000 * 60 * 5 // 5min (evita gastar crédito em retries)
const MAX_CACHE_ENTRIES = 2000

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { __cpfhubCache?: Map<string, CacheEntry> }
  if (!g.__cpfhubCache) g.__cpfhubCache = new Map()
  return g.__cpfhubCache
}

function cleanCpf(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 11)
}

export async function GET(request: Request, ctx: { params: Promise<{ cpf: string }> | { cpf: string } }) {
  const params = await ctx.params
  const cpf = cleanCpf(params?.cpf || '')

  if (cpf.length !== 11) {
    return NextResponse.json({ error: 'CPF inválido' }, { status: 400 })
  }

  // Rate limit: autenticado tem teto maior; anônimo é limitado por IP.
  const now = Date.now()
  let rateKey = ''
  let rateLimit = RATE_LIMIT_ANON
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      rateKey = `u:${user.id}`
      rateLimit = RATE_LIMIT_AUTH
    }
  } catch {
    // segue como anônimo
  }
  if (!rateKey) {
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    rateKey = `ip:${ip}`
  }
  if (!checkRateLimit(rateKey, rateLimit, now)) {
    return NextResponse.json(
      { error: 'Muitas consultas em pouco tempo. Aguarde alguns minutos.' },
      { status: 429 },
    )
  }

  const cache = getCache()
  const cached = cache.get(cpf)
  if (cached && cached.expiresAt > Date.now()) {
    const res = NextResponse.json(cached.body, { status: cached.status })
    res.headers.set('x-cpfhub-cache', 'HIT')
    res.headers.set('x-cpfhub-cache-layer', 'memory')
    return res
  }

  const apiKey = await getCpfHubApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'CPFHub API key não configurada' }, { status: 500 })
  }

  // Layer 2: cache persistente no Supabase
  try {
    const supabase = await createAdminClient()
    const { data: row } = await supabase
      .from('cpfhub_cache')
      .select('cpf,success,response,last_error,cached_until,hit_count')
      .eq('cpf', cpf)
      .maybeSingle()

    const cachedUntil = row?.cached_until ? new Date(String((row as CpfHubCacheRow).cached_until)).getTime() : 0
    if (row && cachedUntil > Date.now()) {
      await supabase
        .from('cpfhub_cache')
        .update({ hit_count: (row.hit_count ?? 0) + 1, last_accessed_at: new Date().toISOString() })
        .eq('cpf', cpf)

      const body = row.success ? row.response : row.last_error
      const status = row.success ? 200 : 502

      cache.set(cpf, { expiresAt: cachedUntil, status, body })
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (oldestKey) cache.delete(oldestKey)
      }

      const res = NextResponse.json(body, { status })
      res.headers.set('x-cpfhub-cache', 'HIT')
      res.headers.set('x-cpfhub-cache-layer', 'supabase')
      return res
    }
  } catch {
    // Se o Supabase falhar, segue para a consulta externa
  }

  try {
    const res = await fetch(`https://api.cpfhub.io/cpf/${cpf}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
      },
      cache: 'no-store',
    })

    const contentType = res.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await res.json() : await res.text()

    if (!res.ok) {
      const payload = {
        error: 'Falha ao consultar CPF',
        status: res.status,
        details: body,
      }

      cache.set(cpf, { expiresAt: Date.now() + CACHE_TTL_ERROR_MS, status: 502, body: payload })
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (oldestKey) cache.delete(oldestKey)
      }

      // Persist best-effort no Supabase (cache de erro curto)
      try {
        const supabase = await createAdminClient()
        const cacheRow: CpfHubCacheRow = {
          cpf,
          success: false,
          response: null,
          last_error: payload,
          cached_until: new Date(Date.now() + CACHE_TTL_ERROR_MS).toISOString(),
          hit_count: 1,
          last_accessed_at: new Date().toISOString(),
        }
        await supabase.from('cpfhub_cache').upsert(cacheRow, { onConflict: 'cpf' })
      } catch {
        // ignore
      }

      const out = NextResponse.json(payload, { status: 502 })
      out.headers.set('x-cpfhub-cache', 'MISS')
      out.headers.set('x-cpfhub-cache-layer', 'remote')
      return out
    }

    cache.set(cpf, { expiresAt: Date.now() + CACHE_TTL_SUCCESS_MS, status: 200, body })
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value
      if (oldestKey) cache.delete(oldestKey)
    }

    // Persist best-effort no Supabase (cache de sucesso longo)
      try {
        const supabase = await createAdminClient()
        const cacheRow: CpfHubCacheRow = {
          cpf,
          success: true,
          response: body,
          last_error: null,
          cached_until: new Date(Date.now() + CACHE_TTL_SUCCESS_MS).toISOString(),
          hit_count: 1,
          last_accessed_at: new Date().toISOString(),
        }
        await supabase.from('cpfhub_cache').upsert(cacheRow, { onConflict: 'cpf' })
      } catch {
        // ignore
      }

    const out = NextResponse.json(body, { status: 200 })
    out.headers.set('x-cpfhub-cache', 'MISS')
    out.headers.set('x-cpfhub-cache-layer', 'remote')
    return out
  } catch {
    const payload = { error: 'Falha ao consultar CPF' }
    cache.set(cpf, { expiresAt: Date.now() + CACHE_TTL_ERROR_MS, status: 502, body: payload })
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value
      if (oldestKey) cache.delete(oldestKey)
    }

    try {
      const supabase = await createAdminClient()
      const cacheRow: CpfHubCacheRow = {
        cpf,
        success: false,
        response: null,
        last_error: payload,
        cached_until: new Date(Date.now() + CACHE_TTL_ERROR_MS).toISOString(),
        hit_count: 1,
        last_accessed_at: new Date().toISOString(),
      }
      await supabase.from('cpfhub_cache').upsert(cacheRow, { onConflict: 'cpf' })
    } catch {
      // ignore
    }

    const out = NextResponse.json(payload, { status: 502 })
    out.headers.set('x-cpfhub-cache', 'MISS')
    out.headers.set('x-cpfhub-cache-layer', 'remote')
    return out
  }
}
