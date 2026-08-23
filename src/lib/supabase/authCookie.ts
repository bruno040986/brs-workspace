// Nome EXCLUSIVO do cookie de sessão do Workspace.
//
// O SSO do portal/CRM grava cookies de sessão com o nome padrão do Supabase
// (sb-<ref>-auth-token) para o domínio inteiro (.brspromotora.com.br). Se o
// Workspace usar o mesmo nome, o navegador passa a ter dois cookies homônimos
// (host-only × domínio) e requisições podem enxergar a sessão errada — foi o
// que causou a troca de senha acidental e o loop de login de 23/08/2026.
// Um nome próprio torna a colisão impossível.
export const WORKSPACE_AUTH_COOKIE_NAME = 'brs-workspace-auth'

export function isWorkspaceAuthCookie(name: string) {
  // Cookies grandes são fatiados pelo @supabase/ssr em <nome>.0, <nome>.1, ...
  return name === WORKSPACE_AUTH_COOKIE_NAME || name.startsWith(`${WORKSPACE_AUTH_COOKIE_NAME}.`)
}
