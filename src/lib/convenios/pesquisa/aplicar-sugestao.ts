/**
 * Convênio — Base de Conhecimento, Fase 3. Aplicação de uma sugestão
 * ACEITA — spec §6.3. Escrita PONTUAL (nunca a RPC `convenio_bc_salvar_secao`,
 * que substitui a seção inteira): cada sugestão grava só o campo dela. As
 * triggers R1 (margem × teto, em `convenio_formas_contrato`) e R2–R6 (em
 * `convenio_instituicao_*`) continuam sendo a rede de segurança do banco;
 * aqui só replicamos o pré-check que NENHUMA trigger cobre — mudar o teto/
 * prazo do próprio convênio não dispara nada nas tabelas filhas.
 */
import { admin } from '@/app/(dashboard)/convenios/supabase-admin'

const BUCKET = 'convenio-documentos'

export type AplicarSugestaoResultado = { success: true } | { success: false; error: string }

async function importarFonteComoDocumento(fonte: any, userId: string): Promise<string> {
  if (fonte.documento_id) return fonte.documento_id as string

  const tituloPartes = [fonte.titulo, fonte.numero ? `nº ${fonte.numero}` : null, fonte.ano ? `/${fonte.ano}` : null].filter(Boolean)
  const titulo = tituloPartes.length > 0 ? tituloPartes.join(' ') : fonte.url || 'Documento da pesquisa'

  const row = {
    convenio_id: fonte.convenio_id,
    tipo: fonte.tipo_norma && fonte.tipo_norma !== 'outro' ? 'decreto' : 'outro',
    titulo: String(titulo).slice(0, 300),
    texto: null as string | null,
    url: fonte.url,
    arquivo_path: fonte.arquivo_path,
    arquivo_nome: fonte.arquivo_path ? fonte.arquivo_path.split('/').pop() : null,
    arquivo_mime: fonte.conteudo_mime,
    arquivo_tamanho: fonte.tamanho,
    texto_extraido: fonte.texto_extraido,
    ia_status: 'concluido',
    ia_lido_em: new Date().toISOString(),
    created_by: userId,
    updated_by: userId,
  }
  const { data, error } = await admin.from('convenio_documentos').insert(row).select('id').single()
  if (error) throw error

  await admin.from('convenio_pesquisa_fontes').update({ documento_id: data.id, status: 'importada' }).eq('id', fonte.id)
  return data.id as string
}

export async function aplicarSugestao(
  sugestaoId: string,
  userId: string,
  valorEditado?: Record<string, unknown>,
): Promise<AplicarSugestaoResultado> {
  const { data: sugestao, error: sugErr } = await admin.from('convenio_bc_sugestoes').select('*').eq('id', sugestaoId).maybeSingle()
  if (sugErr) return { success: false, error: sugErr.message }
  if (!sugestao) return { success: false, error: 'Sugestão não encontrada.' }
  if (sugestao.status !== 'pendente') return { success: false, error: 'Esta sugestão já foi decidida.' }

  const { data: fonte, error: fonteErr } = await admin.from('convenio_pesquisa_fontes').select('*').eq('id', sugestao.fonte_id).maybeSingle()
  if (fonteErr) return { success: false, error: fonteErr.message }
  if (!fonte) return { success: false, error: 'Fonte da sugestão não encontrada.' }

  const valorFinal: any = valorEditado && Object.keys(valorEditado).length > 0 ? { ...(sugestao.valor as any), ...valorEditado } : sugestao.valor
  const convenioId = sugestao.convenio_id as string

  try {
    let documentoId: string | null = null
    if (sugestao.secao !== 'observacao') {
      // observação não precisa da fonte importada como documento — as demais sim
      // (FAQ referencia o documento; geral/formas/públicos ficam mais rastreáveis
      // com o link "de onde veio" mesmo sem referenciar direto).
      documentoId = await importarFonteComoDocumento(fonte, userId)
    }

    if (sugestao.secao === 'geral') {
      await aplicarGeral(convenioId, sugestao.campo, valorFinal)
    } else if (sugestao.secao === 'formas') {
      await aplicarForma(convenioId, sugestao.campo, valorFinal)
    } else if (sugestao.secao === 'publicos') {
      await aplicarPublico(convenioId, sugestao.campo, valorFinal)
    } else if (sugestao.secao === 'faq') {
      await aplicarFaq(convenioId, valorFinal, documentoId, userId)
    } else if (sugestao.secao === 'observacao') {
      const docParaReferencia = await importarFonteComoDocumento(fonte, userId)
      documentoId = docParaReferencia
      await aplicarObservacao(convenioId, valorFinal, fonte)
    }

    // outras sugestões pendentes do MESMO campo (de outras fontes, ex.: dois
    // decretos com número diferente pro mesmo teto) perdem sentido — marca
    // como substituída, não como rejeitada (não foi um "não" do humano).
    await admin
      .from('convenio_bc_sugestoes')
      .update({ status: 'substituida', decidido_por: userId, decidido_em: new Date().toISOString() })
      .eq('convenio_id', convenioId)
      .eq('secao', sugestao.secao)
      .eq('campo', sugestao.campo)
      .eq('status', 'pendente')
      .neq('id', sugestaoId)

    await admin
      .from('convenio_bc_sugestoes')
      .update({
        status: valorEditado && Object.keys(valorEditado).length > 0 ? 'editada' : 'aceita',
        valor_aplicado: valorFinal,
        decidido_por: userId,
        decidido_em: new Date().toISOString(),
      })
      .eq('id', sugestaoId)

    return { success: true }
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) }
  }
}

