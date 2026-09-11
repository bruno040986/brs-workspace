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

// ---------------------------------------------------------------------------
// Chamada única (sem stream) com JSON estruturado + busca na web opcional —
// usada pela pesquisa de convênios (Base de Conhecimento, Fase 3). Nada a
// ver com o chat (`conversarComFallback`, acima): aqui é sempre 1 pergunta,
// 1 resposta, sem histórico de conversa.
// ---------------------------------------------------------------------------
export type IaAnotacao = { url: string; title?: string; content?: string }

export type IaJsonResultado = {
  texto: string
  anotacoes: IaAnotacao[]
  modeloUsado: string
}

// Sem timeout próprio, uma chamada com busca na web (várias buscas + leitura
// de várias páginas + geração) pode passar do limite da função serverless —
// foi exatamente o que travou a primeira pesquisa real (10/09/2026): a
// Vercel matou a função à força depois de 60s, sem a chamada nunca lançar um
// erro JS normal, deixando o lease preso e sem mensagem nenhuma pro usuário.
const TIMEOUT_PADRAO_MS = 55_000

export async function chamarIaJson(params: {
  apiKey: string
  modelo: string
  mensagens: IaTurno[]
  /** Liga o plugin `web` do OpenRouter — qualquer modelo passa a buscar na internet. */
  buscaWeb?: { maxResultados: number }
  maxTokens?: number
  /**
   * Modelos de raciocínio (GPT-5.x, Claude com extended thinking...) cobram
   * `max_tokens` de RACIOCÍNIO + RESPOSTA juntos — sem limitar o esforço, o
   * modelo pode gastar o orçamento inteiro "pensando" (ainda mais com o
   * plugin de busca no meio) e devolver `content` vazio, sem nunca chegar a
   * escrever o JSON pedido. Foi o que aconteceu na 1ª pesquisa real
   * (11/09/2026, GPT-5.2): 3 tentativas, mesma falha determinística, US$0,72
   * gastos sem resultado nenhum. Default 'low' — aqui queremos um JSON
   * direto, não uma investigação profunda; modelos sem suporte a "reasoning"
   * ignoram o campo (é o comportamento documentado do OpenRouter).
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none'
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<IaJsonResultado> {
  const { apiKey, modelo, mensagens, buscaWeb, maxTokens, reasoningEffort = 'low', signal, timeoutMs = TIMEOUT_PADRAO_MS } = params

  const body: Record<string, unknown> = {
    model: modelo,
    messages: mensagens,
    reasoning: { effort: reasoningEffort },
  }
  if (buscaWeb) {
    body.plugins = [{ id: 'web', max_results: Math.max(1, Math.min(buscaWeb.maxResultados, 10)) }]
  }
  if (maxTokens) body.max_tokens = maxTokens

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  // se quem chamou também passou um signal, aborta se QUALQUER um dos dois disparar
  signal?.addEventListener('abort', () => controller.abort())

  let res: Response
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://gestao.brspromotora.com.br',
        'X-Title': 'BRS Workspace - Jarvis (pesquisa de convênios)',
      },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`A IA demorou mais que ${Math.round(timeoutMs / 1000)}s para responder — tente novamente (o progresso já feito não se perde).`)
    }
    throw new Error(`Falha de rede ao chamar a IA: ${e?.message || e}`)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    const err = new Error(`OpenRouter ${res.status}: ${corpo.slice(0, 300)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const json = await res.json().catch(() => null)
  const escolha = json?.choices?.[0]
  const message = escolha?.message
  const texto = typeof message?.content === 'string' ? message.content : ''
  if (!texto.trim()) {
    // finish_reason 'length' = estourou max_tokens (o caso mais comum com
    // modelo de raciocínio: gastou tudo "pensando" e não sobrou pra
    // resposta) — diagnóstico direto na mensagem, sem precisar ir aos logs.
    const motivo =
      escolha?.finish_reason === 'length'
        ? `o modelo "${modelo}" gastou todo o limite de tokens (max_tokens=${maxTokens ?? 'padrão'}) sem terminar a resposta — aumente o limite ou reduza o esforço de raciocínio`
        : 'possível cota esgotada, sem crédito ou erro do provedor'
    throw new Error(`O modelo não devolveu resposta (${motivo}).`)
  }

  const anotacoes: IaAnotacao[] = Array.isArray(message?.annotations)
    ? message.annotations
        .filter((a: any) => a?.type === 'url_citation' && a?.url_citation?.url)
        .map((a: any) => ({
          url: String(a.url_citation.url),
          title: a.url_citation.title ? String(a.url_citation.title) : undefined,
          content: a.url_citation.content ? String(a.url_citation.content) : undefined,
        }))
    : []

  return { texto, anotacoes, modeloUsado: String(json?.model || modelo) }
}

/**
 * Extrai o primeiro objeto JSON de um texto que pode vir com cerca de código
 * (```json ... ```) e/ou frases antes/depois — pega do primeiro `{` ao
 * último `}`. Lança erro claro se não achar nada parseável.
 */
export function extrairJson<T = unknown>(texto: string): T {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error('A IA não devolveu um JSON válido.')
  }
  const candidato = texto.slice(inicio, fim + 1)
  try {
    return JSON.parse(candidato) as T
  } catch (e: any) {
    throw new Error(`Falha ao interpretar o JSON da IA: ${e.message}`)
  }
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
