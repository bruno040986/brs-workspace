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
import {
  adicionarItens,
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
import { atualizarWesalesLote, enviarParaNvti } from '@/lib/if-credito/amigoz/saidas'
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
