/**
 * M06: contratos do dispatcher. Nada aqui fala com rede ou banco: adapters e DB são injetados
 * (produção em producao.ts; testes usam fakes). Desenho: PLANO-MESTRE §8, PT02 §5.4-5.7.
 */
export type Canal = 'telegram' | 'whatsapp' | 'email'
export type Prioridade = 'baixa' | 'media' | 'alta' | 'critica'

/** Resultado de UMA chamada a um provedor. 'rejeitada' = falha COMPROVADA (nada foi aceito). */
export type ResultadoEnvio =
  | { tipo: 'aceita'; messageId?: string }
  | { tipo: 'limitada'; retryAfterSeg: number }
  | { tipo: 'rejeitada'; categoria: string; http?: number; transitoria?: boolean }
  | { tipo: 'incerta'; categoria: string }

export interface TelegramAdapter { enviar(input: { texto: string }): Promise<ResultadoEnvio> }
export interface WhatsAppAdapter { enviar(input: { instanciaId: string; texto: string; operationId: string }): Promise<ResultadoEnvio> }
export interface EmailAdapter { enviar(input: { assunto: string; html: string; operationId: string }): Promise<ResultadoEnvio> }

export type InstanciaWhatsApp = { ordem: number; instanciaId: string }
/** Configuração já decifrada, só em memória durante a execução. Segredos NUNCA são logados. */
export type Canais = {
  telegram: { habilitado: boolean; adapter: TelegramAdapter | null }
  whatsapp: { habilitado: boolean; instancias: InstanciaWhatsApp[]; adapter: WhatsAppAdapter | null }
  email: { habilitado: boolean; adapter: EmailAdapter | null }
}

export type Intencao = { id: string; incidente_id: string; versao_alerta: number; tipo: 'alerta' | 'resumo' | 'analise'; prioridade: Prioridade; criado_em: string }
export type Incidente = {
  codigo: string; regra: string; gravidade: Prioridade; versao_alerta: number
  eventos_total: number; eventos_suprimidos: number; agregado: boolean; janela_inicio: string; janela_fim: string
}
export type Tentativa = {
  id: string; n: number; canal: Canal; config_ref: string; operation_id: string
  estado: 'preparada' | 'enviando' | 'aceita' | 'rejeitada_comprovada' | 'incerta' | 'limitada'
  categoria_erro: string | null; retry_after_ate: string | null; criado_em: string
}
export type EstadoFinal = 'pendente' | 'aceita' | 'incerta' | 'falhou' | 'suprimida_orcamento' | 'cancelada'

/** Fronteira com o banco (RPCs do M05/M06). Cada método pode lançar: o dispatcher decide o que fazer. */
export interface DispatcherDb {
  claim(owner: string, limite: number): Promise<Intencao[]>
  incidente(id: string): Promise<Incidente | null>
  tentativas(intencaoId: string): Promise<Tentativa[]>
  /** Grava a tentativa como 'enviando' ANTES do efeito. Lança se o lease foi perdido. */
  preparar(intencaoId: string, owner: string, canal: Canal, configRef: string, operationId: string): Promise<Tentativa>
  atualizarTentativa(id: string, patch: { estado: Tentativa['estado']; categoria_erro?: string | null; http_status?: number | null; retry_after_ate?: string | null; provider_message_id?: string | null }): Promise<void>
  finish(id: string, owner: string, estado: EstadoFinal, retryApos?: Date): Promise<boolean>
  consumirOrcamento(canal: Canal, incidenteId: string, configRef: string, prioridade: Prioridade): Promise<{ permitido: boolean; motivo: string | null }>
  config(): Promise<Record<string, number>>
  resumoCriar(): Promise<{ criado: boolean }>
  resumoDados(incidenteId: string): Promise<{ suprimidas_orcamento: number; incertas: number; falhas: number; por_contingencia: number } | null>
  falha(categoria: string, detalhe?: string): Promise<void>
}

export type Relogio = () => Date
export const CONFIG_PADRAO = {
  'contingencia.telegram_429_critico_s': 120,
  'contingencia.telegram_429_alto_s': 600,
  'contingencia.telegram_incerto_critico_s': 90,
  'contingencia.telegram_5xx_retry_s': 5,
} as const
