/* eslint-disable @typescript-eslint/no-explicit-any */
import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { gerarToken, hashOtp } from '@/lib/promocoes/codigos'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, ok, UUID_RE } from '@/lib/promocoes/http'

export const dynamic = 'force-dynamic'

const VALIDADE_TOKEN_MS = 30 * 60_000

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const limite = await aplicarLimites([[`rl:otpc:ip:${ipDoRequest(request)}`, 30, 600]])
  if (limite) return limite

  const otpId = typeof body.otpId === 'string' ? body.otpId : ''
  const codigo = typeof body.codigo === 'string' ? body.codigo.replace(/\s/g, '') : ''
  if (!UUID_RE.test(otpId) || !/^\d{6}$/.test(codigo)) return erro('CODIGO_INVALIDO', 'Código inválido.', 422)

  const admin: any = await createAdminClient()
  const { data: otp } = await admin.from('promocao_otps').select('*').eq('id', otpId).eq('campanha_id', camp.id).maybeSingle()
  if (!otp || otp.confirmado_em) return erro('CODIGO_INVALIDO', 'Código inválido.', 422, { tentativasRestantes: 0 })
  if (new Date(otp.expira_em).getTime() < Date.now()) return erro('CODIGO_EXPIRADO', 'Código expirado. Peça um novo.', 410)
  if (otp.tentativas >= otp.max_tentativas) return erro('CODIGO_BLOQUEADO', 'Muitas tentativas. Peça um novo código.', 423)

  // Conta a tentativa ANTES de comparar; a condição em `tentativas` serializa tentativas paralelas.
  const { data: contada } = await admin
    .from('promocao_otps')
    .update({ tentativas: otp.tentativas + 1 })
    .eq('id', otp.id)
    .eq('tentativas', otp.tentativas)
    .select('id')
    .maybeSingle()
  if (!contada) return erro('LIMITE_EXCEDIDO', 'Tente novamente.', 429)

  if (!iguais(hashOtp(codigo, otp.id), otp.codigo_hash)) {
    return erro('CODIGO_INVALIDO', 'Código incorreto.', 422, { tentativasRestantes: Math.max(0, otp.max_tentativas - otp.tentativas - 1) })
  }

  const { token, hash } = gerarToken()
  const expiraEm = new Date(Date.now() + VALIDADE_TOKEN_MS).toISOString()
  const { data: confirmado } = await admin
    .from('promocao_otps')
    .update({ confirmado_em: new Date().toISOString(), otp_token_hash: hash, otp_token_expira_em: expiraEm })
    .eq('id', otp.id)
    .is('confirmado_em', null)
    .select('id')
    .maybeSingle()
  if (!confirmado) return erro('CODIGO_INVALIDO', 'Código inválido.', 422)
  return ok({ otpToken: token, telefone: otp.telefone, expiraEm })
}
