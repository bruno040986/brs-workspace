'use server'

/**
 * Server actions da "Higienização Amigoz" (Gestão de Leads › Comercial).
 * Ver docs/ROTEIRO-AMIGOZ-FATIA-2-HIGIENIZACAO.md.
 *
 * Permissão: alvoconsig-higienizacao-amigoz (can_view leitura, can_include
 * escrita/consulta — a consulta de margem É uma escrita, pois cria lote/item
 * e chama a API do Amigoz de verdade).
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { carregarConfigAmigoz } from '@/lib/if-credito/amigoz/client'
import {
  adicionarVarianteAmigoz,
  atualizarVarianteAmigoz,
  listarConveniosAmigoz,
  listarVariantesAmigoz,
  listarVariantesPorConvenio,
  removerVarianteAmigoz,
  type ConvenioAmigoz,
  type VarianteConvenio,
} from '@/lib/if-credito/amigoz/convenios'
import { consultarMargemComVariantes } from '@/lib/if-credito/amigoz/margem'
import { garantirClienteAmigoz, normalizarDataBrParaAmigoz, resolverDadosClienteAmigoz, simularOfertasAmigoz, type ItemParaOferta, type OrigemDado } from '@/lib/if-credito/amigoz/ofertas'
import type { OfertaNormalizada } from '@/lib/if-credito/ofertas'
import {
  adicionarItens,
  buscarOfertasDoLote,
  cancelarLote,
  criarLote,
  iniciarLote,
  listarItensLote,
  listarLotes,
  obterLote,
  pausarLote,
  retomarLote,
  type ItemEntrada,
  type ItemResumo,
  type LoteResumo,
} from '@/lib/if-credito/amigoz/lote'
import { atualizarWesalesLote, enviarOfertasParaWesales, enviarParaNvti } from '@/lib/if-credito/amigoz/saidas'
import { normalizeCpf, validateCpf } from '@/lib/import/columnMap'
import { WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { customFieldValue, resolveCustomField, searchContactsAte, countContacts, type ContactSearchFilter } from '@/lib/wesales/client'

const RESOURCE = 'alvoconsig-higienizacao-amigoz'
const PATH_TELA = '/gestao-leads/higienizacao-amigoz'

type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

function erro(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' }
}

export type ConvenioBrs = { id: string; nome: string; nomeReduzido: string | null; codigoSistema: string | null }

export async function listarConveniosBrsAction(): Promise<ActionResult<ConvenioBrs[]>> {
  try {
    await requirePermission(RESOURCE)
    const admin = await createAdminClient()
    const { data, error: dbError } = await admin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo_sistema')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('nome')
    if (dbError) throw dbError
    return { success: true, data: (data || []).map((c) => ({ id: String(c.id), nome: String(c.nome || ''), nomeReduzido: c.nome_reduzido ? String(c.nome_reduzido) : null, codigoSistema: c.codigo_sistema ? String(c.codigo_sistema) : null })) }
  } catch (err) {
    return erro(err)
  }
}

/** Todas as variantes já vinculadas (de todos os convênios BRS) — a tela agrupa por convênio. */
export async function listarVariantesAction(): Promise<ActionResult<VarianteConvenio[]>> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await listarVariantesAmigoz() }
  } catch (err) {
    return erro(err)
  }
}

export async function listarConveniosAmigozAction(): Promise<ActionResult<ConvenioAmigoz[]>> {
  try {
    const { user } = await requirePermission(RESOURCE)
    const cfg = await carregarConfigAmigoz()
    return { success: true, data: await listarConveniosAmigoz(cfg, user.id) }
  } catch (err) {
    return erro(err)
  }
}

