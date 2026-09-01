'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { countContacts, deleteCustomField, resolveCustomField } from '@/lib/wesales/client'
import { tagBase, TAG_DISPONIVEL, WESALES_FIELD_KEYS } from '@/lib/alvoconsig/campos-sync'
import { marcarOfertasPerdidas, reverterTagsDaCampanha } from '@/lib/alvoconsig/campanha-encerramento'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const PERMISSION_RESOURCE = 'alvoconsig-gestao'
const PERMISSION_CERTIFICACAO = 'alvoconsig-certificacao'

// ----------------------------------------------------------------------------
// Visão geral
// ----------------------------------------------------------------------------
export async function getAlvoconsigResumo() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const [campanhasAtivas, contatosEmAtendimento, habilitados, filaPendente, filaErro, imports] = await Promise.all([
      supabaseAdmin.from('crm_campanhas').select('id', { count: 'exact', head: true }).in('status', ['ativa', 'encerrando']),
      supabaseAdmin.from('crm_contatos').select('id', { count: 'exact', head: true }).is('deleted_at', null).not('campanha_id', 'is', null),
      supabaseAdmin.from('crm_parceiro_config').select('agente_parceiro_id', { count: 'exact', head: true }).eq('habilitado', true),
      supabaseAdmin.from('crm_wesales_queue').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
      supabaseAdmin.from('crm_wesales_queue').select('id', { count: 'exact', head: true }).eq('status', 'erro'),
      supabaseAdmin
        .from('crm_imports')
        .select('id, tipo, arquivo_nome, total_linhas, importadas, descartadas, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    return {
      success: true,
      resumo: {
        campanhasAtivas: campanhasAtivas.count || 0,
        contatosEmAtendimento: contatosEmAtendimento.count || 0,
        parceirosHabilitados: habilitados.count || 0,
        filaPendente: filaPendente.count || 0,
        filaErro: filaErro.count || 0,
        importsRecentes: imports.data || [],
      },
    }
  } catch (error: any) {
    console.error('Erro ao carregar resumo AlvoConsig:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Importações (log apenas — a gravação em si vai direto ao WeSales, sem
// persistir em crm_contatos; ver /api/alvoconsig/upload)
// ----------------------------------------------------------------------------
export async function getImports() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_imports')
      .select('id, tipo, arquivo_nome, total_linhas, importadas, descartadas, status, erro, created_at, concluido_em, convenios ( id, nome )')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar importações:', error)
    return { success: false, error: error.message }
  }
}

/** Para o seletor de Instituição Financeira na importação de REFIN (obrigatório nesse tipo). */
export async function getInstituicoesAtivas() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('financial_institutions')
      .select('id, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getConveniosAtivos() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('convenios')
      .select('id, nome, nome_reduzido, codigo_sistema')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('nome', { ascending: true })
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Parceiros habilitados (para campanhas)
// ----------------------------------------------------------------------------
export async function getParceirosHabilitados() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_parceiro_config')
      .select('agente_parceiro_id, habilitado, max_atendentes, agentes_parceiros ( id, name, fantasy_name, cpf_cnpj, arw_code )')
      .eq('habilitado', true)
    if (error) throw error

    const items = (data || [])
      .filter((row: any) => String(row.agentes_parceiros?.arw_code || '').trim())
      .map((row: any) => ({
        agenteParceiroId: String(row.agente_parceiro_id),
        nome: String(row.agentes_parceiros?.fantasy_name || row.agentes_parceiros?.name || 'Parceiro'),
        cpfCnpj: String(row.agentes_parceiros?.cpf_cnpj || ''),
        arwCode: String(row.agentes_parceiros?.arw_code || ''),
      }))
    return { success: true, items }
  } catch (error: any) {
    console.error('Erro ao listar parceiros habilitados:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Campanhas (substituem os lotes — leads vêm do WeSales por tag de base)
// ----------------------------------------------------------------------------
export async function contarDisponiveisNoWeSales(baseTagSlug: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    const slug = String(baseTagSlug || '').trim()
    if (!slug) return { success: false, error: 'Informe a base (tag) para consultar.' }

    const total = await countContacts([
      { field: 'tags', operator: 'contains', value: [tagBase(slug)] },
      { field: 'tags', operator: 'contains', value: [TAG_DISPONIVEL] },
    ])
    return { success: true, disponiveis: total }
  } catch (error: any) {
    console.error('Erro ao consultar disponíveis no WeSales:', error)
    return { success: false, error: error.message || 'Erro ao consultar o WeSales.' }
  }
}

/** Disponíveis do convênio inteiro (sem filtrar por base específica). */
export async function contarDisponiveisPorConvenio(convenioId: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!convenioId) return { success: false, error: 'Selecione o convênio.' }

    const { data: convenio } = await supabaseAdmin.from('convenios').select('codigo_sistema').eq('id', convenioId).maybeSingle()
    if (!convenio?.codigo_sistema) return { success: true, disponiveis: 0 }

    const convenioField = await resolveCustomField(WESALES_FIELD_KEYS.convenioCodigo)
    if (!convenioField) return { success: true, disponiveis: 0 }

    const total = await countContacts([
      { field: 'tags', operator: 'contains', value: [TAG_DISPONIVEL] },
      { field: `customFields.${convenioField.id}`, operator: 'eq', value: convenio.codigo_sistema },
    ])
    return { success: true, disponiveis: total }
  } catch (error: any) {
    console.error('Erro ao consultar disponíveis do convênio no WeSales:', error)
    return { success: false, error: error.message || 'Erro ao consultar o WeSales.' }
  }
}

