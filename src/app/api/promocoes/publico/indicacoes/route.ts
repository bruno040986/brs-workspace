/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  cpfBloqueado,
  gravarAceites,
  gravarTracking,
  hojeSp,
  lerCpf,
  lerData,
  lerNome,
  lerTelefone,
  maiorDe18,
  proximoCodigo,
  sincronizarComTimeout,
  str,
  type CampoInvalido,
} from '@/lib/promocoes/cadastro-publico'
import { novoTokenAtendimentoIndicacao } from '@/lib/promocoes/atendimento'
import { textoIndicadorParaIndicado, urlWhatsappIndicado } from '@/lib/promocoes/atendimento-textos'
import { gerarToken } from '@/lib/promocoes/codigos'
import { aplicarLimites, buscarCampanha, cadastroFechado, CAMPANHA_INDISPONIVEL, erro, ipDoRequest, JSON_INVALIDO, lerJson, logSeguro, ok, registrarEvento, telefoneContatoDigitos, UUID_RE, type Campanha } from '@/lib/promocoes/http'
import { consumirOtpToken, liberarOtpToken } from '@/lib/promocoes/otp'
import { pixDoIndicado } from '@/lib/promocoes/seguranca'
import { pixValido, somenteDigitos } from '@/lib/promocoes/validacao'
import type { PixTipo } from '@/lib/promocoes/tipos'
import { instanciaPromocaoDisponivel } from '@/lib/promocoes/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TIPOS_PIX: PixTipo[] = ['cpf', 'telefone', 'email', 'aleatoria', 'dados_bancarios']
const MSG_JA_INDICADO = 'Este servidor já foi indicado. Não é possível nova indicação e não será gerado número de indicação.'
const JA_INDICADO = () => erro('CPF_JA_INDICADO', MSG_JA_INDICADO, 409)
const MSG_JA_PARTICIPA = 'Este servidor já participa da promoção por inscrição direta (ou já iniciou uma proposta), por isso uma indicação agora não gera bonificação nem número da sorte.'
const VALIDADE_COMPROVANTE_MS = 24 * 3600_000

async function novoComprovante(admin: any, indicacaoId: string) {
  const { token, hash } = gerarToken()
  const expira = new Date(Date.now() + VALIDADE_COMPROVANTE_MS).toISOString()
  await admin.from('promocao_indicacoes').update({ comprovante_token_hash: hash, comprovante_expira_em: expira, updated_at: new Date().toISOString() }).eq('id', indicacaoId)
  return token
}

/** Botão B: texto e URL montados no servidor (redação única). null → o site esconde o botão. */
async function urlIndicador(admin: any, camp: Campanha, v: { nomeIndicado: string; telefoneIndicado: string; nomeIndicador: string; numeroIndicacao: string; codigoInscricao: string }) {
  const contatoDigitos = await telefoneContatoDigitos(admin, camp)
  if (!contatoDigitos) return null
  return urlWhatsappIndicado(v.telefoneIndicado, textoIndicadorParaIndicado({ ...v, contatoDigitos }))
}

async function respostaExistente(admin: any, camp: Campanha, ind: any) {
  const { data: insc } = await admin.from('promocao_inscricoes').select('id, codigo, nome, telefone, telefone_verificado, wesales_status').eq('id', ind.inscricao_id).maybeSingle()
  const { data: indicador } = await admin.from('promocao_indicadores').select('nome, telefone_verificado').eq('id', ind.indicador_id).maybeSingle()
  const token = await novoComprovante(admin, ind.id)
  return ok({
    indicacaoId: ind.id,
    numeroIndicacao: ind.numero,
    codigoInscricaoIndicado: insc?.codigo,
    comprovanteToken: token,
    comprovanteUrl: `/api/promo/comprovante?t=${token}`,
    atendimentoToken: await novoTokenAtendimentoIndicacao(admin, ind.id),
    telefoneVerificado: Boolean(indicador?.telefone_verificado),
    wesales: insc?.wesales_status === 'ok' ? 'ok' : 'pendente',
    whatsappIndicadoUrl: insc && indicador
      ? await urlIndicador(admin, camp, { nomeIndicado: insc.nome, telefoneIndicado: insc.telefone, nomeIndicador: indicador.nome, numeroIndicacao: ind.numero, codigoInscricao: insc.codigo })
      : null,
  })
}

