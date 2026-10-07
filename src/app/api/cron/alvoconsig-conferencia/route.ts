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
 * Escopo: leads de campanha E leads manuais/receptivos/IA (lead provisório,
 * 07/10/2026) que já têm `wesales_contact_id` — provisório ainda sem id fica de
 * fora até o worker da fila sincronizar. Só LEITURA do WeSales: nunca toca em
 * `wesales_sync_status`/`wesales_sync_erro` (quem decide é o worker), nem em
 * etapa, tabulações ou observações (o CRM vence nesses campos).
 *
 * WeSales fora do ar: 401 (conta inteira) ou 3 falhas seguidas interrompem o lote
 * e respondem 502 com um código curto. Falha isolada de um contato (5xx/403/
 * timeout) só carimba `sincronizado_em` dele e segue, para não travar a fila.
 *
 * Agendado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { codigoErroWesales, customFieldValue, getContact, findOpportunitiesByContactDetalhadas, mensagemErroWesales, opportunityFieldValue, resolveCustomField, WesalesHttpError } from '@/lib/wesales/client'
import { deveInterromperLote } from '@/lib/alvoconsig/conferencia-lote'
import { codigoConvenioChave, indexarConveniosPorCodigo, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MARGEM_FIELD_KEYS, OFERTA_FIELD_KEYS, resolverPipelineOfertas } from '@/lib/alvoconsig/ofertas-wesales'
import { calcularOfertas, resolverOfertasRefin, type RawOfertaRefin } from '@/lib/alvoconsig/ofertas'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LOTE = 150

function isAuthorized(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || '')
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
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
    .or('campanha_id.not.is.null,origem.in.(manual,receptivo,ia)')
    .not('wesales_contact_id', 'is', null)
    .eq('wesales_sync_status', 'sincronizado')
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
    console.error('Pipeline de Ofertas não encontrado — conferência de REFIN pulada:', mensagemErroWesales(err))
  }

  // "Convênio (Código Workspace)" é NUMERICAL no WeSales ("00001" volta "1").
  const { data: conveniosData } = await admin.from('convenios').select('id, codigo_sistema').is('deleted_at', null)
  const convenioPorCodigo = indexarConveniosPorCodigo(conveniosData)

  let conferidos = 0
  let corrigidos = 0
  const agora = new Date().toISOString()
  let falhasSeguidas = 0
  const carimbar = (id: string) => admin.from('crm_contatos').update({ sincronizado_em: agora }).eq('id', id)

  for (const local of contatos) {
    conferidos += 1
    let remoto: Awaited<ReturnType<typeof getContact>>
    try {
      remoto = await getContact(String(local.wesales_contact_id))
    } catch (err) {
      if (!(err instanceof WesalesHttpError)) throw err
      // Sem dados pessoais no log: só o código e o id interno.
      const codigo = codigoErroWesales(err)
      falhasSeguidas += 1
      console.error(`Conferência AlvoConsig: ${codigo} (contato ${local.id}).`)
      if (deveInterromperLote(err.status, falhasSeguidas)) {
        return Response.json({ ok: false, error: codigo, conferidos: conferidos - 1, corrigidos }, { status: 502 })
      }
      // Contato isolado com erro: vai pro fim da fila e o lote segue.
      await carimbar(String(local.id))
      continue
    }
    falhasSeguidas = 0
    if (!remoto) { // contato apagado no WeSales — não mexe (decisão manual), mas sai da frente da fila
      await carimbar(String(local.id))
      continue
    }

    // CPF vazio no WeSales não apaga o CPF local.
    const cpfRemoto = cpfField ? digits(customFieldValue(remoto, cpfField.id)) || local.cpf : local.cpf
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
          seguroSimNao: fCampo('seguroSimNao') ? opportunityFieldValue(op, fCampo('seguroSimNao')!) : null,
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

    const { error: updError } = await admin
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
      .eq('wesales_sync_status', 'sincronizado')
    if (updError) {
      // Só código/constraint (23505 etc.): a mensagem traz valores (CPF).
      console.error(`Conferência AlvoConsig: falha ao corrigir contato ${local.id}: ${updError.code} ${(updError as any).constraint ?? ''}`.trim())
      await carimbar(String(local.id))
      continue
    }
    corrigidos += 1
  }

  return Response.json({ ok: true, conferidos, corrigidos })
}
