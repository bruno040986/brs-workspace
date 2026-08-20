'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Bell, Grid, User, LogOut, Settings, X,
  ShieldCheck, ExternalLink, HelpCircle, LayoutGrid,
  Megaphone, Briefcase, Banknote, Monitor, UserCircle2, Key, Users
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ThemePreference, UserProfile } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { getMyEffectivePermissions } from '@/lib/auth/actions'
import {
  hasAnyPermission,
  hasPermission,
  systemConfigNavEntries,
  type EffectivePermission,
} from '@/lib/auth/permissions'
import { getPraiseNotifications, getPraiseUnreadCount, markPraiseNotificationsRead } from '@/app/(dashboard)/praises/actions'
import {
  getWorkspaceNotifications,
  getWorkspaceUnreadCount,
  markWorkspaceNotificationsRead,
  type WorkspaceNotificationRow,
} from '@/app/(dashboard)/notificacoes/actions'
import { setMyThemePreference } from '@/app/(dashboard)/theme/actions'
import { applyResolvedTheme, readStoredThemePreference, resolveTheme, storeThemePreference } from '@/components/theme/theme'

interface HubHeaderProps {
  user: UserProfile
}

type PraiseNotification = {
  kind: 'praise'
  id: string
  type?: string
  created_at?: string
  praise_id?: string
  from_user?: { name?: string }
  praise?: { from_user_id?: string }
}

type ComunicadoNotification = {
  kind: 'comunicado'
  id: string
  titulo: string
  texto_html: string
  created_at: string
}

type WorkspaceHeaderNotification = WorkspaceNotificationRow & { kind: 'workspace' }

type HeaderNotification = PraiseNotification | ComunicadoNotification | WorkspaceHeaderNotification

