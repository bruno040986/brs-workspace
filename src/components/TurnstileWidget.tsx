'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

// Render explícito: o implícito não roda de novo em navegação cliente.
export default function TurnstileWidget({ onToken }: { onToken?: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return
    const el = ref.current
    let id: string | undefined
    const atualiza = (t: string) => { setToken(t); onToken?.(t) }
    const render = () => {
      if (!window.turnstile || id) return
      id = window.turnstile.render(el, {
        sitekey: SITE_KEY, callback: atualiza,
        'expired-callback': () => atualiza(''), 'error-callback': () => atualiza(''),
      })
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = SRC
      script.async = true
      document.head.appendChild(script)
    }
    if (window.turnstile) render()
    else script.addEventListener('load', render)
    return () => {
      script.removeEventListener('load', render)
      if (id) window.turnstile?.remove(id)
    }
  }, [onToken])

  if (!SITE_KEY) return null
  return (
    <div ref={ref} style={{ marginBottom: '1rem' }}>
      <input type="hidden" name="cf-turnstile-response" value={token} readOnly />
    </div>
  )
}
