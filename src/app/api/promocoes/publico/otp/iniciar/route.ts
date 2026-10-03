/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { gerarCodigoOtp, hashOtp } from '@/lib/promocoes/codigos'
import { lerTelefone } from '@/lib/promocoes/cadastro-publico'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, logSeguro, ok } from '@/lib/promocoes/http'
import { textoOtp } from '@/lib/promocoes/mensagens'
import { enviarWhatsappPromocao, instanciaPromocaoDisponivel } from '@/lib/promocoes/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const COOLDOWN_MS = 60_000
const VALIDADE_MS = 10 * 60_000

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const ip = ipDoRequest(request)
  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const finalidade = body.finalidade === 'indicador' ? 'indicador' : body.finalidade === 'servidor' ? 'servidor' : null
  const erros: Array<{ campo: string; msg: string }> = []
  const telefone = lerTelefone(body.telefone, 'telefone', erros)
  if (!finalidade || erros.length) return erro('TELEFONE_INVALIDO', 'Informe um WhatsApp válido com DDD.', 422)

  const limite = await aplicarLimites([
    [`rl:otp:ip:${ip}`, 100, 3600],
    [`rl:otp:ip-dia:${ip}`, 30, 86400],
    [`rl:otp:global:${camp.id}`, 300, 3600],
    [`rl:otp:tel:${telefone}`, 3, 3600],
  ])
  if (limite) return limite

  if (!camp.otp_obrigatorio || !(await instanciaPromocaoDisponivel(camp.id))) return ok({ otpId: null, dispensado: true })

  const admin: any = await createAdminClient()
  const { data: ultimo } = await admin
    .from('promocao_otps')
    .select('created_at')
    .eq('telefone', telefone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (ultimo) {
    const reenvio = new Date(ultimo.created_at).getTime() + COOLDOWN_MS
    if (reenvio > Date.now()) {
      return erro('AGUARDE_REENVIO', 'Aguarde um minuto para pedir um novo código.', 429, { reenvioEm: new Date(reenvio).toISOString() })
    }
  }

  const otpId = randomUUID()
  const codigo = gerarCodigoOtp()
  const expiraEm = new Date(Date.now() + VALIDADE_MS).toISOString()
  const { error } = await admin.from('promocao_otps').insert({
    id: otpId,
    campanha_id: camp.id,
    telefone,
    finalidade,
    codigo_hash: hashOtp(codigo, otpId),
    expira_em: expiraEm,
    envio_chave: `otp:${otpId}`,
    ip,
  })
  if (error) {
    logSeguro('otp insert', error)
    return erro('ERRO_INTERNO', 'Não foi possível enviar o código agora. Tente novamente.', 500)
  }

  const envio = await enviarWhatsappPromocao({ campanhaId: camp.id, chave: `otp:${otpId}`, tipo: 'otp', telefone, texto: textoOtp(codigo) })
  if (envio.resultado === 'rejeitado') {
    if (/sem_whatsapp|not.?on.?whatsapp|n[uú]mero.*whatsapp/i.test(envio.mensagem)) {
      return erro('TELEFONE_INVALIDO', 'Este número não possui WhatsApp.', 422)
    }
    return ok({ otpId: null, dispensado: true })
  }
  return ok({ otpId, expiraEm, reenvioEm: new Date(Date.now() + COOLDOWN_MS).toISOString() })
}
