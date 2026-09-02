/**
 * Cliente do provedor de IA (OpenRouter v1; Anthropic previsto como provedor
 * futuro do card — mesma interface). Fallback em duas camadas:
 * 1) `models` nativo do OpenRouter (ele pula sozinho modelo fora do ar/cota);
 * 2) nossa própria cadeia — se a REQUISIÇÃO inteira falhar (429/402/5xx),
 *    tentamos o próximo modelo da lista por conta própria.
 */

export type IaTurno = { role: 'system' | 'user' | 'assistant'; content: string }

export type IaStreamResultado = {
  texto: string
  modeloUsado: string
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function streamDeUmaChamada(
  apiKey: string,
  modelos: string[],
  mensagens: IaTurno[],
  onDelta: (texto: string) => void,
  signal?: AbortSignal,
): Promise<IaStreamResultado> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://gestao.brspromotora.com.br',
      'X-Title': 'BRS Workspace - Jarvis',
    },
    body: JSON.stringify({
      model: modelos[0],
      models: modelos, // fallback nativo do OpenRouter
      messages: mensagens,
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    const corpo = await res.text().catch(() => '')
    const err = new Error(`OpenRouter ${res.status}: ${corpo.slice(0, 300)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let texto = ''
  let modeloUsado = modelos[0]

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const linhas = buffer.split('\n')
    buffer = linhas.pop() || ''
    for (const linha of linhas) {
      const l = linha.trim()
      if (!l.startsWith('data:')) continue
      const payload = l.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        if (json.model) modeloUsado = String(json.model)
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          texto += delta
          onDelta(delta)
        }
      } catch {
        // linha parcial/keep-alive — ignora
      }
    }
  }

  if (!texto.trim()) {
    throw new Error('O modelo não devolveu resposta (possível cota esgotada).')
  }
  return { texto, modeloUsado }
}

export async function conversarComFallback(
  apiKey: string,
  modelos: string[],
  mensagens: IaTurno[],
  onDelta: (texto: string) => void,
  signal?: AbortSignal,
): Promise<IaStreamResultado> {
  const lista = modelos.filter(Boolean)
  if (!lista.length) throw new Error('Nenhum modelo configurado.')

  let ultimoErro: unknown = null
  // 1ª tentativa: lista inteira (fallback nativo). Depois, um a um a partir
  // do segundo — cobre o caso da requisição inteira falhar (ex.: 429 global).
  const tentativas: string[][] = [lista, ...lista.slice(1).map((m) => [m])]
  for (const modelosTentativa of tentativas) {
    try {
      return await streamDeUmaChamada(apiKey, modelosTentativa, mensagens, onDelta, signal)
    } catch (err) {
      ultimoErro = err
      if (signal?.aborted) throw err
      const status = (err as { status?: number }).status
      // erro de autenticação não adianta repetir com outro modelo
      if (status === 401 || status === 403) throw err
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Falha ao consultar a IA.')
}