export default function HubHeader({ user }: HubHeaderProps) {
  const router = useRouter()
  const [showApps, setShowApps] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [permissions, setPermissions] = useState<EffectivePermission[]>([])
  const [loading, setLoading] = useState(true)

  const [praiseUnread, setPraiseUnread] = useState<number>(0)
  const [comunicadoUnread, setComunicadoUnread] = useState<number>(0)
  const [workspaceUnread, setWorkspaceUnread] = useState<number>(0)
  const [loadingNotifs, setLoadingNotifs] = useState(false)
  const [notifItems, setNotifItems] = useState<HeaderNotification[]>([])
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null)
  const [themePref, setThemePref] = useState<ThemePreference>('light')
  const [isDarkTheme, setIsDarkTheme] = useState(false)
  const notificationsRef = useRef<HTMLDivElement | null>(null)
  const appsRef = useRef<HTMLDivElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const lastComunicadoUnreadRef = useRef(0)

  useEffect(() => {
    async function loadPerms() {
      if (!user?.id) return
      try {
        const res = await getMyEffectivePermissions()
        if (res.success) {
          setPermissions(res.permissions || [])
        }
      } catch (err) {
        console.error('Erro ao carregar permissões no HubHeader:', err)
      } finally {
        setLoading(false)
      }
    }
    loadPerms()
  }, [user?.id])

  useEffect(() => {
    const stored = readStoredThemePreference()
    const initial: ThemePreference = stored || user?.theme_preference || 'light'
    setThemePref(initial)
  }, [user?.theme_preference])

  useEffect(() => {
    const updateTheme = () => {
      const current = document.documentElement.getAttribute('data-theme')
      setIsDarkTheme(current === 'dark')
    }

    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return

      if (showNotifications && notificationsRef.current && !notificationsRef.current.contains(target)) {
        setShowNotifications(false)
      }
      if (showApps && appsRef.current && !appsRef.current.contains(target)) {
        setShowApps(false)
      }
      if (showUserMenu && userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showNotifications, showApps, showUserMenu])

  async function handleThemeChange(next: ThemePreference) {
    setThemePref(next)
    storeThemePreference(next)
    applyResolvedTheme(resolveTheme(next))
    const res = await setMyThemePreference(next)
    if (!res?.success) {
      console.warn('Não foi possível salvar preferência de tema:', res?.error)
    }
  }

  async function refreshPraiseBadge() {
    if (!user?.id) return
    const res = await getPraiseUnreadCount()
    if (res.success) setPraiseUnread(res.count || 0)
  }

  async function refreshWorkspaceBadge() {
    if (!user?.id) return
    const res = await getWorkspaceUnreadCount()
    if (res.success) setWorkspaceUnread(res.count || 0)
  }

  async function loadNotifications() {
    setLoadingNotifs(true)
    try {
      const [praiseRes, comunicadoRes, workspaceRes] = await Promise.all([
        getPraiseNotifications({ limit: 10 }),
        fetch('/api/comunicados/notifications')
          .then(async (response) => response.json())
          .catch(() => null),
        getWorkspaceNotifications({ limit: 10 }),
      ])

      const praiseItems = praiseRes.success
        ? ((praiseRes.notifications || []) as PraiseNotification[]).map((item) => ({ ...item, kind: 'praise' as const }))
        : []

      const comunicadoItems = Array.isArray(comunicadoRes?.items)
        ? ((comunicadoRes.items || []) as ComunicadoNotification[]).map((item) => ({ ...item, kind: 'comunicado' as const }))
        : []

      const workspaceItems = workspaceRes.success
        ? (workspaceRes.notifications || []).map((item) => ({ ...item, kind: 'workspace' as const }))
        : []

      setNotifItems(
        [...comunicadoItems, ...praiseItems, ...workspaceItems].sort((a, b) => {
          const left = new Date(String((b as any).created_at || '')).getTime()
          const right = new Date(String((a as any).created_at || '')).getTime()
          return left - right
        }) as HeaderNotification[],
      )
    } finally {
      setLoadingNotifs(false)
    }
  }

  async function refreshComunicadoBadge() {
    try {
      const response = await fetch('/api/comunicados/notifications')
      const data = await response.json()
      const nextUnread = Number(data?.count || 0)
      if (lastComunicadoUnreadRef.current > 0 && nextUnread > lastComunicadoUnreadRef.current) {
        setToast({ id: `com_${Date.now()}`, text: 'Há um novo comunicado para ser lido!' })
      }
      lastComunicadoUnreadRef.current = nextUnread
      setComunicadoUnread(nextUnread)
    } catch {
      // keep the previous badge state if the request fails
    }
  }

  useEffect(() => {
    refreshPraiseBadge()
    refreshComunicadoBadge()
    refreshWorkspaceBadge()
    const handler = () => {
      refreshPraiseBadge()
      refreshComunicadoBadge()
      refreshWorkspaceBadge()
    }
    window.addEventListener('praise:refresh', handler)
    window.addEventListener('comunicados:refresh', handler)
    const interval = window.setInterval(() => refreshPraiseBadge(), 30000)
    const intervalComunicados = window.setInterval(() => refreshComunicadoBadge(), 30000)
    const intervalWorkspace = window.setInterval(() => refreshWorkspaceBadge(), 30000)
    const onFocus = () => {
      refreshPraiseBadge()
      refreshComunicadoBadge()
      refreshWorkspaceBadge()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('praise:refresh', handler)
      window.removeEventListener('comunicados:refresh', handler)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
      window.clearInterval(intervalComunicados)
      window.clearInterval(intervalWorkspace)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`workspace-notifs-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workspace_notifications', filter: `user_id=eq.${user.id}` },
        async (payload) => {
          const newId = String((payload as any)?.new?.id || '')
          const title = String((payload as any)?.new?.title || 'Você tem uma nova notificação.')
          await refreshWorkspaceBadge()
          setToast({ id: newId || `w_${Date.now()}`, text: title })
          window.setTimeout(() => setToast((prev) => (prev?.id === (newId || prev?.id || '') ? null : prev)), 4500)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`praise-notifs-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'praise_notifications', filter: `user_id=eq.${user.id}` },
        async (payload) => {
          const newId = String((payload as any)?.new?.id || '')
          await refreshPraiseBadge()

          const listRes = await getPraiseNotifications({ limit: 10 })
          if (listRes.success) {
            const list = (listRes.notifications || []) as any[]
            setNotifItems(list)
            const current = list.find((n) => String(n.id) === newId) || list[0] || null
            const type = String(current?.type || (payload as any)?.new?.type || '')
            if (type === 'praise_reaction') {
              const actorName = String(current?.from_user?.name || 'Alguém')
              setToast({ id: newId || `t_${Date.now()}`, text: `${actorName} reagiu ao seu elogio!` })
            } else if (type === 'praise_received') {
              setToast({ id: newId || `t_${Date.now()}`, text: 'Você recebeu um elogio!' })
            }
          }

          window.setTimeout(() => setToast((prev) => (prev?.id === (newId || prev?.id || '') ? null : prev)), 4500)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const canView = (resourceId: string): boolean => {
    if (loading) return false
    return hasPermission(permissions, resourceId)
  }

  const configEntries = systemConfigNavEntries

  const systemApps = [
    { label: 'Home HUB', icon: LayoutGrid, href: '/', color: '#475569', id: 'home' },
    { label: 'Usuários', icon: User, href: '/usuarios', color: '#7c3aed', id: 'sistema-usuarios-root' },
    { label: 'Configurações', icon: Settings, href: '/rh/parceiros/config', color: '#475569', id: 'sistema-config-root' },
    { label: 'Comunicados', icon: Megaphone, href: '/comunicados', color: '#dc2626', id: 'sistema-comunicados' },
    { label: 'Links', icon: ExternalLink, href: '/links', color: '#ea580c', id: 'sistema-links' },
    { label: 'Ajuda', icon: HelpCircle, href: '#', color: '#db2777', id: 'sistema-ajuda' },
  ]


  const sectorApps = [
    { label: 'Adm', icon: UserCircle2, href: '/?sector=adm', color: '#7c3aed', id: 'workspace-adm' },
    { label: 'Financeiro', icon: Banknote, href: '/?sector=fin', color: '#16a34a', id: 'workspace-fin' },
    { label: 'RH', icon: Users, href: '/?sector=rh', color: '#2563eb', id: 'workspace-rh' },
    { label: 'Operacional', icon: Monitor, href: '/?sector=ops', color: '#ea580c', id: 'workspace-ops' },
    { label: 'Marketing', icon: Megaphone, href: '/?sector=mkt', color: '#db2777', id: 'workspace-mkt' },
    { label: 'Comercial', icon: Briefcase, href: '/?sector=com', color: '#ca8a04', id: 'workspace-com' },
    { label: 'Acessos', icon: Key, href: '/?sector=acc', color: '#475569', id: 'workspace-acc' },
  ]

  const filteredSystemApps = systemApps.filter(app => {
    if (app.id === 'home') return true
    if (app.id === 'sistema-usuarios-root') {
      return hasAnyPermission(permissions, [
        { resource: 'sistema-usuarios-root' },
        { resource: 'sistema-usuarios-cadastro' },
        { resource: 'sistema-usuarios-perfis' },
      ])
    }
    if (app.id === 'sistema-config-root') {
      return hasAnyPermission(
        permissions,
        configEntries.map((entry) => ({ resource: entry.resource })),
      )
    }
    return canView(app.id)
  })

  const filteredSectorApps = sectorApps.filter(app => {
    return canView(app.id)
  })

  async function handleLogout() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Erro ao sair:', err)
    } finally {
      setShowUserMenu(false)
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <header className="hub-header">
      <div className="hub-header-left">
        <Link href="/">
          <Image 
            key={isDarkTheme ? 'workspace-dark' : 'workspace-light'}
            src={
              isDarkTheme
                ? '/logotipos/BRS WORKSPACE FUNDO ESCURO SEM FUNDO.png'
                : '/logotipos/BRS WORKSPACE FUNDO CLARO SEM FUNDO.png'
            }
            alt="BRS Workspace"
            width={180}
            height={60} 
            priority
            unoptimized
            style={{ objectFit: 'contain' }}
          />
        </Link>
      </div>

      <div className="hub-header-center">
        <div className="bia-bar-hub" title="Em breve a BIA vai estar aqui para te ajudar...">
          <Image className="bia-bar-hub-icon" src="/bia.png" alt="BIA" width={42} height={42} priority />
          <div className="bia-bar-hub-box">
            <span className="bia-bar-hub-label">Em breve a BIA vai estar aqui para te ajudar...</span>
          </div>
        </div>
      </div>

      <div className="hub-header-right">
        {toast && (
          <div
            style={{
              position: 'fixed',
              right: 18,
              bottom: 18,
              zIndex: 2000,
              background: 'var(--brs-surface)',
              border: '1px solid var(--brs-gray-100)',
              boxShadow: '0 10px 35px rgba(0,0,0,0.18)',
              borderRadius: 16,
              padding: '0.85rem 1rem',
              minWidth: 260,
              maxWidth: 360,
              fontWeight: 800,
              color: 'var(--brs-gray-800)',
              cursor: 'pointer',
            }}
            data-brs-messenger-ignore-close="true"
            onClick={() => {
              setShowNotifications(true)
              loadNotifications()
            }}
            title="Abrir notificações"
          >
            {toast.text}
          </div>
        )}
        <div style={{ position: 'relative' }} ref={notificationsRef}>
        <button
          className="icon-button"
          data-brs-messenger-ignore-close="true"
          onClick={async () => {
            const next = !showNotifications
            setShowNotifications(next)
            if (next) {
              await Promise.all([refreshPraiseBadge(), refreshComunicadoBadge(), refreshWorkspaceBadge(), loadNotifications()])
            }
          }}
        >
          <Bell size={20} />
          {(praiseUnread + comunicadoUnread + workspaceUnread) > 0 && (
            <span className="notification-badge">{Math.min(99, praiseUnread + comunicadoUnread + workspaceUnread)}</span>
          )}
        </button>

          {showNotifications && (
            <div
              data-brs-messenger-ignore-close="true"
              style={{
                position: 'absolute',
                top: '50px',
              right: 0,
              zIndex: 1000,
              width: '320px',
              background: 'var(--brs-surface)',
              borderRadius: '16px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
              border: '1px solid var(--brs-gray-100)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '0.9rem 1rem', fontWeight: 900, color: 'var(--brs-gray-800)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Notificações
              <button className="icon-button" style={{ width: 30, height: 30 }} onClick={() => setShowNotifications(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ borderTop: '1px solid var(--brs-gray-50)' }} />
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {loadingNotifs ? (
                <div style={{ padding: '1rem', color: 'var(--brs-gray-400)', fontSize: '0.8125rem', textAlign: 'center' }}>Carregando…</div>
              ) : notifItems.length === 0 ? (
                <div style={{ padding: '1rem', color: 'var(--brs-gray-400)', fontSize: '0.8125rem', textAlign: 'center' }}>Nenhuma notificação.</div>
              ) : (
                notifItems.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={async () => {
                      setShowNotifications(false)
                      if (n.kind === 'workspace') {
                        await markWorkspaceNotificationsRead({ id: n.id })
                        await refreshWorkspaceBadge()
                        if (n.href) router.push(n.href)
                      } else if (n.kind === 'comunicado') {
                        window.dispatchEvent(
                          new CustomEvent('comunicados:open', {
                            detail: {
                              id: n.id,
                              titulo: n.titulo,
                              texto_html: n.texto_html,
                            },
                          }),
                        )
                      } else {
                        await markPraiseNotificationsRead({ praise_id: n.praise_id })
                        window.dispatchEvent(new Event('praise:refresh'))
                        const type = String(n.type || 'praise_received')
                        if (type === 'praise_reaction') {
                          router.push(`/?praiseTab=feed&praiseId=${encodeURIComponent(String(n.praise_id))}`)
                        } else {
                          router.push('/?praiseTab=received')
                        }
                      }
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.85rem 1rem',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: '0.25rem',
                    }}
                  >
                    {n.kind === 'workspace' ? (
                      <div style={{ fontSize: '0.85rem', fontWeight: n.read_at ? 500 : 800, color: 'var(--brs-gray-800)' }}>
                        {n.title}
                      </div>
                    ) : n.kind === 'comunicado' ? (
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brs-gray-800)' }}>
                        Há um novo comunicado para ser lido!
                      </div>
                    ) : String(n.type || 'praise_received') === 'praise_reaction' ? (
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brs-gray-800)' }}>
                        {`${String(n?.from_user?.name || 'Alguém')} reagiu ao seu elogio ${
                          String(n?.praise?.from_user_id || '') === String(user?.id || '') ? 'enviado' : 'recebido'
                        }!`}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brs-gray-800)' }}>Você recebeu um elogio!</div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                      {new Date(String(n.created_at || '')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        </div>

        <div style={{ position: 'relative' }} ref={appsRef}>
          <button 
            className="icon-button"
            data-brs-messenger-ignore-close="true"
            onClick={() => setShowApps(!showApps)}
          >
            <Grid size={20} />
          </button>

          {showApps && (
            <div 
              data-brs-messenger-ignore-close="true"
              style={{ 
                position: 'absolute', 
                top: '50px', 
                right: '0', 
                zIndex: 1000,
                width: '320px',
                background: 'var(--brs-surface)',
                borderRadius: '16px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                border: '1px solid var(--brs-gray-100)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Bloco Sistema */}
              {filteredSystemApps.length > 0 && (
                <div style={{ padding: '1rem 1rem 0.5rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    Sistema
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {filteredSystemApps.map((app) => (
                      <Link 
                        key={app.label} 
                        href={app.href}
                        className="app-item"
                        onClick={() => setShowApps(false)}
                        style={{ padding: '0.75rem 0.25rem' }}
                      >
                        <div className="app-icon" style={{ color: app.color, marginBottom: '4px' }}>
                          <app.icon size={22} />
                        </div>
                        <span className="app-label" style={{ fontSize: '0.75rem', fontWeight: 500 }}>{app.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Divisor */}
              {filteredSystemApps.length > 0 && filteredSectorApps.length > 0 && (
                <div style={{ height: '1px', background: 'var(--brs-gray-50)', margin: '0.5rem 1rem' }} />
              )}

              {/* Bloco Ferramentas */}
              {filteredSectorApps.length > 0 && (
                <div style={{ padding: '0.5rem 1rem 1rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    Ferramentas
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {filteredSectorApps.map((app) => (
                      <Link 
                        key={app.label} 
                        href={app.href}
                        className="app-item"
                        onClick={() => setShowApps(false)}
                        style={{ padding: '0.75rem 0.25rem' }}
                      >
                        <div className="app-icon" style={{ color: app.color, marginBottom: '4px' }}>
                          <app.icon size={22} />
                        </div>
                        <span className="app-label" style={{ fontSize: '0.75rem', fontWeight: 500 }}>{app.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }} ref={userMenuRef}>
          <button 
            className="user-profile-button"
            data-brs-messenger-ignore-close="true"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="user-avatar" style={{ overflow: 'hidden' }}>
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                user.name.charAt(0)
              )}
            </div>
          </button>

          {showUserMenu && (
            <div 
              data-brs-messenger-ignore-close="true"
              style={{ 
                position: 'absolute', 
                top: '55px', 
                right: '0', 
                width: '320px',
                background: 'var(--brs-surface)',
                borderRadius: '28px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                padding: '1.5rem',
                zIndex: 1000,
                textAlign: 'center',
                border: '1px solid var(--brs-gray-100)'
              }}
            >
              <div style={{ marginBottom: '1rem', color: 'var(--brs-gray-600)', fontSize: '0.875rem' }}>
                {user.email}
              </div>
              
              <div style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto 1rem', borderRadius: '50%', overflow: 'hidden', border: '1px solid var(--brs-gray-100)' }}>
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--brs-navy)', color: '#fff', fontSize: '2rem', fontWeight: 600 }}>
                    {user.name.charAt(0)}
                  </div>
                )}
              </div>

              <div style={{ fontSize: '1.5rem', fontWeight: 500, color: isDarkTheme ? 'var(--brs-gray-800)' : 'var(--brs-navy)', marginBottom: '1.5rem' }}>
                Olá, {user.name.split(' ')[0]}!
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ textAlign: 'left', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--brs-gray-400)', marginBottom: '0.35rem' }}>
                    Tema
                  </div>
                  <select
                    className="form-control"
                    value={themePref}
                    onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
                    style={{ width: '100%', borderRadius: '999px' }}
                  >
                    <option value="light">Claro</option>
                    <option value="dark">Escuro</option>
                    <option value="system">Navegador (Sistema)</option>
                  </select>
                </div>
                {canView('sistema-usuarios-root') && (
                  <Link 
                    href="/usuarios" 
                    className="btn btn-outline" 
                    style={{
                      borderRadius: '100px',
                      padding: '0.6rem',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      justifyContent: 'center',
                      color: isDarkTheme ? 'var(--brs-gray-800)' : 'var(--brs-navy)',
                    }}
                    onClick={() => setShowUserMenu(false)}
                  >
                    Gerenciar sua conta
                  </Link>
                )}
                
                <button 
                  className="btn btn-ghost" 
                  style={{ borderRadius: '100px', padding: '0.6rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--brs-danger)', justifyContent: 'center', marginTop: '1rem' }}
                  onClick={handleLogout}
                >
                  <LogOut size={18} />
                  Sair
                </button>
              </div>

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>
                <span>Privacidade</span>
                <span>•</span>
                <span>Termos</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

