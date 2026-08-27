import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, getRouteAccessDecision } from '@/lib/auth/permissions'
import { getEffectivePermissionsForUserId } from '@/lib/auth/effectivePermissions'
import { WORKSPACE_AUTH_COOKIE_NAME, isWorkspaceAuthCookie } from '@/lib/supabase/authCookie'

function isApiRequest(pathname: string) {
  return pathname.startsWith('/api/')
}

function isServerActionRequest(request: NextRequest) {
  return request.headers.has('next-action')
}

function isPublicAssetRequest(pathname: string) {
  return (
    pathname === '/notificacao-brs.mp3' ||
    pathname === '/notificacao-chat-brs.mp3' ||
    pathname.endsWith('.mp3') ||
    pathname.endsWith('.ogg') ||
    pathname.endsWith('.wav') ||
    pathname.endsWith('.m4a')
  )
}

function isAuthenticatedOpenApi(pathname: string) {
  // Rotas de API liberadas a qualquer usuário autenticado (sem permissão específica).
  // A validação real da sessão é feita no handler via getUser().
  return pathname.startsWith('/api/comunicados') || pathname.startsWith('/api/cnpjws')
}

function forbiddenResponse(request: NextRequest) {
  if (isApiRequest(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Sem permissao.' }, { status: 403 })
  }

  const url = request.nextUrl.clone()
  url.pathname = '/acesso-negado'
  url.searchParams.set('from', request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

function hasSupabaseSessionCookie(request: NextRequest) {
  // Só o cookie EXCLUSIVO do Workspace conta como sessão. Cookies SSO do
  // portal/CRM (sb-<ref>-auth-token, domain=.brspromotora.com.br) chegam a
  // este host mas pertencem a outra aplicação — ver src/lib/supabase/authCookie.ts.
  return request.cookies.getAll().some(({ name }) => isWorkspaceAuthCookie(name))
}

function isLegacySupabaseCookie(name: string) {
  return name.startsWith('sb-') && name.includes('auth-token')
}

// Expira o cookie host-only ANTIGO do Workspace (nome padrão do Supabase),
// que ficou órfão após a migração para o nome exclusivo. O delete SEM o
// atributo domain não alcança o cookie SSO de domínio do portal/CRM — apenas
// o homônimo host-only deste host é removido.
function expireLegacyAuthCookies(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (isLegacySupabaseCookie(name)) {
      response.cookies.set(name, '', { maxAge: 0, path: '/' })
    }
  }
  return response
}

function getRequestHost(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const hostHeader = request.headers.get('host')
  const rawHost = forwardedHost || hostHeader || request.nextUrl.hostname || ''
  return rawHost.toLowerCase().replace(/:\d+$/, '')
}

function getPublicCardSlugFromHost(request: NextRequest) {
  const hostname = getRequestHost(request)
  if (!hostname.endsWith('.brspromotora.com.br')) return null

  const slug = hostname.replace('.brspromotora.com.br', '')
  if (
    !slug ||
    ['workspace', 'gestao', 'www', 'app', 'api', 'auth', 'login', 'cartao', 'links', 'cadastro-parceiro', 'acesso-negado'].includes(slug)
  ) {
    return null
  }
  return slug
}

// Circuito por instância de função (não é distribuído entre lambdas, mas
// numa instância "quente" atendendo várias requisições em sequência evita
// martelar o Supabase Auth com uma chamada de 4s por requisição quando ele
// já está instável/fora do ar — reduz nossa contribuição pra tempestade de
// retries em cima de um Auth já degradado.
type AuthCircuitState = { openUntil: number; consecutiveFailures: number }
const authCircuit: AuthCircuitState = { openUntil: 0, consecutiveFailures: 0 }
const AUTH_CIRCUIT_FAILURE_THRESHOLD = 3
const AUTH_CIRCUIT_OPEN_MS = 15000

async function getUserWithTimeout(
  supabase: ReturnType<typeof createServerClient>,
  timeoutMs = 4000,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Supabase auth timeout after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const publicCardSlug = getPublicCardSlugFromHost(request)

  if (publicCardSlug && (pathname === '/' || pathname === '')) {
    const url = request.nextUrl.clone()
    url.pathname = '/cartao'
    url.search = ''
    url.searchParams.set('slug', publicCardSlug)
    return NextResponse.rewrite(url)
  }

  if (publicCardSlug && pathname === '/links') {
    const url = request.nextUrl.clone()
    url.pathname = '/cartao'
    url.search = ''
    url.searchParams.set('slug', publicCardSlug)
    url.searchParams.set('view', 'links')
    return NextResponse.rewrite(url)
  }

  // Do not intercept internal Next.js endpoints (RSC/Flight/Server Actions)
  // so navigation does not get stuck waiting on auth checks.
  if (pathname.startsWith('/_next')) {
    return NextResponse.next({ request })
  }

  // Public routes that should stay responsive even if auth is slow or unavailable.
  const publicRoutes = [
    '/login',
    '/auth/callback',
    '/api/auth/google',
    '/acesso-negado',
    '/cadastro-parceiro',
    '/cartao',
    '/api/lookups',
    '/api/cpfhub',
    // Autenticam por segredo no próprio handler (Vercel Cron / webhook Assinafy).
    '/api/cron',
    '/api/assinafy/webhook',
    '/api/zapi/webhook',
    // Autentica por NVTI_SERVICE_TOKEN no handler (rota de serviço dos orquestradores).
    '/api/nvti/interno',
  ]
  const isPublicRoute = publicRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`))
  if (isPublicAssetRequest(pathname)) {
    return NextResponse.next({ request })
  }
  const hasSessionCookie = hasSupabaseSessionCookie(request)

  if (isPublicRoute && !hasSessionCookie) {
    return NextResponse.next({ request })
  }

  if (!hasSessionCookie) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 })
    }

    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return expireLegacyAuthCookies(request, NextResponse.redirect(url))
  }

  if (isAuthenticatedOpenApi(pathname)) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: WORKSPACE_AUTH_COOKIE_NAME },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null

  // Redireciona pro login sinalizando ?motivo=instabilidade quando o motivo
  // for o Supabase Auth não responder a tempo (timeout/disjuntor aberto),
  // pra distinguir na tela de login de uma sessão realmente inválida — sem
  // isso, os dois casos pareciam igualmente "e-mail ou senha inválidos".
  function redirectParaLoginPorInstabilidade() {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('motivo', 'instabilidade')
    return NextResponse.redirect(url)
  }

  if (authCircuit.openUntil > Date.now()) {
    if (isPublicRoute) {
      return supabaseResponse
    }

    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Servico de autenticacao instavel. Tente novamente em instantes.' }, { status: 503 })
    }

    return redirectParaLoginPorInstabilidade()
  }

  try {
    const authResult = await getUserWithTimeout(supabase)
    user = authResult.data.user
    authCircuit.consecutiveFailures = 0
    authCircuit.openUntil = 0
  } catch (error) {
    console.error('Erro ao validar sessao no proxy:', error)

    authCircuit.consecutiveFailures += 1
    if (authCircuit.consecutiveFailures >= AUTH_CIRCUIT_FAILURE_THRESHOLD) {
      authCircuit.openUntil = Date.now() + AUTH_CIRCUIT_OPEN_MS
    }

    if (isPublicRoute) {
      return supabaseResponse
    }

    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Servico de autenticacao instavel. Tente novamente em instantes.' }, { status: 503 })
    }

    return redirectParaLoginPorInstabilidade()
  }

  // Cookie de sessão presente mas inválido: getUser() devolve user=null sem lançar.
  // Sem este tratamento, a requisição atravessaria o proxy sem sessão e sem checagem de rota.
  if (!user && !isPublicRoute) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // O cookie SSO tem domain=.brspromotora.com.br: sessões de PARCEIROS (portal)
  // e de usuários do CRM AlvoConsig chegam até aqui. O Workspace é só para
  // usuários internos — bloqueia qualquer sessão externa.
  const userEmail = String(user?.email || '').toLowerCase()
  const isExternalUser = Boolean(
    user &&
      (userEmail.endsWith('@parceiro.brspromotora.com.br') ||
        (user as { app_metadata?: { external?: string | boolean } }).app_metadata?.external),
  )
  if (isExternalUser) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Acesso restrito a usuários internos.' }, { status: 403 })
    }
    return NextResponse.redirect('https://parceiro.brspromotora.com.br/')
  }

  // Troca de senha obrigatória no primeiro acesso (flag no app_metadata).
  const mustChangePassword = Boolean(
    (user as { app_metadata?: { temp_password_reset_required?: boolean } } | null)
      ?.app_metadata?.temp_password_reset_required,
  )
  const isChangePasswordRoute = pathname === '/trocar-senha' || pathname.startsWith('/trocar-senha/')

  // A própria tela de troca fica sempre acessível ao usuário logado.
  if (user && isChangePasswordRoute) {
    return supabaseResponse
  }

  // Enquanto a flag estiver ligada, bloqueia o resto do app. Server actions passam
  // (a action que limpa a flag precisa rodar); rotas de auth também.
  if (user && mustChangePassword && !isServerActionRequest(request) && !pathname.startsWith('/api/auth')) {
    if (isApiRequest(pathname)) {
      return NextResponse.json({ error: 'Troca de senha obrigatória.' }, { status: 403 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/trocar-senha'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  if (user && !isPublicRoute && !isServerActionRequest(request)) {
    const decision = getRouteAccessDecision(pathname, request.nextUrl.searchParams)

    if (decision.type === 'deny') {
      return forbiddenResponse(request)
    }

    if (decision.type === 'permission') {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!serviceRoleKey) return forbiddenResponse(request)

      try {
        const admin = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceRoleKey,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          },
        )
        const permissions = await getEffectivePermissionsForUserId(admin, user.id)
        if (!canAccessRoute(permissions, decision.rule)) {
          return forbiddenResponse(request)
        }
      } catch (error) {
        console.error('Erro ao validar permissao de rota:', error)
        return forbiddenResponse(request)
      }
    }
  }

  return expireLegacyAuthCookies(request, supabaseResponse)
}
