'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/server'
import { registrarAcesso } from '@/lib/auth/sessao-interna'
import { lerContaAuth, mesclarAppMetadata } from '@/lib/auth/tipo-conta'
import { classificarErroAuth, mensagemPausa } from '@/lib/auth/etapas'

// M04 I3: a troca de senha e feita AQUI (nao mais no navegador via updateUser): exige sessao LIBERADA
// (requireCurrentUser), a senha atual (verificada com cliente sem persistencia, para nao trocar a sessao) e
// limita tentativas da senha atual. O trigger do banco revoga TODAS as liberacoes ao trocar encrypted_password
// (inclusive a desta sessao): o cliente encerra a sessao e o usuario refaz as etapas com a senha nova.
const CHAVE_LIMITE = 5
export async function trocarSenha(senhaAtual: string, novaSenha: string): Promise<{ success: boolean; error?: string; pausaSeg?: number }> {
  try {
    const user = await requireCurrentUser()
    const atual = String(senhaAtual ?? '')
    const nova = String(novaSenha ?? '')
    if (!user.email || !atual) return { success: false, error: 'Informe a senha atual.' }
    if (nova.length < 8 || nova.length > 72) return { success: false, error: 'A nova senha deve ter entre 8 e 72 caracteres.' }
    if (nova === atual) return { success: false, error: 'A nova senha deve ser diferente da atual.' }

    const admin = await createAdminClient()
    const chave = `tp:${user.id}`
    const pausa = await admin.rpc('auth_pausa_atual', { p_chave: chave, p_etapa: 'senha' })
    if (pausa.error) return { success: false, error: 'Servico de autenticacao instavel. Tente novamente em instantes.' }
    if (Number(pausa.data) > 0) return { success: false, pausaSeg: Number(pausa.data), error: mensagemPausa(Number(pausa.data)) }

    const verificador = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: credErr } = await verificador.auth.signInWithPassword({ email: user.email, password: atual })
    if (credErr) {
      if (classificarErroAuth(credErr) === 'infra') return { success: false, error: 'Servico de autenticacao instavel. Tente novamente em instantes.' }
      await admin.rpc('auth_registrar_falha_limiar', { p_chave: chave, p_etapa: 'senha', p_limite: CHAVE_LIMITE, p_pausa_fixa_min: 5 })
      await registrarAcesso({ etapa: 'senha', resultado: 'falha', motivo: 'troca_senha_atual_invalida', userId: user.id, sessionId: user.session_id })
      return { success: false, error: 'Senha atual incorreta.' }
    }
    await verificador.auth.signOut({ scope: 'local' }).catch(() => {}) // C4: encerra a sessao AAL1 orfa do verificador
    await admin.rpc('auth_registrar_sucesso', { p_chave: chave, p_etapa: 'senha' })

    const conta = await lerContaAuth(admin, user.id)
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: nova,
      app_metadata: mesclarAppMetadata(conta.app_metadata, { temp_password_reset_required: false }),
    })
    if (error) return { success: false, error: 'Nao foi possivel atualizar a senha. Tente novamente.' }
    await registrarAcesso({ etapa: 'senha', resultado: 'sucesso', motivo: 'senha_trocada', userId: user.id, sessionId: user.session_id })
    return { success: true }
  } catch {
    return { success: false, error: 'Nao foi possivel atualizar a senha. Tente novamente.' }
  }
}