/**
 * Bases (tags) já conhecidas pelo sistema, para o seletor da campanha — sem
 * digitação livre. Vem do que foi importado pela nossa tela (guardado dentro
 * de `crm_imports.mapeamento._base_tag`, sem precisar de coluna/migration
 * nova). Importações feitas direto via CSV nativo do WeSales não aparecem
 * aqui — nesse caso raro, o operador ainda digita o nome uma vez.
 */
export async function getBasesImportadas(convenioId?: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    let query = supabaseAdmin
      .from('crm_imports')
      .select('mapeamento, convenio_id, created_at')
      .eq('status', 'concluido')
      .order('created_at', { ascending: false })
      .limit(200)
    if (convenioId) query = query.eq('convenio_id', convenioId)
    const { data, error } = await query
    if (error) throw error

    const vistos = new Map<string, string>()
    for (const row of data || []) {
      const tag = String((row.mapeamento as any)?._base_tag || '').trim()
      if (!tag || vistos.has(tag)) continue
      vistos.set(tag, row.created_at as string)
    }
    return { success: true, items: [...vistos.entries()].map(([tag, importadaEm]) => ({ tag, importadaEm })) }
  } catch (error: any) {
    console.error('Erro ao listar bases importadas:', error)
    return { success: false, error: error.message }
  }
}

export async function getCampanhas() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_campanhas')
      .select('id, codigo, descricao, base_tag, qtd_solicitada, qtd_alocada, vigencia_inicio, vigencia_fim, status, created_at, encerrada_em, agentes_parceiros ( id, name, fantasy_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar campanhas:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Encerra a campanha manualmente (antes da vigência acabar, ou o cron do
 * expurgo faz isso automaticamente todo dia). RPC exige fila zerada — se
 * ainda houver sync pendente, devolve status 'encerrando' para tentar de
 * novo depois (o cron de expurgo insiste diariamente).
 */
