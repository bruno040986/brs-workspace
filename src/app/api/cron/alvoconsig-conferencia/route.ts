/**
 * Cron de conferência: compara a cópia de trabalho (crm_contatos) com o
 * WeSales para os campos cujo dono é o WeSales (CAMPOS_DO_WESALES) e
 * autocorrige divergências — a fila cobre a escrita (Workspace → WeSales);
 * este cron cobre a leitura de volta (WeSales → Workspace) para o caso de
 * algo ter mudado por lá fora do fluxo normal (edição manual, automação).
 *
 * Roda em lotes pequenos (os mais antigos sem conferir primeiro) para nunca
 * estourar o maxDuration mesmo com muitas campanhas ativas simultâneas.
 * Reaplica `calcularOfertas` quando margem ou convênio mudou.
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET.
 */

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { customFieldValue, getContact, resolveCustomField } from '@/lib/wesales/client'
import { WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MAX_OFERTAS_REFIN, refinSlotFieldKey } from '@/lib/alvoconsig/refin-slots'
import { calcularOfertas, resolverOfertasRefin, type RawRefinSlot } from '@/lib/alvoconsig/ofertas'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOTE = 150

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}
function parseMoneyField(value: string | null): number | null {
  if (!value) return null
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.WESALES_API_TOKEN || !process.env.WESALES_LOCATION_ID) {
    return Response.json({ ok: true, skipped: 'WeSales não configurado.' })
  }

  const admin = await createAdminClient()

  const { data: contatos, error } = await admin
    .from('crm_contatos')
    .select('id, wesales_contact_id, cpf, nome, telefone, convenio_id, matricula, margem_novo, margem_cartao_rmc, margem_cartao_rcc, refin_troco, ofertas')
    .is('deleted_at', null)
    .not('campanha_id', 'is', null)
    .not('wesales_contact_id', 'is', null)
    .order('sincronizado_em', { ascending: true, nullsFirst: true })
    .limit(LOTE)
  if (error) {
    console.error('Erro ao listar contatos para conferência:', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!contatos?.length) return Response.json({ ok: true, conferidos: 0, corrigidos: 0 })

  const [cpfField, matriculaField, convenioField, margemNovoField, margemRmcField, margemRccField] = await Promise.all([
    resolveCustomField(WESALES_FIELD_KEYS.cpf),
    resolveCustomField(WESALES_FIELD_KEYS.matricula),
    resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
    resolveCustomField(WESALES_FIELD_KEYS.margemNovo),
    resolveCustomField(WESALES_FIELD_KEYS.margemCartaoRmc),
    resolveCustomField(WESALES_FIELD_KEYS.margemCartaoRcc),
  ])
  const refinSlotFields: Record<string, { id: string } | null> = {}
  await Promise.all(
    Array.from({ length: MAX_OFERTAS_REFIN }, (_, i) => i + 1).flatMap((slot) =>
      (['troco', 'parcela', 'prazo', 'taxa', 'tabela', 'instituicao'] as const).map(async (campo) => {
        const key = refinSlotFieldKey(slot, campo)
        refinSlotFields[key] = await resolveCustomField(key)
      }),
    ),
  )
  const { data: conveniosData } = await admin.from('convenios').select('id, codigo').is('deleted_at', null)
  const convenioPorCodigo = new Map<string, string>()
  for (const conv of conveniosData || []) {
    if (conv.codigo) convenioPorCodigo.set(digits(conv.codigo) || String(conv.codigo), String(conv.id))
  }

  let conferidos = 0
  let corrigidos = 0
  const agora = new Date().toISOString()

  for (const local of contatos) {
    conferidos += 1
    const remoto = await getContact(String(local.wesales_contact_id))
    if (!remoto) continue // contato apagado no WeSales — não mexe (decisão manual)

    const cpfRemoto = cpfField ? digits(customFieldValue(remoto, cpfField.id)) || null : local.cpf
    const nomeRemoto = String(remoto.name || [remoto.firstName, remoto.lastName].filter(Boolean).join(' ') || local.nome || '').trim()
    const telefoneRemoto = digits(remoto.phone) || local.telefone
    const matriculaRemoto = matriculaField ? customFieldValue(remoto, matriculaField.id) : local.matricula
    const codigoConvenioRemoto = convenioField ? customFieldValue(remoto, convenioField.id) : null
    const convenioRemoto = (codigoConvenioRemoto && convenioPorCodigo.get(digits(codigoConvenioRemoto) || codigoConvenioRemoto)) || local.convenio_id
    const margemNovoRemoto = margemNovoField ? parseMoneyField(customFieldValue(remoto, margemNovoField.id)) : local.margem_novo
    const margemRmcRemoto = margemRmcField ? parseMoneyField(customFieldValue(remoto, margemRmcField.id)) : local.margem_cartao_rmc
    const margemRccRemoto = margemRccField ? parseMoneyField(customFieldValue(remoto, margemRccField.id)) : local.margem_cartao_rcc
    // Lê os até MAX_OFERTAS_REFIN slots preenchidos (ver refin-slots.ts).
    const rawSlots: RawRefinSlot[] = []
    for (let slot = 1; slot <= MAX_OFERTAS_REFIN; slot++) {
      const trocoField = refinSlotFields[refinSlotFieldKey(slot, 'troco')]
      if (!trocoField) continue
      const troco = parseMoneyField(customFieldValue(remoto, trocoField.id))
      if (troco === null) continue
      const parcelaField = refinSlotFields[refinSlotFieldKey(slot, 'parcela')]
      const prazoField = refinSlotFields[refinSlotFieldKey(slot, 'prazo')]
      const taxaField = refinSlotFields[refinSlotFieldKey(slot, 'taxa')]
      const tabelaField = refinSlotFields[refinSlotFieldKey(slot, 'tabela')]
      const instField = refinSlotFields[refinSlotFieldKey(slot, 'instituicao')]
      rawSlots.push({
        slot,
        troco,
        parcela: parcelaField ? parseMoneyField(customFieldValue(remoto, parcelaField.id)) : null,
        prazo: prazoField ? Number.parseInt(customFieldValue(remoto, prazoField.id) || '', 10) || null : null,
        taxa: taxaField ? customFieldValue(remoto, taxaField.id) : null,
        tabelaCodigo: tabelaField ? customFieldValue(remoto, tabelaField.id) : null,
        instituicaoId: instField ? customFieldValue(remoto, instField.id) : null,
      })
    }
    const refinRemoto = await resolverOfertasRefin(admin, rawSlots, convenioRemoto)
    const refinTrocoRemoto = refinRemoto.length ? Math.max(...refinRemoto.map((o) => o.troco || 0)) : null
    const refinLocalAssinatura = JSON.stringify((local.ofertas as any)?.refin || [])
    const refinRemotoAssinatura = JSON.stringify(refinRemoto)

    const divergiu =
      cpfRemoto !== local.cpf ||
      nomeRemoto !== local.nome ||
      telefoneRemoto !== local.telefone ||
      matriculaRemoto !== local.matricula ||
      convenioRemoto !== local.convenio_id ||
      margemNovoRemoto !== local.margem_novo ||
      margemRmcRemoto !== local.margem_cartao_rmc ||
      margemRccRemoto !== local.margem_cartao_rcc ||
      refinTrocoRemoto !== local.refin_troco ||
      refinLocalAssinatura !== refinRemotoAssinatura

    if (!divergiu) {
      await admin.from('crm_contatos').update({ sincronizado_em: agora }).eq('id', local.id)
      continue
    }

    const margens = { novo: margemNovoRemoto, cartao_rmc: margemRmcRemoto, cartao_rcc: margemRccRemoto }
    const ofertas = await calcularOfertas(admin, convenioRemoto, margens, refinRemoto)

    await admin
      .from('crm_contatos')
      .update({
        cpf: cpfRemoto,
        nome: nomeRemoto,
        telefone: telefoneRemoto,
        matricula: matriculaRemoto,
        convenio_id: convenioRemoto,
        margem_novo: margemNovoRemoto,
        margem_cartao_rmc: margemRmcRemoto,
        margem_cartao_rcc: margemRccRemoto,
        refin_troco: refinTrocoRemoto,
        ofertas,
        margens_atualizadas_em: agora,
        sincronizado_em: agora,
        updated_at: agora,
      })
      .eq('id', local.id)
    corrigidos += 1
  }

  return Response.json({ ok: true, conferidos, corrigidos })
}
