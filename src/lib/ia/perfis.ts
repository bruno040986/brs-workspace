/**
 * Perfil do Agente de IA (spec SPEC-AGENTES-IA-CRM §7): tipos, merge puro
 * padrão + overrides, validação e prévia do prompt. Sem I/O — o CRM mantém
 * uma cópia do contrato (o JSON do perfil é o contrato entre os repos).
 */

export type CampoColeta = {
  ordem: number
  campo: string
  obrigatorio: boolean
  pergunta?: string
  descricao?: string
  opcoes?: string[]
  so_se_quer_simulacao?: boolean
  nunca_no_turno_1?: boolean
  validar_dv?: boolean
  justificativa_lgpd?: string
}

export type PerfilQualificacao = {
  identidade: { nome_assistente: string }
  tom: string
  objetivo: string
  limites: {
    max_turnos: number
    max_msgs_agente: { ycloud: number; baileys: number; zapi: number }
    gasto_dia_max_usd: number
    proibicoes: string[]
  }
  coleta: CampoColeta[]
  pos_qualificacao: {
    pedir_documento: boolean
    mensagem_transferencia: string
    mensagem_espera: string
    mensagem_fora_expediente: string
    mensagem_fallback_erro: string
    mensagem_optout: string
  }
  roteamento: {
    modo: 'rodizio' | 'master' | 'atendente_fixo' | 'espera'
    master_id: string | null
    atendente_fixo_id: string | null
    ordem: string[]
    max_abertas: number
    espera_master_min: number
    destinos: Record<string, 'equipe_humana' | 'encerrar'>
  }
  modelos: {
    provedor: string
    principal: string
    fallbacks: string[]
    fallback_gratuito: { provedor: string; modelo: string } | null
  }
  tempos: {
    agrupar_s: { ycloud: number; baileys: number; zapi: number }
    digitacao_ms_por_char: number
    digitacao_min_ms: number
    digitacao_max_ms: number
    digitacao_oficial_ms: number
  }
  // janela null = 24h. ponytail: formato {inicio,fim} "HH:MM"; dias da semana só se o CRM pedir.
  horario: { janela: { inicio: string; fim: string } | null; fuso: string }
}

export const INTENCOES = ['quer_credito', 'quer_simulacao', 'duvida_produto', 'ja_cliente', 'quer_humano', 'fora_de_escopo', 'parar', 'spam'] as const
export const LIMITE_TOKENS_BC = 6000

/** Estimativa grosseira (4 caracteres por token), a mesma da spec §6.3. */
export const estimarTokens = (texto: string) => Math.ceil(texto.length / 4)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

/** Grava `valor` em `obj` seguindo o caminho "a.b.c" (cria níveis que faltarem). */
function definir(obj: Json, caminho: string, valor: unknown) {
  const partes = caminho.split('.')
  let alvo = obj
  for (const p of partes.slice(0, -1)) {
    if (typeof alvo[p] !== 'object' || alvo[p] === null || Array.isArray(alvo[p])) alvo[p] = {}
    alvo = alvo[p]
  }
  alvo[partes[partes.length - 1]] = valor
}

/** Padrão + overrides por caminho (campo a campo; arrays e objetos-folha substituem inteiros). */
export function mesclarPerfil<T extends Json = PerfilQualificacao>(padrao: T, overrides: Record<string, unknown> | null | undefined): T {
  const resultado = structuredClone(padrao) as Json
  for (const [caminho, valor] of Object.entries(overrides || {})) definir(resultado, caminho, structuredClone(valor))
  return resultado as T
}

/** "Restaurar padrão": remove o override (um caminho, ou todos se não vier caminho). */
export function restaurarOverride(overrides: Record<string, unknown>, caminho?: string): Record<string, unknown> {
  if (!caminho) return {}
  const resto = { ...overrides }
  delete resto[caminho]
  return resto
}

/** Erros que impedem publicar o perfil (lista vazia = ok). */
export function validarPerfil(p: PerfilQualificacao): string[] {
  const erros: string[] = []
  const inteiro = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
  if (!p.identidade?.nome_assistente?.trim()) erros.push('Nome da assistente é obrigatório.')
  if (!p.tom?.trim()) erros.push('Tom é obrigatório.')
  if (!p.objetivo?.trim()) erros.push('Objetivo é obrigatório.')
  if (!inteiro(p.limites?.max_turnos, 1, 50)) erros.push('Máximo de turnos deve ser inteiro entre 1 e 50.')
  if (!inteiro(p.roteamento?.max_abertas, 1, 100)) erros.push('Máximo de conversas abertas deve ser inteiro entre 1 e 100.')
  if (!(Number(p.limites?.gasto_dia_max_usd) >= 0)) erros.push('Teto de gasto por dia deve ser zero ou mais.')
  if (!p.modelos?.principal?.trim()) erros.push('Modelo principal é obrigatório.')
  const campos = (p.coleta || []).map((c) => c.campo?.trim())
  if (campos.some((c) => !c)) erros.push('Todo campo a coletar precisa de nome.')
  if (new Set(campos).size !== campos.length) erros.push('Há campos a coletar repetidos.')
  const j = p.horario?.janela
  if (j && !(/^\d{2}:\d{2}$/.test(j.inicio) && /^\d{2}:\d{2}$/.test(j.fim))) erros.push('Horário deve estar no formato HH:MM.')
  return erros
}

export type SecaoBC = { titulo: string; conteudo_md: string }

/** Prévia do system prompt (§7.3) com valores de exemplo; o engine monta o real. */
export function montarPrompt(p: PerfilQualificacao, bc: SecaoBC[], dados = { nome_comercial: '{nome_comercial}', cidade_uf: '{cidade_uf}' }): string {
  const ordenados = [...p.coleta].sort((a, b) => a.ordem - b.ordem)
  const produtos = ordenados.find((c) => c.campo === 'produto')?.opcoes?.join(', ') || '(nenhum)'
  const coleta = ordenados.map((c) => `${c.ordem}. ${c.campo}${c.obrigatorio ? ' (obrigatório)' : ''}${c.so_se_quer_simulacao ? ' (só se quer simulação)' : ''}`).join('; ')
  return [
    `Você é ${p.identidade.nome_assistente}, assistente virtual da ${dados.nome_comercial} (${dados.cidade_uf}). Você conversa por WhatsApp com pessoas que entraram em contato por conta própria. Objetivo: ${p.objetivo}.`,
    `Você não é consultora de crédito: nunca informa taxa, juros, valor de parcela, valor liberado, nem diz que algo está aprovado ou garantido — quem confirma isso é o atendente. Fale de forma ${p.tom}. Na primeira mensagem, apresente-se como assistente virtual.`,
    `Proibições:\n${p.limites.proibicoes.map((x) => `- ${x}`).join('\n')}`,
    `Produtos que a ${dados.nome_comercial} trabalha: ${produtos}.`,
    `Base de conhecimento (use só para explicar em linguagem simples; não invente nada fora dela):\n${bc.map((s) => `## ${s.titulo}\n${s.conteudo_md}`).join('\n\n')}`,
    `Dados a coletar, nesta ordem de prioridade (não repita o que já tem): ${coleta}.`,
    'Responda SEMPRE e SOMENTE com um JSON: {"resposta": "...", "campos_coletados": {}, "intencao": "' + [...INTENCOES, 'indefinida'].join('|') + '", "concluido": true|false}',
  ].join('\n\n')
}
