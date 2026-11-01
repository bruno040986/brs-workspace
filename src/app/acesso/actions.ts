'use server'

// M04 — Server Actions das etapas do login interno. NENHUMA recebe identidade, sessão ou destino do
// cliente: user/sessão vêm do JWT verificado no servidor; o destino do e-mail vem do banco.
// Estas actions NÃO usam requireCurrentUser (a sessão ainda está incompleta por definição).

import { cookies } from 'next/headers'
import { COOKIE_DISPOSITIVO, DISPOSITIVO_TTL_SEG, dispositivoValido, emitirDispositivo, userIdDoDispositivo } from '@/lib/auth/dispositivo-confiavel'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import {
  calcularEtapa, classificarErroAuth, emailDominioInterno, mensagemPausa, normalizarEmail,
  MENSAGEM_GENERICA, MENSAGEM_INSTABILIDADE,
} from '@/lib/auth/etapas'
import {
  CODIGO_MAX_TENTATIVAS, CODIGO_TTL_SEG, LIMITE_DURO, identificadorSenha, LIMITE_IDENTIFICADOR, LIMITE_IP, TETO_DURO_MIN, LIMITE_PAR, PAUSA_FIXA_MIN, chavesSenha, formatoCodigoValido, gerarCodigo, hashCodigo, segredoCodigo,
} from '@/lib/auth/codigo-email'
import { obterMailer } from '@/lib/auth/mailer'
import { decidirPausaSenha } from '@/lib/auth/pausa-senha'
import { verificarTurnstile } from '@/lib/auth/turnstile'
import { contextoRequisicao, lerClaimsVerificados, obterEstadoBanco, registrarAcesso } from '@/lib/auth/sessao-interna'

export type ResultadoAcesso = { ok: boolean; mensagem?: string; pausaSeg?: number; esperaSeg?: number; proximo?: string; restantes?: number }

async function rpc<T = unknown>(nome: string, args: Record<string, unknown>): Promise<{ data: T | null; erro: boolean }> {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin.rpc(nome, args)
    return { data: (data as T) ?? null, erro: Boolean(error) }
  } catch {
    return { erro: true, data: null }
  }
}

async function sessaoAtual() {
  const claims = await lerClaimsVerificados()
  if (!claims?.sub || !claims.session_id) return null
  return { userId: claims.sub, sessionId: claims.session_id, aal: claims.aal, claims }
}

/** Sessão negada (conta não interna etc.): encerra só ESTA sessão e responde genérico. */
async function negarSessao(userId: string, sessionId: string) {
  await rpc('auth_revogar_sessao', { p_user: userId, p_session: sessionId, p_motivo: 'negada' })
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  try { (await cookies()).delete(COOKIE_DISPOSITIVO) } catch { /* ignora */ } // sessao negada/bloqueada: apaga o cookie do dispositivo
}

