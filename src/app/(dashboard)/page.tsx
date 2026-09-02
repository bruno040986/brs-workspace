'use client'

/**
 * Home do BRS Workspace — layout aprovado 02/09/2026.
 *
 * O centro é o painel amplo de Agenda & Tarefas (4 abas). Os cards de setor
 * viraram a sidebar por divisões; os links externos foram para o dropdown
 * "Links" da topbar; Comunicados, Elogios e Aniversários moram no BRS
 * Messenger (polo social). O clima é um pill Open-Meteo carregado depois da
 * pintura — o iframe de terceiro foi removido.
 */
import { useEffect, useState } from 'react'
import { getMyHubContext } from '@/lib/auth/actions'
import HubBannerCarousel from './_components/HubBannerCarousel'
import WeatherPill from './_components/WeatherPill'
import PraiseBoard from './_components/PraiseBoard'
import { AgendaComponent } from './theme/AgendaComponent'

export default function HubPage() {
  const [userName, setUserName] = useState<string>('')
  const [greeting, setGreeting] = useState<string>('Bom dia')
  const [formattedDate, setFormattedDate] = useState<string>('')
  const [praiseParams, setPraiseParams] = useState<{ tab?: 'feed' | 'send' | 'received'; id?: string } | null>(null)

  useEffect(() => {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) setGreeting('Bom dia')
    else if (hour >= 12 && hour < 18) setGreeting('Boa tarde')
    else setGreeting('Boa noite')

    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    const dateStr = new Date().toLocaleDateString('pt-BR', options)
    const words = dateStr
      .split(' ')
      .map((word) => (word.length > 2 ? word.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-') : word))
      .join(' ')
    setFormattedDate(words.charAt(0).toUpperCase() + words.slice(1))

    // Deep-link de elogios (sino de notificações) continua funcionando:
    // o mural abre aqui quando a URL pede, mesmo com os elogios morando no
    // Messenger no dia a dia.
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('praiseTab')
    const id = params.get('praiseId')
    if (tab === 'send' || tab === 'received' || tab === 'feed' || id) {
      setPraiseParams({ tab: (tab as 'feed' | 'send' | 'received') || undefined, id: id || undefined })
    }

    getMyHubContext()
      .then((ctx) => {
        if (ctx.success) setUserName(ctx.userName || '')
      })
      .catch(() => {})
  }, [])

  return (
    <div className="hub-container">
      <div className="hub-main">
        <div className="hub-greeting-row">
          <div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--brs-gray-800)', margin: 0 }}>
              {greeting}, {userName || 'Usuário'}!
            </h1>
            <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.95rem', margin: '0.35rem 0 0' }}>
              {formattedDate || 'Carregando data...'}
            </p>
          </div>
          <WeatherPill />
        </div>

        <HubBannerCarousel />

        {praiseParams && (
          <div className="widget-card" style={{ padding: '1rem' }}>
            <PraiseBoard initialTab={praiseParams.tab} focusPraiseId={praiseParams.id} />
          </div>
        )}

        <div className="hub-agenda-panel">
          <AgendaComponent />
        </div>
      </div>
    </div>
  )
}
