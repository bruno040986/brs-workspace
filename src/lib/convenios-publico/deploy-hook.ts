// Rebuild do site estático da NuAzul via Deploy Hook da Vercel. Nunca lança.
// Sem a env NUAZUL_DEPLOY_HOOK_URL não faz nada.

export async function chamarHook(url: string): Promise<void> {
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function dispararRebuildNuAzul(
  motivo: 'publicar' | 'retirar',
  slug: string,
  chamar: (url: string) => Promise<void> = chamarHook,
): Promise<void> {
  const url = process.env.NUAZUL_DEPLOY_HOOK_URL?.trim()
  if (!url) return
  try {
    await chamar(url)
  } catch (e) {
    // só o nome do erro e um status: a mensagem do fetch pode conter a URL do hook
    try {
      const { logSeguro } = await import('../promocoes/http')
      logSeguro('convenios-publico.deploy-hook', new Error(`rebuild NuAzul falhou (${motivo}, ${slug}): ${e instanceof Error ? e.name : 'erro'}`))
    } catch {
      // log nunca derruba o fluxo
    }
  }
}
