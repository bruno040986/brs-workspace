/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { lerCpf, str, urlWhatsapp } from '@/lib/promocoes/cadastro-publico'
import { proximoNEnvio } from '@/lib/promocoes/comprovante-envio'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, ok } from '@/lib/promocoes/http'
import { textoAberturaAtendimento } from '@/lib/promocoes/mensagens'
import { consumirOtpToken } from '@/lib/promocoes/otp'
import { enviarWhatsappPromocao } from '@/lib/promocoes/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NAO_ENCONTRADA = () => erro('INSCRICAO_NAO_ENCONTRADA', 'Inscrição não encontrada para este WhatsApp.', 404)

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const limite = await aplicarLimites([
    [`rl:reenv:ip:${ipDoRequest(request)}`, 100, 3600],
    [`rl:reenv:global:${camp.id}`, 300, 3600],
  ])
  if (limite) return limite

  const erros: Array<{ campo: string; msg: string }> = []
  const cpf = lerCpf(body.cpf, 'cpf', erros)
  if (erros.length || !str(body.otpToken, 100)) return erro('OTP_OBRIGATORIO', 'Confirme seu WhatsApp com o código enviado.', 401)

  const admin: any = await createAdminClient()
  const telefone = await consumirOtpToken(admin, camp.id, 'servidor', body.otpToken)
  if (!telefone) return erro('OTP_OBRIGATORIO', 'Confirme seu WhatsApp com o código enviado.', 401)

  const { data: insc } = await admin.from('promocao_inscricoes').select('id, codigo').eq('campanha_id', camp.id).eq('cpf', cpf).eq('telefone', telefone).maybeSingle()
  if (!insc) return NAO_ENCONTRADA()

  const prefixo = `reenvio-insc:${insc.id}`
  const n = await proximoNEnvio(admin, prefixo)
  if (!n) return erro('LIMITE_EXCEDIDO', 'Limite de reenvios atingido.', 429)

  const url = await urlWhatsapp(admin, camp, insc.codigo)
  const texto = `${textoAberturaAtendimento({ codigo: insc.codigo })}${url ? `\n\nPara falar com a NuAzul agora: ${url}` : ''}`
  const r = await enviarWhatsappPromocao({ campanhaId: camp.id, chave: `${prefixo}:${n}`, tipo: 'comprovante_indicacao', telefone, texto })
  return ok({ envio: r.resultado === 'confirmado' ? 'enviado' : r.resultado === 'incerto' ? 'incerto' : 'pendente' })
}
