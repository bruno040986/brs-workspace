/**
 * Criação de campanha — busca no WeSales os contatos disponíveis da base
 * (tag base:<slug> + disponivel), copia o mínimo pra crm_contatos (cópia de
 * trabalho, com ofertas pré-calculadas) e enfileira a troca de tag
 * (disponivel → parceiro:<arw>) para o worker da fila processar no ritmo dele.
 *
 * Rota (não server action) para ter maxDuration próprio — a busca paginada no
 * WeSales para quantidades grandes pode levar dezenas de segundos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { customFieldValue, resolveCustomField, searchContactsAte, type WesalesContact } from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MAX_OFERTAS_REFIN, refinSlotFieldKey } from '@/lib/alvoconsig/refin-slots'
import { calcularOfertas, resolverOfertasRefin, type RawRefinSlot } from '@/lib/alvoconsig/ofertas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const QUANTIDADE_MAXIMA = 20_000

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function parseMoneyField(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseIntField(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'alvoconsig-gestao', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const body = await request.json()
    const agenteParceiroId = String(body.agenteParceiroId || '').trim()
    const baseTagSlug = String(body.baseTagSlug || '').trim()
    const convenioId = String(body.convenioId || '').trim() || null
    const descricao = String(body.descricao || '').trim()
    const vigenciaFim = String(body.vigenciaFim || '').trim()
    const quantidade = Number.parseInt(String(body.quantidade), 10)

    if (!agenteParceiroId) return NextResponse.json({ error: 'Selecione o parceiro.' }, { status: 400 })
    if (!baseTagSlug) return NextResponse.json({ error: 'Informe a base (tag) no WeSales.' }, { status: 400 })
    if (!vigenciaFim || Number.isNaN(Date.parse(vigenciaFim))) return NextResponse.json({ error: 'Informe a vigência final da campanha.' }, { status: 400 })
    if (!Number.isFinite(quantidade) || quantidade <= 0) return NextResponse.json({ error: 'Informe a quantidade de contatos.' }, { status: 400 })
    if (quantidade > QUANTIDADE_MAXIMA) return NextResponse.json({ error: `Máximo de ${QUANTIDADE_MAXIMA.toLocaleString('pt-BR')} contatos por campanha.` }, { status: 400 })

    const admin = await createAdminClient()

    const { data: parceiro } = await admin.from('agentes_parceiros').select('id, arw_code').eq('id', agenteParceiroId).maybeSingle()
    const arwCode = String(parceiro?.arw_code || '').trim().toLowerCase()
    if (!arwCode) return NextResponse.json({ error: 'Parceiro sem código ARW — não é possível gerar a tag de dono.' }, { status: 400 })

    // Busca no WeSales: disponíveis desta base (leitura — nunca escreve aqui).
    let contatos: WesalesContact[]
    try {
      contatos = await searchContactsAte(
        [
          { field: 'tags', operator: 'contains', value: [tagBase(baseTagSlug)] },
          { field: 'tags', operator: 'contains', value: [TAG_DISPONIVEL] },
        ],
        quantidade,
      )
    } catch (error: any) {
      console.error('Erro ao buscar contatos no WeSales:', error)
      return NextResponse.json({ error: `Falha ao consultar o WeSales: ${error?.message || error}` }, { status: 502 })
    }
    if (!contatos.length) {
      return NextResponse.json({ error: `Nenhum contato disponível com a tag "${tagBase(baseTagSlug)}" + "${TAG_DISPONIVEL}" no WeSales.` }, { status: 400 })
    }

    // Descarta quem já tem dono ativo localmente (defensivo — não deveria
    // acontecer, já que só quem tem a tag "disponivel" entra na busca).
    const contactIds = contatos.map((c) => c.id)
    const { data: jaAlocados } = await admin
      .from('crm_dono_leads')
      .select('wesales_contact_id')
      .in('wesales_contact_id', contactIds)
      .is('revogado_em', null)
    const jaAlocadosSet = new Set((jaAlocados || []).map((r: any) => String(r.wesales_contact_id)))
    const selecionados = contatos.filter((c) => !jaAlocadosSet.has(c.id))
    if (!selecionados.length) {
      return NextResponse.json({ error: 'Os contatos encontrados já estão alocados (dessincronia de tag no WeSales) — revise antes de tentar de novo.' }, { status: 409 })
    }

    // Resolve os IDs dos campos personalizados usados (1x, não por contato).
    const [cpfField, matriculaField, convenioField, margemNovoField, margemRmcField, margemRccField] = await Promise.all([
      resolveCustomField(WESALES_FIELD_KEYS.cpf),
      resolveCustomField(WESALES_FIELD_KEYS.matricula),
      resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
      resolveCustomField(WESALES_FIELD_KEYS.margemNovo),
      resolveCustomField(WESALES_FIELD_KEYS.margemCartaoRmc),
      resolveCustomField(WESALES_FIELD_KEYS.margemCartaoRcc),
    ])
    // REFIN: até MAX_OFERTAS_REFIN slots, 6 campos cada (ver refin-slots.ts).
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

    // Cria a campanha (status 'montando' até terminar de copiar).
    const { data: campanha, error: campanhaError } = await admin
      .from('crm_campanhas')
      .insert({
        agente_parceiro_id: agenteParceiroId,
        descricao,
        base_tag: baseTagSlug,
        filtros: { convenioId },
        qtd_solicitada: quantidade,
        vigencia_fim: vigenciaFim,
        criado_por: user.id,
      })
      .select('id')
      .single()
    if (campanhaError || !campanha) {
      return NextResponse.json({ error: 'Falha ao criar a campanha.' }, { status: 500 })
    }

    const agora = new Date().toISOString()
    const linhas: Array<Record<string, unknown>> = []
    for (const contato of selecionados) {
      const cpf = cpfField ? digits(customFieldValue(contato, cpfField.id)) || null : null
      const matricula = matriculaField ? customFieldValue(contato, matriculaField.id) : null
      const codigoConvenio = convenioField ? customFieldValue(contato, convenioField.id) : null
      const convenioResolvido = convenioId || (codigoConvenio && convenioPorCodigo.get(digits(codigoConvenio) || codigoConvenio)) || null

      const margens = {
        novo: margemNovoField ? parseMoneyField(customFieldValue(contato, margemNovoField.id)) : null,
        cartao_rmc: margemRmcField ? parseMoneyField(customFieldValue(contato, margemRmcField.id)) : null,
        cartao_rcc: margemRccField ? parseMoneyField(customFieldValue(contato, margemRccField.id)) : null,
      }
      // Lê os até MAX_OFERTAS_REFIN slots preenchidos (ver refin-slots.ts).
      const rawSlots: RawRefinSlot[] = []
      for (let slot = 1; slot <= MAX_OFERTAS_REFIN; slot++) {
        const trocoField = refinSlotFields[refinSlotFieldKey(slot, 'troco')]
        if (!trocoField) continue
        const troco = parseMoneyField(customFieldValue(contato, trocoField.id))
        if (troco === null) continue
        const parcelaField = refinSlotFields[refinSlotFieldKey(slot, 'parcela')]
        const prazoField = refinSlotFields[refinSlotFieldKey(slot, 'prazo')]
        const taxaField = refinSlotFields[refinSlotFieldKey(slot, 'taxa')]
        const tabelaField = refinSlotFields[refinSlotFieldKey(slot, 'tabela')]
        const instField = refinSlotFields[refinSlotFieldKey(slot, 'instituicao')]
        rawSlots.push({
          slot,
          troco,
          parcela: parcelaField ? parseMoneyField(customFieldValue(contato, parcelaField.id)) : null,
          prazo: prazoField ? parseIntField(customFieldValue(contato, prazoField.id)) : null,
          taxa: taxaField ? customFieldValue(contato, taxaField.id) : null,
          tabelaCodigo: tabelaField ? customFieldValue(contato, tabelaField.id) : null,
          instituicaoId: instField ? customFieldValue(contato, instField.id) : null,
        })
      }
      const refin = await resolverOfertasRefin(admin, rawSlots, convenioResolvido)
      // Resumo escalar (listas/filtros rápidos) = maior troco entre as ofertas; o
      // detalhe completo mora em ofertas.refin (jsonb).
      const refinTrocoResumo = refin.length ? Math.max(...refin.map((o) => o.troco || 0)) : null

      const ofertas = await calcularOfertas(admin, convenioResolvido, margens, refin)

      linhas.push({
        wesales_contact_id: contato.id,
        cpf,
        nome: String(contato.name || [contato.firstName, contato.lastName].filter(Boolean).join(' ') || '').trim(),
        telefone: digits(contato.phone) || null,
        convenio_id: convenioResolvido,
        matricula: matricula || null,
        margem_novo: margens.novo,
        margem_cartao_rmc: margens.cartao_rmc,
        margem_cartao_rcc: margens.cartao_rcc,
        refin_troco: refinTrocoResumo,
        margens_atualizadas_em: agora,
        agente_parceiro_id: agenteParceiroId,
        campanha_id: campanha.id,
        expira_em: `${vigenciaFim}T23:59:59-03:00`,
        ofertas,
        estado_local: 'ativo',
        sincronizado_em: agora,
        updated_at: agora,
      })
    }

    // Upsert em chunks (onConflict wesales_contact_id — único no schema).
    let copiados = 0
    for (let i = 0; i < linhas.length; i += 300) {
      const chunk = linhas.slice(i, i + 300)
      const { data: inseridos, error: insertError } = await admin
        .from('crm_contatos')
        .upsert(chunk, { onConflict: 'wesales_contact_id' })
        .select('id, wesales_contact_id')
      if (insertError) {
        console.error('Falha ao gravar cópia de trabalho da campanha:', insertError)
        continue
      }
      copiados += inseridos?.length || 0

      const donoRows = (inseridos || []).map((row: any) => ({
        wesales_contact_id: row.wesales_contact_id,
        agente_parceiro_id: agenteParceiroId,
        campanha_id: campanha.id,
        alocado_por: user.id,
      }))
      if (donoRows.length) {
        const { error: donoError } = await admin.from('crm_dono_leads').insert(donoRows)
        if (donoError) console.error('Falha ao gravar dono do lead:', donoError)
      }

      const filaOps = (inseridos || []).flatMap((row: any) => [
        { operacao: 'remover_tag', contato_id: row.id, payload: { tag: TAG_DISPONIVEL } },
        { operacao: 'aplicar_tag', contato_id: row.id, payload: { tag: `parceiro:${arwCode}` } },
      ])
      if (filaOps.length) {
        const { error: filaError } = await admin.from('crm_wesales_queue').insert(filaOps)
        if (filaError) console.error('Falha ao enfileirar tags da campanha:', filaError)
      }
    }

    await admin
      .from('crm_campanhas')
      .update({ qtd_alocada: copiados, status: copiados > 0 ? 'ativa' : 'cancelada' })
      .eq('id', campanha.id)

    return NextResponse.json({ campanhaId: campanha.id, solicitados: quantidade, encontrados: selecionados.length, alocados: copiados })
  } catch (error: any) {
    console.error('Erro ao criar campanha AlvoConsig:', error)
    return NextResponse.json({ error: 'Erro inesperado ao criar a campanha.' }, { status: 500 })
  }
}
