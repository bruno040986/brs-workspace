import type { EmailAdapter, ResultadoEnvio } from '../tipos.ts'

/** Último canal: Resend (mesma conta/remetente do Workspace). Idempotency-Key = operation_id derivado. */
export class ResendEmailAdapter implements EmailAdapter {
  private apiKey: string
  private from: string
  private para: string
  private opts: { timeoutMs?: number; fetchImpl?: typeof fetch }
  constructor(apiKey: string, from: string, para: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) { this.apiKey = apiKey; this.from = from; this.para = para; this.opts = opts }

  async enviar({ assunto, html, operationId }: { assunto: string; html: string; operationId: string }): Promise<ResultadoEnvio> {
    const f = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
        body: JSON.stringify({ from: this.from, to: [this.para], subject: assunto, html }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10000),
      })
    } catch {
      return { tipo: 'incerta', categoria: 'timeout_ou_rede' }
    }
    const corpo = (await res.json().catch(() => null)) as { id?: string } | null
    if (res.ok) return corpo?.id ? { tipo: 'aceita', messageId: corpo.id } : { tipo: 'incerta', categoria: 'resposta_ilegivel' }
    if (res.status === 429) return { tipo: 'limitada', retryAfterSeg: Number(res.headers.get('retry-after')) || 60 }
    if (res.status >= 500) return { tipo: 'incerta', categoria: 'http_5xx' }
    return { tipo: 'rejeitada', categoria: `http_${res.status}`, http: res.status }
  }
}
