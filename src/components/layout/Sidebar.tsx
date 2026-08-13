'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { usePathname } from 'next/navigation'
import {
  AlertTriangle,
  BarChart2,
  BriefcaseBusiness,
  Building,
  Building2,
  Calculator,
  ChevronDown,
  ClipboardList,
  Coins,
  Cpu,
  Eye,
  FileText,
  Globe,
  HandCoins,
  Key,
  LayoutDashboard,
  LayoutGrid,
  Mail,
  Menu,
  MessageSquare,
  Scale,
  Upload,
  UserCog,
  Users,
  Bus,
  BookOpen,
  Link2,
  X,
} from 'lucide-react'
import { getMyEffectivePermissions } from '@/lib/auth/actions'
import { hasAnyPermission, hasPermission, type EffectivePermission } from '@/lib/auth/permissions'

type NavItem = {
  label: string
  href: string
  icon: ComponentType<{ size?: number }>
}

type NavGroup = {
  key: string
  label: string
  items: NavItem[]
  defaultOpen?: boolean
}

type SidebarSection = {
  type: 'section'
  label: string
}

function isSection(item: NavItem | SidebarSection): item is SidebarSection {
  return 'type' in item && item.type === 'section'
}

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [permissions, setPermissions] = useState<EffectivePermission[]>([])
  const [loading, setLoading] = useState(true)
  const [permissionsError, setPermissionsError] = useState(false)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function loadPerms() {
      try {
        const res = await getMyEffectivePermissions()
        if (res.success) {
          setPermissions(res.permissions || [])
          setPermissionsError(false)
        } else {
          setPermissionsError(true)
        }
      } catch (err) {
        console.error('Erro ao carregar permissões na Sidebar:', err)
        setPermissionsError(true)
      } finally {
        setLoading(false)
      }
    }

    loadPerms()
  }, [])

  const canView = (resourceId: string): boolean => {
    if (permissionsError || loading) return false
    return hasPermission(permissions, resourceId)
  }

  const canViewAny = (resourceIds: string[]): boolean => {
    if (permissionsError || loading) return false
    return hasAnyPermission(
      permissions,
      resourceIds.map((resource) => ({ resource })),
    )
  }

  const configResourceIds = [
    'sistema-config-email',
    'sistema-config-whatsapp',
    'sistema-config-assinatura',
    'sistema-config-empresa',
    'sistema-config-google',
    'sistema-config-cnae',
    'sistema-config-ctn',
    'sistema-config-nbs',
    'sistema-config-tipos-remuneracao',
    'sistema-config-quarkrh',
    'sistema-config-contaazul',
    'sistema-config-arw',
    'sistema-config-instituicoes',
    'sistema-config-crm',
  ]

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    if (href === '/rh') return pathname === '/rh'
    if (href === '/rh/parceiros') return pathname === '/rh/parceiros'
    if (href === '/rh/parceiros/config/comercial') return pathname.startsWith('/rh/parceiros/config/comercial')
    if (href === '/seletor') return pathname === '/seletor'
    if (href === '/rh/parceiros/config/comercial/seletor') return pathname.startsWith('/rh/parceiros/config/comercial/seletor')
    if (href === '/cartao') return pathname.startsWith('/cartao')
    if (href.includes('?')) return pathname + '?' === href.split('?')[0] + '?' || pathname === href.split('?')[0]
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function canSeeProviderRoute(href: string) {
    if (href === '/rh/parceiros/config/provedores/email') return canView('sistema-config-email')
    if (href === '/rh/parceiros/config/provedores/whatsapp') return canView('sistema-config-whatsapp')
    if (href === '/rh/parceiros/config/provedores/assinatura') return canView('sistema-config-assinatura')
    if (href === '/rh/parceiros/config/provedores/empresas') return canView('sistema-config-empresa')
    if (href === '/rh/parceiros/config/provedores/cpf') return canView('sistema-config-cpf')
    if (href === '/rh/parceiros/config/provedores/cnae') return canView('sistema-config-cnae')
    if (href === '/rh/parceiros/config/provedores/ctn') return canView('sistema-config-ctn')
    if (href === '/rh/parceiros/config/provedores/nbs') return canView('sistema-config-nbs')
    if (href === '/rh/parceiros/config/provedores/tipos-comercial') return canView('sistema-config-comercial-tipos')
    if (href === '/rh/parceiros/config/provedores/setores') return canView('sistema-config-setores')
    if (href === '/rh/parceiros/config/provedores/tipos-emissao-nfse') return canView('sistema-config-nfse-emissao')
    if (href === '/rh/parceiros/config/provedores/formas-recebimento') return canView('sistema-config-formas-recebimento')
    if (href === '/rh/parceiros/config/provedores/tipos-remuneracao') return canView('sistema-config-tipos-remuneracao')
    if (href === '/rh/parceiros/config/provedores/tipos-sistemas') return canView('sistema-config-tipos-sistemas')
    if (href === '/rh/parceiros/config/provedores/google') return canView('sistema-config-google')
    if (href === '/rh/parceiros/config/provedores/regimes-tributarios') return canViewAny(configResourceIds)
    if (href === '/rh/parceiros/config/provedores/recalculo-tributario') return canViewAny(configResourceIds)
    if (href.includes('QuarkRH')) return canView('sistema-config-quarkrh')
    if (href.includes('ContaAzul')) return canView('sistema-config-contaazul')
    if (href.includes('ARW')) return canView('sistema-config-arw')
    if (href.includes('Instituicoes')) return canView('sistema-config-instituicoes')
    if (href.includes('CRM')) return canView('sistema-config-crm')
    return false
  }

  function filterItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.href === '/rh/parceiros/config/comercial') return canViewAny(['comercial-agentes', 'comercial-estrutura'])
      if (item.href === '/seletor') return canViewAny(['comercial-agentes', 'comercial-estrutura'])
      if (item.href === '/rh/parceiros/config/comercial/seletor') return canViewAny(['comercial-agentes', 'comercial-estrutura'])
      if (item.href === '/cartao') return true
      if (item.href === '/rh/parceiros/config/comercial/links-cartao-digital') return canViewAny(['comercial-agentes', 'comercial-estrutura'])
      if (item.href === '/rh/parceiros/config/comercial/tabela-locacao-veiculo') return canView('comercial-estrutura')
      if (item.href === '/') return true
      if (item.href === '/?sector=rh') return canView('workspace-rh')

      if (item.href.startsWith('/rh/parceiros/config/provedores')) return canSeeProviderRoute(item.href)

      if (item.href === '/promotoras') return canView('promotoras')
      if (item.href === '/agente-corban') return canView('agente-corban')
      if (item.href === '/agente-corban/niveis-acesso') return canView('agente-corban-niveis-acesso')
      if (item.href === '/agente-corban/tipos-agente') return canView('agente-corban-tipos-agente')
      if (item.href === '/agente-corban/regras-fisico') return canView('agente-corban-regras-fisico')
      if (item.href === '/rh/parceiros') return canView('scp-crm')
      if (item.href === '/rh/parceiros/config/processos') return canView('scp-processos')
      if (item.href === '/rh/parceiros/config/formularios') return canView('scp-construtor')
      if (item.href === '/rh/parceiros/config/documentos') return canView('scp-documentos')
      if (item.href === '/rh/parceiros/config/emails') return canView('scp-emails')
      if (item.href === '/rh/parceiros/config/whatsapp') return canView('scp-whatsapp')

      if (item.href === '/comunicados') return canView('sistema-comunicados')

      if (item.href === '/rh/colaboradores') return canView('rh-colaboradores')
      if (item.href === '/rh/importacoes') return canView('rh-importacoes')
      if (item.href === '/rh/vale-transporte') return canView('rh-vale-transporte')
      if (item.href === '/rh/medidas-disciplinares') return canView('rh-medidas-disciplinares')
      if (item.href === '/rh/motivos') return canView('rh-motivos')
      if (item.href === '/rh/unidades') return canView('rh-unidades')
      if (item.href === '/rh/relatorios') return canView('rh-relatorios')
      if (item.href === '/rh/auditoria') return canView('rh-auditoria')
      return false
    })
  }

  function renderSimpleSidebar(items: Array<NavItem | SidebarSection>) {
    const finalItems: Array<NavItem | SidebarSection> = []
    for (let i = 0; i < items.length; i++) {
      const current = items[i]
      if (isSection(current)) {
        let hasContent = false
        for (let j = i + 1; j < items.length; j++) {
          if (isSection(items[j])) break
          hasContent = true
        }
        if (hasContent) finalItems.push(current)
      } else {
        finalItems.push(current)
      }
    }

    return finalItems.map((item, idx) => {
      if (isSection(item)) {
        return (
          <div key={`section-${idx}`} className="sidebar-section-label">
            {item.label}
          </div>
        )
      }

      const Icon = item.icon
      return (
        <a key={item.href} href={item.href} className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}>
          <Icon size={18} />
          {item.label}
        </a>
      )
    })
  }

  useEffect(() => {
    if (!pathname.startsWith('/rh/parceiros/config/provedores')) return
    setGroupOpen((current) => {
      const next = { ...current }
      for (const group of providerGroups) {
        if (next[group.key] === undefined) {
          next[group.key] = group.defaultOpen ?? group.items.some((item) => isActive(item.href))
        }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const providerGroups: NavGroup[] = [
    {
      key: 'geral',
      label: 'Geral',
      defaultOpen: true,
      items: filterItems([
        { label: 'Cadastro da Empresa', href: '/rh/parceiros/config/provedores/empresas', icon: Building2 },
        { label: 'Tipos de Comercial', href: '/rh/parceiros/config/provedores/tipos-comercial', icon: BriefcaseBusiness },
        { label: 'Setores', href: '/rh/parceiros/config/provedores/setores', icon: Building },
        { label: 'Forma de Recebimento', href: '/rh/parceiros/config/provedores/formas-recebimento', icon: HandCoins },
        { label: 'Tipos de Sistemas', href: '/rh/parceiros/config/provedores/tipos-sistemas', icon: Cpu },
        { label: 'Tipos de Remuneração', href: '/rh/parceiros/config/provedores/tipos-remuneracao', icon: HandCoins },
      ]),
    },
    {
      key: 'api-integracao',
      label: 'API e Integração',
      defaultOpen: true,
      items: filterItems([
        { label: 'API E-mail', href: '/rh/parceiros/config/provedores/email', icon: Mail },
        { label: 'API WhatsApp', href: '/rh/parceiros/config/provedores/whatsapp', icon: MessageSquare },
        { label: 'API Assinatura Eletrônica', href: '/rh/parceiros/config/provedores/assinatura', icon: FileText },
        { label: 'Google', href: '/rh/parceiros/config/provedores/google', icon: Globe },
        { label: 'API CPF', href: '/rh/parceiros/config/provedores/cpf', icon: Key },
      ]),
    },
    {
      key: 'fiscal',
      label: 'Fiscal',
      defaultOpen: true,
      items: filterItems([
        { label: 'CNAE', href: '/rh/parceiros/config/provedores/cnae', icon: FileText },
        { label: 'CTN', href: '/rh/parceiros/config/provedores/ctn', icon: FileText },
        { label: 'NBS', href: '/rh/parceiros/config/provedores/nbs', icon: FileText },
        { label: 'Tipo de Emissão de NFSe', href: '/rh/parceiros/config/provedores/tipos-emissao-nfse', icon: FileText },
        { label: 'Regimes Tributários', href: '/rh/parceiros/config/provedores/regimes-tributarios', icon: Scale },
        { label: 'Recálculo Tributário', href: '/rh/parceiros/config/provedores/recalculo-tributario', icon: Calculator },
      ]),
    },
    {
      key: 'integracoes',
      label: 'Integrações (Em breve)',
      defaultOpen: true,
      items: filterItems([
        { label: 'API QuarkRH', href: '/rh/parceiros/config/provedores/breve?api=QuarkRH', icon: Users },
        { label: 'API Conta Azul', href: '/rh/parceiros/config/provedores/breve?api=ContaAzul', icon: BarChart2 },
        { label: 'API ARW', href: '/rh/parceiros/config/provedores/breve?api=ARW', icon: Key },
        { label: 'API Instituições Financeiras', href: '/rh/parceiros/config/provedores/breve?api=Instituicoes', icon: Building2 },
        { label: 'API CRM', href: '/rh/parceiros/config/provedores/breve?api=CRM', icon: UserCog },
      ]),
    },
  ]

  if (pathname.startsWith('/rh/parceiros/config/provedores')) {
    return (
      <>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setOpen(!open)}
          style={{
            position: 'fixed',
            top: '1rem',
            left: '1rem',
            zIndex: 50,
            display: 'none',
            background: 'var(--brs-navy)',
            color: '#fff',
            borderRadius: '8px',
          }}
          id="sidebar-toggle"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>

        {open && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39 }} onClick={() => setOpen(false)} />
        )}

        <aside className={`sidebar${open ? ' open' : ''}`}>
          <div style={{ height: '1.5rem' }} />

          <nav className="sidebar-nav">
            <div className="sidebar-nav-stack">
              {providerGroups
                .filter((group) => group.items.length > 0)
                .map((group) => {
                  const expanded = groupOpen[group.key] ?? group.defaultOpen ?? false
                  const activeCount = group.items.filter((item) => isActive(item.href)).length
                  return (
                    <div key={group.key} className="sidebar-group">
                      <button
                        type="button"
                        className={`sidebar-group-header${expanded ? ' open' : ''}${activeCount > 0 ? ' active' : ''}`}
                        onClick={() => setGroupOpen((current) => ({ ...current, [group.key]: !expanded }))}
                      >
                        <span>{group.label}</span>
                        <span className="sidebar-group-header-meta">
                          {activeCount > 0 ? <span className="sidebar-group-dot" /> : null}
                          <ChevronDown size={14} />
                        </span>
                      </button>

                      {expanded && (
                        <div className="sidebar-group-items">
                          {group.items.map((item) => {
                            const Icon = item.icon
                            return (
                              <a key={item.href} href={item.href} className={`sidebar-link sidebar-link-nested${isActive(item.href) ? ' active' : ''}`}>
                                <Icon size={18} />
                                {item.label}
                              </a>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

              <div className="sidebar-group">
                <div className="sidebar-section-label sidebar-section-label-spaced">Sistema</div>
                <a href="/" className={`sidebar-link${isActive('/') ? ' active' : ''}`}>
                  <LayoutDashboard size={18} />
                  Voltar ao Workspace
                </a>
              </div>
            </div>
          </nav>
        </aside>
      </>
    )
  }

  let navItems: Array<NavItem | SidebarSection> = []

  if (pathname.startsWith('/rh/parceiros/config/comercial')) {
    navItems = [
      { type: 'section', label: 'Cadastros Comerciais' },
      { label: 'Agentes Comerciais', href: '/rh/parceiros/config/comercial', icon: UserCog },
      { label: 'Preview Real', href: '/rh/parceiros/config/comercial/seletor', icon: Eye },
      { label: 'Links do Cartão Digital', href: '/rh/parceiros/config/comercial/links-cartao-digital', icon: Link2 },
      { label: 'Tabela de Locacao de Veiculo', href: '/rh/parceiros/config/comercial/tabela-locacao-veiculo', icon: Building2 },
      { type: 'section', label: 'Sistema' },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  } else if (pathname.startsWith('/promotoras')) {
    navItems = [
      { type: 'section', label: 'Promotoras' },
      { label: 'Promotoras', href: '/promotoras', icon: Users },
      { type: 'section', label: 'Sistema' },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  } else if (pathname.startsWith('/agente-corban')) {
    navItems = [
      { type: 'section', label: 'Agentes Corban' },
      { label: 'Agentes Corban', href: '/agente-corban', icon: UserCog },
      { label: 'Nível de Acesso', href: '/agente-corban/niveis-acesso', icon: Key },
      { label: 'Tipo de Agente', href: '/agente-corban/tipos-agente', icon: BriefcaseBusiness },
      { label: 'Regra de Físico', href: '/agente-corban/regras-fisico', icon: Scale },
      { type: 'section', label: 'Sistema' },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  } else if (pathname.startsWith('/rh/parceiros')) {
    navItems = [
      { type: 'section', label: 'CRM Parceiros' },
      { label: 'CRM Parceiros', href: '/rh/parceiros', icon: Users },
      { label: 'Construtor de Processo', href: '/rh/parceiros/config/processos', icon: LayoutGrid },
      { label: 'Construtor de Formulário', href: '/rh/parceiros/config/formularios', icon: FileText },
      { type: 'section', label: 'Modelos' },
      { label: 'Modelos de Documentos', href: '/rh/parceiros/config/documentos', icon: FileText },
      { label: 'Modelos de E-mails', href: '/rh/parceiros/config/emails', icon: Mail },
      { label: 'Modelos de WhatsApp', href: '/rh/parceiros/config/whatsapp', icon: MessageSquare },
      { type: 'section', label: 'Sistema' },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  } else if (pathname.startsWith('/comunicados')) {
    navItems = [
      { type: 'section', label: 'Comunicados' },
      { label: 'Lista de Comunicados', href: '/comunicados', icon: MessageSquare },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  } else {
    navItems = [
      { label: 'Painel RH', href: '/?sector=rh', icon: LayoutDashboard },
      { type: 'section', label: 'Colaboradores' },
      { label: 'Colaboradores', href: '/rh/colaboradores', icon: Users },
      { label: 'Importações', href: '/rh/importacoes', icon: Upload },
      { type: 'section', label: 'Documentos' },
      { label: 'Vale-Transporte', href: '/rh/vale-transporte', icon: Bus },
      { label: 'Medidas Disciplinares', href: '/rh/medidas-disciplinares', icon: AlertTriangle },
      { label: 'Motivos', href: '/rh/motivos', icon: BookOpen },
      { type: 'section', label: 'Configurações' },
      { label: 'Unidades', href: '/rh/unidades', icon: Building2 },
      { label: 'Relatórios', href: '/rh/relatorios', icon: BarChart2 },
      { label: 'Auditoria', href: '/rh/auditoria', icon: ClipboardList },
      { type: 'section', label: 'Sistema' },
      { label: 'Voltar ao Workspace', href: '/', icon: LayoutDashboard },
    ]
  }

  const filteredNavItems = filterItems(
    navItems.filter((item): item is NavItem => !isSection(item)),
  )

  return (
    <>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          top: '1rem',
          left: '1rem',
          zIndex: 50,
          display: 'none',
          background: 'var(--brs-navy)',
          color: '#fff',
          borderRadius: '8px',
        }}
        id="sidebar-toggle"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39 }} onClick={() => setOpen(false)} />
      )}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div style={{ height: '1.5rem' }} />

        <nav className="sidebar-nav">
          {renderSimpleSidebar(
            navItems.filter((item) => {
              if (isSection(item)) return true
              return filteredNavItems.some((navItem) => navItem.href === item.href)
            }),
          )}
        </nav>
      </aside>
    </>
  )
}