/** Vincula UMA variante do Amigoz ao convênio BRS — um convênio pode ter várias (ex.: INSS e INSS - Aposentadoria por Invalidez). */
export async function adicionarVarianteAction(input: {
  convenioId: string
  convenioExternoId: string
  convenioExternoNome: string | null
  averbadoraExterna: number | null
  exigeMatricula: boolean
  exigeSenhaServidor: boolean
}): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const existentes = await listarVariantesPorConvenio(input.convenioId)
    const proximaOrdem = existentes.length > 0 ? Math.max(...existentes.map((v) => v.ordem)) + 1 : 0
    await adicionarVarianteAmigoz({ ...input, ordem: proximaOrdem })
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

export async function atualizarVarianteAction(
  varianteId: string,
  patch: { rotulo?: string | null; exigeMatricula?: boolean; exigeSenhaServidor?: boolean; ordem?: number }
): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    await atualizarVarianteAmigoz(varianteId, patch)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

export async function removerVarianteAction(varianteId: string): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    await removerVarianteAmigoz(varianteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

// ---------------------------------------------------------------------------
// Aba 1 — consulta unitária (também vira um lote de 1 item, mesma trilha)
// ---------------------------------------------------------------------------

export type ResultadoUnitario = {
  loteId: string
  itemId: string
  ok: boolean
  mensagem?: string
  margem?: {
    nomeIf: string | null
    matriculaIf: string | null
    margemConsignado: number
    margemBeneficioCompra: number
    margemBeneficioSaque: number
    margemBeneficio: number
    margemEmprestimo: number
    temOportunidade: boolean
  }
}

export async function consultarUnitariaAction(input: {
  convenioId: string
  cpf: string
  matricula?: string
  senhaServidor?: string
}): Promise<ActionResult<ResultadoUnitario>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const cpf = normalizeCpf(input.cpf)
    if (!validateCpf(cpf)) throw new Error('CPF inválido.')

    const variantes = await listarVariantesPorConvenio(input.convenioId)
    if (variantes.length === 0) throw new Error('Este convênio ainda não está vinculado a um convênio do Amigoz.')
    const semAverbadora = variantes.every((v) => v.averbadoraExterna === null)
    if (semAverbadora) throw new Error('Nenhuma variante deste convênio tem averbadora configurada — edite o vínculo.')
    if (variantes.some((v) => v.exigeMatricula) && !input.matricula?.trim()) throw new Error('Este convênio exige matrícula.')
    if (variantes.some((v) => v.exigeSenhaServidor) && !input.senhaServidor?.trim()) throw new Error('Este convênio exige senha do servidor.')

    const loteId = await criarLote({
      origem: 'unitaria',
      convenioId: input.convenioId,
      convenioExternoId: variantes[0].convenioExternoId,
      averbadoraExterna: variantes[0].averbadoraExterna,
      criadoPor: user.id,
    })
    const item: ItemEntrada = { cpf, matricula: input.matricula || null, senhaServidor: input.senhaServidor || null }
    await adicionarItens(loteId, [item])

    const admin = await createAdminClient()
    const { data: itemRow } = await admin.from('if_higienizacao_itens').select('id').eq('lote_id', loteId).single()
    const itemId = String(itemRow!.id)
    await admin.from('if_higienizacao_itens').update({ status: 'processando' }).eq('id', itemId)

    const cfg = await carregarConfigAmigoz()
    const resultado = await consultarMargemComVariantes(
      cfg,
      input.convenioId,
      { cpf, numeroMatricula: input.matricula, senhaServidor: input.senhaServidor },
      user.id
    )

    if (resultado.ok) {
      const m = resultado.margem
      await admin
        .from('if_higienizacao_itens')
        .update({
          status: m.temOportunidade ? 'ok' : 'sem_margem',
          nome_if: m.nomeIf,
          nascimento_if: m.nascimentoIf,
          ocupacao_if: m.ocupacaoIf,
          matricula_if: m.matriculaIf,
          estavel: m.estavel,
          margem_consignado: m.margemConsignado,
          margem_beneficio_compra: m.margemBeneficioCompra,
          margem_beneficio_saque: m.margemBeneficioSaque,
          margem_beneficio: m.margemBeneficio,
          margem_emprestimo: m.margemEmprestimo,
          tem_oportunidade: m.temOportunidade,
          resposta_bruta: resultado.bruto as never,
          convenio_externo_usado: resultado.varianteUsada?.convenioExternoId ?? null,
          averbadora_usada: resultado.varianteUsada?.averbadoraExterna ?? null,
          consultado_em: new Date().toISOString(),
        })
        .eq('id', itemId)
      await admin
        .from('if_higienizacao_lotes')
        .update({ status: 'concluido', itens_processados: 1, itens_com_margem: m.temOportunidade ? 1 : 0, concluido_em: new Date().toISOString() })
        .eq('id', loteId)
      revalidatePath(PATH_TELA)
      return {
        success: true,
        data: {
          loteId,
          itemId,
          ok: true,
          margem: {
            nomeIf: m.nomeIf,
            matriculaIf: m.matriculaIf,
            margemConsignado: m.margemConsignado,
            margemBeneficioCompra: m.margemBeneficioCompra,
            margemBeneficioSaque: m.margemBeneficioSaque,
            margemBeneficio: m.margemBeneficio,
            margemEmprestimo: m.margemEmprestimo,
            temOportunidade: m.temOportunidade,
          },
        },
      }
    }

    await admin
      .from('if_higienizacao_itens')
      .update({
        status: 'erro',
        erro: resultado.mensagem.slice(0, 500),
        tentativas: 1,
        resposta_bruta: (resultado.bruto ?? null) as never,
        convenio_externo_usado: resultado.varianteUsada?.convenioExternoId ?? null,
        averbadora_usada: resultado.varianteUsada?.averbadoraExterna ?? null,
      })
      .eq('id', itemId)
    await admin.from('if_higienizacao_lotes').update({ status: 'concluido', itens_processados: 1, itens_erro: 1, concluido_em: new Date().toISOString() }).eq('id', loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: { loteId, itemId, ok: false, mensagem: resultado.mensagem } }
  } catch (err) {
    return erro(err)
  }
}

