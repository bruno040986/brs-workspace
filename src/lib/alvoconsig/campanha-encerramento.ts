/**
 * Reversão de tags no WeSales ao fim de uma campanha (manual ou pelo cron de
 * expurgo). NÃO é 'use server' — helper interno puro, sem checagem de
 * permissão própria; quem chama (action já autorizada, ou cron com
 * CRON_SECRET) é responsável por isso. Ver docs/SPEC-CRM-WESALES-CAMPANHAS.md.
 */

import { TAG_DISPONIVEL } from './campos-sync'

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
