/**
 * Criação de campanha — busca no WeSales os contatos disponíveis da base
 * (tag base:<slug> + disponivel, ou do convênio inteiro sem base), copia o
 * mínimo pra crm_contatos (cópia de trabalho, com ofertas pré-calculadas) e
 * enfileira a troca de tag (disponivel → parceiro:<arw>) para o worker da
 * fila processar no ritmo dele.
 *
 * Cada oferta de REFIN já existe como Oportunidade no pipeline "Ofertas de
 * Crédito" (criada na importação — é o INVENTÁRIO da BRS) — aqui só lemos.
 * Ofertas de Novo/Cartão são CALCULADAS agora (coeficiente × margem).
 *
 * Funis do parceiro (docs/SPEC-FUNIS-ALVOCONSIG.md, decisão 5): TODA oferta
 * desta campanha (REFIN lido + Novo/Cartão calculado) vira uma linha em
 * `crm_ofertas` e um card no pipeline "AC - Oferta"; o lead vira um card em
 * "AC - Prospecção" (Carteira de Leads). Os cards no WeSales são criados
 * pelo worker da fila do CRM (brs-alvoconsig, ops mover_oferta /
 * mover_estagio) no ritmo do rate limit — esta rota não escreve mais
 * oportunidade nenhuma no WeSales, e não toca mais em "Ofertas de Crédito"
 * (pipeline da venda própria/NuAzul).
 *
 * Rota (não server action) para ter maxDuration próprio — a busca paginada no
 * WeSales para quantidades grandes pode levar dezenas de segundos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import {
  findOpportunitiesByContactDetalhadas,
  opportunityFieldValue,
  resolveCustomField,
  searchContactsAte,
  customFieldValue,
  type WesalesContact,
} from '@/lib/wesales/client'
import { tagBase, tagCampanha, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { MARGEM_FIELD_KEYS, OFERTA_FIELD_KEYS, resolverPipelineOfertas } from '@/lib/alvoconsig/ofertas-wesales'
import { calcularOfertas, resolverOfertasRefin, type OfertasContato, type RawOfertaRefin } from '@/lib/alvoconsig/ofertas'

/** Linha de crm_ofertas ainda sem contato_id/campanha (preenchidos após o upsert do contato). */
type LinhaOferta = {
  produto: 'novo' | 'cartao_rmc' | 'cartao_rcc' | 'refin'
  produto_nome: string
  instituicao_id: string | null
  instituicao_nome: string
  tabela_comissao_id: string | null
  tabela_nome: string
  codigo_tabela_banco: string | null
  com_seguro: boolean | null
  prazo: number | null
  coeficiente: number | null
  taxa: string | null
  margem: number | null
  parcela: number | null
  valor_liberado: number
  dados: Record<string, unknown>
}

const PRODUTO_NOME: Record<LinhaOferta['produto'], string> = {
  novo: 'Empréstimo Novo',
  cartao_rmc: 'Cartão RMC',
  cartao_rcc: 'Cartão RCC',
  refin: 'Refinanciamento',
}

