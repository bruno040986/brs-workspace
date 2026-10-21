/**
 * Cron: envia os e-mails do HelpDesk enfileirados pelos triggers
 * (helpdesk_email_fila — mesmos eventos do sino). Agendado no vercel.json,
 * protegido por CRON_SECRET (Vercel manda `Authorization: Bearer <CRON_SECRET>`).
 *
 * Envio pelo Resend do projeto (resend_config lido 1x por lote, via
 * enviarEmailOnboarding). Antes de enviar, cada linha é RESERVADA com
 * enviado_em = agora só se ainda estiver null (claim atômico: duas execuções
 * simultâneas não mandam o mesmo e-mail). Sucesso mantém o enviado_em; falha
 * definitiva (sem e-mail, 4xx exceto 429) grava erro; falha passageira
 * devolve enviado_em = null e soma tentativas, com erro definitivo na 5ª
 * (desfechoEmailFila). O e-mail leva só título do ticket, evento e link;
 * nunca descrição nem prints.
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { carregarResendConfig, enviarEmailOnboarding } from '@/lib/onboarding-comunicacao'
import { desfechoEmailFila } from '@/lib/helpdesk/validacao'
import { escapeHtml } from '@/lib/mensagens/render'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LOTE = 20
// Não reserva linha nova depois disso: envio tem timeout de 15 s e a função
// morre em 60 s — linha reservada e não enviada ficaria marcada como enviada.
const ORCAMENTO_MS = 35_000

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

function linkHelpdesk(): string {
  const base =
    String(process.env.NEXT_PUBLIC_APP_URL || '').trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  return base ? `${base.replace(/\/+$/, '')}/helpdesk` : ''
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  const admin = await createAdminClient()
  const { data: fila, error } = await admin
    .from('helpdesk_email_fila')
    .select('id, user_id, assunto, corpo, tentativas')
    .is('enviado_em', null)
    .is('erro', null)
    .order('created_at')
    .limit(LOTE)
  if (error) {
    console.error('[helpdesk-emails] erro ao ler a fila:', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!fila?.length) return Response.json({ ok: true, enviados: 0, erros: 0 })

  const ids = [...new Set(fila.map((f) => String(f.user_id)))]
  const { data: usuarios } = await admin.from('users').select('id, email').in('id', ids)
  const emailPorId = new Map((usuarios || []).map((u) => [String(u.id), String(u.email || '').trim()]))
  const link = linkHelpdesk()
  const resend = await carregarResendConfig()

  let enviados = 0
  let erros = 0
  for (const f of fila) {
    if (Date.now() - inicio > ORCAMENTO_MS) break
    const { data: reservada, error: erroReserva } = await admin
      .from('helpdesk_email_fila')
      .update({ enviado_em: new Date().toISOString() })
      .eq('id', f.id)
      .is('enviado_em', null)
      .select('id')
    if (erroReserva) console.error('[helpdesk-emails] não reservou a linha', f.id, erroReserva)
    if (!reservada?.length) continue

    const to = emailPorId.get(String(f.user_id)) || ''
    const corpoHtml = escapeHtml(f.corpo).replace(/\n/g, '<br>')
    const html = `<p>${corpoHtml}</p><p>${
      link ? `<a href="${escapeHtml(link)}">Abrir o HelpDesk</a>` : 'Abra o HelpDesk no BRS Workspace.'
    }</p><p style="color:#888;font-size:12px">Aviso automático do BRS Workspace.</p>`
    const r = to
      ? await enviarEmailOnboarding({ to, subject: f.assunto, html }, { resend })
      : { ok: false, detalhe: 'Usuário sem e-mail.' }
    if (r.ok) {
      enviados += 1
      continue
    }
    erros += 1
    const { error: erroMarca } = await admin
      .from('helpdesk_email_fila')
      .update(desfechoEmailFila(r, f.tentativas))
      .eq('id', f.id)
    if (erroMarca) console.error('[helpdesk-emails] não marcou a falha da linha', f.id, erroMarca)
  }

  return Response.json({ ok: true, enviados, erros })
}