// ---------------------------------------------------------------------------
// Aba 3 — seleção no WeSales por convênio + tags (todas obrigatórias)
// ---------------------------------------------------------------------------

async function montarFiltrosWesales(convenioId: string, tagsExtras: string[]): Promise<{ filtros: ContactSearchFilter[]; convenioCodigo: string | null }> {
  const admin = await createAdminClient()
  const { data: convenio } = await admin.from('convenios').select('codigo_sistema').eq('id', convenioId).maybeSingle()
  const codigoSistema = convenio?.codigo_sistema ? String(convenio.codigo_sistema) : null

  const filtros: ContactSearchFilter[] = []
  if (codigoSistema) {
    const def = await resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo)
    if (!def) throw new Error(`Campo "Convênio (Código Workspace)" não encontrado no WeSales.`)
    filtros.push({ field: `customFields.${def.id}`, operator: 'eq', value: codigoSistema })
  }
  for (const tag of tagsExtras) {
    const limpa = tag.trim()
    if (limpa) filtros.push({ field: 'tags', operator: 'contains', value: [limpa] })
  }
  return { filtros, convenioCodigo: codigoSistema }
}

export async function contarWesalesPorFiltroAction(input: { convenioId: string; tagsExtras: string[] }): Promise<ActionResult<number>> {
  try {
    await requirePermission(RESOURCE)
    const { filtros } = await montarFiltrosWesales(input.convenioId, input.tagsExtras)
    return { success: true, data: await countContacts(filtros) }
  } catch (err) {
    return erro(err)
  }
}

