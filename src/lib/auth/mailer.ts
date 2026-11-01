import { createAdminClient } from '@/lib/supabase/server'

// Entrega do código da etapa 4. Provedor existente: Resend via tabela resend_config (mesma do
// onboarding). Timeout curto; qualquer falha/ausência de config => ok:false (NUNCA libera, e o
// código não é desviado a Telegram/WhatsApp).
export type ResultadoEnvio = { ok: boolean; estado: 'aceita' | 'falhou' | 'incerta'; ref?: string }
export interface CodigoMailer {
  enviar(input: { para: string; codigo: string; ttlMin: number; finalidade: 'acesso_workspace' | 'ativacao_fator' }): Promise<ResultadoEnvio>
}

/** Falha fechado: usado quando não há provedor configurado (sempre em produção). */
export class NoopMailer implements CodigoMailer {
  async enviar(): Promise<ResultadoEnvio> {
    return { ok: false, estado: 'falhou' }
  }
}

const TIMEOUT_MS = 10_000

export class ResendMailer implements CodigoMailer {
  constructor(private apiKey: string, private from: string) {}
  async enviar({ para, codigo, ttlMin, finalidade }: Parameters<CodigoMailer['enviar']>[0]): Promise<ResultadoEnvio> {
    const assunto = finalidade === 'ativacao_fator' ? 'BRS Workspace: código para ativar o autenticador' : 'BRS Workspace: código de acesso'
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [para],
          subject: assunto,
          html: `<p>Seu código é <strong style="font-size:20px;letter-spacing:3px">${codigo}</strong>.</p><p>Vale por ${ttlMin} minutos e só pode ser usado uma vez. Se você não tentou entrar, ignore este e-mail e avise a TI.</p>`,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return { ok: false, estado: res.status >= 500 || res.status === 429 ? 'incerta' : 'falhou' }
      const corpo = (await res.json().catch(() => ({}))) as { id?: string }
      return { ok: true, estado: 'aceita', ref: corpo.id }
    } catch {
      return { ok: false, estado: 'incerta' } // timeout/rede: pode ter saído; o desafio é invalidado mesmo assim
    }
  }
}

export async function obterMailer(): Promise<CodigoMailer> {
  try {
    const admin = await createAdminClient()
    const { data } = await admin.from('resend_config').select('is_active, api_key, from_email').limit(1).maybeSingle()
    if (data?.is_active && data.api_key && data.from_email) return new ResendMailer(data.api_key, data.from_email)
  } catch {
    /* cai no NoopMailer (fail closed) */
  }
  return new NoopMailer()
}
