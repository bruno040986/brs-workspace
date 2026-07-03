export type PermissionAction =
  | 'can_view'
  | 'can_include'
  | 'can_edit'
  | 'can_delete'
  | 'can_activate_inactivate'

export type EffectivePermission = {
  resource_name: string
  can_view?: boolean | null
  can_include?: boolean | null
  can_edit?: boolean | null
  can_delete?: boolean | null
  can_activate_inactivate?: boolean | null
}

export type PermissionRequirement = {
  resource: string
  action?: PermissionAction
}

export type RouteAccessRule = {
  mode: 'all' | 'any'
  requirements: PermissionRequirement[]
}

export type RouteAccessDecision =
  | { type: 'open' }
  | { type: 'permission'; rule: RouteAccessRule }
  | { type: 'deny' }

const view = (resource: string): PermissionRequirement => ({ resource, action: 'can_view' })
const include = (resource: string): PermissionRequirement => ({ resource, action: 'can_include' })

const scpAutomationLibraryResources = [
  'scp-acoes-gatilhos',
  'scp-processos',
  'scp-construtor',
  'scp-documentos',
  'scp-emails',
  'scp-whatsapp',
  'scp-crm',
]

export const providerBriefPermissionByApi: Record<string, string> = {
  google: 'sistema-config-google',
  quarkrh: 'sistema-config-quarkrh',
  contaazul: 'sistema-config-contaazul',
  arw: 'sistema-config-arw',
  instituicoes: 'sistema-config-instituicoes',
  crm: 'sistema-config-crm',
}

export const systemConfigNavEntries = [
  { resource: 'sistema-config-email', href: '/rh/parceiros/config/provedores/email' },
  { resource: 'sistema-config-whatsapp', href: '/rh/parceiros/config/provedores/whatsapp' },
  { resource: 'sistema-config-assinatura', href: '/rh/parceiros/config/provedores/assinatura' },
  { resource: 'sistema-config-empresa', href: '/rh/parceiros/config/provedores/empresas' },
  { resource: 'sistema-config-google', href: '/rh/parceiros/config/provedores/google' },
  { resource: 'sistema-config-cpf', href: '/rh/parceiros/config/provedores/cpf' },
  { resource: 'sistema-config-cnae', href: '/rh/parceiros/config/provedores/cnae' },
  { resource: 'sistema-config-ctn', href: '/rh/parceiros/config/provedores/ctn' },
  { resource: 'sistema-config-nbs', href: '/rh/parceiros/config/provedores/nbs' },
  { resource: 'sistema-config-tipos-comercial', href: '/rh/parceiros/config/provedores/tipos-comercial' },
  { resource: 'sistema-config-setores', href: '/rh/parceiros/config/provedores/setores' },
  { resource: 'sistema-config-nfse-emissao', href: '/rh/parceiros/config/provedores/tipos-emissao-nfse' },
  { resource: 'sistema-config-formas-recebimento', href: '/rh/parceiros/config/provedores/formas-recebimento' },
  { resource: 'sistema-config-tipos-remuneracao', href: '/rh/parceiros/config/provedores/tipos-remuneracao' },
  { resource: 'sistema-config-tipos-sistemas', href: '/rh/parceiros/config/provedores/tipos-sistemas' },
  { resource: 'sistema-config-regimes-tributarios', href: '/rh/parceiros/config/provedores/regimes-tributarios' },
  { resource: 'sistema-config-recalculo-tributario', href: '/rh/parceiros/config/provedores/recalculo-tributario' },
  { resource: 'sistema-config-instituicoes', href: '/rh/parceiros/config/provedores/instituicoes-financeiras' },
  { resource: 'sistema-config-quarkrh', href: '/rh/parceiros/config/provedores/breve?api=QuarkRH' },
  { resource: 'sistema-config-contaazul', href: '/rh/parceiros/config/provedores/breve?api=ContaAzul' },
  { resource: 'sistema-config-arw', href: '/rh/parceiros/config/provedores/breve?api=ARW' },
  { resource: 'sistema-config-crm', href: '/rh/parceiros/config/provedores/breve?api=CRM' },
  { resource: 'scp-acoes-gatilhos', href: '/rh/parceiros/config/acoes-gatilhos' },
] as const

export const systemConfigRouteOptions: PermissionRequirement[] = [
  ...systemConfigNavEntries.map(({ resource }) => view(resource)),
]

export function hasScpAutomationLibraryAccess(
  permissions: readonly EffectivePermission[],
  action: PermissionAction = 'can_view',
) {
  return hasAnyPermission(
    permissions,
    scpAutomationLibraryResources.map((resource) => ({ resource, action })),
  )
}

