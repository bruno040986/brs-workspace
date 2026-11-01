import { hashCurto } from './normalizar.ts'
import type { Classificacao, EventoNormalizado } from './tipos.ts'

// Limiares/janelas/cardinalidade moram em public.seg_config (proposta, não decisão do Bruno);
// o SQL aplica 'regra.<regra>.limiar' e 'regra.<regra>.janela_min'. Aqui só se decide REGRA, CONTEXTO e GRAVIDADE.

export type HorarioDia = {
  day_of_week: number // 0 = segunda ... 6 = domingo (convenção de user_schedules / tela de Usuários)
  enabled: boolean
  start_time_1?: string | null
  end_time_1?: string | null
  start_time_2?: string | null
  end_time_2?: string | null
}

const FUSO = 'America/Sao_Paulo'

function partesLocais(d: Date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(String(p.weekday))
  return { dow, min: Number(p.hour) * 60 + Number(p.minute) }
}

const minutos = (t?: string | null) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * true/false; null quando não há horário cadastrado (não alerta: sem base para afirmar "fora do expediente").
 * Dia desabilitado = fora do expediente.
 */
export function dentroDoExpediente(horarios: HorarioDia[], quando: Date): boolean | null {
  if (!horarios.length) return null
  const { dow, min } = partesLocais(quando)
  const dia = horarios.find((h) => h.day_of_week === dow)
  if (!dia || !dia.enabled) return false
  return [[dia.start_time_1, dia.end_time_1], [dia.start_time_2, dia.end_time_2]].some(([a, b]) => {
    const ini = minutos(a), fim = minutos(b)
    return ini !== null && fim !== null && min >= ini && min <= fim
  })
}

/** Regras determinísticas iniciais. `foraDoExpediente` só é consultado para login.concluido. */
export function classificarEvento(e: EventoNormalizado, ctx: { foraDoExpediente?: boolean | null } = {}): Classificacao[] {
  const out: Classificacao[] = []
  const ident = e.identidade_informada ? hashCurto(e.identidade_informada) : null
  switch (e.tipo) {
    case 'login.falha':
      if (ident) out.push({ regra: 'login_falhas_identificador', contexto: `ident:${ident}`, gravidade: 'media' })
      if (e.ip_observado) out.push({ regra: 'login_falhas_origem', contexto: `ip:${hashCurto(e.ip_observado)}`, gravidade: 'media' })
      break
    case 'login.pausa':
    case 'login.bloqueio':
      // B1: UMA notificação por janela de 10 min (contexto global); as demais ocorrências entram como eventos_total do mesmo incidente.
      out.push({ regra: 'login_reincidencia', contexto: 'global', gravidade: 'alta', limiar: 1, janela_min: 10 })
      break
    case 'login.concluido':
      if (ctx.foraDoExpediente === true && e.identidade_validada_user_id) {
        out.push({ regra: 'login_fora_expediente', contexto: `user:${e.identidade_validada_user_id}`, gravidade: 'media', limiar: 1 })
      }
      break
    case 'permissao.alterada':
    case 'perfil.alterado':
      out.push({ regra: 'permissao_alterada', contexto: 'global', gravidade: 'alta', limiar: 1 })
      break
    case 'fator.desconhecido':
      out.push({ regra: 'fator_mfa_desconhecido', contexto: e.identidade_validada_user_id ? `user:${e.identidade_validada_user_id}` : 'global', gravidade: 'alta', limiar: 1 })
      break
    case 'signup.tentativa':
      out.push({ regra: 'signup_tentativa', contexto: 'global', gravidade: 'critica', limiar: 1 })
      break
  }
  return out
}
