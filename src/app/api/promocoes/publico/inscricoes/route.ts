/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  cpfBloqueado,
  gravarAceites,
  gravarTracking,
  lerCpf,
  lerData,
  lerEmail,
  lerNome,
  lerTelefone,
  proximoCodigo,
  sincronizarComTimeout,
  urlWhatsapp,
  type CampoInvalido,
} from '@/lib/promocoes/cadastro-publico'
import { aplicarLimites, buscarCampanha, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, logSeguro, ok, registrarEvento, UUID_RE, type Campanha } from '@/lib/promocoes/http'
import { consumirOtpToken, liberarOtpToken } from '@/lib/promocoes/otp'
import { instanciaPromocaoDisponivel } from '@/lib/promocoes/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function resposta(admin: any, camp: Campanha, row: any) {
  return ok({
    inscricaoId: row.id,
    codigo: row.codigo,
    telefoneVerificado: Boolean(row.telefone_verificado),
    wesales: row.wesales_status === 'ok' ? 'ok' : 'pendente',
    whatsappUrl: await urlWhatsapp(admin, camp, row.codigo),
  })
}

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const ip = ipDoRequest(request)
  const userAgent = request.headers.get('user-agent') || ''
  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const limiteIp = await aplicarLimites([[`rl:insc:ip:${ip}`, 200, 3600]])
  if (limiteIp) return limiteIp

  const erros: CampoInvalido[] = []
  const submissionId = typeof body.submissionId === 'string' && UUID_RE.test(body.submissionId) ? body.submissionId : null
  if (!submissionId) erros.push({ campo: 'submissionId', msg: 'Requisição inválida.' })
  const nome = lerNome(body.nome, 'nome', erros)
  const cpf = lerCpf(body.cpf, 'cpf', erros)
  const telefone = lerTelefone(body.telefone, 'telefone', erros)
  const nascimento = lerData(body.dataNascimento, 'dataNascimento', erros, false)
  const email = lerEmail(body.email, 'email', erros)
  if (erros.length) return erro('DADOS_INVALIDOS', 'Confira os campos informados.', 422, { campos: erros })
  if (body.consentPromocao !== true) return erro('CONSENTIMENTO_OBRIGATORIO', 'É preciso aceitar o regulamento para participar.', 409)
  const consentContato = body.consentContatoComercial === true
  if (typeof body.regulamentoVersao === 'string' && body.regulamentoVersao && body.regulamentoVersao !== camp.regulamento_versao) {
    return erro('REGULAMENTO_DESATUALIZADO', 'O regulamento foi atualizado. Recarregue a página e aceite novamente.', 409)
  }
  const versao = camp.regulamento_versao

  const limiteTel = await aplicarLimites([[`rl:insc:tel:${telefone}`, 5, 3600]])
  if (limiteTel) return limiteTel

  const admin: any = await createAdminClient()

  const { data: repetida } = await admin.from('promocao_inscricoes').select('*').eq('submission_id', submissionId).eq('campanha_id', camp.id).maybeSingle()
  if (repetida) return resposta(admin, camp, repetida)

  if (await cpfBloqueado(admin, camp.id, [cpf])) {
    return erro('CPF_NAO_ELEGIVEL', 'Não foi possível concluir o cadastro com este CPF. Fale com a NuAzul.', 422)
  }

  const otpExigido = camp.otp_obrigatorio && (await instanciaPromocaoDisponivel(camp.id).catch(() => false))
  const tokenInformado = typeof body.otpToken === 'string' && body.otpToken ? body.otpToken : null
  let verificado = false
  if (tokenInformado) {
    const telToken = await consumirOtpToken(admin, camp.id, 'servidor', tokenInformado)
    verificado = telToken === telefone
    if (telToken && !verificado) await liberarOtpToken(admin, tokenInformado)
  }
  if (otpExigido && !verificado) return erro('OTP_OBRIGATORIO', 'Confirme seu WhatsApp com o código enviado.', 401)

  // CPF já inscrito: só revela/assume com posse comprovada do telefone (OTP verificado); nunca confirma vínculo CPF↔telefone sem isso
  const JA_INSCRITO = () => erro('CPF_JA_INSCRITO', 'Este CPF já possui inscrição. Fale com a NuAzul se precisar de ajuda.', 409)
  const tratarCpfExistente = async (): Promise<{ resp: Response | null; assumida: any | null }> => {
    const { data: existente } = await admin.from('promocao_inscricoes').select('*').eq('campanha_id', camp.id).eq('cpf', cpf).maybeSingle()
    if (!existente) return { resp: null, assumida: null }
    if (otpExigido && !verificado) return { resp: JA_INSCRITO(), assumida: null }
    if (existente.telefone === telefone) return { resp: await resposta(admin, camp, existente), assumida: null }
    if (existente.origem === 'indicacao' && verificado) {
      // indicado confirmou o próprio WhatsApp: o servidor assume o cadastro (vínculo e código mantidos)
      const { data: up, error: eUp } = await admin
        .from('promocao_inscricoes')
        .update({
          nome,
          telefone,
          telefone_verificado: true,
          email,
          data_nascimento: nascimento ?? existente.data_nascimento,
          consent_promocao: true,
          consent_contato_comercial: consentContato,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existente.id)
        .select('*')
        .single()
      if (eUp || !up) {
        logSeguro('inscricao assumir', eUp)
        await liberarOtpToken(admin, tokenInformado!).catch(() => undefined)
        return { resp: erro('ERRO_INTERNO', 'Não foi possível concluir o cadastro agora. Tente novamente.', 500), assumida: null }
      }
      await registrarEvento(admin, camp.id, 'inscricao', existente.id, 'inscricao.assumida_pelo_servidor', { telefoneAnteriorFinal: String(existente.telefone || '').slice(-4) })
      return { resp: null, assumida: up }
    }
    return { resp: JA_INSCRITO(), assumida: null }
  }
  const ex = await tratarCpfExistente()
  if (ex.resp) return ex.resp

  let codigo = ''
  if (!ex.assumida) {
    try {
      codigo = await proximoCodigo(admin, camp.prefixo_codigo)
    } catch (e) {
      logSeguro('codigo', e)
      if (tokenInformado && verificado) await liberarOtpToken(admin, tokenInformado)
      return erro('ERRO_INTERNO', 'Não foi possível concluir o cadastro agora. Tente novamente.', 500)
    }
  }

  const { data: inscricao, error } = ex.assumida ? { data: ex.assumida, error: null } : await admin
    .from('promocao_inscricoes')
    .insert({
      campanha_id: camp.id,
      codigo,
      cpf,
      nome,
      telefone,
      telefone_verificado: verificado,
      data_nascimento: nascimento,
      email,
      origem: 'direta',
      consent_promocao: true,
      consent_contato_comercial: consentContato,
      submission_id: submissionId,
    })
    .select('*')
    .single()
  if (error || !inscricao) {
    if (String(error?.code) === '23505') {
      const { data: r2 } = await admin.from('promocao_inscricoes').select('*').eq('submission_id', submissionId).maybeSingle()
      if (r2) return resposta(admin, camp, r2)
      const r3 = await tratarCpfExistente()
      if (r3.resp) return r3.resp
    }
    logSeguro('inscricao insert', error)
    if (tokenInformado && verificado) await liberarOtpToken(admin, tokenInformado)
    return erro('ERRO_INTERNO', 'Não foi possível concluir o cadastro agora. Tente novamente.', 500)
  }

  try {
    await gravarAceites(admin, { campanhaId: camp.id, sujeitoTipo: 'inscricao', sujeitoId: inscricao.id, versao, ip, userAgent }, [
      { finalidade: 'promocao', aceito: true },
      { finalidade: 'contato_comercial', aceito: consentContato },
    ])
  } catch (e) {
    logSeguro('aceites', e)
  }
  await gravarTracking(admin, { campanhaId: camp.id, inscricaoId: inscricao.id, ip, userAgent }, body.tracking)
  await registrarEvento(admin, camp.id, 'inscricao', inscricao.id, 'inscricao.criada', { origem: ex.assumida ? 'indicacao_assumida' : 'direta', telefoneVerificado: verificado })

  const wesales = await sincronizarComTimeout(inscricao.id)
  return ok({
    inscricaoId: inscricao.id,
    codigo: inscricao.codigo,
    telefoneVerificado: verificado,
    wesales,
    whatsappUrl: await urlWhatsapp(admin, camp, inscricao.codigo),
  })
}
