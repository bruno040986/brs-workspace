'use client'

import { Suspense, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, LogIn, AlertTriangle } from 'lucide-react'
import Image from 'next/image'

const MENSAGEM_INSTABILIDADE =
  'Não foi possível confirmar sua sessão a tempo — o serviço de autenticação está instável no momento (não é senha incorreta). Tente novamente em alguns instantes.'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [avisoInstabilidade, setAvisoInstabilidade] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    if (searchParams.get('motivo') === 'instabilidade') {
      setAvisoInstabilidade(true)
    }
  }, [searchParams])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setAvisoInstabilidade(false)
    try {
      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ])
      if (error) {
        // status 400 = credencial realmente inválida; qualquer outra coisa
        // (timeout, 5xx, erro de rede) é instabilidade do serviço, não senha errada.
        if (error.status === 400) {
          setError('E-mail ou senha inválidos.')
        } else {
          setAvisoInstabilidade(true)
        }
        setLoading(false)
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setAvisoInstabilidade(true)
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Image
            src="/logotipos/BRS WORKSPACE FUNDO CLARO SEM FUNDO.png"
            alt="BRS Workspace"
            width={220}
            height={90}
            style={{ objectFit: 'contain' }}
            priority
          />
          <div className="login-logo-title">
            <p style={{ color: 'var(--brs-gray-800)', fontWeight: 700 }}>
              Acesse todas as ferramentas em um só lugar.
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin}>
          {avisoInstabilidade && (
            <div
              className="alert"
              style={{
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                background: '#FFF7E6',
                border: '1px solid #FFD591',
                color: '#874D00',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{MENSAGEM_INSTABILIDADE}</span>
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input
              id="email"
              type="email"
              className="form-control"
              placeholder="seu@brspromotora.com.br"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Senha</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                style={{
                  position: 'absolute', right: '0.75rem', top: '50%',
                  transform: 'translateY(-50%)', background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--brs-gray-400)', padding: 0
                }}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            id="btn-login"
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : <LogIn size={18} />}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--brs-gray-500)', lineHeight: 1.35 }}>
          Uso interno exclusivo
          <br />
          BRS Promotora de Vendas Ltda - CNPJ 54.303.453/0001-16
        </p>
      </div>
    </div>
  )
}