const any = (requirements: PermissionRequirement[]): RouteAccessRule => ({
  mode: 'any',
  requirements,
})

const all = (requirements: PermissionRequirement[]): RouteAccessRule => ({
  mode: 'all',
  requirements,
})

const exactRouteRules: Record<string, RouteAccessRule> = {
  '/usuarios': any([
    view('sistema-usuarios-root'),
    view('sistema-usuarios-cadastro'),
    view('sistema-usuarios-perfis'),
  ]),
  '/links': any([view('sistema-links')]),
  '/comunicados': any([view('sistema-comunicados')]),
  '/rh': any([view('rh-painel')]),
  '/api/import': any([include('rh-importacoes')]),
  '/api/users/list': any([
    view('sistema-usuarios-root'),
    view('sistema-usuarios-cadastro'),
    view('sistema-usuarios-perfis'),
  ]),
  '/rh/parceiros/config': any(systemConfigRouteOptions),
  '/rh/parceiros/config/provedores': any(systemConfigRouteOptions),
  '/rh/parceiros/config/empresas': any([view('sistema-config-empresa')]),
  '/rh/parceiros/config/provedores/empresas': any([view('sistema-config-empresa')]),
  '/rh/parceiros/config/provedores/email': any([view('sistema-config-email')]),
  '/rh/parceiros/config/provedores/whatsapp': any([view('sistema-config-whatsapp')]),
  '/rh/parceiros/config/provedores/assinatura': any([view('sistema-config-assinatura')]),
  '/rh/parceiros/config/provedores/google': any([view('sistema-config-google')]),
  '/rh/parceiros/config/provedores/cpf': any([view('sistema-config-cpf')]),
  '/rh/parceiros/config/provedores/nbs': any([view('sistema-config-nbs')]),
  '/rh/parceiros/config/provedores/regimes-tributarios': any(systemConfigRouteOptions),
  '/rh/parceiros/config/provedores/recalculo-tributario': any(systemConfigRouteOptions),
  '/rh/parceiros/config/provedores/instituicoes-financeiras': any([view('sistema-config-instituicoes')]),
  '/rh/parceiros/config/acoes-gatilhos': any(
    scpAutomationLibraryResources.map((resource) => view(resource)),
  ),
  '/instituicoes-financeiras': any([view('sistema-config-instituicoes')]),
  '/rh/parceiros/config/provedores/tipos-comercial': any([view('sistema-config-comercial-tipos')]),
  '/rh/parceiros/config/provedores/setores': any([view('sistema-config-setores')]),
  '/rh/parceiros/config/provedores/tipos-emissao-nfse': any([view('sistema-config-nfse-emissao')]),
  '/rh/parceiros/config/provedores/formas-recebimento': any([view('sistema-config-formas-recebimento')]),
  '/rh/parceiros/config/provedores/tipos-remuneracao': any([view('sistema-config-tipos-remuneracao')]),
  '/rh/parceiros/config/provedores/tipos-sistemas': any([view('sistema-config-tipos-sistemas')]),
  '/promotoras': any([view('promotoras')]),
  '/agente-corban': any([view('agente-corban')]),
  '/agente-corban/niveis-acesso': any([view('agente-corban-niveis-acesso')]),
  '/agente-corban/tipos-agente': any([view('agente-corban-tipos-agente')]),
  '/agente-corban/regras-fisico': any([view('agente-corban-regras-fisico')]),
  '/rh/parceiros/config/comercial/links-cartao-digital': any([view('comercial-agentes'), view('comercial-estrutura')]),
  '/rh/parceiros/config/comercial/seletor': any([view('comercial-agentes'), view('comercial-estrutura')]),
  '/rh/parceiros/config/comercial/preview-real': any([view('comercial-agentes'), view('comercial-estrutura')]),
  '/seletor': any([view('comercial-agentes'), view('comercial-estrutura')]),
}

const authenticatedOpenRoutes = new Set([
  '/api/auth/google/url',
  '/api/auth/google/callback',
  '/api/calendar/check-connection',
  '/api/calendar/create-event',
  '/api/calendar/events',
  '/api/chat/contacts',
  '/api/chat/profile',
  '/api/chat/presence',
  '/api/chat/upload',
  '/api/chat/conversations',
  '/api/chat/messages',
])