export async function encerrarCampanhaAgora(campanhaId: string) {
  try {
    const { user } = await requirePermission(PERMISSION_RESOURCE, 'can_edit')
    if (!campanhaId) return { success: false, error: 'Campanha inválida.' }

    const { data: campanha } = await supabaseAdmin
      .from('crm_campanhas')
      .select('id, agente_parceiro_id')
      .eq('id', campanhaId)
      .maybeSingle()
    if (!campanha) return { success: false, error: 'Campanha não encontrada.' }

    const { data: resultado, error } = await supabaseAdmin.rpc('crm_encerrar_campanha', {
      p_campanha_id: campanhaId,
      p_user_id: user.id,
    })
    if (error) throw error

    const payload = resultado as { ok: boolean; motivo?: string; pendentes?: number; expurgados?: number; mantidos?: number }
    if (!payload.ok) {
      return { success: false, error: `Fila com ${payload.pendentes || 0} sincronização(ões) pendente(s) — aguarde a fila esvaziar e tente de novo.` }
    }

    const reversao = await reverterTagsDaCampanha(supabaseAdmin, campanhaId, campanha.agente_parceiro_id)
    await marcarOfertasPerdidas(supabaseAdmin, campanhaId)

    revalidatePath('/alvoconsig/alocacao')
    if (reversao.erro) {
      // A campanha encerrou (leads apagados da cópia de trabalho), mas os
      // leads podem não ter voltado pro pool no WeSales — sem isso, o
      // parceiro via "0 disponíveis" na próxima alocação sem entender por quê.
      return {
        success: true,
        expurgados: payload.expurgados || 0,
        mantidos: payload.mantidos || 0,
        avisoReversao: `Campanha encerrada, mas a liberação dos leads no WeSales falhou: ${reversao.erro} Avise o suporte — os leads podem continuar indisponíveis pra novas campanhas até isso ser corrigido.`,
      }
    }
    return { success: true, expurgados: payload.expurgados || 0, mantidos: payload.mantidos || 0, revertidos: reversao.revertidos }
  } catch (error: any) {
    console.error('Erro ao encerrar campanha:', error)
    return { success: false, error: error.message || 'Erro ao encerrar a campanha.' }
  }
}

// ----------------------------------------------------------------------------
// Certificação de clientes conquistados
// ----------------------------------------------------------------------------
/**
 * Pendências de certificação. Depende do Fase 3 (CRM, brs-alvoconsig) marcar
 * `estado_local='certificacao_pendente'` ao mover um lead pra estágio final —
 * ainda não implementado, então esta lista fica vazia até lá. Também mostra
 * contatos já no estágio 'pagamento_feito' como fallback manual.
 */
export async function getContatosPendentesCertificacao() {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const { data, error } = await supabaseAdmin
      .from('crm_contatos')
      .select('id, cpf, nome, telefone, funil_estagio, estado_local, agente_parceiro_id, campanha_id, convenios ( id, nome ), agentes_parceiros ( id, name, fantasy_name )')
      .is('deleted_at', null)
      .or('estado_local.eq.certificacao_pendente,funil_estagio.eq.pagamento_feito')
      .order('funil_atualizado_em', { ascending: false })
      .limit(200)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    console.error('Erro ao listar pendências de certificação:', error)
    return { success: false, error: error.message }
  }
}

export async function certificarCliente(payload: { contatoId: string; produto?: string; valor?: number | null; observacao?: string }) {
  try {
    const { user } = await requirePermission(PERMISSION_CERTIFICACAO, 'can_include')
    if (!payload.contatoId) return { success: false, error: 'Contato inválido.' }

    const { data: resultado, error } = await supabaseAdmin.rpc('crm_certificar_cliente', {
      p_contato_id: payload.contatoId,
      p_user_id: user.id,
      p_produto: payload.produto || null,
      p_valor: payload.valor ?? null,
      p_observacao: payload.observacao || null,
    })
    if (error) throw error

    const resposta = resultado as { ok: boolean; motivo?: string; wesales_contact_id?: string }
    if (!resposta.ok) {
      return { success: false, error: resposta.motivo === 'contato_nao_encontrado' ? 'Contato não encontrado.' : 'Contato sem WeSales ou sem dono — não é possível certificar.' }
    }

    revalidatePath('/alvoconsig/certificacao')
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao certificar cliente:', error)
    return { success: false, error: error.message || 'Erro ao certificar o cliente.' }
  }
}