// ---------------------------------------------------------------- etapas 1 e 2
export async function entrar(input: { email: string; password: string; turnstileToken?: string }): Promise<ResultadoAcesso> {
  const email = normalizarEmail(String(input?.email ?? ''))
  const password = String(input?.password ?? '')
  const ctx = await contextoRequisicao()
  let segredo: string
  try { segredo = segredoCodigo() } catch {
    await registrarAcesso({ etapa: 'senha', resultado: 'erro_infra', motivo: 'config_ausente', identidadeInformada: email })
    return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  }
  const k = chavesSenha(segredo, email, ctx.ip)

  // Pausa por origem (par identificador+origem e IP): só atinge quem errou. Pausa só por identificador
  // (terceiro digitando o e-mail da vítima) é curta e a senha correta passa se o Turnstile estiver ligado e válido.
  const pausaPar = await rpc<number>('auth_pausa_atual', { p_chave: k.par, p_etapa: 'senha' })
  const pausaIp = k.ip ? await rpc<number>('auth_pausa_atual', { p_chave: k.ip, p_etapa: 'senha' }) : { data: 0, erro: false }
  const pausaId = await rpc<number>('auth_pausa_atual', { p_chave: k.id, p_etapa: 'senha' })
  const pausaDuro = await rpc<number>('auth_pausa_atual', { p_chave: k.duro, p_etapa: 'senha' })
  if (pausaPar.erro || pausaIp.erro || pausaId.erro || pausaDuro.erro) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  const origemSeg = Math.max(pausaPar.data ?? 0, pausaIp.data ?? 0)
  const ts = await verificarTurnstile(input?.turnstileToken, ctx.ip)
  const dcValor = (await cookies()).get(COOKIE_DISPOSITIVO)?.value, dcUser = userIdDoDispositivo(dcValor)
  const dcEpoch = dcUser ? await rpc<number>('auth_credencial_epoch', { p_user: dcUser }) : null
  if (dcEpoch?.erro) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  const dcIdade = dispositivoValido(segredo, k.identificador, dcEpoch?.data, dcValor)
  const dec = decidirPausaSenha({ origemSeg, duroSeg: pausaDuro.data ?? 0, leveSeg: pausaId.data ?? 0, turnstileAplicadoEValido: ts.aplicado && ts.ok,
    dispositivoConfiavel: dcIdade != null }) // cookie invalido/expirado/epoch divergente/usuario inexistente: ignorado
  if (dec.bloqueia) {
    await registrarAcesso({ etapa: 'senha', resultado: 'pausa', motivo: dec.motivo!, identidadeInformada: email })
    return { ok: false, pausaSeg: dec.pausaSeg, mensagem: mensagemPausa(dec.pausaSeg) }
  }
  if (!ts.ok) {
    await registrarAcesso({ etapa: 'senha', resultado: 'negado', motivo: 'captcha_invalido', identidadeInformada: email })
    return { ok: false, mensagem: MENSAGEM_GENERICA }
  }

  // Falha de credencial/domínio conta nas três chaves; mensagem e fluxo iguais para conta inexistente, externa ou inativa.
  const falhaCredencial = async (motivo: string, userId?: string): Promise<ResultadoAcesso> => {
    const par = await rpc<{ pausa_seg: number; alerta: boolean }>('auth_registrar_falha_limiar', { p_chave: k.par, p_etapa: 'senha', p_limite: LIMITE_PAR, p_identificador: k.identificador })
    const ip = k.ip ? await rpc<{ pausa_seg: number; alerta: boolean }>('auth_registrar_falha_limiar', { p_chave: k.ip, p_etapa: 'senha', p_limite: LIMITE_IP, p_pausa_fixa_min: PAUSA_FIXA_MIN }) : null
    const id = await rpc<{ pausa_seg: number; alerta: boolean }>('auth_registrar_falha_limiar', { p_chave: k.id, p_etapa: 'senha', p_limite: LIMITE_IDENTIFICADOR, p_pausa_fixa_min: PAUSA_FIXA_MIN, p_identificador: k.identificador })
    const duro = await rpc<{ pausa_seg: number; alerta: boolean }>('auth_registrar_falha_limiar', { p_chave: k.duro, p_etapa: 'senha', p_limite: LIMITE_DURO, p_identificador: k.identificador, p_teto_min: TETO_DURO_MIN })
    const pausaSeg = Math.max(par.data?.pausa_seg ?? 0, ip?.data?.pausa_seg ?? 0, duro.data?.pausa_seg ?? 0)
    const alerta = Boolean(par.data?.alerta || ip?.data?.alerta || id.data?.alerta || duro.data?.alerta)
    await registrarAcesso({
      etapa: 'senha', resultado: pausaSeg > 0 ? 'pausa' : 'falha', motivo: pausaSeg > 0 ? 'pausa_aplicada' : id.data?.alerta ? 'limite_identificador' : motivo,
      identidadeInformada: email, userId: userId ?? null, pausaAte: pausaSeg > 0 ? new Date(Date.now() + pausaSeg * 1000) : null, alerta,
    })
    return pausaSeg > 0 ? { ok: false, pausaSeg, mensagem: mensagemPausa(pausaSeg) } : { ok: false, mensagem: MENSAGEM_GENERICA }
  }

  if (!emailDominioInterno(email) || !password) return falhaCredencial('dominio_invalido')

  const supabase = await createClient()
  let signIn
  try { signIn = await supabase.auth.signInWithPassword({ email, password }) } catch {
    await registrarAcesso({ etapa: 'senha', resultado: 'erro_infra', motivo: 'erro_infraestrutura', identidadeInformada: email })
    return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  }
  if (signIn.error) {
    if (classificarErroAuth(signIn.error) === 'infra') {
      await registrarAcesso({ etapa: 'senha', resultado: 'erro_infra', motivo: 'erro_infraestrutura', identidadeInformada: email })
      return { ok: false, mensagem: MENSAGEM_INSTABILIDADE } // NÃO conta como senha errada
    }
    return falhaCredencial('credencial_invalida')
  }

  // Etapa 2: identidade interna confirmada (calculada, recalculada a cada checagem).
  const sess = await sessaoAtual()
  if (!sess) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  const estado = await obterEstadoBanco(sess.userId, sess.sessionId, sess.aal)
  const { etapa, proximo } = calcularEtapa(sess.claims, estado)
  if (etapa === 'negada' || etapa === 'anonima') {
    await negarSessao(sess.userId, sess.sessionId)
    const r = await falhaCredencial('identidade_nao_interna', sess.userId)
    return r
  }
  await rpc('auth_registrar_sucesso', { p_chave: k.par, p_etapa: 'senha' })
  await rpc('auth_registrar_sucesso', { p_chave: k.id, p_etapa: 'senha' })
  await registrarAcesso({ etapa: 'senha', resultado: 'sucesso', motivo: 'ok', identidadeInformada: email, userId: sess.userId, sessionId: sess.sessionId })
  return { ok: true, proximo }
}

