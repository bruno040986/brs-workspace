import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { processarHookMfa } from '@/lib/auth/hook-mfa'
import { registrarAcesso } from '@/lib/auth/sessao-interna'

// Auth Hook "MFA Verification Attempt" (configurar no painel do Auth; ver RELATORIO-M04). Autentica pela
// assinatura Standard Webhooks (AUTH_HOOK_MFA_SECRET); sem a env, falha fechado (503). Sem sessao/cookie.
export async function POST(request: Request) {
  const corpo = await request.text()
  const admin = await createAdminClient()
  const r = await processarHookMfa(
    { id: request.headers.get('webhook-id'), timestamp: request.headers.get('webhook-timestamp'), assinatura: request.headers.get('webhook-signature') },
    corpo,
    {
      segredo: process.env.AUTH_HOOK_MFA_SECRET,
      pausaAtual: async (u) => { const { data, error } = await admin.rpc('auth_pausa_atual', { p_chave: u, p_etapa: 'totp' }); return error ? null : Number(data ?? 0) },
      registrarFalha: async (u) => {
        const { data, error } = await admin.rpc('auth_registrar_falha', { p_chave: u, p_etapa: 'totp' })
        return error || !data ? null : { pausaSeg: Number((data as { pausa_seg?: number }).pausa_seg ?? 0), alerta: Boolean((data as { alerta?: boolean }).alerta) }
      },
      registrarSucesso: async (u) => { await admin.rpc('auth_registrar_sucesso', { p_chave: u, p_etapa: 'totp' }) },
      log: async (e) => registrarAcesso({ etapa: 'totp', resultado: e.resultado, motivo: e.motivo, userId: e.userId ?? null, pausaAte: e.pausaSeg ? new Date(Date.now() + e.pausaSeg * 1000) : null, alerta: e.alerta }),
    },
  )
  return NextResponse.json(r.corpo, { status: r.status })
}