export async function criarLoteWesalesAction(input: {
  convenioId: string
  tagsExtras: string[]
  limite: number
  pausaMs: number
  buscarOfertas?: boolean
}): Promise<ActionResult<{ loteId: string; total: number }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const variantes = await listarVariantesPorConvenio(input.convenioId)
    if (variantes.length === 0) throw new Error('Este convênio ainda não está vinculado a um convênio do Amigoz.')
    if (variantes.every((v) => v.averbadoraExterna === null)) throw new Error('Nenhuma variante deste convênio tem averbadora configurada — edite o vínculo.')

    const limite = Math.min(Math.max(input.limite, 1), 5000)
    const { filtros } = await montarFiltrosWesales(input.convenioId, input.tagsExtras)
    const cpfDef = await resolveCustomField('cpf')
    if (!cpfDef) throw new Error('Campo "CPF" não encontrado no WeSales.')

    const contatos = await searchContactsAte(filtros, limite)
    const itens: ItemEntrada[] = []
    for (const c of contatos) {
      const cpf = normalizeCpf(customFieldValue(c, cpfDef.id) || '')
      if (!validateCpf(cpf)) continue
      itens.push({ cpf, nome: c.name || null, telefone: c.phone || null, wesalesContactId: c.id })
    }
    if (itens.length === 0) throw new Error('Nenhum contato com CPF válido encontrado com esses filtros.')

    const loteId = await criarLote({
      origem: 'wesales',
      convenioId: input.convenioId,
      convenioExternoId: variantes[0].convenioExternoId,
      averbadoraExterna: variantes[0].averbadoraExterna,
      pausaMs: input.pausaMs,
      filtroWesales: { convenioId: input.convenioId, tagsExtras: input.tagsExtras, limite },
      buscarOfertas: input.buscarOfertas ?? false,
      criadoPor: user.id,
    })
    const { inseridos } = await adicionarItens(loteId, itens)
    await iniciarLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: { loteId, total: inseridos } }
  } catch (err) {
    return erro(err)
  }
}

// ---------------------------------------------------------------------------
// Lotes — leitura e controle
// ---------------------------------------------------------------------------

export async function listarLotesAction(): Promise<ActionResult<LoteResumo[]>> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await listarLotes(30) }
  } catch (err) {
    return erro(err)
  }
}

export async function obterLoteAction(loteId: string): Promise<ActionResult<LoteResumo | null>> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await obterLote(loteId) }
  } catch (err) {
    return erro(err)
  }
}

export async function listarItensLoteAction(loteId: string): Promise<ActionResult<ItemResumo[]>> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await listarItensLote(loteId) }
  } catch (err) {
    return erro(err)
  }
}

export async function pausarLoteAction(loteId: string): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    await pausarLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

export async function retomarLoteAction(loteId: string): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    await retomarLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

export async function cancelarLoteAction(loteId: string): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    await cancelarLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

export async function enviarParaNvtiAction(loteId: string): Promise<ActionResult<{ enviados: number }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const resultado = await enviarParaNvti(loteId, user.id)
    revalidatePath(PATH_TELA)
    return { success: true, data: resultado }
  } catch (err) {
    return erro(err)
  }
}

export async function atualizarWesalesAction(loteId: string): Promise<ActionResult<{ atualizados: number; semContato: number }>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const resultado = await atualizarWesalesLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: resultado }
  } catch (err) {
    return erro(err)
  }
}

// ---------------------------------------------------------------------------
// Fatia 3 — ofertas disponíveis (simulação em tempo real) → Oportunidade
// ---------------------------------------------------------------------------

export async function enviarOfertasParaWesalesAction(loteId: string): Promise<ActionResult<{ enviados: number; semContato: number }>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const resultado = await enviarOfertasParaWesales(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: resultado }
  } catch (err) {
    return erro(err)
  }
}

/** Reabre um lote CONCLUÍDO (sem `buscar_ofertas` na criação) pra buscar ofertas dos itens já `ok`. */
export async function buscarOfertasDoLoteAction(loteId: string): Promise<ActionResult<null>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    await buscarOfertasDoLote(loteId)
    revalidatePath(PATH_TELA)
    return { success: true, data: null }
  } catch (err) {
    return erro(err)
  }
}

