/* eslint-disable @typescript-eslint/no-explicit-any */
import { hashToken } from './codigos'

export type OtpFinalidade = 'servidor' | 'indicador'

/**
 * Consome (uso único, atômico) o otpToken. Devolve o telefone verificado ou null
 * (token inexistente, de outra campanha/finalidade, expirado ou já usado).
 */
export async function consumirOtpToken(admin: any, campanhaId: string, finalidade: OtpFinalidade, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const hash = hashToken(token)
  const agora = new Date().toISOString()
  const { data } = await admin
    .from('promocao_otps')
    .update({ otp_token_usado_em: agora })
    .eq('otp_token_hash', hash)
    .eq('campanha_id', campanhaId)
    .eq('finalidade', finalidade)
    .is('otp_token_usado_em', null)
    .gt('otp_token_expira_em', agora)
    .select('telefone')
    .maybeSingle()
  return data?.telefone ? String(data.telefone) : null
}

export async function liberarOtpToken(admin: any, token: string): Promise<void> {
  await admin.from('promocao_otps').update({ otp_token_usado_em: null }).eq('otp_token_hash', hashToken(token))
}
