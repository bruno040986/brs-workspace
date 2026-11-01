import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizarEvento } from './normalizar'
import { classificarEvento, dentroDoExpediente, type HorarioDia } from './regras'
import type { EventoSeguranca } from './tipos'

export type ResultadoRegistro = { ok: boolean; eventoId?: string; incidentes?: { regra: string; codigo?: string; novo?: boolean }[]; erro?: string }

/**
 * Hook de eventos de segurança. NUNCA lança: falha de registro não pode derrubar login/ação.
 * Chamar DEPOIS de decidir o resultado de negócio (o evento descreve o que aconteceu, não o decide).
 * Devolve código INC-n só para log interno: não anunciar a ninguém (o canal é o M06, após COMMIT).
 */
export async function registrarEventoSeguranca(evento: EventoSeguranca): Promise<ResultadoRegistro> {
  try {
    const ev = normalizarEvento(evento)
    const admin = await createAdminClient()
    let fora: boolean | null = null
    if (ev.tipo === 'login.concluido' && ev.identidade_validada_user_id) {
      const { data, error: errHor } = await admin.from('user_schedules').select('day_of_week, enabled, start_time_1, end_time_1, start_time_2, end_time_2').eq('user_id', ev.identidade_validada_user_id)
      if (errHor) console.error('[seguranca] falha ao ler user_schedules (regra fora_do_expediente desativada neste evento)', errHor.message?.slice(0, 200))
      const h = (data || []) as HorarioDia[]
      const dentro = dentroDoExpediente(h, new Date(ev.ocorrido_em))
      fora = dentro === null ? null : !dentro
    }
    const { data, error } = await admin.rpc('seg_registrar_evento', { p_evento: ev, p_classificacoes: classificarEvento(ev, { foraDoExpediente: fora }) })
    if (error) throw error
    // M5: eventos de login anônimos (falha/pausa/bloqueio) não disparam after(); o cron de 1 min cobre.
    if (data?.incidentes?.some((i: { novo?: boolean }) => i.novo) && !/^login\.(falha|pausa|bloqueio)$/.test(ev.tipo)) acionarDispatcher()
    return { ok: true, eventoId: data?.evento_id, incidentes: data?.incidentes }
  } catch (e) {
    console.error('[seguranca] falha ao registrar evento', evento?.tipo, e instanceof Error ? e.message.slice(0, 200) : 'erro')
    return { ok: false, erro: 'registro_indisponivel' }
  }
}

/**
 * M06: aciona o dispatcher logo após o COMMIT de um incidente novo (alto/crítico não espera o cron de 1 min nem a IA).
 * Best-effort: `after()` roda depois da resposta; fora de um request (ou se falhar) o cron cobre. Nunca lança nem bloqueia.
 */
function acionarDispatcher() {
  try {
    after(async () => {
      try { await (await import('./dispatcher/producao')).rodarDispatcher(undefined, 1) } catch { /* o cron de 1 min é a rede de segurança */ }
    })
  } catch { /* fora de escopo de request */ }
}
