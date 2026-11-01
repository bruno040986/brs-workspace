'use server'

// M06 — configuração dos canais de notificação. Segredos (token do bot, chat_id, telefone de destino) são cifrados com o
// MESMO cofre das integrações (CRM_CREDENTIALS_KEY, AES-256-GCM) e gravados em seg_destinos_protegidos; nunca voltam à tela.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { cifrarTexto, cofreConfigurado } from '@/lib/central-conversas/cofre'
import { registrarAcesso } from '@/lib/auth/sessao-interna'

const CANAIS = ['telegram', 'whatsapp', 'email'] as const
type Canal = (typeof CANAIS)[number]
const CAMPOS: Record<Canal, string[]> = { telegram: ['bot_token', 'chat_id'], whatsapp: ['destino'], email: [] }

export async function salvarCanal(formData: FormData): Promise<void> {
  const { user } = await requirePermission('sistema-usuarios-root', 'can_edit')
  const canal = String(formData.get('canal') ?? '') as Canal
  if (!CANAIS.includes(canal)) throw new Error('Canal inválido.')
  const admin = await createAdminClient()
  for (const chave of CAMPOS[canal]) {
    const v = String(formData.get(chave) ?? '').trim()
    if (!v) continue // campo vazio = manter o valor atual
    if (v.length > 200) throw new Error('Valor longo demais.')
    if (!cofreConfigurado()) throw new Error('Cofre não configurado (CRM_CREDENTIALS_KEY).')
    const { error } = await admin.from('seg_destinos_protegidos').upsert({ canal, chave, valor_cifrado: cifrarTexto(v), atualizado_em: new Date().toISOString() }, { onConflict: 'canal,chave' })
    if (error) throw new Error('Falha ao gravar o segredo.')
  }
  const habilitado = formData.get('habilitado') === 'on'
  const { error } = await admin.from('seg_canais_config').update({ habilitado, atualizado_em: new Date().toISOString(), atualizado_por: user.id }).eq('canal', canal)
  if (error) throw new Error('Falha ao salvar o canal.')
  await registrarAcesso({ etapa: 'admin', resultado: 'sucesso', motivo: `canal_${canal}_${habilitado ? 'ligado' : 'desligado'}`, userId: user.id })
  revalidatePath('/usuarios/seguranca/canais')
}