export async function getClientesDoParceiro(agenteParceiroId: string) {
  try {
    await requirePermission(PERMISSION_RESOURCE)
    if (!agenteParceiroId) return { success: true, items: [] }

    const { data, error } = await supabaseAdmin
      .from('crm_clientes_parceiro')
      .select('id, produto, valor, certificado_em, observacao')
      .eq('agente_parceiro_id', agenteParceiroId)
      .order('certificado_em', { ascending: false })
      .limit(500)
    if (error) throw error
    return { success: true, items: data || [] }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Contatos (cópias de trabalho de campanhas ativas — não é mais "toda a base",
// que agora mora no WeSales)
// ----------------------------------------------------------------------------
export async function getContatosGlobal(params: {
  busca?: string
  convenioId?: string
  campanhaId?: string
  pagina?: number
}) {
  try {
    await requirePermission(PERMISSION_RESOURCE)

    const pagina = Math.max(1, Number.parseInt(String(params.pagina || 1), 10) || 1)
    const porPagina = 50

    let query = supabaseAdmin
      .from('crm_contatos')
      .select(
        'id, cpf, nome, telefone, margem_novo, margem_cartao_rmc, margem_cartao_rcc, refin_troco, funil_estagio, agente_parceiro_id, campanha_id, estado_local, convenios ( id, nome ), agentes_parceiros ( id, name, fantasy_name )',
        { count: 'exact' },
      )
      .is('deleted_at', null)
      .not('campanha_id', 'is', null)

    if (params.convenioId) query = query.eq('convenio_id', params.convenioId)
    if (params.campanhaId) query = query.eq('campanha_id', params.campanhaId)

    const busca = String(params.busca || '').trim()
    if (busca) {
      const digits = busca.replace(/\D/g, '')
      if (digits.length >= 4) {
        query = query.or(`cpf.ilike.%${digits}%,telefone.ilike.%${digits}%,nome.ilike.%${busca}%`)
      } else {
        query = query.ilike('nome', `%${busca}%`)
      }
    }

    const from = (pagina - 1) * porPagina
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + porPagina - 1)
    if (error) throw error

    return { success: true, items: data || [], total: count || 0, pagina, porPagina }
  } catch (error: any) {
    console.error('Erro ao listar contatos:', error)
    return { success: false, error: error.message }
  }
}

// ----------------------------------------------------------------------------
// Faxina única — campos de REFIN antigos (numerados, substituídos pelas
// Oportunidades em 24/08/2026). Apagar a DEFINIÇÃO do campo já limpa o valor
// em todos os contatos — sem passo intermediário de "zerar". Disparo manual,
// só depois de confirmar que a reimportação recriou as ofertas como
// Oportunidade (não tem tela própria — Bruno pede pra rodar quando quiser).
// ----------------------------------------------------------------------------
export async function limparCamposRefinAntigos() {
  try {
    await requirePermission(PERMISSION_RESOURCE, 'can_delete')
    const chaves: string[] = []
    for (let slot = 1; slot <= 5; slot++) {
      for (const campo of ['troco', 'parcela', 'prazo', 'taxa', 'tabela', 'instituicao']) {
        chaves.push(`alvoconsig_refin_${campo}_${slot}`)
      }
    }
    const resultados: Array<{ chave: string; removido: boolean }> = []
    for (const chave of chaves) {
      const def = await resolveCustomField(chave)
      if (!def) {
        resultados.push({ chave, removido: false })
        continue
      }
      await deleteCustomField(def.id)
      resultados.push({ chave, removido: true })
    }
    const removidos = resultados.filter((r) => r.removido).length
    return { success: true, removidos, total: chaves.length }
  } catch (error: any) {
    console.error('Erro ao remover campos antigos de REFIN:', error)
    return { success: false, error: error.message }
  }
}
