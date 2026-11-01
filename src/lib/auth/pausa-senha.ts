// Decisao pura da pausa de senha (I2). Origem (par identificador+origem, IP) e tier duro por identificador NUNCA
// sao dispensados; so a pausa leve por identificador cede a Turnstile ligado E valido.
export function decidirPausaSenha(p: { origemSeg: number; duroSeg: number; leveSeg: number; turnstileAplicadoEValido: boolean; dispositivoConfiavel?: boolean }):
  { bloqueia: boolean; pausaSeg: number; motivo: 'pausa_ativa' | 'pausa_ativa_teto_identificador' | 'pausa_ativa_identificador' | null } {
  if (p.origemSeg > 0) return { bloqueia: true, pausaSeg: p.origemSeg, motivo: 'pausa_ativa' }
  // C1: cookie de dispositivo confiavel (login completo anterior neste navegador) dispensa as pausas so-por-identificador.
  if (p.duroSeg > 0 && !p.dispositivoConfiavel) return { bloqueia: true, pausaSeg: p.duroSeg, motivo: 'pausa_ativa_teto_identificador' } // captcha nao dispensa
  if (p.leveSeg > 0 && !p.turnstileAplicadoEValido && !p.dispositivoConfiavel) return { bloqueia: true, pausaSeg: p.leveSeg, motivo: 'pausa_ativa_identificador' }
  return { bloqueia: false, pausaSeg: 0, motivo: null }
}
