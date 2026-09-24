/**
 * Poll que respeita a Page Visibility API: não bate no servidor enquanto a
 * aba está em segundo plano e refaz uma vez assim que ela volta a ficar
 * visível (mesmo desenho do CRM AlvoConsig, commit d2fd373). Retorno é o
 * cleanup para o useEffect.
 *
 * Motivo (13/09/2026): cada requisição gera evento de Observability na
 * Vercel; polls montados no layout raiz rodavam para todo usuário logado, o
 * dia inteiro, inclusive em abas esquecidas abertas.
 */
export function pollingVisivel(
  fn: () => Promise<unknown> | unknown,
  ms: number,
  opcoes: { imediato?: boolean } = {},
): () => void {
  let executando = false
  const executar = async () => {
    if (executando) return
    executando = true
    try {
      await fn()
    } catch {
      // Silencia exceções para não interromper o timer do polling
    } finally {
      executando = false
    }
  }
  const visivel = () => typeof document === 'undefined' || !document.hidden

  if (opcoes.imediato !== false) void executar()
  const timer = setInterval(() => {
    if (visivel()) void executar()
  }, ms)
  const aoMudarVisibilidade = () => {
    if (visivel()) void executar()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', aoMudarVisibilidade)
  return () => {
    clearInterval(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  }
}
