'use client'

/**
 * Aba 🎂 do BRS Messenger — próximos aniversários da equipe (dados do
 * getMyHubContext, que já mascara o ano). Saiu da home no layout de
 * 02/09/2026: o Messenger é o polo social do Workspace.
 */
import { useEffect, useState } from 'react'
import { getMyHubContext } from '@/lib/auth/actions'

type Aniversariante = {
  name: string
  avatar_url: string | null
  dia: string
  daysUntil: number
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export default function AniversariosTab() {
  const [lista, setLista] = useState<Aniversariante[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let ativo = true
    getMyHubContext()
      .then((ctx) => {
        if (!ativo || !ctx.success) return
        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)
        const ano = hoje.getFullYear()
        const linhas = ((ctx.birthdays || []) as Array<{ name?: string | null; birth_date?: string | null; avatar_url?: string | null }>)
          .map((u) => {
            const partes = String(u.birth_date || '').split('-')
            const dia = parseInt(partes[2] || '0', 10)
            const mes = parseInt(partes[1] || '0', 10)
            if (!dia || !mes) return null
            let proximo = new Date(ano, mes - 1, dia)
            proximo.setHours(0, 0, 0, 0)
            if (proximo < hoje) proximo = new Date(ano + 1, mes - 1, dia)
            const daysUntil = Math.round((proximo.getTime() - hoje.getTime()) / 86400000)
            const rotulo = daysUntil === 0 ? 'Hoje 🎉' : daysUntil === 1 ? 'Amanhã' : `${dia} de ${MESES[mes - 1]}`
            return { name: String(u.name || ''), avatar_url: u.avatar_url || null, dia: rotulo, daysUntil }
          })
          .filter((x): x is Aniversariante => Boolean(x))
          .sort((a, b) => a.daysUntil - b.daysUntil)
          .slice(0, 15)
        setLista(linhas)
      })
      .catch(() => {})
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [])

  return (
    <div className="brs-messenger-surface" style={{ height: '100%', overflow: 'auto', padding: '0.7rem' }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--msn-muted)', fontWeight: 700, marginBottom: '0.5rem' }}>
        Próximos aniversários
      </div>
      {carregando && <div style={{ color: 'var(--msn-muted)', fontSize: '0.8rem' }}>Carregando…</div>}
      {!carregando && lista.length === 0 && (
        <div style={{ color: 'var(--msn-muted)', fontSize: '0.8rem' }}>Nenhum aniversário cadastrado.</div>
      )}
      {lista.map((a, i) => (
        <div
          key={`${a.name}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.45rem',
            borderRadius: 8, background: a.daysUntil === 0 ? 'var(--msn-item-hover)' : 'transparent',
          }}
        >
          <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--msn-avatar-bg)', border: '1px solid var(--msn-border)', color: 'var(--msn-avatar-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', overflow: 'hidden', flexShrink: 0 }}>
            {a.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              a.name.charAt(0).toUpperCase()
            )}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: 'var(--msn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.name} {a.daysUntil === 0 ? '🎂' : ''}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--msn-muted)' }}>{a.dia}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