function montarLinhasOfertas(ofertas: OfertasContato): LinhaOferta[] {
  const linhas: LinhaOferta[] = []
  for (const produto of ['novo', 'cartao_rmc', 'cartao_rcc'] as const) {
    for (const calc of ofertas[produto]) {
      linhas.push({
        produto,
        produto_nome: calc.produto || PRODUTO_NOME[produto],
        instituicao_id: calc.institutionId || null,
        instituicao_nome: calc.instituicao,
        tabela_comissao_id: calc.tabelaComissaoId || null,
        tabela_nome: calc.tabela,
        codigo_tabela_banco: calc.codigoTabelaBanco,
        com_seguro: calc.comSeguro,
        prazo: calc.prazo || null,
        coeficiente: calc.coeficiente,
        taxa: null,
        margem: calc.margem,
        parcela: null,
        valor_liberado: calc.valorLiberado,
        dados: { origem: 'campanha' },
      })
    }
  }
  for (const refin of ofertas.refin) {
    if (!(typeof refin.troco === 'number' && refin.troco > 0)) continue
    linhas.push({
      produto: 'refin',
      produto_nome: PRODUTO_NOME.refin,
      instituicao_id: refin.instituicaoId || null,
      instituicao_nome: refin.instituicaoNome || 'Instituição não identificada',
      tabela_comissao_id: refin.tabelaComissaoId || null,
      tabela_nome: refin.tabelaNome || refin.tabelaCodigo || '-',
      codigo_tabela_banco: refin.tabelaCodigo,
      com_seguro: null,
      prazo: refin.prazo,
      coeficiente: null,
      taxa: refin.taxa,
      margem: null,
      parcela: refin.parcela,
      valor_liberado: refin.troco,
      // Oportunidade de origem no inventário ("Ofertas de Crédito") — só referência.
      dados: { origem: 'campanha', refin_opportunity_id: refin.opportunityId },
    })
  }
  return linhas
}