function lerPix(raw: any, erros: CampoInvalido[]) {
  const tipo = TIPOS_PIX.includes(raw?.tipo) ? (raw.tipo as PixTipo) : null
  if (!tipo) {
    erros.push({ campo: 'indicador.pix.tipo', msg: 'Selecione o tipo da chave Pix.' })
    return null
  }
  if (tipo === 'dados_bancarios') {
    const p = { bancoCodigo: str(raw.bancoCodigo, 10), bancoNome: str(raw.bancoNome, 80), agencia: str(raw.agencia, 12), conta: str(raw.conta, 24) }
    if (!p.bancoCodigo || !p.agencia || !p.conta) {
      erros.push({ campo: 'indicador.pix', msg: 'Informe banco, agência e conta.' })
      return null
    }
    return { tipo, chave: null, ...p }
  }
  let chave = str(raw.chave, 120)
  if (tipo === 'cpf' || tipo === 'telefone') chave = somenteDigitos(chave)
  else chave = chave.toLowerCase()
  if (!pixValido(tipo, chave)) {
    erros.push({ campo: 'indicador.pix.chave', msg: 'Chave Pix inválida para o tipo selecionado.' })
    return null
  }
  return { tipo, chave, bancoCodigo: null, bancoNome: null, agencia: null, conta: null }
}

