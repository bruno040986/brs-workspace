import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HubHeader from '@/components/layout/HubHeader'
import { ComunicadosBridge } from '@/components/layout/ComunicadosBridge'
import { MessengerNotificationBridge } from '@/components/layout/MessengerNotificationBridge'
import { MessengerDockProvider } from '@/components/layout/MessengerDockContext'
import { MessengerDockShell } from '@/components/layout/MessengerDockShell'
import type { UserProfile } from '@/types'
import ThemeInit from '@/components/theme/ThemeInit'
import SidebarCollapseToggle from '@/components/layout/SidebarCollapseToggle'
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let themePreference: React.ComponentProps<typeof ThemeInit>['preference'] = 'light'
  let profile: UserProfile = {
    id: '',
    name: 'Visitante',
    email: '',
    role: 'consulta',
    active: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    theme_preference: 'light',
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
    profile = (data as UserProfile | null) || profile
    themePreference = profile?.theme_preference || 'light'
  } catch (error) {
    console.error('Erro ao montar o dashboard; usando perfil de fallback.', error)
  }

  // Usuário inativado não navega no sistema, mesmo com sessão ainda válida
  if (profile.id && profile.active === false) redirect('/login')

  return (
    <MessengerDockProvider>
      <div className="app-layout">
        <ThemeInit preference={themePreference} />
        <HubHeader user={profile} />
        <ComunicadosBridge />
        <MessengerNotificationBridge />
        <MessengerDockShell />
        <SidebarCollapseToggle />
        <div className="workspace-body">
          <WorkspaceSidebar />
          {/* page-shell = padrão ÚNICO de espaçamento de conteúdo do Workspace
              (03/09/2026): os paddings locais (.rh-content/.hub-container)
              foram zerados — o respiro vem só daqui. */}
          <main className="main-content">
            <div className="page-shell">{children}</div>
          </main>
        </div>
      </div>
    </MessengerDockProvider>
  )
}
