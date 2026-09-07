/**
 * Intenção de envio (Lote 02B, 07/09/2026) — módulo puro, sem 'use server',
 * usado no cliente (modal) e no servidor (action).
 *
 * `operationId` é a chave de idempotência do `POST /instancias/:id/enviar` do
 * engine. Regras do contrato:
 *  - gerada UMA vez por intenção de envio, na UI, e propagada até o engine;
 *  - retry da MESMA intenção (mesmos campos) conserva a chave; qualquer
 *    mudança de conteúdo ou um novo envio deliberado ganha outra chave;
 *  - nunca derivada de telefone/texto (o engine confere fingerprint do corpo
 *    e rejeita chave reaproveitada com conteúdo diferente).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function novoOperationId(): string {
  return globalThis.crypto.randomUUID()
}

export function ehOperationId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** Telefone BR com DDD → E.164 sem "+" (10/11 dígitos ganham 55). */
export function normalizarTelefoneDestino(telefone: string): string {
  const digitos = String(telefone || '').replace(/\D/g, '')
  if (digitos.length < 10) throw new Error('Informe o telefone com DDD (mínimo 10 dígitos).')
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

export type CamposEnvio = { instanciaId: string; telefone: string; texto: string }
export type IntencaoEnvio = CamposEnvio & { chave: string }

/**
 * Resolve a intenção corrente: se os campos são os mesmos da intenção
 * anterior (retry), a chave é conservada; se mudou qualquer campo ou não há
 * intenção (novo envio deliberado), nasce uma chave nova. A chave em si vem de
 * `gerar()` (uuid aleatório) — nunca dos campos.
 */
export function resolverIntencao(atual: IntencaoEnvio | null, campos: CamposEnvio, gerar: () => string = novoOperationId): IntencaoEnvio {
  if (atual && atual.instanciaId === campos.instanciaId && atual.telefone === campos.telefone && atual.texto === campos.texto) return atual
  return { ...campos, chave: gerar() }
}

// ---------------------------------------------------------------------------
// Resultado do envio como VALOR (a action devolve isto; Server Action mascara
// Error.message em produção, então exceção não serve pra distinguir os casos).
// ---------------------------------------------------------------------------

export type ResultadoEnvio =
  | { resultado: 'confirmado'; conversationId: number | null }
  /** Nada foi enviado: validação local, instância inexistente, rejeição comprovada pelo engine. Retry com a MESMA chave é seguro. */
  | { resultado: 'rejeitado'; mensagem: string }
  /** Pode ter saído ou não (timeout, queda de conexão, 5xx, resposta inválida, 409 DELIVERY_UNCERTAIN). Não reenviar sozinho. */
  | { resultado: 'incerto'; mensagem: string }

// ---------------------------------------------------------------------------
// Máquina de estados da modal "Nova conversa" — é ESTA que a UI usa
// (useReducer), pra poder ser testada sem DOM.
//
//   editando --enviar--> enviando --resultado--> concluido | incerto | editando(erro)
//   incerto  --repetir--> enviando (MESMA intenção: chave e campos congelados)
//   incerto  --novoEnvio--> editando (intenção zerada; a anterior fica
//            registrada em `incertoAnterior` pra UI avisar que pode ter saído)
//
// Em 'enviando' e 'incerto' os campos ficam congelados: editar é ignorado.
// ---------------------------------------------------------------------------

export type FaseEnvio = 'editando' | 'enviando' | 'incerto' | 'concluido'

export type EstadoEnvio = {
  fase: FaseEnvio
  campos: CamposEnvio
  /** Intenção corrente — a chave que vai (ou foi) pro engine. */
  intencao: IntencaoEnvio | null
  /** Erro (editando) ou aviso de incerteza (incerto). */
  mensagem: string | null
  /** Intenção incerta abandonada por "novo envio": a UI avisa que ela pode ter sido entregue. */
  incertoAnterior: IntencaoEnvio | null
  conversationId: number | null
}

export type AcaoEnvio =
  | { tipo: 'editar'; campos: Partial<CamposEnvio> }
  | { tipo: 'erro'; mensagem: string }
  /** `chave`: a UI gera o uuid UMA vez e passa na ação, pra poder calcular o
   * próximo estado (reducer puro) e despachar a MESMA ação sem divergir. */
  | { tipo: 'enviar'; chave?: string }
  | { tipo: 'repetir' }
  | { tipo: 'novoEnvio' }
  | { tipo: 'resultado'; resultado: ResultadoEnvio }

export function estadoInicialEnvio(campos: CamposEnvio): EstadoEnvio {
  return { fase: 'editando', campos, intencao: null, mensagem: null, incertoAnterior: null, conversationId: null }
}

/** Campos como vão pro engine (telefone só dígitos, texto sem espaços nas pontas). */
export function normalizarCampos(campos: CamposEnvio): CamposEnvio {
  return { instanciaId: campos.instanciaId, telefone: String(campos.telefone || '').replace(/\D/g, ''), texto: String(campos.texto || '').trim() }
}

export function reduzirEnvio(estado: EstadoEnvio, acao: AcaoEnvio, gerar: () => string = novoOperationId): EstadoEnvio {
  switch (acao.tipo) {
    case 'editar':
      // Congelado fora de 'editando' — nada muda enquanto envia ou enquanto a
      // intenção incerta ainda não foi resolvida (repetir ou novo envio).
      if (estado.fase !== 'editando') return estado
      return { ...estado, campos: { ...estado.campos, ...acao.campos }, mensagem: null }
    case 'erro':
      if (estado.fase !== 'editando') return estado
      return { ...estado, mensagem: acao.mensagem }
    case 'enviar': {
      if (estado.fase !== 'editando') return estado
      const campos = normalizarCampos(estado.campos)
      const chave = acao.chave
      const intencao = resolverIntencao(estado.intencao, campos, chave ? () => chave : gerar)
      return { ...estado, fase: 'enviando', intencao, mensagem: null }
    }
    case 'repetir':
      // Só de 'incerto', e SEMPRE com a intenção congelada (mesma chave, mesmo payload).
      if (estado.fase !== 'incerto' || !estado.intencao) return estado
      return { ...estado, fase: 'enviando', campos: { instanciaId: estado.intencao.instanciaId, telefone: estado.intencao.telefone, texto: estado.intencao.texto }, mensagem: null }
    case 'novoEnvio':
      if (estado.fase !== 'incerto') return estado
      return {
        ...estado,
        fase: 'editando',
        intencao: null,
        incertoAnterior: estado.intencao,
        mensagem: 'O envio anterior não foi confirmado e PODE ter sido entregue. Este será um novo envio, com outra operação — confira antes de mandar.',
      }
    case 'resultado': {
      if (estado.fase !== 'enviando') return estado
      const r = acao.resultado
      if (r.resultado === 'confirmado') return { ...estado, fase: 'concluido', mensagem: null, intencao: null, conversationId: r.conversationId }
      if (r.resultado === 'incerto') return { ...estado, fase: 'incerto', mensagem: r.mensagem }
      // rejeitado: nada saiu — volta a editar; a intenção fica (mesma chave se repetir igual).
      return { ...estado, fase: 'editando', mensagem: r.mensagem }
    }
    default:
      return estado
  }
}
