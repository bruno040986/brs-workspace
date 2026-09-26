/**
 * Espelho Workspace → Chatwoot dos atributos de vínculo do contato (D3). Módulo SEM 'use server'
 * (é chamado de dentro de actions.ts) e sem import estático de ./actions (evita ciclo).
 * Best-effort: o vínculo no Workspace já foi gravado; falha aqui nunca desfaz nem trava nada.
 */
import { atributosDoVinculo, mesclarAtributos, type TipoEntidade } from './atributos'

type ContatoChatwoot = { payload?: { custom_attributes?: Record<string, unknown> } }

export async function lerAtributosContato(cli: { req<T>(path: string): Promise<T> }, contactId: number): Promise<Record<string, unknown>> {
  const r = await cli.req<ContatoChatwoot>(`/contacts/${contactId}`)
  return r.payload?.custom_attributes || {}
}

/** Mescla e grava o hash completo (o Chatwoot substitui o hash inteiro no PUT). */
export async function gravarAtributosContato(cli: { req<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> }, contactId: number, novos: Record<string, unknown>): Promise<void> {
  const atual = await lerAtributosContato(cli, contactId)
  await cli.req(`/contacts/${contactId}`, { method: 'PUT', body: { custom_attributes: mesclarAtributos(atual, novos) } })
}

export async function espelharVinculoContato(contactId: number, tipo: TipoEntidade | null, nome: string): Promise<boolean> {
  try {
    const { clienteChatwootBrs } = await import('./actions')
    const cli = await clienteChatwootBrs()
    if (!cli) return false
    await gravarAtributosContato(cli, contactId, atributosDoVinculo(tipo, nome))
    return true
  } catch (err) {
    console.warn('[atributos] espelho do vínculo falhou (best-effort):', err instanceof Error ? err.message : err)
    return false
  }
}
