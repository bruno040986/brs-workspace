/**
 * Cron de conferência: compara a cópia de trabalho (crm_contatos) com o
 * WeSales para os campos cujo dono é o WeSales (CAMPOS_DO_WESALES) e
 * autocorrige divergências — a fila cobre a escrita (Workspace → WeSales);
 * este cron cobre a leitura de volta (WeSales → Workspace) para o caso de
 * algo ter mudado por lá fora do fluxo normal (edição manual, automação).
 *
 * REFIN vem de Oportunidades (uma por oferta, ver ofertas-wesales.ts), não
 * mais de campos numerados no contato.
 *
 * Roda em lotes pequenos (os mais antigos sem conferir primeiro) para nunca
 * estourar o maxDuration mesmo com muitas campanhas ativas simultâneas.
 * Reaplica `calcularOfertas` quando margem ou convênio mudou.
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET.
 */

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { customFieldValue, getContact, findOpportunitiesByContactDetalhadas, opportunityFieldValue, resolveCustomField } from '@/lib/wesales/client'
import { codigoConvenioChave, indexarConveniosPorCodigo, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MARGEM_FIELD_KEYS, OFERTA_FIELD_KEYS, resolverPipelineOfertas } from '@/lib/alvoconsig/ofertas-wesales'
import { calcularOfertas, resolverOfertasRefin, type RawOfertaRefin } from '@/lib/alvoconsig/ofertas'

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
function digitsOrRaw(value: string) {
  return value.replace(/\D/g, '') || value
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

  const [cpfField, matriculaField, convenioField, novoValorField, rmcValorField, rccValorField] = await Promise.all([
    resolveCustomField(WESALES_FIELD_KEYS.cpf),
    resolveCustomField(WESALES_FIELD_KEYS.matricula),
    resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
    resolveCustomField(MARGEM_FIELD_KEYS.novoValor),
    resolveCustomField(MARGEM_FIELD_KEYS.rmcValor),
    resolveCustomField(MARGEM_FIELD_KEYS.rccValor),
  ])

  const entradasOferta = Object.entries(OFERTA_FIELD_KEYS) as Array<[keyof typeof OFERTA_FIELD_KEYS, string]>
  const ofertaFieldsResolvidos = await Promise.all(entradasOferta.map(([, key]) => resolveCustomField(key, 'opportunity')))
  const ofertaFieldDefs: Record<string, { id: string } | null> = {}
  entradasOferta.forEach(([, key], i) => { ofertaFieldDefs[key] = ofertaFieldsResolvidos[i] })
  const fCampo = (campo: keyof typeof OFERTA_FIELD_KEYS): string | null => ofertaFieldDefs[OFERTA_FIELD_KEYS[campo]]?.id ?? null

  let pipelineOfertasId: string | null = null
  try {
    pipelineOfertasId = (await resolverPipelineOfertas()).pipeline.id
  } catch (err: any) {
    console.error('Pipeline de Ofertas não encontrado — conferência de REFIN pulada:', err?.message || err)
  }

  // "Convênio (Código Workspace)" é NUMERICAL no WeSales ("00001" volta "1").
  const { data: conveniosData } = await admin.from('convenios').select('id, codigo_sistema').is('deleted_at', null)
  const convenioPorCodigo = indexarConveniosPorCodigo(conveniosData)

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
    const convenioRemoto = (codigoConvenioChave(codigoConvenioRemoto) && convenioPorCodigo.get(codigoConvenioChave(codigoConvenioRemoto)!)) || local.convenio_id
    const margemNovoRemoto = novoValorField ? parseMoneyField(customFieldValue(remoto, novoValorField.id)) : local.margem_novo
    const margemRmcRemoto = rmcValorField ? parseMoneyField(customFieldValue(remoto, rmcValorField.id)) : local.margem_cartao_rmc
    const margemRccRemoto = rccValorField ? parseMoneyField(customFieldValue(remoto, rccValorField.id)) : local.margem_cartao_rcc

    // REFIN: lê as Oportunidades do tipo 'refin' deste contato no pipeline de Ofertas.
    let refinRemoto: Awaited<ReturnType<typeof resolverOfertasRefin>> = []
    if (pipelineOfertasId) {
      const oportunidades = await findOpportunitiesByContactDetalhadas(String(local.wesales_contact_id), pipelineOfertasId)
      const rawOfertas: RawOfertaRefin[] = oportunidades
        .filter((op) => fCampo('tipoOferta') && opportunityFieldValue(op, fCampo('tipoOferta')!) === 'refin')
        .map((op) => ({
          opportunityId: op.id,
          troco: op.monetaryValue ?? null,
          parcela: fCampo('parcela') ? parseMoneyField(opportunityFieldValue(op, fCampo('parcela')!)) : null,
          prazo: fCampo('prazo') ? Number.parseInt(opportunityFieldValue(op, fCampo('prazo')!) || '', 10) || null : null,
          taxa: fCampo('taxa') ? opportunityFieldValue(op, fCampo('taxa')!) : null,
          tabelaCodigo: fCampo('tabelaCodigo') ? opportunityFieldValue(op, fCampo('tabelaCodigo')!) : null,
          instituicaoId: fCampo('instituicaoId') ? opportunityFieldValue(op, fCampo('instituicaoId')!) : null,
          instituicaoNomeWesales: fCampo('instituicao') ? opportunityFieldValue(op, fCampo('instituicao')!) : null,
          contrato: fCampo('contrato') ? opportunityFieldValue(op, fCampo('contrato')!) : null,
        }))
      refinRemoto = await resolverOfertasRefin(admin, rawOfertas, convenioRemoto)
    }
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
