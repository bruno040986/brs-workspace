/**
 * M05: contrato do hook de eventos de segurança.
 * O M04 (login) e as actions de usuários chamam `registrarEventoSeguranca` (registrar.ts).
 */
export type TipoEvento =
  | 'login.falha'        // senha/TOTP/código de e-mail errado (identidade_informada = o que foi digitado; NÃO é validada)
  | 'login.pausa'        // pausa por tentativas (M04)
  | 'login.bloqueio'     // bloqueio administrativo aplicado/ignorado (M04)
  | 'login.concluido'    // as 5 etapas concluídas (somente este é avaliado contra expediente)
  | 'permissao.alterada' // permissões diretas de usuário alteradas
  | 'perfil.alterado'    // perfil de acesso (ou profile_id do usuário) alterado
  | 'signup.tentativa'   // sem fonte hoje (LACUNA); regra pronta
  | 'fator.desconhecido' // fator MFA sem ticket de ativação (M04)

export type Gravidade = 'baixa' | 'media' | 'alta' | 'critica'

export type EventoSeguranca = {
  fonte: string                       // ex.: 'workspace_login', 'workspace_usuarios'
  tipo: TipoEvento | (string & {})
  idOrigem?: string | null            // estável => reprocessar o mesmo evento é idempotente
  ocorridoEm?: Date | string
  identidadeInformada?: string | null // digitada pelo cliente
  identidadeValidadaUserId?: string | null // só se o servidor/Auth validou
  requestId?: string | null
  ipObservado?: string | null         // cabeçalho, sem atribuição de autoria
  userAgentObservado?: string | null
  coberturaFonte?: string | null
  payload?: Record<string, unknown>
}

export type EventoNormalizado = {
  fonte: string
  tipo: string
  id_origem: string | null
  ocorrido_em: string
  identidade_informada: string | null
  identidade_validada_user_id: string | null
  request_id: string | null
  ip_observado: string | null
  user_agent_observado: string | null
  cobertura_fonte: string | null
  payload: Record<string, unknown>
}

export type Classificacao = {
  regra: string
  contexto: string
  gravidade: Gravidade
  limiar?: number
  janela_min?: number
}
