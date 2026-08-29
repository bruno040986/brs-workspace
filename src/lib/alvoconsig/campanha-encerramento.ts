/**
 * Reversão de tags no WeSales ao fim de uma campanha (manual ou pelo cron de
 * expurgo). NÃO é 'use server' — helper interno puro, sem checagem de
 * permissão própria; quem chama (action já autorizada, ou cron com
 * CRON_SECRET) é responsável por isso. Ver docs/SPEC-CRM-WESALES-CAMPANHAS.md.
 */

import { TAG_DISPONIVEL, WESALES_FIELD_KEYS } from './campos-sync'
import { OFERTA_FIELD_KEYS, resolverPipelineOfertas } from './ofertas-wesales'
import { findOpportunitiesByContact, opportunityFieldValue, resolveCustomField, updateOpportunityStatus } from '@/lib/wesales/client'

type AdminClient = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

/**
 * Leads da campanha que NÃO viraram cliente voltam pro pool: perdem a tag do
 * parceiro, recuperam "disponivel" (enfileirado — o worker aplica no ritmo
 * dele). Certificados (crm_clientes_parceiro) ficam com a tag do parceiro,
 * como histórico da venda.
 */
export async function reverterTagsDaCampanha(admin: AdminClient, campanhaId: string, agenteParceiroId: string) {
  const { data: parceiro } = await admin.from('agentes_parceiros').select('arw_code').eq('id', agenteParceiroId).maybeSingle()
  const arwCode = String(parceiro?.arw_code || '').trim().toLowerCase()
  if (!arwCode) return { revertidos: 0 }

  const { data: donos } = await admin.from('crm_dono_leads').select('id, wesales_contact_id').eq('campanha_id', campanhaId).is('revogado_em', null)
  if (!donos?.length) return { revertidos: 0 }

  const { data: certificados } = await admin.from('crm_clientes_parceiro').select('wesales_contact_id').eq('campanha_id', campanhaId)
  const certificadosSet = new Set((certificados || []).map((c: any) => String(c.wesales_contact_id)))

  const paraReverter = donos.filter((d: any) => !certificadosSet.has(String(d.wesales_contact_id)))
  if (!paraReverter.length) return { revertidos: 0 }

  // A cópia de trabalho (crm_contatos) já foi apagada pelo RPC de
  // encerramento. A fila precisa de um contato_id local (FK) — recria uma
  // linha mínima, já marcada para expurgo, só para o worker processar a
  // reversão de tag.
  const contatosMinimos = paraReverter.map((d: any) => ({
    wesales_contact_id: String(d.wesales_contact_id),
    nome: '',
    agente_parceiro_id: agenteParceiroId,
    campanha_id: null,
    estado_local: 'expurgavel',
    deleted_at: new Date().toISOString(),
  }))
  const { data: reinseridos, error: reinsertError } = await admin
    .from('crm_contatos')
    .upsert(contatosMinimos, { onConflict: 'wesales_contact_id' })
    .select('id, wesales_contact_id')
  if (reinsertError || !reinseridos) {
    console.error('Falha ao preparar reversão de tags:', reinsertError)
    return { revertidos: 0 }
  }

  const filaOps = reinseridos.flatMap((c: any) => [
    { operacao: 'remover_tag', contato_id: c.id, payload: { tag: `parceiro:${arwCode}` } },
    // Limpa o espelho da tag de dono ("Código de Parceiro BRS").
    { operacao: 'atualizar_campo', contato_id: c.id, payload: { campo: WESALES_FIELD_KEYS.codigoParceiro, valor: '' } },
    { operacao: 'aplicar_tag', contato_id: c.id, payload: { tag: TAG_DISPONIVEL } },
  ])
  for (let i = 0; i < filaOps.length; i += 500) {
    const { error } = await admin.from('crm_wesales_queue').insert(filaOps.slice(i, i + 500))
    if (error) console.error('Falha ao enfileirar reversão de tags:', error)
  }

  await admin
    .from('crm_dono_leads')
    .update({ revogado_em: new Date().toISOString() })
    .in('id', paraReverter.map((d: any) => d.id))

  return { revertidos: paraReverter.length }
}

/**
 * Marca como PERDIDA (status, não etapa — fica visível ONDE cada uma parou)
 * toda oferta ainda aberta dos leads não certificados da campanha. Quem foi
 * certificado guarda a oferta escolhida como está (aberta/ganha) — decisão
 * de qual é "a escolhida" ainda não é coletada na certificação (pendência
 * conhecida, ver docs/SPEC-CRM-WESALES-CAMPANHAS.md); por ora as ofertas do
 * certificado simplesmente não são tocadas aqui.
 */
export async function marcarOfertasPerdidas(admin: AdminClient, campanhaId: string) {
  const { data: donos } = await admin.from('crm_dono_leads').select('wesales_contact_id').eq('campanha_id', campanhaId).is('revogado_em', null)
  if (!donos?.length) return { marcadas: 0 }

  const { data: certificados } = await admin.from('crm_clientes_parceiro').select('wesales_contact_id').eq('campanha_id', campanhaId)
  const certificadosSet = new Set((certificados || []).map((c: any) => String(c.wesales_contact_id)))
  const naoCertificados = donos.filter((d: any) => !certificadosSet.has(String(d.wesales_contact_id)))
  if (!naoCertificados.length) return { marcadas: 0 }

  let pipelineId: string
  let tipoOfertaFieldId: string | null
  try {
    const pipeline = await resolverPipelineOfertas()
    pipelineId = pipeline.pipeline.id
    const tipoOfertaField = await resolveCustomField(OFERTA_FIELD_KEYS.tipoOferta, 'opportunity')
    tipoOfertaFieldId = tipoOfertaField?.id ?? null
  } catch (error: any) {
    console.error('Pipeline de Ofertas não encontrado — marcação de perdidas pulada:', error?.message || error)
    return { marcadas: 0 }
  }

  let marcadas = 0
  for (const dono of naoCertificados) {
    const contactId = String((dono as any).wesales_contact_id)
    try {
      const oportunidades = await findOpportunitiesByContact(contactId, pipelineId)
      for (const op of oportunidades) {
        if (op.status !== 'open') continue
        if (tipoOfertaFieldId && !opportunityFieldValue(op, tipoOfertaFieldId)) continue
        await updateOpportunityStatus(op.id, 'lost')
        marcadas += 1
      }
    } catch (error: any) {
      console.error(`Falha ao marcar ofertas perdidas do contato ${contactId}:`, error?.message || error)
    }
  }
  return { marcadas }
}