export async function POST(request: NextRequest) {
  const body = await lerJson(request)
  if (!body) return JSON_INVALIDO()
  if (body.site) return ok({ ok: true })

  const ip = ipDoRequest(request)
  const userAgent = request.headers.get('user-agent') || ''
  const camp = await buscarCampanha(body.campanha)
  if (!camp) return CAMPANHA_INDISPONIVEL()
  const fechado = cadastroFechado(camp)
  if (fechado) return fechado
  const limiteIp = await aplicarLimites([[`rl:ind:ip:${ip}`, 200, 3600]])
  if (limiteIp) return limiteIp

  const erros: CampoInvalido[] = []
  const submissionId = typeof body.submissionId === 'string' && UUID_RE.test(body.submissionId) ? body.submissionId : null
  if (!submissionId) erros.push({ campo: 'submissionId', msg: 'Requisição inválida.' })
  const bi = body.indicador && typeof body.indicador === 'object' ? body.indicador : {}
  const bd = body.indicado && typeof body.indicado === 'object' ? body.indicado : {}
  const indicador = {
    nome: lerNome(bi.nome, 'indicador.nome', erros),
    cpf: lerCpf(bi.cpf, 'indicador.cpf', erros),
    telefone: lerTelefone(bi.telefone, 'indicador.telefone', erros),
    nascimento: lerData(bi.dataNascimento, 'indicador.dataNascimento', erros, true),
  }
  const indicado = {
    nome: lerNome(bd.nome, 'indicado.nome', erros),
    cpf: lerCpf(bd.cpf, 'indicado.cpf', erros),
    telefone: lerTelefone(bd.telefone, 'indicado.telefone', erros),
    nascimento: lerData(bd.dataNascimento, 'indicado.dataNascimento', erros, true),
  }
  const pixErros: CampoInvalido[] = []
  const pix = lerPix(bi.pix, pixErros)
  if (erros.length) return erro('DADOS_INVALIDOS', 'Confira os campos informados.', 422, { campos: erros })
  if (pixErros.length || !pix) return erro('PIX_INVALIDO', 'Confira os dados da chave Pix.', 422, { campos: pixErros })
  if (indicador.cpf === indicado.cpf) return erro('AUTOINDICACAO', 'Não é possível indicar o próprio CPF.', 422)
  if (indicador.telefone === indicado.telefone) return erro('AUTOINDICACAO', 'O WhatsApp do indicado não pode ser o mesmo do indicador.', 422)
  if (pixDoIndicado(pix, indicado)) return erro('PIX_DO_INDICADO', 'A chave Pix não pode pertencer ao servidor indicado.', 422)
  if (!maiorDe18(indicador.nascimento!, hojeSp())) return erro('MENOR_DE_IDADE', 'O indicador deve ter 18 anos ou mais.', 422)
  if (body.consentPromocao !== true || body.declaraRelacaoLegitima !== true) {
    return erro('CONSENTIMENTO_OBRIGATORIO', 'É preciso aceitar o regulamento e declarar a relação com o indicado.', 409)
  }
  if (typeof body.regulamentoVersao === 'string' && body.regulamentoVersao && body.regulamentoVersao !== camp.regulamento_versao) {
    return erro('REGULAMENTO_DESATUALIZADO', 'O regulamento foi atualizado. Recarregue a página e aceite novamente.', 409)
  }
  const versao = camp.regulamento_versao

  const limiteTel = await aplicarLimites([[`rl:ind:tel:${indicador.telefone}`, 10, 3600]])
  if (limiteTel) return limiteTel

  const admin: any = await createAdminClient()

  const { data: repetida } = await admin.from('promocao_indicacoes').select('*').eq('submission_id', submissionId).eq('campanha_id', camp.id).maybeSingle()
  if (repetida) return respostaExistente(admin, camp, repetida)

  const otpExigido = camp.otp_obrigatorio && (await instanciaPromocaoDisponivel(camp.id).catch(() => false))
  const tokenInformado = typeof body.otpToken === 'string' && body.otpToken ? body.otpToken : null
  let verificado = false
  if (tokenInformado) {
    const telToken = await consumirOtpToken(admin, camp.id, 'indicador', tokenInformado)
    verificado = telToken === indicador.telefone
    if (telToken && !verificado) await liberarOtpToken(admin, tokenInformado)
  }
  if (otpExigido && !verificado) return erro('OTP_OBRIGATORIO', 'Confirme seu WhatsApp com o código enviado.', 401)
  const devolverToken = async () => {
    if (tokenInformado && verificado) await liberarOtpToken(admin, tokenInformado).catch(() => undefined)
  }

  // consultas de CPF só DEPOIS do OTP (sem oráculo de CPF para quem não provou o telefone)
  if (await cpfBloqueado(admin, camp.id, [indicador.cpf, indicado.cpf])) {
    await devolverToken()
    return erro('CPF_NAO_ELEGIVEL', 'Não foi possível concluir o cadastro com este CPF. Fale com a NuAzul.', 422)
  }

  const { data: jaInscrito } = await admin.from('promocao_inscricoes').select('id, origem').eq('campanha_id', camp.id).eq('cpf', indicado.cpf).maybeSingle()
  // §9.4: inscrição direta (ou com proposta) anterior à indicação nunca é vinculada a indicador
  if (jaInscrito?.origem === 'direta') {
    await devolverToken()
    return erro('SERVIDOR_JA_PARTICIPA', MSG_JA_PARTICIPA, 409)
  }
  if (jaInscrito) {
    await devolverToken()
    return JA_INDICADO()
  }

  const falhaInterna = async (contexto: string, e: unknown) => {
    logSeguro(contexto, e)
    await devolverToken()
    return erro('ERRO_INTERNO', 'Não foi possível concluir o cadastro agora. Tente novamente.', 500)
  }

  // indicador: 1 por (campanha, cpf); troca de Pix/telefone fica auditada
  const dadosIndicador = {
    nome: indicador.nome,
    telefone: indicador.telefone,
    telefone_verificado: verificado,
    data_nascimento: indicador.nascimento,
    pix_tipo: pix.tipo,
    pix_chave: pix.chave,
    banco_codigo: pix.bancoCodigo,
    banco_nome: pix.bancoNome,
    agencia: pix.agencia,
    conta: pix.conta,
  }
  let indicadorId: string
  const { data: indExistente } = await admin.from('promocao_indicadores').select('*').eq('campanha_id', camp.id).eq('cpf', indicador.cpf).maybeSingle()
  if (indExistente) {
    // sem posse comprovada do indicador existente, telefone/Pix/nome nunca são sobrescritos pela API pública
    const mudouPix = ['pix_tipo', 'pix_chave', 'banco_codigo', 'agencia', 'conta'].some((k) => (indExistente[k] ?? null) !== ((dadosIndicador as any)[k] ?? null))
    if (indExistente.telefone !== indicador.telefone || mudouPix) {
      await devolverToken()
      return erro('INDICADOR_DADOS_DIVERGENTES', 'Já existe cadastro de indicador com este CPF. Para alterar telefone ou chave Pix, fale com a NuAzul.', 409)
    }
    if (verificado && !indExistente.telefone_verificado) {
      const { error: eUp } = await admin.from('promocao_indicadores').update({ telefone_verificado: true, updated_at: new Date().toISOString() }).eq('id', indExistente.id)
      if (eUp) return falhaInterna('indicador update', eUp)
    }
    indicadorId = indExistente.id
  } else {
    const { data: novo, error: eIns } = await admin.from('promocao_indicadores').insert({ campanha_id: camp.id, cpf: indicador.cpf, ...dadosIndicador }).select('id').single()
    if (eIns || !novo) return falhaInterna('indicador insert', eIns)
    indicadorId = novo.id
  }

  let numeroIndicacao: string
  let codigoInscricao: string
  try {
    numeroIndicacao = await proximoCodigo(admin, camp.prefixo_indicacao)
    codigoInscricao = await proximoCodigo(admin, camp.prefixo_codigo)
  } catch (e) {
    return falhaInterna('codigo', e)
  }

  const { data: inscricao, error: eInsc } = await admin
    .from('promocao_inscricoes')
    .insert({
      campanha_id: camp.id,
      codigo: codigoInscricao,
      cpf: indicado.cpf,
      nome: indicado.nome,
      telefone: indicado.telefone,
      data_nascimento: indicado.nascimento,
      origem: 'indicacao',
      consent_promocao: false,
      submission_id: crypto.randomUUID(),
    })
    .select('id')
    .single()
  if (eInsc || !inscricao) {
    if (String(eInsc?.code) === '23505') {
      await devolverToken()
      return JA_INDICADO()
    }
    return falhaInterna('inscricao do indicado', eInsc)
  }

  const { data: indicacao, error: eInd } = await admin
    .from('promocao_indicacoes')
    .insert({
      campanha_id: camp.id,
      numero: numeroIndicacao,
      indicador_id: indicadorId,
      inscricao_id: inscricao.id,
      cpf_indicado: indicado.cpf,
      submission_id: submissionId,
    })
    .select('*')
    .single()
  if (eInd || !indicacao) {
    await admin.from('promocao_inscricoes').delete().eq('id', inscricao.id)
    if (String(eInd?.code) === '23505') {
      const { data: r2 } = await admin.from('promocao_indicacoes').select('*').eq('submission_id', submissionId).maybeSingle()
      if (r2) return respostaExistente(admin, camp, r2)
      await devolverToken()
      return JA_INDICADO()
    }
    return falhaInterna('indicacao insert', eInd)
  }
  await admin.from('promocao_inscricoes').update({ indicacao_id: indicacao.id, updated_at: new Date().toISOString() }).eq('id', inscricao.id)

  try {
    await gravarAceites(admin, { campanhaId: camp.id, sujeitoTipo: 'indicador', sujeitoId: indicadorId, versao, ip, userAgent }, [
      { finalidade: 'promocao', aceito: true },
      { finalidade: 'relacao_legitima_indicado', aceito: true },
    ])
  } catch (e) {
    logSeguro('aceites', e)
  }
  await gravarTracking(admin, { campanhaId: camp.id, inscricaoId: inscricao.id, indicacaoId: indicacao.id, ip, userAgent }, body.tracking)
  await registrarEvento(admin, camp.id, 'indicacao', indicacao.id, 'indicacao.criada', { telefoneVerificado: verificado })

  const token = await novoComprovante(admin, indicacao.id)
  const wesales = await sincronizarComTimeout(inscricao.id)
  return ok({
    indicacaoId: indicacao.id,
    numeroIndicacao,
    codigoInscricaoIndicado: codigoInscricao,
    comprovanteToken: token,
    comprovanteUrl: `/api/promo/comprovante?t=${token}`,
    atendimentoToken: await novoTokenAtendimentoIndicacao(admin, indicacao.id),
    telefoneVerificado: verificado,
    wesales,
    whatsappIndicadoUrl: await urlIndicador(admin, camp, { nomeIndicado: indicado.nome, telefoneIndicado: indicado.telefone, nomeIndicador: indicador.nome, numeroIndicacao, codigoInscricao }),
  })
}