// ---------------------------------------------------------------- etapa 4 (e prova da ativação)
async function enviarDesafio(finalidade: 'acesso_workspace' | 'ativacao_fator'): Promise<ResultadoAcesso> {
  const sess = await sessaoAtual()
  if (!sess) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const etapa = finalidade === 'ativacao_fator' ? 'ativacao' : 'email'
  let segredo: string
  try { segredo = segredoCodigo() } catch {
    await registrarAcesso({ etapa, resultado: 'erro_infra', motivo: 'config_ausente', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  }
  const codigo = gerarCodigo()
  const hash = hashCodigo(segredo, sess.userId, sess.sessionId, finalidade, codigo)
  const r = await rpc<{ status: string; desafio_id?: string; destino?: string; espera_seg?: number }>('auth_criar_desafio', {
    p_user: sess.userId, p_session: sess.sessionId, p_finalidade: finalidade, p_hash: hash,
    p_ttl_seg: CODIGO_TTL_SEG, p_max_tent: CODIGO_MAX_TENTATIVAS,
  })
  if (r.erro || !r.data) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  const d = r.data
  if (d.status !== 'ok' || !d.desafio_id || !d.destino) {
    const motivo = ({ negado: 'negado', etapa_anterior: 'etapa_anterior', pausa: 'pausa_ativa', reenvio_cedo: 'codigo_reenvio_cedo', limite: 'codigo_limite' } as Record<string, string>)[d.status] ?? 'negado'
    await registrarAcesso({ etapa, resultado: d.status === 'reenvio_cedo' || d.status === 'limite' || d.status === 'pausa' ? 'pausa' : 'negado', motivo, userId: sess.userId, sessionId: sess.sessionId })
    if (d.espera_seg) return { ok: false, esperaSeg: d.espera_seg, mensagem: `Aguarde ${d.espera_seg} s para pedir novo código.` }
    return { ok: false, mensagem: MENSAGEM_GENERICA }
  }
  // Destino = e-mail cadastrado devolvido pelo banco (nunca o cliente).
  const envio = await (await obterMailer()).enviar({ para: d.destino, codigo, ttlMin: Math.round(CODIGO_TTL_SEG / 60), finalidade })
  await rpc('auth_entrega_desafio', { p_id: d.desafio_id, p_estado: envio.estado, p_ref: envio.ref ?? null })
  if (!envio.ok) {
    await registrarAcesso({ etapa, resultado: 'erro_infra', motivo: 'entrega_indisponivel', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, mensagem: 'Não foi possível enviar o código agora. Tente novamente em instantes.' }
  }
  await registrarAcesso({ etapa, resultado: 'sucesso', motivo: 'desafio_enviado', userId: sess.userId, sessionId: sess.sessionId })
  return { ok: true, esperaSeg: 60 }
}
export async function iniciarDesafioEmail() { return enviarDesafio('acesso_workspace') }
export async function iniciarAtivacaoEmail() { return enviarDesafio('ativacao_fator') }

async function verificarCodigo(codigo: string, finalidade: 'acesso_workspace' | 'ativacao_fator'): Promise<ResultadoAcesso> {
  const sess = await sessaoAtual()
  if (!sess || !formatoCodigoValido(codigo)) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const etapa = finalidade === 'ativacao_fator' ? 'ativacao' : 'email'
  let hash: string
  try { hash = hashCodigo(segredoCodigo(), sess.userId, sess.sessionId, finalidade, codigo) } catch {
    return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  }
  const r = await rpc<{ status: string; pausa_seg?: number; restantes?: number; alerta?: boolean }>('auth_verificar_desafio', {
    p_user: sess.userId, p_session: sess.sessionId, p_finalidade: finalidade, p_hash: hash,
  })
  if (r.erro || !r.data) { // infraestrutura: não conta como código errado
    await registrarAcesso({ etapa, resultado: 'erro_infra', motivo: 'erro_infraestrutura', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  }
  const { status, pausa_seg, restantes, alerta } = r.data
  if (status === 'liberado') {
    await registrarAcesso({ etapa, resultado: 'sucesso', motivo: finalidade === 'ativacao_fator' ? 'prova_ativacao_ok' : 'liberado', userId: sess.userId, sessionId: sess.sessionId })
    if (finalidade === 'acesso_workspace' && sess.claims.email) { // C1: etapa 5 concluida => dispositivo confiavel (logout NAO apaga)
      try {
        const segredo = segredoCodigo()
        const ep = await rpc<number>('auth_credencial_epoch', { p_user: sess.userId })
        if (ep.data == null) throw new Error('sem epoch')
        ;(await cookies()).set(COOKIE_DISPOSITIVO, emitirDispositivo(segredo, identificadorSenha(segredo, normalizarEmail(sess.claims.email)), sess.userId, ep.data), {
          httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: DISPOSITIVO_TTL_SEG,
        })
      } catch { /* sem cookie: so perde a dispensa */ }
    }
    return { ok: true, proximo: finalidade === 'ativacao_fator' ? 'ativar_totp' : 'nenhum' }
  }
  const motivo = ({ incorreto: 'codigo_incorreto', expirado: 'codigo_expirado', esgotado: 'codigo_esgotado', inexistente: 'codigo_inexistente', pausa: 'pausa_ativa', etapa_anterior: 'etapa_anterior' } as Record<string, string>)[status] ?? 'negado'
  await registrarAcesso({
    etapa, resultado: pausa_seg ? 'pausa' : 'falha', motivo, userId: sess.userId, sessionId: sess.sessionId,
    pausaAte: pausa_seg ? new Date(Date.now() + pausa_seg * 1000) : null, alerta: alerta ?? false,
  })
  if (pausa_seg) return { ok: false, pausaSeg: pausa_seg, mensagem: mensagemPausa(pausa_seg) }
  return { ok: false, mensagem: status === 'incorreto' ? 'Código incorreto.' : 'Código inválido ou expirado. Peça um novo código.', restantes }
}
export async function verificarCodigoEmail(codigo: string) { return verificarCodigo(codigo, 'acesso_workspace') }
export async function verificarCodigoAtivacao(codigo: string) { return verificarCodigo(codigo, 'ativacao_fator') }

// ---------------------------------------------------------------- etapa 3 (TOTP)
export async function iniciarAtivacaoTotp(): Promise<ResultadoAcesso & { factorId?: string; qrCode?: string; segredoManual?: string }> {
  const sess = await sessaoAtual()
  if (!sess) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const ok = await rpc<boolean>('auth_pode_ativar_fator', { p_user: sess.userId, p_session: sess.sessionId })
  if (ok.erro) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  if (ok.data !== true) {
    await registrarAcesso({ etapa: 'ativacao', resultado: 'negado', motivo: 'sem_prova_ativacao', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, mensagem: MENSAGEM_GENERICA }
  }
  const supabase = await createClient()
  // remove tentativas anteriores nao verificadas (so existem fatores nao verificados aqui)
  const lista = await supabase.auth.mfa.listFactors()
  for (const f of lista.data?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `BRS ${new Date().toISOString().slice(0, 10)}` })
  if (error || !data) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  // QR e segredo vão só para a tela de ativação (nunca para log).
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, segredoManual: data.totp.secret }
}

async function verificarTotpComContador(factorId: string, code: string, sess: NonNullable<Awaited<ReturnType<typeof sessaoAtual>>>): Promise<ResultadoAcesso> {
  const chave = sess.userId
  const pausa = await rpc<number>('auth_pausa_atual', { p_chave: chave, p_etapa: 'totp' })
  if (pausa.erro) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  if ((pausa.data ?? 0) > 0) {
    await registrarAcesso({ etapa: 'totp', resultado: 'pausa', motivo: 'pausa_ativa', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, pausaSeg: pausa.data!, mensagem: mensagemPausa(pausa.data!) }
  }
  if (!/^\d{6}$/.test(code)) return { ok: false, mensagem: 'Código inválido.' }
  const supabase = await createClient()
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    if (classificarErroAuth(error) === 'infra') {
      await registrarAcesso({ etapa: 'totp', resultado: 'erro_infra', motivo: 'erro_infraestrutura', userId: sess.userId, sessionId: sess.sessionId })
      return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
    }
    // Com o hook MFA do Auth ligado (AUTH_HOOK_MFA_ATIVO=true) a falha ja foi contada la (caminho unico para
    // o servidor e para o GoTrue direto): aqui so le a pausa, para nao contar duas vezes.
    const f = process.env.AUTH_HOOK_MFA_ATIVO === 'true'
      ? { data: { pausa_seg: (await rpc<number>('auth_pausa_atual', { p_chave: chave, p_etapa: 'totp' })).data ?? 0, alerta: false } }
      : await rpc<{ pausa_seg: number; alerta: boolean }>('auth_registrar_falha', { p_chave: chave, p_etapa: 'totp' })
    const pausaSeg = f.data?.pausa_seg ?? 0
    await registrarAcesso({
      etapa: 'totp', resultado: pausaSeg ? 'pausa' : 'falha', motivo: pausaSeg ? 'pausa_aplicada' : 'totp_invalido', userId: sess.userId, sessionId: sess.sessionId,
      pausaAte: pausaSeg ? new Date(Date.now() + pausaSeg * 1000) : null, alerta: f.data?.alerta ?? false,
    })
    return pausaSeg ? { ok: false, pausaSeg, mensagem: mensagemPausa(pausaSeg) } : { ok: false, mensagem: 'Código inválido.' }
  }
  await rpc('auth_registrar_sucesso', { p_chave: chave, p_etapa: 'totp' })
  return { ok: true }
}

/** Ativação: verifica o TOTP recém-cadastrado e só então o aprova (exige a prova de e-mail da sessão). */
export async function confirmarAtivacaoTotp(factorId: string, code: string): Promise<ResultadoAcesso> {
  const sess = await sessaoAtual()
  if (!sess || typeof factorId !== 'string') return { ok: false, mensagem: MENSAGEM_GENERICA }
  const pode = await rpc<boolean>('auth_pode_ativar_fator', { p_user: sess.userId, p_session: sess.sessionId })
  if (pode.erro) return { ok: false, mensagem: MENSAGEM_INSTABILIDADE }
  if (pode.data !== true) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const v = await verificarTotpComContador(factorId, code, sess)
  if (!v.ok) return v
  // O verify gerou novo access token (mesmo session_id); relê os claims verificados.
  const depois = await sessaoAtual()
  const aprov = await rpc<string>('auth_aprovar_fator', { p_user: sess.userId, p_session: depois?.sessionId ?? sess.sessionId, p_factor_id: factorId })
  if (aprov.data !== 'ok') {
    const admin = await createAdminClient()
    await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: sess.userId })
    await registrarAcesso({ etapa: 'ativacao', resultado: 'negado', motivo: 'fator_nao_aprovado', userId: sess.userId, sessionId: sess.sessionId })
    return { ok: false, mensagem: MENSAGEM_GENERICA }
  }
  await registrarAcesso({ etapa: 'ativacao', resultado: 'sucesso', motivo: 'fator_aprovado', userId: sess.userId, sessionId: sess.sessionId })
  return { ok: true, proximo: 'email' }
}

/** Login normal: verifica o TOTP do fator APROVADO do usuário (o servidor escolhe o fator). */
export async function verificarTotp(code: string): Promise<ResultadoAcesso> {
  const sess = await sessaoAtual()
  if (!sess) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const estado = await obterEstadoBanco(sess.userId, sess.sessionId, sess.aal)
  if (!estado || !estado.interno_ativo || estado.bloqueado_admin || !estado.fator_id) return { ok: false, mensagem: MENSAGEM_GENERICA }
  const v = await verificarTotpComContador(estado.fator_id, code, sess)
  if (!v.ok) return v
  await registrarAcesso({ etapa: 'totp', resultado: 'sucesso', motivo: 'ok', userId: sess.userId, sessionId: sess.sessionId })
  return { ok: true, proximo: 'email' }
}

// ---------------------------------------------------------------- logout
export async function sair(escopo: 'esta' | 'todas' = 'esta'): Promise<void> {
  const sess = await sessaoAtual()
  if (sess) {
    if (escopo === 'todas') { // bump do epoch invalida o cookie brs_dc em qualquer navegador; este aqui tambem e apagado
      await rpc('auth_revogar_liberacoes', { p_user: sess.userId, p_motivo: 'logout_todas' })
      try { (await cookies()).delete(COOKIE_DISPOSITIVO) } catch { /* ignora */ }
    }
    else await rpc('auth_revogar_sessao', { p_user: sess.userId, p_session: sess.sessionId, p_motivo: 'logout' })
    await registrarAcesso({ etapa: 'logout', resultado: 'sucesso', motivo: escopo === 'todas' ? 'logout_todas' : 'logout', userId: sess.userId, sessionId: sess.sessionId })
  }
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: escopo === 'todas' ? 'global' : 'local' })
}

export async function estadoAcesso(): Promise<{ proximo: string; etapa: string; pausaEmailSeg: number; pausaTotpSeg: number }> {
  const sess = await sessaoAtual()
  if (!sess) return { proximo: 'login', etapa: 'anonima', pausaEmailSeg: 0, pausaTotpSeg: 0 }
  const estado = await obterEstadoBanco(sess.userId, sess.sessionId, sess.aal)
  const { etapa, proximo } = calcularEtapa(sess.claims, estado)
  return { etapa, proximo, pausaEmailSeg: estado?.pausa_email_seg ?? 0, pausaTotpSeg: estado?.pausa_totp_seg ?? 0 }
}
