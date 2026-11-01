/* eslint-disable @typescript-eslint/no-explicit-any */
// NÃO é 'use server': função interna chamada só pela rota do Excel, que já
// autenticou o usuário. Em arquivo 'use server' ela viraria Server Action
// pública e qualquer sessão forjaria `userId` e marcaria remessas como exportadas.
import { createAdminClient } from '@/lib/supabase/server'

/** gerada → exportada (idempotente: se já passou disso, não mexe). */
export async function registrarExportacao(remessaId: string, userId: string) {
  const sb: any = await createAdminClient()
  const { data } = await sb.from('promocao_remessas')
    .update({ status: 'exportada', exportada_por: userId, exportada_em: new Date().toISOString() })
    .eq('id', remessaId).eq('status', 'gerada').select('campanha_id').maybeSingle()
  if (data) await sb.from('promocao_eventos').insert({ campanha_id: data.campanha_id, entidade: 'remessa', entidade_id: remessaId, tipo: 'remessa_exportada', ator_user_id: userId })
}
