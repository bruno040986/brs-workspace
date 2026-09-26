import { createClient } from '@/lib/supabase/client'

export type PresencaRecebida = { instanciaId: string; jid: string; estado: 'digitando' | 'gravando' | 'online' | 'offline' | 'parado'; em: number }

/**
 * Canal de presença (broadcast do engine, `presenca-conta-<chatwoot_account_id>`).
 * Um canal só por página: o dock e /conversas montam useAtendimento juntos e o
 * supabase-js não aceita dois `.on()` no mesmo tópico depois do subscribe.
 */
let canal: ReturnType<ReturnType<typeof createClient>['channel']> | null = null
let conta: number | null = null
const ouvintes = new Set<(p: PresencaRecebida) => void>()

export function ouvirPresenca(accountId: number, cb: (p: PresencaRecebida) => void): () => void {
  ouvintes.add(cb)
  if (!canal || conta !== accountId) {
    const supabase = createClient()
    if (canal) void supabase.removeChannel(canal)
    conta = accountId
    canal = supabase
      .channel(`presenca-conta-${accountId}`)
      .on('broadcast', { event: 'presenca' }, ({ payload }) => ouvintes.forEach((o) => o(payload as PresencaRecebida)))
      .subscribe()
  }
  return () => {
    ouvintes.delete(cb)
    if (!ouvintes.size && canal) {
      void createClient().removeChannel(canal)
      canal = null
      conta = null
    }
  }
}
