/**
 * Criação de campanha — busca no WeSales os contatos disponíveis da base
 * (tag base:<slug> + disponivel, ou do convênio inteiro sem base), copia o
 * mínimo pra crm_contatos (cópia de trabalho, com ofertas pré-calculadas) e
 * enfileira a troca de tag (disponivel → parceiro:<arw>) para o worker da
 * fila processar no ritmo dele.
 *
 * Cada oferta de REFIN já existe como Oportunidade (criada na importação) —
 * aqui só lemos. Ofertas de Novo/Cartão são CALCULADAS agora (coeficiente ×
 * margem) e viram Oportunidade nova, datada — histórico real do que foi
 * oferecido nesta campanha (ver docs/SPEC-CRM-WESALES-CAMPANHAS.md).
 *
 * Rota (não server action) para ter maxDuration próprio — a busca paginada no
 * WeSales para quantidades grandes pode levar dezenas de segundos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  createOpportunity,
  findOpportunitiesByContactDetalhadas,
  opportunityFieldValue,
  resolveCustomField,
  searchContactsAte,
  updateOpportunity,
  customFieldValue,
  type WesalesContact,
} from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { ETAPA_DISPONIVEL, MARGEM_FIELD_KEYS, OFERTA_FIELD_KEYS, TipoOferta, nomeOportunidade, resolverPipelineOfertas } from '@/lib/alvoconsig/ofertas-wesales'
import { calcularOfertas, resolverOfertasRefin, type OfertaCalculada, type RawOfertaRefin } from '@/lib/alvoconsig/ofertas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const QUANTIDADE_MAXIMA = 20_000

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}
function digitsOrRaw(value: string) {
  return value.replace(/\D/g, '') || value
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
    if (!convenioId) return NextResponse.json({ error: 'Selecione o convênio.' }, { status: 400 })
    if (!vigenciaFim || Number.isNaN(Date.parse(vigenciaFim))) return NextResponse.json({ error: 'Informe a vigência final da campanha.' }, { status: 400 })
    if (!Number.isFinite(quantidade) || quantidade <= 0) return NextResponse.json({ error: 'Informe a quantidade de contatos.' }, { status: 400 })
    if (quantidade > QUANTIDADE_MAXIMA) return NextResponse.json({ error: `Máximo de ${QUANTIDADE_MAXIMA.toLocaleString('pt-BR')} contatos por campanha.` }, { status: 400 })

    const admin = await createAdminClient()

    const { data: parceiro } = await admin.from('agentes_parceiros').select('id, arw_code').eq('id', agenteParceiroId).maybeSingle()
    const arwCode = String(parceiro?.arw_code || '').trim().toLowerCase()
    if (!arwCode) return NextResponse.json({ error: 'Parceiro sem código ARW — não é possível gerar a tag de dono.' }, { status: 400 })

    // Busca no WeSales: disponíveis (leitura — nunca escreve aqui). Com base
    // (tag) escolhida, filtra por ela; sem base, escopa pelo convênio inteiro
    // via o campo personalizado (evita puxar disponíveis de outro convênio).
    const filtrosBusca: Array<{ field: string; operator: string; value: unknown }> = [
      { field: 'tags', operator: 'contains', value: [TAG_DISPONIVEL] },
    ]
    let descricaoBusca = ''
    if (baseTagSlug) {
      filtrosBusca.push({ field: 'tags', operator: 'contains', value: [tagBase(baseTagSlug)] })
      descricaoBusca = `com a tag "${tagBase(baseTagSlug)}"`
    } else {
      const [convenioFieldBusca, convenioParaBusca] = await Promise.all([
        resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
        admin.from('convenios').select('codigo').eq('id', convenioId).maybeSingle().then((r) => r.data),
      ])
      if (convenioFieldBusca && convenioParaBusca?.codigo) {
        filtrosBusca.push({ field: `customFields.${convenioFieldBusca.id}`, operator: 'eq', value: convenioParaBusca.codigo })
      }
      descricaoBusca = 'do convênio selecionado'
    }

    let contatos: WesalesContact[]
    try {
      contatos = await searchContactsAte(filtrosBusca, quantidade)
    } catch (error: any) {
      console.error('Erro ao buscar contatos no WeSales:', error)
      return NextResponse.json({ error: `Falha ao consultar o WeSales: ${error?.message || error}` }, { status: 502 })
    }
    if (!contatos.length) {
      return NextResponse.json({ error: `Nenhum contato disponível ${descricaoBusca} no WeSales.` }, { status: 400 })
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
    const [cpfField, matriculaField, convenioField, novoValorField, rmcValorField, rccValorField] = await Promise.all([
      resolveCustomField(WESALES_FIELD_KEYS.cpf),
      resolveCustomField(WESALES_FIELD_KEYS.matricula),
      resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo),
      resolveCustomField(MARGEM_FIELD_KEYS.novoValor),
      resolveCustomField(MARGEM_FIELD_KEYS.rmcValor),
      resolveCustomField(MARGEM_FIELD_KEYS.rccValor),
    ])

    // Campos de OPORTUNIDADE (ofertas — REFIN já existentes + Novo/Cartão a criar agora).
    const entradasOferta = Object.entries(OFERTA_FIELD_KEYS) as Array<[keyof typeof OFERTA_FIELD_KEYS, string]>
    const ofertaFieldsResolvidos = await Promise.all(entradasOferta.map(([, key]) => resolveCustomField(key, 'opportunity')))
    const ofertaFieldDefs: Record<string, { id: string } | null> = {}
    entradasOferta.forEach(([, key], i) => { ofertaFieldDefs[key] = ofertaFieldsResolvidos[i] })
    const fCampo = (campo: keyof typeof OFERTA_FIELD_KEYS): string | null => ofertaFieldDefs[OFERTA_FIELD_KEYS[campo]]?.id ?? null

    const pipelineOfertas = await resolverPipelineOfertas()
    const stageDisponivelId = pipelineOfertas.stages[ETAPA_DISPONIVEL]?.id

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

    /** Cria/atualiza a Oportunidade de uma oferta calculada (Novo/RMC/RCC) — histórico datado, nunca sobrescreve outra campanha anterior. */
    async function gravarOfertaCalculada(contactId: string, tipo: TipoOferta, calc: OfertaCalculada, existentes: Awaited<ReturnType<typeof findOpportunitiesByContactDetalhadas>>) {
      const tipoFieldId = fCampo('tipoOferta')
      const instFieldId = fCampo('instituicaoId')
      const tabelaFieldId = fCampo('tabelaCodigo')
      const prazoFieldId = fCampo('prazo')
      if (!tipoFieldId || !instFieldId || !tabelaFieldId) return

      const alvo = existentes.find((op) => {
        if (opportunityFieldValue(op, tipoFieldId) !== tipo) return false
        if (opportunityFieldValue(op, instFieldId) !== calc.institutionId) return false
        const tabelaOp = opportunityFieldValue(op, tabelaFieldId)
        return !!tabelaOp && !!calc.codigoTabelaBanco && digitsOrRaw(tabelaOp) === digitsOrRaw(calc.codigoTabelaBanco)
      })

      const customFields: Array<{ id: string; fieldValue: string }> = [
        { id: tipoFieldId, fieldValue: tipo },
        { id: instFieldId, fieldValue: calc.institutionId },
      ]
      const instNomeFieldId = fCampo('instituicao')
      if (instNomeFieldId) customFields.push({ id: instNomeFieldId, fieldValue: calc.instituicao })
      if (calc.codigoTabelaBanco) customFields.push({ id: tabelaFieldId, fieldValue: calc.codigoTabelaBanco })
      if (prazoFieldId) customFields.push({ id: prazoFieldId, fieldValue: String(calc.prazo) })

      if (alvo) {
        await updateOpportunity(alvo.id, { monetaryValue: calc.valorLiberado, customFields })
      } else if (stageDisponivelId) {
        const nova = await createOpportunity({
          contactId,
          pipelineId: pipelineOfertas.pipeline.id,
          pipelineStageId: stageDisponivelId,
          name: nomeOportunidade(tipo, calc.instituicao, calc.tabela),
          monetaryValue: calc.valorLiberado,
          customFields,
        })
        existentes.push(nova)
      }
    }

    const agora = new Date().toISOString()
    const linhas: Array<Record<string, unknown>> = []
    for (const contato of selecionados) {
      const cpf = cpfField ? digits(customFieldValue(contato, cpfField.id)) || null : null
      const matricula = matriculaField ? customFieldValue(contato, matriculaField.id) : null
      const codigoConvenio = convenioField ? customFieldValue(contato, convenioField.id) : null
      const convenioResolvido = convenioId || (codigoConvenio && convenioPorCodigo.get(digits(codigoConvenio) || codigoConvenio)) || null

      const margens = {
        novo: novoValorField ? parseMoneyField(customFieldValue(contato, novoValorField.id)) : null,
        cartao_rmc: rmcValorField ? parseMoneyField(customFieldValue(contato, rmcValorField.id)) : null,
        cartao_rcc: rccValorField ? parseMoneyField(customFieldValue(contato, rccValorField.id)) : null,
      }

      // Ofertas de crédito já existentes deste contato (REFIN da importação +
      // Novo/Cartão de campanhas anteriores) — usado tanto pra ler REFIN
      // quanto pra decidir criar vs atualizar as de Novo/Cartão desta rodada.
      const oportunidadesExistentes = await findOpportunitiesByContactDetalhadas(contato.id, pipelineOfertas.pipeline.id)

      const rawOfertasRefin: RawOfertaRefin[] = oportunidadesExistentes
        .filter((op) => fCampo('tipoOferta') && opportunityFieldValue(op, fCampo('tipoOferta')!) === 'refin')
        .map((op) => ({
          opportunityId: op.id,
          troco: op.monetaryValue ?? null,
          parcela: fCampo('parcela') ? parseMoneyField(opportunityFieldValue(op, fCampo('parcela')!)) : null,
          prazo: fCampo('prazo') ? parseIntField(opportunityFieldValue(op, fCampo('prazo')!)) : null,
          taxa: fCampo('taxa') ? opportunityFieldValue(op, fCampo('taxa')!) : null,
          tabelaCodigo: fCampo('tabelaCodigo') ? opportunityFieldValue(op, fCampo('tabelaCodigo')!) : null,
          instituicaoId: fCampo('instituicaoId') ? opportunityFieldValue(op, fCampo('instituicaoId')!) : null,
        }))
      const refin = await resolverOfertasRefin(admin, rawOfertasRefin, convenioResolvido)
      // Resumo escalar (listas/filtros rápidos) = maior troco entre as ofertas; o
      // detalhe completo mora em ofertas.refin (jsonb).
      const refinTrocoResumo = refin.length ? Math.max(...refin.map((o) => o.troco || 0)) : null

      const ofertas = await calcularOfertas(admin, convenioResolvido, margens, refin)

      // Novo/RMC/RCC calculados agora (só roda de fato quando houver
      // coeficientes cadastrados pro convênio — senão os arrays vêm vazios).
      for (const tipo of ['novo', 'cartao_rmc', 'cartao_rcc'] as const) {
        for (const calc of ofertas[tipo]) {
          try {
            await gravarOfertaCalculada(contato.id, tipo, calc, oportunidadesExistentes)
          } catch (error: any) {
            console.error(`Falha ao gravar oferta calculada (${tipo}) do contato ${contato.id}:`, error?.message || error)
          }
        }
      }

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
