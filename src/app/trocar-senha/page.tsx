'use client'

import { sair as sairDaSessao } from '@/app/acesso/actions'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, KeyRound, LogOut } from 'lucide-react'
import Image from 'next/image'
import { trocarSenha } from './actions'

export default function TrocarSenhaPage() {
  const [atual, setAtual] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }

    setLoading(true)
    const res = await trocarSenha(atual, password)
    if (!res.success) {
      setError(res.error || 'Não foi possível atualizar a senha. Tente novamente.')
      setLoading(false)
      return
    }

    // O banco revoga as liberações ao trocar a senha: entra de novo com a senha nova (todas as etapas).
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleLogout() {
    await sairDaSessao('esta')
    router.push('/login')
    router.refresh()
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
              Defina uma nova senha para continuar.
            </p>
            <p style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
              Por segurança, no primeiro acesso é necessário trocar a senha provisória.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Senha atual</label>
            <input
              type={showPass ? 'text' : 'password'}
              className="form-control"
              value={atual}
              onChange={e => setAtual(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Nova senha</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                className="form-control"
                placeholder="Mínimo de 8 caracteres"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                style={{
                  position: 'absolute', right: '0.75rem', top: '50%',
                  transform: 'translateY(-50%)', background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--brs-gray-400)', padding: 0,
                }}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Confirmar nova senha</label>
            <input
              type={showPass ? 'text' : 'password'}
              className="form-control"
              placeholder="Repita a nova senha"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : <KeyRound size={18} />}
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLogout}
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'center', marginTop: '0.75rem', gap: '0.4rem' }}
        >
          <LogOut size={15} />
          Sair
        </button>
      </div>
    </div>
  )
}
