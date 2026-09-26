'use server'

/**
 * Atributos personalizados (D3, lote 2). Administração (definições, sincronizações) exige
 * `central-conversas`; ler/gravar Convênio e Motivo no painel do atendimento exige `conversas`.
 * Retorna `{ok:false,error}` em vez de lançar (o Next apaga a mensagem de Error em produção).
 */

import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { clienteChatwootBrs, getContatoMetaReadOnly } from './actions'
import { corpoDefinicao, DEFINICOES, mesclarAtributos, modeloParaApi, MOTIVOS_PADRAO, normalizarLista, type DefinicaoAtributo, type ModeloAtributo } from './atributos'
import { espelharVinculoContato, gravarAtributosContato, lerAtributosContato } from './atributos-espelho'

type Falha = { ok: false; error: string }
const msg = (e: unknown): Falha => ({ ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Chatwoot.' })

type DefinicaoChatwoot = { id: number; attribute_key: string; attribute_values?: string[] | null }

async function cliente() {
  const cli = await clienteChatwootBrs()
  if (!cli) throw new Error('Chatwoot não provisionado.')
  return cli
}

/** Definições existentes no Chatwoot, por chave (a API só lista um modelo por vez). */
async function definicoesExistentes(cli: Awaited<ReturnType<typeof cliente>>): Promise<Map<string, DefinicaoChatwoot>> {
  const mapa = new Map<string, DefinicaoChatwoot>()
  for (const modelo of ['conversa', 'contato'] as ModeloAtributo[]) {
    const r = await cli.req<DefinicaoChatwoot[] | { payload: DefinicaoChatwoot[] }>(`/custom_attribute_definitions?attribute_model=${modeloParaApi(modelo)}`)
    for (const d of Array.isArray(r) ? r : r.payload || []) mapa.set(d.attribute_key, d)
  }
  return mapa
}

async function nomesConvenios(): Promise<string[]> {
  const admin = await createAdminClient()
  const { data } = await admin.from('convenios').select('nome').eq('is_active', true).is('deleted_at', null).order('nome')
  return normalizarLista((data || []).map((c: { nome: string }) => c.nome))
}

export type ItemAtributo = { def: DefinicaoAtributo; existe: boolean; valores: string[] }

export async function listarAtributos(): Promise<{ ok: true; itens: ItemAtributo[]; motivos: string[]; totalConvenios: number } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const cli = await cliente()
    const existentes = await definicoesExistentes(cli)
    const itens = DEFINICOES.map((def) => {
      const e = existentes.get(def.chave)
      return { def, existe: Boolean(e), valores: e?.attribute_values || [] }
    })
    const motivos = itens.find((i) => i.def.chave === 'motivo_contato')?.valores || []
    return { ok: true, itens, motivos: motivos.length ? motivos : MOTIVOS_PADRAO, totalConvenios: (await nomesConvenios()).length }
  } catch (e) {
    return msg(e)
  }
}

/**
 * Cria as definições que faltam e atualiza as listas: Convênio (do cadastro) e Motivo de Contato (o que a
 * tela enviar). Idempotente. Lista de convênios vazia = não mexe na definição (a API exige ao menos 1 valor).
 */
export async function sincronizarAtributos(motivos: string[]): Promise<{ ok: true; criadas: string[]; atualizadas: string[] } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const cli = await cliente()
    const existentes = await definicoesExistentes(cli)
    const convenios = await nomesConvenios()
    const criadas: string[] = []
    const atualizadas: string[] = []
    for (const def of DEFINICOES) {
      const valores = def.chave === 'convenio' ? convenios : def.chave === 'motivo_contato' ? motivos : []
      const c = corpoDefinicao(def, valores)
      if (!c.ok) {
        if (def.chave === 'convenio') continue
        return c
      }
      const atual = existentes.get(def.chave)
      if (!atual) {
        await cli.req('/custom_attribute_definitions', { method: 'POST', body: c.corpo })
        criadas.push(def.nome)
      } else if (def.tipo === 6) {
        await cli.req(`/custom_attribute_definitions/${atual.id}`, { method: 'PATCH', body: c.corpo })
        atualizadas.push(def.nome)
      }
    }
    return { ok: true, criadas, atualizadas }
  } catch (e) {
    return msg(e)
  }
}

/** Botão "Espelhar vínculos existentes": leva os vínculos de contato que já existem no Workspace para o Chatwoot (uma vez; até 300). */
export async function espelharVinculosExistentes(): Promise<{ ok: true; espelhados: number; falhas: number } | Falha> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const admin = await createAdminClient()
    const { data, error } = await admin.from('chat_contato_meta').select('chatwoot_contact_id').not('entidade_tipo', 'is', null).limit(300)
    if (error) throw error
    let espelhados = 0
    let falhas = 0
    for (const row of data || []) {
      const contactId = Number(row.chatwoot_contact_id)
      const meta = await getContatoMetaReadOnly(contactId).catch(() => null)
      if (!meta?.entidade) continue
      if (await espelharVinculoContato(contactId, meta.entidade.tipo, meta.entidade.nome)) espelhados++
      else falhas++
    }
    return { ok: true, espelhados, falhas }
  } catch (e) {
    return msg(e)
  }
}

export type AtributosPainel = { convenio: string; motivo: string; opcoesConvenio: string[]; opcoesMotivo: string[]; definido: boolean }

/** Valores atuais e opções para o painel do atendimento. `definido:false` = definições ainda não criadas (tela Atributos). */
export async function getAtributosPainel(conversationId: number, contactId: number | null): Promise<{ ok: true; dados: AtributosPainel } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    const cli = await cliente()
    const existentes = await definicoesExistentes(cli)
    const convDef = existentes.get('convenio')
    const motDef = existentes.get('motivo_contato')
    const [contato, conversa] = await Promise.all([
      contactId ? lerAtributosContato(cli, contactId) : Promise.resolve({} as Record<string, unknown>),
      cli.req<{ custom_attributes?: Record<string, unknown> }>(`/conversations/${conversationId}`),
    ])
    return {
      ok: true,
      dados: {
        convenio: String(contato.convenio ?? ''),
        motivo: String(conversa.custom_attributes?.motivo_contato ?? ''),
        opcoesConvenio: convDef?.attribute_values || [],
        opcoesMotivo: motDef?.attribute_values || [],
        definido: Boolean(convDef && motDef),
      },
    }
  } catch (e) {
    return msg(e)
  }
}

export async function definirConvenioContato(contactId: number, convenio: string): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    await gravarAtributosContato(await cliente(), contactId, { convenio })
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}

export async function definirMotivoConversa(conversationId: number, motivo: string): Promise<{ ok: true } | Falha> {
  try {
    await requirePermission('conversas', 'can_view')
    const cli = await cliente()
    const atual = await cli.req<{ custom_attributes?: Record<string, unknown> }>(`/conversations/${conversationId}`)
    await cli.req(`/conversations/${conversationId}/custom_attributes`, { method: 'POST', body: { custom_attributes: mesclarAtributos(atual.custom_attributes, { motivo_contato: motivo }) } })
    return { ok: true }
  } catch (e) {
    return msg(e)
  }
}
