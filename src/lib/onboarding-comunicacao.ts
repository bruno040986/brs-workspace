/**
 * Comunicação do pipeline Cadastros Recebidos (e-mail via resend_config,
 * WhatsApp via Z-API/sendAndLog). Os textos vêm dos Templates de Mensagens
 * (src/lib/mensagens). Falha de envio nunca derruba a ação que a chamou —
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

/**
 * E-mail e WhatsApp do parceiro a partir do corban_data (master do cadastro).
 * Prioriza quem PREENCHEU o cadastro (etapa "Identificação" do portal,
 * 23/09/2026) — é quem de fato vai abrir o link de correção — e só cai para
 * o sócio/contatos gerais quando o cadastro é anterior a essa etapa.
 */
export function resolverContatoParceiro(corbanData: Record<string, any>, nomeAgente: string): ContatoParceiro {
  const preenchedorEmail = String(corbanData?.preenchedor?.email || '').trim()
  const email =
    preenchedorEmail ||
    String(corbanData?.socios?.[0]?.email || '').trim() ||
    String(corbanData?.contacts?.email_comissao || '').trim() ||
    null
  const telefone =
    String(corbanData?.preenchedor?.whatsapp || '').trim() ||
    String(corbanData?.contacts?.phone_whatsapp || '').trim() ||
    String(corbanData?.commercial?.whatsapp_atendimento || '').trim() ||
    String(corbanData?.contacts?.phone_commercial || '').trim() ||
    null
  const nome = String((preenchedorEmail && corbanData?.preenchedor?.nome) || corbanData?.socios?.[0]?.nome || nomeAgente || 'Parceiro').trim()
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

// Os textos das mensagens saíram daqui em 26/09/2026 (fatia 5): catálogo e
// padrões em src/lib/mensagens/catalogo.ts, personalização na tela
// Agente Corban › Templates de Mensagens, renderização em src/lib/mensagens.
