'use server'

// M04 — administração de acesso interno: bloqueio administrativo (único bloqueio longo; nunca
// automático) e remoção do autenticador (troca de telefone/perda). Registra quem fez.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { registrarAcesso } from '@/lib/auth/sessao-interna'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function bloquearAcessoUsuario(userId: string, ateIso: string | null, motivo: string) {
  try {
    const { user } = await requirePermission('sistema-usuarios-cadastro', 'can_edit')
    if (!UUID.test(userId) || userId === user.id) throw new Error('Usuario invalido.')
    const ate = ateIso ? new Date(ateIso) : null
    if (ate && (Number.isNaN(ate.getTime()) || ate.getTime() <= Date.now())) throw new Error('Data de fim invalida.')
    const admin = await createAdminClient()
    const { data, error } = await admin.rpc('auth_bloquear_usuario', { p_user: userId, p_ate: ate ? ate.toISOString() : null, p_motivo: String(motivo || '').slice(0, 300), p_por: user.id })
    if (error) throw error
    await registrarAcesso({ etapa: 'admin', resultado: 'bloqueado', motivo: 'bloqueio_criado', userId, bloqueioId: data as string })
    revalidatePath('/usuarios/logs-acessos')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Falha ao bloquear.' }
  }
}

export async function desbloquearAcessoUsuario(userId: string, motivo: string) {
  try {
    const { user } = await requirePermission('sistema-usuarios-cadastro', 'can_edit')
    if (!UUID.test(userId)) throw new Error('Usuario invalido.')
    const admin = await createAdminClient()
    const { error } = await admin.rpc('auth_desbloquear_usuario', { p_user: userId, p_por: user.id, p_motivo: String(motivo || '').slice(0, 300) })
    if (error) throw error
    await registrarAcesso({ etapa: 'admin', resultado: 'sucesso', motivo: 'bloqueio_removido', userId, desbloqueadoPor: user.id })
    revalidatePath('/usuarios/logs-acessos')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Falha ao desbloquear.' }
  }
}

/**
 * Remove o autenticador do usuario (nova ativacao exige novo e-mail). Exige permissao root, nao
 * permite sobre si mesmo e RECUSA se o alvo for o ultimo usuario ativo com sistema-usuarios-root
 * (proposta de quebra de vidro: ver RELATORIO-M04; nenhum atalho aqui).
 */
export async function removerAutenticadorUsuario(userId: string) {
  try {
    const { user } = await requirePermission('sistema-usuarios-root', 'can_edit')
    if (!UUID.test(userId) || userId === user.id) throw new Error('Usuario invalido.')
    const admin = await createAdminClient()
    const { data: roots } = await admin.from('user_permissions').select('user_id').eq('resource_name', 'sistema-usuarios-root').eq('can_edit', true)
    const outros = (roots || []).filter((r: { user_id: string }) => r.user_id !== userId)
    if (outros.length === 0) throw new Error('Recusado: seria o ultimo administrador.')
    const { data: fatores } = await admin.auth.admin.mfa.listFactors({ userId })
    for (const f of fatores?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId })
    const { error } = await admin.rpc('auth_remover_fator', { p_user: userId, p_motivo: 'removido_admin' })
    if (error) throw error
    await registrarAcesso({ etapa: 'admin', resultado: 'sucesso', motivo: 'fator_removido', userId, desbloqueadoPor: user.id })
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Falha ao remover autenticador.' }
  }
}