// ---------------------------------------------------------------------------
async function aplicarGeral(convenioId: string, campo: string, valor: any) {
  const numero = Number(valor?.numero)
  if (!Number.isFinite(numero)) throw new Error('Valor numérico inválido.')

  const { data: convenioRow, error } = await admin
    .from('convenios')
    .select('max_comprometimento_salarial, prazo_minimo_geral, prazo_maximo_geral')
    .eq('id', convenioId)
    .maybeSingle()
  if (error) throw error

  if (campo === 'max_comprometimento_salarial') {
    if (numero <= 0 || numero > 100) throw new Error('Teto de comprometimento inválido (0–100%).')
    const { data: formas } = await admin.from('convenio_formas_contrato').select('percentual_margem').eq('convenio_id', convenioId)
    const soma = (formas || []).reduce((s: number, f: any) => s + (Number(f.percentual_margem) || 0), 0)
    if (soma > numero) {
      throw new Error(`A soma das margens já cadastradas (${soma.toFixed(2)}%) excede o novo teto (${numero}%) — ajuste as margens em Formas & Margens antes.`)
    }
  } else if (campo === 'prazo_minimo_geral' || campo === 'prazo_maximo_geral') {
    if (!Number.isInteger(numero) || numero <= 0) throw new Error('Prazo inválido.')
    const min = campo === 'prazo_minimo_geral' ? numero : convenioRow?.prazo_minimo_geral
    const max = campo === 'prazo_maximo_geral' ? numero : convenioRow?.prazo_maximo_geral
    if (min != null && max != null && min > max) throw new Error('O prazo mínimo geral não pode ficar maior que o máximo.')
  } else if (campo === 'numero_servidores') {
    if (numero < 0) throw new Error('Número de servidores inválido.')
  } else {
    throw new Error(`Campo geral desconhecido: ${campo}.`)
  }

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  patch[campo] = campo === 'numero_servidores' || campo === 'prazo_minimo_geral' || campo === 'prazo_maximo_geral' ? Math.round(numero) : numero
  const { error: upErr } = await admin.from('convenios').update(patch).eq('id', convenioId)
  if (upErr) throw upErr
}

async function aplicarForma(convenioId: string, campo: string, valor: any) {
  const formaId = campo.startsWith('forma:') && campo !== 'forma:?' ? campo.slice('forma:'.length) : String(valor?.forma_contrato_id || '')
  if (!formaId) throw new Error('Escolha a forma de contrato correspondente antes de aceitar esta sugestão.')
  const percentual = Number(valor?.percentual_margem)
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) throw new Error('Percentual de margem inválido.')

  // upsert — a trigger convenio_bc_valida_margens (R1) valida contra o teto do convênio.
  const { error } = await admin
    .from('convenio_formas_contrato')
    .upsert({ convenio_id: convenioId, forma_contrato_id: formaId, percentual_margem: percentual }, { onConflict: 'convenio_id,forma_contrato_id' })
  if (error) throw new Error(error.message) // mensagem da trigger já vem em PT-BR
}

async function aplicarPublico(convenioId: string, campo: string, valor: any) {
  const publicoId = campo.startsWith('publico:') && campo !== 'publico:?' ? campo.slice('publico:'.length) : String(valor?.publico_id || '')
  if (!publicoId) throw new Error('Escolha o público correspondente antes de aceitar esta sugestão.')

  const { error } = await admin.from('convenio_publicos').upsert({ convenio_id: convenioId, publico_id: publicoId }, { onConflict: 'convenio_id,publico_id', ignoreDuplicates: true })
  if (error) throw error
}

async function aplicarFaq(convenioId: string, valor: any, documentoId: string | null, userId: string) {
  const pergunta = String(valor?.pergunta || '').trim()
  const resposta = String(valor?.resposta || '').trim()
  if (!pergunta || !resposta) throw new Error('FAQ sugerida sem pergunta ou resposta.')

  const { error } = await admin.from('faq_itens').insert({
    escopo: 'convenio',
    convenio_id: convenioId,
    categoria: valor?.categoria ? String(valor.categoria).slice(0, 100) : null,
    pergunta,
    resposta,
    origem: 'ia',
    status: 'ativo',
    documento_id: documentoId,
    created_by: userId,
    updated_by: userId,
  })
  if (error) throw error
}

async function aplicarObservacao(convenioId: string, valor: any, fonte: any) {
  const texto = String(valor?.texto || '').trim()
  if (!texto) throw new Error('Observação sugerida vazia.')

  const referencia = [fonte.tipo_norma !== 'outro' ? capitalizar(fonte.tipo_norma) : null, fonte.numero ? `nº ${fonte.numero}` : null, fonte.ano || null]
    .filter(Boolean)
    .join(' ')

  const { data: atual } = await admin.from('convenios').select('bc_observacoes').eq('id', convenioId).maybeSingle()
  const bloco = referencia ? `${texto} (${referencia})` : texto
  const novoTexto = atual?.bc_observacoes ? `${atual.bc_observacoes}\n\n${bloco}` : bloco

  const { error } = await admin.from('convenios').update({ bc_observacoes: novoTexto, updated_at: new Date().toISOString() }).eq('id', convenioId)
  if (error) throw error
}

function capitalizar(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
