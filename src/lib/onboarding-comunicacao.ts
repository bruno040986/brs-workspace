/**
 * Comunicação do pipeline Cadastros Recebidos (e-mail via resend_config,
 * WhatsApp via Z-API/sendAndLog). Templates em texto claro AQUI para o
 * Bruno ajustar as palavras sem caçar strings pelo sistema (critério de
 * aceite da orientação). Falha de envio nunca derruba a ação que a chamou —
 * o resultado volta pro operador decidir (reenviar, copiar o link etc.).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getDefaultInstance } from '@/lib/zapi/instances'
import { sendAndLog } from '@/lib/zapi/send'

export type ContatoParceiro = {
  nome: string
  email: string | null
  telefone: string | null
}

/** E-mail e WhatsApp do parceiro a partir do corban_data (master do cadastro). */
export function resolverContatoParceiro(corbanData: Record<string, any>, nomeAgente: string): ContatoParceiro {
  const email =
    String(corbanData?.socios?.[0]?.email || '').trim() ||
    String(corbanData?.contacts?.email_comissao || '').trim() ||
    null
  const telefone =
    String(corbanData?.contacts?.phone_whatsapp || '').trim() ||
    String(corbanData?.commercial?.whatsapp_atendimento || '').trim() ||
    String(corbanData?.contacts?.phone_commercial || '').trim() ||
    null
  const nome = String(corbanData?.socios?.[0]?.nome || nomeAgente || 'Parceiro').trim()
  return { nome, email, telefone }
}

export async function enviarEmailOnboarding(input: {
  to: string
  subject: string
  html: string
}): Promise<{ ok: boolean; detalhe: string }> {
  try {
    const admin = await createAdminClient()
    const { data: resend } = await admin.from('resend_config').select('*').limit(1).maybeSingle()
    if (!resend || !resend.is_active || !resend.api_key) {
      return { ok: false, detalhe: 'Resend inativo ou sem credenciais (Provedores e APIs › API E-mail).' }
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resend.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resend.from_email || 'onboarding@brspromotora.com.br',
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    })
    if (!res.ok) return { ok: false, detalhe: `Resend respondeu ${res.status}.` }
    return { ok: true, detalhe: 'E-mail enviado.' }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Erro no envio de e-mail.' }
  }
}

export async function enviarWhatsAppOnboarding(input: {
  phone: string
  texto: string
  partnerId?: string | null
}): Promise<{ ok: boolean; detalhe: string }> {
  try {
    const instance = await getDefaultInstance()
    if (!instance) return { ok: false, detalhe: 'Nenhuma instância Z-API padrão configurada.' }
    const result = await sendAndLog({
      instance,
      phone: input.phone,
      source: 'scp',
      block: { type: 'text', body: input.texto },
      refs: { partnerId: input.partnerId || null },
    })
    if (!result.ok) return { ok: false, detalhe: result.error }
    return { ok: true, detalhe: 'WhatsApp enviado.' }
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : 'Erro no envio de WhatsApp.' }
  }
}

// ===========================================================================
// Templates (texto claro — ajustar aqui)
// ===========================================================================

export function templateNuvidio(nome: string, link: string) {
  const assunto = 'BRS Promotora — Validação por vídeo (Nuvidio)'
  const texto = `Olá, ${nome}! Aqui é da BRS Promotora. Para seguirmos com o seu credenciamento, precisamos de uma rápida validação por vídeo. Acesse: ${link} — leva poucos minutos. Qualquer dúvida, é só responder por aqui.`
  const html = `<p>Olá, <strong>${nome}</strong>!</p><p>Para seguirmos com o seu credenciamento na BRS Promotora, precisamos de uma rápida validação por vídeo.</p><p><a href="${link}">Clique aqui para fazer a validação</a> — leva poucos minutos.</p><p>Qualquer dúvida, responda este e-mail.</p><p>Equipe BRS Promotora</p>`
  return { assunto, texto, html }
}

export function templateContrato(nome: string, links: string[]) {
  const lista = links.map((l) => `• ${l}`).join('\n')
  const assunto = 'BRS Promotora — Contrato de credenciamento para assinatura'
  const texto = `Olá, ${nome}! Seu contrato de credenciamento com a BRS Promotora está pronto para assinatura digital:\n${lista}\nApós todas as assinaturas, seguimos para a etapa final do seu cadastro.`
  const html = `<p>Olá, <strong>${nome}</strong>!</p><p>Seu contrato de credenciamento com a BRS Promotora está pronto para assinatura digital:</p><ul>${links.map((l) => `<li><a href="${l}">${l}</a></li>`).join('')}</ul><p>Após todas as assinaturas, seguimos para a etapa final do seu cadastro.</p><p>Equipe BRS Promotora</p>`
  return { assunto, texto, html }
}

export function templateCorrecao(nome: string, link: string, itens: Array<{ rotulo: string; instrucoes: string }>) {
  const listaTexto = itens.map((i) => `• ${i.rotulo}: ${i.instrucoes}`).join('\n')
  const assunto = 'BRS Promotora — Ajustes necessários no seu cadastro'
  const texto = `Olá, ${nome}! Analisamos o seu cadastro na BRS Promotora e precisamos de alguns ajustes:\n${listaTexto}\n\nCorrija pelos link seguro (válido por 7 dias): ${link}`
  const html = `<p>Olá, <strong>${nome}</strong>!</p><p>Analisamos o seu cadastro na BRS Promotora e precisamos de alguns ajustes:</p><ul>${itens
    .map((i) => `<li><strong>${i.rotulo}</strong>: ${i.instrucoes}</li>`)
    .join('')}</ul><p><a href="${link}">Clique aqui para corrigir</a> (link seguro, válido por 7 dias).</p><p>Equipe BRS Promotora</p>`
  return { assunto, texto, html }
}

export function templateBoasVindas(nome: string, arwCode: string | null) {
  const codigo = arwCode ? ` Seu código de parceiro é ${arwCode}.` : ''
  const assunto = 'Bem-vindo à BRS Promotora! 🎉'
  const texto = `Parabéns, ${nome}! Seu credenciamento na BRS Promotora foi concluído.${codigo} Em breve nosso time comercial entra em contato com os próximos passos. Seja muito bem-vindo!`
  const html = `<p>Parabéns, <strong>${nome}</strong>! 🎉</p><p>Seu credenciamento na BRS Promotora foi concluído.${codigo}</p><p>Em breve nosso time comercial entra em contato com os próximos passos.</p><p>Seja muito bem-vindo!<br/>Equipe BRS Promotora</p>`
  return { assunto, texto, html }
}