function brParaIso(v: string | null): string | null {
  const m = String(v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export type PreparoOfertasUnitaria = {
  telefone: string | null
  telefoneOrigem: OrigemDado
  nascimentoIso: string | null
  nascimentoOrigem: OrigemDado
}

/**
 * Antes de "Buscar ofertas" chamar a API de verdade: resolve telefone/
 * nascimento pela entrada/IF/WeSales, pra tela decidir se pede os campos
 * (e com qual origem mostrar — editável se veio do WeSales, os dois vazios
 * se não achou em lugar nenhum).
 */
export async function prepararOfertasUnitariaAction(itemId: string): Promise<ActionResult<PreparoOfertasUnitaria>> {
  try {
    await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const { data: item, error } = await admin.from('if_higienizacao_itens').select('cpf, telefone, nascimento_if, wesales_contact_id').eq('id', itemId).maybeSingle()
    if (error) throw error
    if (!item) throw new Error('Item não encontrado.')

    const resolvido = await resolverDadosClienteAmigoz({
      cpf: String(item.cpf),
      telefone: item.telefone ? String(item.telefone) : null,
      nascimentoIf: item.nascimento_if ? String(item.nascimento_if) : null,
      wesalesContactId: item.wesales_contact_id ? String(item.wesales_contact_id) : null,
    })
    return {
      success: true,
      data: {
        telefone: resolvido.telefone,
        telefoneOrigem: resolvido.telefoneOrigem,
        nascimentoIso: brParaIso(resolvido.nascimento),
        nascimentoOrigem: resolvido.nascimentoOrigem,
      },
    }
  } catch (err) {
    return erro(err)
  }
}

/**
 * Aba 1 (unitária): depois da margem, roda cliente + simulação NA HORA (sem
 * passar pelo worker de lote — é 1 item só) e devolve as ofertas pra tela.
 *
 * `manual` só é usado quando `prepararOfertasUnitariaAction` não achou
 * telefone/nascimento em lugar nenhum — a tela pediu os campos pro operador
 * com a flag "Dados Reais"/"Dados Fictícios". Dado marcado REAL é gravado no
 * item (nunca sobrescreve o que já existia); dado FICTÍCIO nunca é gravado
 * nas colunas de telefone/nascimento — só fica registrado em
 * `ofertas_dados_ficticios` (a oferta em si é real, só o cadastro é de teste).
 */
export async function buscarOfertasUnitariaAction(
  itemId: string,
  manual?: { telefone?: string; nascimento?: string; dadosReais?: boolean },
): Promise<ActionResult<{ ofertas: OfertaNormalizada[]; status: string; mensagem: string | null }>> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const { data: item, error } = await admin.from('if_higienizacao_itens').select('*').eq('id', itemId).maybeSingle()
    if (error) throw error
    if (!item) throw new Error('Item não encontrado.')
    if (!item.tem_oportunidade) throw new Error('Este item não tem margem de cartão (RCC/RMC).')

    const resolvido = await resolverDadosClienteAmigoz({
      cpf: String(item.cpf),
      telefone: item.telefone ? String(item.telefone) : null,
      nascimentoIf: item.nascimento_if ? String(item.nascimento_if) : null,
      wesalesContactId: item.wesales_contact_id ? String(item.wesales_contact_id) : null,
    })

    const telefoneManual = manual?.telefone ? manual.telefone.replace(/\D/g, '') || null : null
    const nascimentoManual = manual?.nascimento ? normalizarDataBrParaAmigoz(manual.nascimento) : null
    const usouTelefoneManual = !resolvido.telefoneOrigem && Boolean(telefoneManual)
    const usouNascimentoManual = !resolvido.nascimentoOrigem && Boolean(nascimentoManual)
    const usouDadoManual = usouTelefoneManual || usouNascimentoManual

    const telefoneFinal = resolvido.telefone || telefoneManual
    const nascimentoFinal = resolvido.nascimento || nascimentoManual

    if (!telefoneFinal || !nascimentoFinal) {
      const mensagem = !telefoneFinal && !nascimentoFinal ? 'Informe telefone e data de nascimento.' : !telefoneFinal ? 'Informe o telefone.' : 'Informe a data de nascimento.'
      return { success: true, data: { ofertas: [], status: 'faltam_dados', mensagem } }
    }

    // Persistência do dado manual: só quando confirmado como REAL, e só nas colunas ainda vazias (nunca sobrescreve dado já existente).
    const patchDadosReais: Record<string, unknown> = {}
    if (usouDadoManual && manual?.dadosReais) {
      if (usouTelefoneManual && !item.telefone) patchDadosReais.telefone = telefoneFinal
      if (usouNascimentoManual && !item.nascimento_if) patchDadosReais.nascimento_if = nascimentoFinal
    }
    if (Object.keys(patchDadosReais).length > 0) {
      await admin.from('if_higienizacao_itens').update(patchDadosReais).eq('id', itemId)
    }
    const ofertasDadosFicticios = usouDadoManual ? !manual?.dadosReais : null

    const dados: ItemParaOferta = {
      cpf: String(item.cpf),
      nome: item.nome ? String(item.nome) : null,
      nomeIf: item.nome_if ? String(item.nome_if) : null,
      nascimentoIf: nascimentoFinal,
      matriculaIf: item.matricula_if ? String(item.matricula_if) : null,
      telefone: telefoneFinal,
      wesalesContactId: item.wesales_contact_id ? String(item.wesales_contact_id) : null,
      convenioExternoUsado: item.convenio_externo_usado ? String(item.convenio_externo_usado) : null,
      margemConsignado: item.margem_consignado === null ? null : Number(item.margem_consignado),
      margemBeneficioCompra: item.margem_beneficio_compra === null ? null : Number(item.margem_beneficio_compra),
      margemBeneficioSaque: item.margem_beneficio_saque === null ? null : Number(item.margem_beneficio_saque),
      clienteExternoId: item.cliente_externo_id ? String(item.cliente_externo_id) : null,
    }

    const cfg = await carregarConfigAmigoz()
    const clienteResultado = await garantirClienteAmigoz(cfg, dados, user.id)
    if (!clienteResultado.ok) {
      await admin
        .from('if_higienizacao_itens')
        .update({
          ofertas_status: 'erro',
          ofertas_erro: clienteResultado.mensagem.slice(0, 500),
          ofertas_consultadas_em: new Date().toISOString(),
          ofertas_dados_ficticios: ofertasDadosFicticios,
        })
        .eq('id', itemId)
      revalidatePath(PATH_TELA)
      return { success: true, data: { ofertas: [], status: 'erro', mensagem: clienteResultado.mensagem } }
    }
    if (!dados.clienteExternoId) {
      await admin.from('if_higienizacao_itens').update({ cliente_externo_id: clienteResultado.clienteExternoId }).eq('id', itemId)
    }

    const PAUSA_MS_UNITARIA = 1500 // 1 item só, fora do lote — usa o mesmo piso padrão do lote
    const simulacao = await simularOfertasAmigoz(cfg, dados, PAUSA_MS_UNITARIA, user.id)
    const status = simulacao.ofertas.length > 0 ? 'ok' : simulacao.algumErro ? 'erro' : 'sem_oferta'
    await admin
      .from('if_higienizacao_itens')
      .update({
        ofertas: simulacao.ofertas as never,
        ofertas_status: status,
        ofertas_erro: status === 'erro' ? (simulacao.algumErro || '').slice(0, 500) : null,
        ofertas_consultadas_em: new Date().toISOString(),
        ofertas_dados_ficticios: ofertasDadosFicticios,
      })
      .eq('id', itemId)
    // Lote unitário tem sempre 1 item — não precisa incrementar, só refletir o resultado deste.
    await admin.from('if_higienizacao_lotes').update({ itens_com_oferta: status === 'ok' ? 1 : 0 }).eq('id', item.lote_id)

    revalidatePath(PATH_TELA)
    return { success: true, data: { ofertas: simulacao.ofertas, status, mensagem: simulacao.algumErro } }
  } catch (err) {
    return erro(err)
  }
}
