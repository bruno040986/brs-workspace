/**
 * Pesquisa de satisfação (CSAT) do Chatwoot (D4, lote 2) — validação e resumo PUROS.
 * Config por caixa de entrada: PATCH /inboxes/:id { csat_survey_enabled, csat_config:{display_type,message,button_text,language} }.
 * Respostas: GET /csat_survey_responses (nota 1–5 + comentário).
 * ATENÇÃO: o engine ainda não envia a mensagem `input_csat` com o link da pesquisa
 * (ver docs/RECADO-ENGINE-CSAT-2026-09-26.md); sem isso o cliente recebe só o texto.
 */

export const CSAT_TIPOS = [
  { valor: 'emoji', rotulo: 'Emoji (😡 😕 😐 🙂 😍)' },
  { valor: 'star', rotulo: 'Estrelas (★1–5)' },
] as const

export const CSAT_MENSAGEM_PADRAO = 'Como foi o seu atendimento? Sua opinião nos ajuda a melhorar.'
export const CSAT_BOTAO_PADRAO = 'Avaliar atendimento'

export type CsatEntrada = { ativa: boolean; tipo: string; mensagem: string; botao: string }

export function montarConfigCsat(e: CsatEntrada): { ok: true; corpo: { csat_survey_enabled: boolean; csat_config: { display_type: string; message: string; button_text: string; language: string } } } | { ok: false; error: string } {
  const mensagem = String(e.mensagem || '').trim()
  const botao = String(e.botao || '').trim()
  if (!CSAT_TIPOS.some((t) => t.valor === e.tipo)) return { ok: false, error: 'Tipo de avaliação inválido.' }
  if (e.ativa && !mensagem) return { ok: false, error: 'Escreva o texto da pesquisa.' }
  if (mensagem.length > 300) return { ok: false, error: 'O texto da pesquisa passa de 300 caracteres.' }
  if (botao.length > 40) return { ok: false, error: 'O texto do botão passa de 40 caracteres.' }
  return { ok: true, corpo: { csat_survey_enabled: Boolean(e.ativa), csat_config: { display_type: e.tipo, message: mensagem, button_text: botao || CSAT_BOTAO_PADRAO, language: 'pt_BR' } } }
}

export type RespostaCsat = { id: number; rating: number; feedback_message?: string | null; conversation_id?: number; created_at?: number | string; assigned_agent?: { id?: number; name?: string } | null; contact?: { name?: string } | null }

export type ResumoCsat = { total: number; media: number; distribuicao: Record<1 | 2 | 3 | 4 | 5, number>; porAtendente: Array<{ nome: string; total: number; media: number }> }

const arred = (n: number) => Math.round(n * 100) / 100

export function resumirCsat(respostas: RespostaCsat[]): ResumoCsat {
  const validas = respostas.filter((r) => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)
  const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ResumoCsat['distribuicao']
  const por = new Map<string, { soma: number; total: number }>()
  let soma = 0
  for (const r of validas) {
    distribuicao[r.rating as 1 | 2 | 3 | 4 | 5]++
    soma += r.rating
    const nome = r.assigned_agent?.name || 'Sem atendente'
    const a = por.get(nome) || { soma: 0, total: 0 }
    a.soma += r.rating
    a.total++
    por.set(nome, a)
  }
  return {
    total: validas.length,
    media: validas.length ? arred(soma / validas.length) : 0,
    distribuicao,
    porAtendente: [...por.entries()].map(([nome, a]) => ({ nome, total: a.total, media: arred(a.soma / a.total) })).sort((x, y) => y.media - x.media || y.total - x.total),
  }
}