/** Mesma identidade natural do índice único crm_ofertas_identidade_uidx. */
function chaveOferta(o: { contato_id: string; produto: string; tabela_comissao_id: string | null; codigo_tabela_banco: string | null; prazo: number | null }) {
  return `${o.contato_id}|${o.produto}|${o.tabela_comissao_id ?? o.codigo_tabela_banco ?? ''}|${o.prazo ?? 0}`
}

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
        admin.from('convenios').select('codigo_sistema').eq('id', convenioId).maybeSingle().then((r) => r.data),
      ])
      if (convenioFieldBusca && convenioParaBusca?.codigo_sistema) {
        filtrosBusca.push({ field: `customFields.${convenioFieldBusca.id}`, operator: 'eq', value: convenioParaBusca.codigo_sistema })
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

    // Só pra LER as ofertas de REFIN do inventário — nada é escrito lá.
    const pipelineOfertas = await resolverPipelineOfertas()

    const { data: conveniosData } = await admin.from('convenios').select('id, codigo_sistema').is('deleted_at', null)
    const convenioPorCodigo = new Map<string, string>()
    for (const conv of conveniosData || []) {
      if (conv.codigo_sistema) convenioPorCodigo.set(conv.codigo_sistema, String(conv.id))
    }

    // Código sequencial global (<arw_atual>-<numero>) — identifica a campanha
    // no Workspace e vira tag adicional no WeSales (campanha:<codigo>), junto
    // da parceiro:<arw> que já existe. Sequência é do sistema todo, não por
    // parceiro (decisão 26/08/2026).
    const { data: numeroCampanha, error: numeroError } = await admin.rpc('next_crm_campanha_numero')
    if (numeroError || numeroCampanha == null) {
      return NextResponse.json({ error: 'Falha ao gerar o código da campanha.' }, { status: 500 })
    }
    const codigoCampanha = `${arwCode}-${numeroCampanha}`

    // Cria a campanha (status 'montando' até terminar de copiar).
    const { data: campanha, error: campanhaError } = await admin
      .from('crm_campanhas')
      .insert({
        agente_parceiro_id: agenteParceiroId,
        codigo: codigoCampanha,
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

    // Ofertas desta campanha por contato do WeSales — viram linhas de
    // crm_ofertas depois que o contato local existe (upsert abaixo).
    const ofertasPorContato = new Map<string, LinhaOferta[]>()

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

      // Novo/RMC/RCC calculados agora + REFIN lido: 1 linha por oferta
      // (só roda de fato quando houver coeficientes pro convênio).
      ofertasPorContato.set(contato.id, montarLinhasOfertas(ofertas))

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

      // crm_ofertas: 1 linha por oferta deste chunk. Reaproveita o que já
      // existir (mesma identidade natural) pra não duplicar em recampanha.
      const contatoIdsChunk = (inseridos || []).map((row: any) => String(row.id))
      const { data: ofertasExistentes } = await admin
        .from('crm_ofertas')
        .select('id, contato_id, produto, tabela_comissao_id, codigo_tabela_banco, prazo')
        .in('contato_id', contatoIdsChunk)
        .is('deleted_at', null)
      const idPorChave = new Map<string, string>()
      for (const existente of ofertasExistentes || []) {
        idPorChave.set(
          chaveOferta({
            contato_id: String(existente.contato_id),
            produto: String(existente.produto),
            tabela_comissao_id: existente.tabela_comissao_id ? String(existente.tabela_comissao_id) : null,
            codigo_tabela_banco: existente.codigo_tabela_banco ? String(existente.codigo_tabela_banco) : null,
            prazo: typeof existente.prazo === 'number' ? existente.prazo : null,
          }),
          String(existente.id),
        )
      }

      const linhasNovas: Array<LinhaOferta & { contato_id: string; agente_parceiro_id: string; campanha_id: string }> = []
      for (const row of inseridos || []) {
        for (const linha of ofertasPorContato.get(String(row.wesales_contact_id)) || []) {
          const candidata = { ...linha, contato_id: String(row.id), agente_parceiro_id: agenteParceiroId, campanha_id: campanha.id }
          if (idPorChave.has(chaveOferta(candidata))) continue
          linhasNovas.push(candidata)
        }
      }
      const ofertaIdsDoChunk: Array<{ ofertaId: string; contatoId: string }> = []
      for (const [chave, id] of idPorChave) ofertaIdsDoChunk.push({ ofertaId: id, contatoId: chave.split('|')[0] })
      if (linhasNovas.length) {
        const { data: ofertasInseridas, error: ofertasError } = await admin
          .from('crm_ofertas')
          .insert(linhasNovas)
          .select('id, contato_id')
        if (ofertasError) console.error('Falha ao gravar ofertas da campanha:', ofertasError)
        for (const oferta of ofertasInseridas || []) ofertaIdsDoChunk.push({ ofertaId: String(oferta.id), contatoId: String(oferta.contato_id) })
      }

      // Fila do CRM: tags de dono + card do lead em AC-Prospecção (Carteira
      // de Leads) + um card por oferta em AC-Oferta (Ofertas Disponíveis).
      const filaOps = [
        ...(inseridos || []).flatMap((row: any) => [
          { operacao: 'remover_tag', contato_id: row.id, payload: { tag: TAG_DISPONIVEL } },
          { operacao: 'aplicar_tag', contato_id: row.id, payload: { tag: `parceiro:${arwCode}` } },
          { operacao: 'aplicar_tag', contato_id: row.id, payload: { tag: tagCampanha(codigoCampanha) } },
          { operacao: 'mover_estagio', contato_id: row.id, payload: { estagio: 'carteira_de_leads' } },
        ]),
        ...ofertaIdsDoChunk.map(({ ofertaId, contatoId }) => ({
          operacao: 'mover_oferta',
          contato_id: contatoId,
          payload: { ofertaId, estagio: 'ofertas_disponiveis' },
        })),
      ]
      if (filaOps.length) {
        const { error: filaError } = await admin.from('crm_wesales_queue').insert(filaOps)
        if (filaError) console.error('Falha ao enfileirar tags da campanha:', filaError)
      }
    }

    await admin
      .from('crm_campanhas')
      .update({ qtd_alocada: copiados, status: copiados > 0 ? 'ativa' : 'cancelada' })
      .eq('id', campanha.id)

    return NextResponse.json({ campanhaId: campanha.id, codigo: codigoCampanha, solicitados: quantidade, encontrados: selecionados.length, alocados: copiados })
  } catch (error: any) {
    console.error('Erro ao criar campanha AlvoConsig:', error)
    return NextResponse.json({ error: 'Erro inesperado ao criar a campanha.' }, { status: 500 })
  }
}
