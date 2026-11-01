import type { ResultadoEnvio, TelegramAdapter } from '../tipos.ts'

/**
 * Telegram Bot API sendMessage. Sem parse_mode (texto puro: nada a escapar, nada interpretado).
 * O token entra na URL (exigência da API) e NUNCA em log nem em mensagem de erro.
 * Classificação (PT02 §5.4): ok+message_id => aceita; 429 => limitada(retry_after); 5xx => rejeitada transitória;
 * 400/401/403/404 => rejeitada permanente; timeout/queda/corpo ilegível => INCERTA (sem idempotência no Telegram).
 */
export class TelegramBotAdapter implements TelegramAdapter {
  private token: string
  private chatId: string
  private opts: { timeoutMs?: number; fetchImpl?: typeof fetch }
  constructor(token: string, chatId: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) { this.token = token; this.chatId = chatId; this.opts = opts }

  async enviar({ texto }: { texto: string }): Promise<ResultadoEnvio> {
    const f = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await f(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: texto.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
      })
    } catch {
      return { tipo: 'incerta', categoria: 'timeout_ou_rede' } // o pedido pode ter chegado
    }
    let corpo: { ok?: boolean; result?: { message_id?: number }; parameters?: { retry_after?: number } } | null = null
    try { corpo = JSON.parse(await res.text()) } catch { /* ilegível */ }
    if (res.status === 429) return { tipo: 'limitada', retryAfterSeg: Math.min(Math.max(Number(corpo?.parameters?.retry_after) || 30, 1), 3600) }
    if (res.ok) {
      return corpo?.ok === true && corpo.result?.message_id !== undefined
        ? { tipo: 'aceita', messageId: String(corpo.result.message_id) }
        : { tipo: 'incerta', categoria: 'resposta_ilegivel' }
    }
    if (res.status >= 500) return { tipo: 'rejeitada', categoria: 'http_5xx', http: res.status, transitoria: true }
    return { tipo: 'rejeitada', categoria: `http_${res.status}`, http: res.status }
  }
}
