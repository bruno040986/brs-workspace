/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  addContactTags,
  createContact,
  createOpportunity,
  customFieldEntry,
  findContactByCpf,
  findOpportunitiesByContact,
  getContact,
  resolveCustomField,
  resolvePipelineStage,
  updateContact,
  type CustomFieldDef,
} from '@/lib/wesales/client'
import { WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { createAdminClient } from '@/lib/supabase/server'
import { registrarEvento } from './http'
import { decidirNascimentoNoContato } from './validacao'
import { camposTrafego, sourceTrafego, tagsTrafego } from './trafego-wesales'

export type ResultadoSync = { status: 'ok' | 'erro'; erro?: string }

const CHAVE_CODIGO = 'promocao__codigo_de_inscricao'
const CHAVE_INDICACAO = 'promocao__n_de_indicacao'
const CHAVE_INDICADOR = 'promocao__nome_do_indicador'

class CampoAusente extends Error {}

async function campo(key: string): Promise<CustomFieldDef> {
  const def = await resolveCustomField(key)
  if (!def) throw new CampoAusente(`campo ${key} não existe no WeSales`)
  return def
}

function separarNome(nome: string): { firstName: string; lastName: string } {
  const [firstName, ...resto] = nome.trim().split(/\s+/)
  return { firstName, lastName: resto.join(' ') }
}

/** Idempotente: sempre busca antes de criar. Nunca cria campo no WeSales. */
export async function sincronizarInscricaoWesales(inscricaoId: string): Promise<ResultadoSync> {
  const admin: any = await createAdminClient()
  const marcar = (patch: Record<string, unknown>) =>
    admin.from('promocao_inscricoes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', inscricaoId)

  const { data: insc } = await admin.from('promocao_inscricoes').select('*').eq('id', inscricaoId).maybeSingle()
  if (!insc) return { status: 'erro', erro: 'inscrição não encontrada' }
  const { data: camp } = await admin.from('promocao_campanhas').select('*').eq('id', insc.campanha_id).maybeSingle()
  if (!camp) return { status: 'erro', erro: 'campanha não encontrada' }

  try {
    let numeroIndicacao = ''
    let nomeIndicador = ''
    if (insc.origem === 'indicacao' && insc.indicacao_id) {
      const { data: ind } = await admin
        .from('promocao_indicacoes')
        .select('numero, promocao_indicadores(nome)')
        .eq('id', insc.indicacao_id)
        .maybeSingle()
      numeroIndicacao = String(ind?.numero || '')
      nomeIndicador = String(ind?.promocao_indicadores?.nome || '')
    }

    const tags = [...new Set([...(camp.wesales_tags || ['promo-valparaiso']), insc.origem === 'direta' ? 'promo-direto' : 'promo-indicado'])]

    // Atribuição: lida NO MOMENTO do sync (as rotas gravam o tracking antes de enfileirar; o retry do job também a encontra).
    const { data: trk } = await admin
      .from('promocao_tracking')
      .select('*')
      .eq('inscricao_id', inscricaoId)
      .eq('evento', 'lead_conclusao')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const tagsAtrib = tagsTrafego(trk)
    const sourceAtrib = sourceTrafego(trk)
    const trafego = await camposTrafego(trk, (k) => resolveCustomField(k), (def, v) => customFieldEntry(def, v))
    if (trafego.ausentes.length) await registrarEvento(admin, insc.campanha_id, 'inscricao', inscricaoId, 'wesales.campos_trafego_ausentes', { chaves: trafego.ausentes })

    const entradas: Array<{ id: string; fieldValue: string | number }> = []
    const add = (def: CustomFieldDef, valor: unknown) => {
      const e = customFieldEntry(def, valor)
      if (e) entradas.push(e)
    }
    add(await campo(CHAVE_CODIGO), insc.codigo)
    if (numeroIndicacao) add(await campo(CHAVE_INDICACAO), numeroIndicacao)
    if (nomeIndicador) add(await campo(CHAVE_INDICADOR), nomeIndicador)
    const cpfDef = await campo(WESALES_FIELD_KEYS.cpf)
    const cpfEntrada = customFieldEntry(cpfDef, insc.cpf)
    // só valores não vazios entram (nunca apaga atribuição já preenchida no contato)
    const entradasCpf = [...entradas, ...trafego.entradas, ...(cpfEntrada ? [cpfEntrada] : [])]
    let tagsFinais = tags

    if (camp.convenio_id) {
      const { data: conv } = await admin.from('convenios').select('codigo_sistema, nome_reduzido').eq('id', camp.convenio_id).maybeSingle()
      const defCod = await resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo)
      const defNome = await resolveCustomField(WESALES_FIELD_KEYS.nomeConvenio)
      if (conv?.codigo_sistema && defCod) add(defCod, conv.codigo_sistema)
      if (conv?.nome_reduzido && defNome) add(defNome, conv.nome_reduzido)
    }

    const nascimento = insc.data_nascimento ? String(insc.data_nascimento).slice(0, 10) : undefined
    let contactId: string
    const existente = await findContactByCpf(insc.cpf)
    if (existente) {
      contactId = existente.id
      tagsFinais = [...tags, ...tagsAtrib]
      await updateContact(contactId, { customFields: entradasCpf, ...(trk ? { source: sourceAtrib } : {}), ...(nascimento ? { dateOfBirth: nascimento } : {}) })
    } else {
      const { firstName, lastName } = separarNome(String(insc.nome))
      const { contact, duplicateOfId } = await createContact({
        firstName,
        lastName,
        phone: `+${insc.telefone}`,
        ...(insc.email ? { email: insc.email } : {}),
        ...(nascimento ? { dateOfBirth: nascimento } : {}),
        tags: [...tags, ...tagsAtrib],
        source: sourceAtrib,
        customFields: entradasCpf,
      })
      if (contact) {
        contactId = contact.id
        tagsFinais = [...tags, ...tagsAtrib]
      } else if (duplicateOfId) {
        contactId = duplicateOfId
        // achado por telefone, não por CPF: pode ser outra pessoa; nunca troca nascimento existente
        const decisao = nascimento ? decidirNascimentoNoContato((await getContact(contactId))?.dateOfBirth, nascimento) : 'manter'
        await updateContact(contactId, { customFields: entradas, ...(decisao === 'gravar' ? { dateOfBirth: nascimento } : {}) })
        if (decisao === 'divergente') await registrarEvento(admin, insc.campanha_id, 'inscricao', inscricaoId, 'wesales.nascimento_divergente', { contactId, divergente: true })
        await registrarEvento(admin, insc.campanha_id, 'inscricao', inscricaoId, 'wesales.duplicado_por_telefone', { contactId })
      } else {
        throw new Error('WeSales não devolveu o contato')
      }
    }
    await addContactTags(contactId, tagsFinais)

    let opportunityId: string | null = insc.wesales_opportunity_id || null
    if (camp.wesales_funil_nome && camp.wesales_etapa_nome && !opportunityId) {
      const alvo = await resolvePipelineStage(camp.wesales_funil_nome, camp.wesales_etapa_nome)
      if (alvo) {
        const ops = await findOpportunitiesByContact(contactId, alvo.pipeline.id)
        const op = ops[0] || (await createOpportunity({ contactId, pipelineId: alvo.pipeline.id, pipelineStageId: alvo.stage.id, name: `Promoção Valparaíso — ${insc.codigo}` }))
        opportunityId = op.id
      } else {
        await registrarEvento(admin, insc.campanha_id, 'inscricao', inscricaoId, 'wesales.funil_nao_encontrado', {})
      }
    }

    await marcar({ wesales_contact_id: contactId, wesales_opportunity_id: opportunityId, wesales_status: 'ok', wesales_erro: null, wesales_sync_em: new Date().toISOString() })
    return { status: 'ok' }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : 'erro desconhecido').slice(0, 300)
    await marcar({ wesales_status: 'erro', wesales_erro: msg })
    return { status: 'erro', erro: msg }
  }
}