const prefixRouteRules: Array<[string, RouteAccessRule]> = [
  ['/rh/vale-transporte/novo', any([include('rh-vale-transporte')])],
  ['/rh/vale-transporte/opcao', any([include('rh-vale-transporte')])],
  ['/rh/vale-transporte/recusa', any([include('rh-vale-transporte')])],
  ['/rh/vale-transporte/visualizar', any([view('rh-vale-transporte')])],
  ['/rh/medidas-disciplinares/nova', any([include('rh-medidas-disciplinares')])],
  ['/rh/parceiros/config/comercial', any([view('comercial-agentes'), view('comercial-estrutura')])],
  ['/rh/parceiros/config/provedores/nbs', any([view('sistema-config-nbs')])],
  ['/rh/parceiros/config/provedores/cpf', any([view('sistema-config-cpf')])],
  ['/rh/parceiros/config/provedores/regimes-tributarios', any(systemConfigRouteOptions)],
  ['/rh/parceiros/config/provedores/recalculo-tributario', any(systemConfigRouteOptions)],
  ['/rh/parceiros/config/provedores/instituicoes-financeiras', any([view('sistema-config-instituicoes')])],
  ['/instituicoes-financeiras', any([view('sistema-config-instituicoes')])],
  ['/rh/parceiros/config/processos', any([view('scp-processos')])],
  ['/rh/parceiros/config/formularios', any([view('scp-construtor')])],
  ['/rh/parceiros/config/documentos', any([view('scp-documentos')])],
  ['/rh/parceiros/config/acoes-gatilhos', any(scpAutomationLibraryResources.map((resource) => view(resource)))],
  ['/rh/parceiros/config/templates', any([view('scp-documentos'), view('scp-emails')])],
  ['/rh/parceiros/config/emails', any([view('scp-emails')])],
  ['/rh/parceiros/config/whatsapp', any([view('scp-whatsapp')])],
  ['/agente-corban', any([view('agente-corban')])],
  ['/agente-corban/niveis-acesso', any([view('agente-corban-niveis-acesso')])],
  ['/agente-corban/tipos-agente', any([view('agente-corban-tipos-agente')])],
  ['/agente-corban/regras-fisico', any([view('agente-corban-regras-fisico')])],
  ['/promotoras', any([view('promotoras')])],
  ['/rh/colaboradores', any([view('rh-colaboradores')])],
  ['/rh/importacoes', any([view('rh-importacoes')])],
  ['/rh/vale-transporte', any([view('rh-vale-transporte')])],
  ['/rh/medidas-disciplinares', any([view('rh-medidas-disciplinares')])],
  ['/rh/motivos', any([view('rh-motivos')])],
  ['/rh/unidades', any([view('rh-unidades')])],
  ['/rh/relatorios', any([view('rh-relatorios')])],
  ['/rh/auditoria', any([view('rh-auditoria')])],
  ['/rh/parceiros', any([view('scp-crm')])],
]

function normalizePath(pathname: string) {
  if (!pathname) return '/'
  const clean = pathname.split('?')[0] || '/'
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function getRouteAccessDecision(
  pathname: string,
  searchParams?: URLSearchParams,
): RouteAccessDecision {
  const normalizedPath = normalizePath(pathname)

  if (normalizedPath === '/') return { type: 'open' }

  if (normalizedPath === '/rh/parceiros/config/provedores/breve') {
    const api = String(searchParams?.get('api') || '').trim().toLowerCase()
    const resource = providerBriefPermissionByApi[api]
    return resource ? { type: 'permission', rule: any([view(resource)]) } : { type: 'deny' }
  }

  const exactRule = exactRouteRules[normalizedPath]
  if (exactRule) return { type: 'permission', rule: exactRule }

  if (authenticatedOpenRoutes.has(normalizedPath)) return { type: 'open' }

  const prefixRule = prefixRouteRules
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => matchesPrefix(normalizedPath, prefix))

  if (prefixRule) return { type: 'permission', rule: prefixRule[1] }

  return { type: 'deny' }
}

export function hasPermission(
  permissions: readonly EffectivePermission[],
  resource: string,
  action: PermissionAction = 'can_view',
) {
  const permission = permissions.find((item) => item.resource_name === resource)
  return permission ? Boolean(permission[action]) : false
}

export function hasAnyPermission(
  permissions: readonly EffectivePermission[],
  requirements: readonly PermissionRequirement[],
) {
  return requirements.some((requirement) =>
    hasPermission(permissions, requirement.resource, requirement.action || 'can_view'),
  )
}

export function hasAllPermissions(
  permissions: readonly EffectivePermission[],
  requirements: readonly PermissionRequirement[],
) {
  return requirements.every((requirement) =>
    hasPermission(permissions, requirement.resource, requirement.action || 'can_view'),
  )
}

export function canAccessRoute(permissions: readonly EffectivePermission[], rule: RouteAccessRule) {
  return rule.mode === 'all'
    ? hasAllPermissions(permissions, rule.requirements)
    : hasAnyPermission(permissions, rule.requirements)
}

export const strictAll = all
