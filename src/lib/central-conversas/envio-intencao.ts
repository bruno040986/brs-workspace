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
 * Resolve a intenção corrente do modal: se os campos são os mesmos da
 * intenção anterior (retry), a chave é conservada; se mudou qualquer campo ou
 * não há intenção (novo envio deliberado), nasce uma chave nova. A chave em si
 * vem de `gerar()` (uuid aleatório) — nunca dos campos.
 */
export function resolverIntencao(atual: IntencaoEnvio | null, campos: CamposEnvio, gerar: () => string = novoOperationId): IntencaoEnvio {
  if (atual && atual.instanciaId === campos.instanciaId && atual.telefone === campos.telefone && atual.texto === campos.texto) return atual
  return { ...campos, chave: gerar() }
}
