import type { SupabaseClient } from '@supabase/supabase-js'

// Marca do tipo da conta em app_metadata.tipo, lida pelo banco em app_private.seg_tipo_conta()
// (gate M4; estrito a partir de M6: sem marca = negado). Só a service role grava app_metadata;
// nunca usar user_metadata para isso.
export type TipoConta = 'interno' | 'parceiro' | 'atendente'

type Meta = Record<string, unknown>

const DOMINIO_PARCEIRO = '@parceiro.brspromotora.com.br'

/**
 * app_metadata completo para enviar ao Auth: atual + extra + tipo. Funciona se o GoTrue mesclar ou
 * substituir o objeto (manda tudo). Regras iguais às do banco (M1/M5):
 *  - `tipo` válido já gravado nunca é trocado;
 *  - 'interno' nunca vai para conta com `external` ou e-mail do domínio de parceiro.
 */
export function mesclarAppMetadata(atual: unknown, extra: Meta, tipo?: TipoConta, email?: string | null): Meta {
  const base: Meta = atual && typeof atual === 'object' && !Array.isArray(atual) ? (atual as Meta) : {}
  const out: Meta = { ...base, ...extra }
  const jaTem = ['interno', 'parceiro', 'atendente'].includes(String(base.tipo))
  const internoProibido =
    tipo === 'interno' && (Boolean(base.external) || String(email ?? '').trim().toLowerCase().endsWith(DOMINIO_PARCEIRO))
  if (jaTem) out.tipo = base.tipo
  else if (tipo && !internoProibido) out.tipo = tipo
  return out
}

/** Lê o app_metadata e o e-mail atuais da conta (service role). Falha = exceção: não grava às cegas. */
export async function lerContaAuth(admin: SupabaseClient, userId: string): Promise<{ app_metadata: unknown; email: string | null }> {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user) throw error ?? new Error('Conta não encontrada no Auth.')
  return { app_metadata: data.user.app_metadata ?? {}, email: data.user.email ?? null }
}
