import type { Incidente } from './tipos.ts'

/**
 * Template FIXO (PLANO-MESTRE §7.1), sem IA. Só entram dados que o motor de regras produziu e que são
 * estruturados: código INC-n, gravidade, regra (vocabulário controlado), contagens e janela.
 * Identidade informada, IP, user-agent e payload NUNCA entram (conteúdo não confiável). Texto de cada regra
 * vem de um dicionário local; regra desconhecida cai em frase genérica com o nome higienizado.
 */
const FRASES: Record<string, (n: number) => string> = {
  login_falhas_identificador: (n) => `${n} falha(s) de login para um mesmo identificador na janela.`,
  login_falhas_origem: (n) => `${n} falha(s) de login vindas de uma mesma origem na janela.`,
  login_reincidencia: (n) => `Pausa ou bloqueio de acesso aplicado após tentativas repetidas (${n} evento(s)).`,
  login_fora_expediente: () => 'Login concluído fora do expediente cadastrado.',
  permissao_alterada: (n) => `Permissões de usuário alteradas (${n} evento(s)).`,
  perfil_alterado: (n) => `Perfil de acesso alterado (${n} evento(s)).`,
  fator_desconhecido: () => 'Fator de autenticação sem ticket de ativação.',
  signup_tentativa: (n) => `Tentativa de cadastro público (${n} evento(s)).`,
  dispatcher_falha: (n) => `Falha interna do sistema de notificação (${n} evento(s)).`,
}

/** Remove controles/quebras, limita tamanho e deixa só caracteres de vocabulário técnico. */
export function limparToken(s: unknown, max = 60): string {
  return String(s ?? '').replace(/[^a-zA-Z0-9_.\- ]/g, '').slice(0, max)
}
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0)

export type DadosMensagem = { incidente: Incidente; tipo: 'alerta' | 'resumo' | 'analise'; iaMotivo?: string | null; controles?: string[]; possivelDuplicata?: { versao: number } | null }
export type ResumoRecuperacao = { suprimidas_orcamento: number; incertas: number; falhas: number; por_contingencia: number }

export function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function montarTexto(d: DadosMensagem): string {
  const i = d.incidente
  const cod = limparToken(i.codigo, 20)
  const grav = limparToken(i.gravidade, 10)
  const frase = (FRASES[i.regra] ?? ((n: number) => `Regra "${limparToken(i.regra)}" acionada (${n} evento(s)).`))(num(i.eventos_total))
  const linhas = [`BRS Segurança — ${cod} — ${grav}`, '']
  if (d.possivelDuplicata) linhas.push(`Possível duplicata do alerta ${cod} v.${num(d.possivelDuplicata.versao)} (contingência após envio incerto).`, '')
  linhas.push(frase)
  if (num(i.eventos_suprimidos) > 0) linhas.push(`Mais ${num(i.eventos_suprimidos)} evento(s) agrupado(s) não detalhado(s) aqui.`)
  if (i.agregado) linhas.push('Volume anômalo: vários contextos foram agrupados neste incidente.')
  linhas.push('', d.iaMotivo ? `Não foi possível acionar o Jarvis: ${limparToken(d.iaMotivo, 80)}.` : 'Este alerta não depende de análise por IA.')
  linhas.push('', `O incidente está registrado. Consulte ${cod} pelo MCP de segurança no Claude ou ChatGPT, ou pelo painel autenticado.`)
  if (d.controles?.length) linhas.push('', `Controles aplicados: ${d.controles.map((c) => limparToken(c, 60)).join('; ')}.`)
  return linhas.join('\n')
}

/** Resumo único após recuperação: só contagens, nunca reemite o backlog. */
export function montarResumo(r: ResumoRecuperacao): string {
  return [
    'BRS Segurança — resumo após recuperação do canal',
    '',
    `Sem aceite pelo Telegram no período: ${num(r.por_contingencia)} entregue(s) por outro canal, ${num(r.suprimidas_orcamento)} suprimida(s) por orçamento, ${num(r.incertas)} com resultado incerto, ${num(r.falhas)} com falha.`,
    'Nada será reenviado. Consulte os incidentes pelo painel autenticado ou pelo MCP de segurança.',
  ].join('\n')
}

export function montarEmail(texto: string, codigo: string, gravidade: string): { assunto: string; html: string } {
  return {
    assunto: `[BRS Segurança] ${limparToken(codigo, 20)} — ${limparToken(gravidade, 10)}`,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${escaparHtml(texto)}</pre>`,
  }
}
