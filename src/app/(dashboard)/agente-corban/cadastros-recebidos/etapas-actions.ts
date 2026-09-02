'use server'

/**
 * Cadastros Recebidos — etapas finais do pipeline (fases C–E da orientação):
 * Nuvidio (3) · ARW (4) · Contrato Assinafy (5) · Termo (6) · Boas-vindas (7)
 * + fluxo de correção via magic link. As etapas 1–2 (validação/análise) vivem
 * em ./actions.ts. Toda ação relevante gera linha em corban_onboarding_eventos.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { generateContractForPartner } from '@/lib/assinafy/generate-contract'
import {
  enviarEmailOnboarding,
  enviarWhatsAppOnboarding,
  resolverContatoParceiro,
  templateBoasVindas,
  templateContrato,
  templateCorrecao,
  templateNuvidio,
} from '@/lib/onboarding-comunicacao'

const RESOURCE = 'agente-corban-cadastros-recebidos'
const BUCKET = 'partner-analise'

/** Nome (ou trecho) do template do termo de usuário na Assinafy — ajustar
 * quando o Bruno subir o template definitivo. */
const TERMO_TEMPLATE_PADRAO = 'Termo de Usuário'

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://parceiro.brspromotora.com.br'

type Resultado = { success: true } | { success: false; error: string }

async function carregarProcessoAgente(admin: Awaited<ReturnType<typeof createAdminClient>>, processoId: string) {
  const { data: processo, error: pErr } = await admin
    .from('corban_onboarding_processos')
    .select('*')
    .eq('id', processoId)
    .single()
  if (pErr || !processo) throw pErr || new Error('Processo não encontrado.')
  const { data: agente, error: aErr } = await admin
    .from('agentes_parceiros')
    .select('id,name,cpf_cnpj,corban_data,arw_code')
    .eq('id', processo.agente_parceiro_id)
    .single()
  if (aErr || !agente) throw aErr || new Error('Agente não encontrado.')
  return { processo, agente }
}

async function registrarEvento(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  processoId: string,
  tipo: string,
  detalhe: Record<string, unknown>,
  actorId: string | null,
) {
  await admin.from('corban_onboarding_eventos').insert({ processo_id: processoId, tipo, detalhe, actor_id: actorId })
}

async function concluirEtapaGenerica(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  processo: { id: string; etapas: Record<string, any> | null },
  etapa: string,
  proxima: string,
  userId: string,
) {
  const nowIso = new Date().toISOString()
  const etapas = {
    ...(processo.etapas || {}),
    [etapa]: { ...((processo.etapas || {})[etapa] || {}), completed_at: nowIso, completed_by: userId },
  }
  const patch: Record<string, unknown> = { etapa_atual: proxima, etapas, updated_at: nowIso }
  if (proxima === 'concluido') patch.status = 'concluido'
  const { error } = await admin.from('corban_onboarding_processos').update(patch).eq('id', processo.id)
  if (error) throw error
  await registrarEvento(admin, processo.id, 'etapa_concluida', { etapa }, userId)
}

function revalidar(processoId: string) {
  revalidatePath(`/agente-corban/cadastros-recebidos/${processoId}`)
  revalidatePath('/agente-corban/cadastros-recebidos')
}

// ===========================================================================
// Etapa 3 — Nuvidio (manual v1)
// ===========================================================================

export async function salvarNuvidioLink(processoId: string, link: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    // Segurança: o link vai pra dentro de e-mail/WhatsApp — só http(s) entra.
    const limpo = String(link || '').trim()
    if (limpo && !/^https?:\/\//i.test(limpo)) throw new Error('O link da Nuvidio precisa começar com http(s)://')
    const { error } = await admin
      .from('corban_onboarding_processos')
      .update({ nuvidio_link: limpo || null, updated_at: new Date().toISOString() })
      .eq('id', processoId)
    if (error) throw error
    await registrarEvento(admin, processoId, 'nuvidio_link_salvo', {}, user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function enviarConviteNuvidio(
  processoId: string,
  canal: 'email' | 'whatsapp',
): Promise<{ success: true; detalhe: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo, agente } = await carregarProcessoAgente(admin, processoId)
    if (!processo.nuvidio_link) throw new Error('Salve o link da Nuvidio antes de enviar.')

    const contato = resolverContatoParceiro(agente.corban_data || {}, agente.name)
    const tpl = templateNuvidio(contato.nome, processo.nuvidio_link)

    let resultado: { ok: boolean; detalhe: string }
    if (canal === 'email') {
      if (!contato.email) throw new Error('Cadastro sem e-mail de contato.')
      resultado = await enviarEmailOnboarding({ to: contato.email, subject: tpl.assunto, html: tpl.html })
    } else {
      if (!contato.telefone) throw new Error('Cadastro sem telefone/WhatsApp de contato.')
      resultado = await enviarWhatsAppOnboarding({ phone: contato.telefone, texto: tpl.texto, partnerId: agente.id })
    }
    await registrarEvento(admin, processoId, 'nuvidio_convite_enviado', { canal, ok: resultado.ok, detalhe: resultado.detalhe }, user.id)
    if (!resultado.ok) return { success: false, error: resultado.detalhe }
    revalidar(processoId)
    return { success: true, detalhe: resultado.detalhe }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function concluirEtapaNuvidio(processoId: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'nuvidio') throw new Error('O processo não está na etapa Nuvidio.')
    if (!processo.nuvidio_video_url) throw new Error('Envie o vídeo da validação Nuvidio antes de concluir.')
    await concluirEtapaGenerica(admin, processo, 'nuvidio', 'arw', user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ===========================================================================
// Etapa 4 — Cadastro no ARW (copiar/colar) + retorno na aba Acesso
// ===========================================================================

export async function salvarRetornoArw(
  processoId: string,
  retorno: { arw_code?: string; tipo_agente?: string; gerente_id?: string; nivel_acesso?: string },
): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo } = await carregarProcessoAgente(admin, processoId)

    // Grava nos campos JÁ EXISTENTES do agente (mesmos da aba Acesso do
    // editor) — a senha ARW continua sendo colada no editor, com a
    // sincronização de Auth que já existe lá (não duplicamos aquele fluxo).
    const patch: Record<string, unknown> = {}
    if (retorno.arw_code !== undefined) patch.arw_code = String(retorno.arw_code || '').trim() || null
    if (retorno.tipo_agente !== undefined) patch.tipo_agente = String(retorno.tipo_agente || '').trim() || null
    if (retorno.gerente_id !== undefined) patch.gerente_id = retorno.gerente_id || null
    if (retorno.nivel_acesso !== undefined) patch.nivel_acesso = String(retorno.nivel_acesso || '').trim() || null
    if (Object.keys(patch).length === 0) throw new Error('Nada para salvar.')

    const { error } = await admin.from('agentes_parceiros').update(patch).eq('id', processo.agente_parceiro_id)
    if (error) throw error
    await registrarEvento(admin, processoId, 'arw_retorno_salvo', { campos: Object.keys(patch) }, user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function concluirEtapaArw(processoId: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo, agente } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'arw') throw new Error('O processo não está na etapa ARW.')
    if (!String(agente.arw_code || '').trim()) throw new Error('Informe o código ARW do parceiro antes de concluir.')
    await concluirEtapaGenerica(admin, processo, 'arw', 'contrato', user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ===========================================================================
// Etapa 5 — Contrato (Assinafy)
// ===========================================================================

export async function prepararEnviarContrato(
  processoId: string,
): Promise<{ success: true; detalhe: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo, agente } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'contrato') throw new Error('O processo não está na etapa Contrato.')

    const resultado = await generateContractForPartner({ partnerId: agente.id })
    if (!resultado.ok || !resultado.documentId) {
      throw new Error(resultado.error || 'A Assinafy não devolveu o documento do contrato.')
    }

    const links = (resultado.signingUrls || []).map((s) => s.url).filter(Boolean)
    const contato = resolverContatoParceiro(agente.corban_data || {}, agente.name)

    const avisos: string[] = []
    if (links.length) {
      const tpl = templateContrato(contato.nome, links)
      if (contato.email) {
        const r = await enviarEmailOnboarding({ to: contato.email, subject: tpl.assunto, html: tpl.html })
        if (!r.ok) avisos.push(`e-mail: ${r.detalhe}`)
      }
      if (contato.telefone) {
        const r = await enviarWhatsAppOnboarding({ phone: contato.telefone, texto: tpl.texto, partnerId: agente.id })
        if (!r.ok) avisos.push(`WhatsApp: ${r.detalhe}`)
      }
    } else {
      avisos.push('Assinafy não devolveu links de assinatura — os signatários assinam pelos e-mails da própria Assinafy.')
    }

    const { error } = await admin
      .from('corban_onboarding_processos')
      .update({
        contrato_assinafy_document_id: resultado.documentId,
        contrato_status: 'enviado',
        termo_status: 'pendente_contrato',
        updated_at: new Date().toISOString(),
      })
      .eq('id', processoId)
    if (error) throw error

    await registrarEvento(admin, processoId, 'contrato_enviado', { document_id: resultado.documentId, links: links.length, avisos }, user.id)
    revalidar(processoId)
    return { success: true, detalhe: avisos.length ? `Contrato enviado com avisos: ${avisos.join(' · ')}` : 'Contrato preparado e enviado.' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** Marca assinado manualmente (fallback quando o webhook não chegar). */
export async function marcarDocumentoAssinado(processoId: string, tipo: 'contrato' | 'termo'): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const patch =
      tipo === 'contrato'
        ? { contrato_status: 'assinado', updated_at: new Date().toISOString() }
        : { termo_status: 'assinado', updated_at: new Date().toISOString() }
    const { error } = await admin.from('corban_onboarding_processos').update(patch).eq('id', processoId)
    if (error) throw error
    await registrarEvento(admin, processoId, `${tipo}_assinado_manual`, {}, user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function concluirEtapaContrato(processoId: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'contrato') throw new Error('O processo não está na etapa Contrato.')
    if (processo.contrato_status !== 'assinado') throw new Error('O contrato ainda não consta como assinado.')
    await concluirEtapaGenerica(admin, processo, 'contrato', 'termo', user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ===========================================================================
// Etapa 6 — Termo de usuário (Assinafy, template próprio)
// ===========================================================================

export async function prepararEnviarTermo(
  processoId: string,
  templateName?: string,
): Promise<{ success: true; detalhe: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo, agente } = await carregarProcessoAgente(admin, processoId)
    if (processo.contrato_status !== 'assinado') throw new Error('O termo só é disparado depois do contrato assinado.')

    const resultado = await generateContractForPartner({
      partnerId: agente.id,
      templateName: String(templateName || '').trim() || TERMO_TEMPLATE_PADRAO,
    })
    if (!resultado.ok || !resultado.documentId) {
      throw new Error(resultado.error || 'A Assinafy não devolveu o documento do termo.')
    }

    const { error } = await admin
      .from('corban_onboarding_processos')
      .update({ termo_assinafy_document_id: resultado.documentId, termo_status: 'enviado', updated_at: new Date().toISOString() })
      .eq('id', processoId)
    if (error) throw error
    await registrarEvento(admin, processoId, 'termo_enviado', { document_id: resultado.documentId }, user.id)
    revalidar(processoId)
    return { success: true, detalhe: 'Termo preparado e enviado para assinatura.' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function concluirEtapaTermo(processoId: string): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'termo') throw new Error('O processo não está na etapa Termo.')
    if (processo.termo_status !== 'assinado') throw new Error('O termo ainda não consta como assinado.')
    await concluirEtapaGenerica(admin, processo, 'termo', 'boas_vindas', user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ===========================================================================
// Etapa 7 — Boas-vindas (validação final + disparo + conclusão)
// ===========================================================================

export async function uploadPdfAssinado(
  processoId: string,
  tipo: 'contrato' | 'termo',
  formData: FormData,
): Promise<Resultado> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_include')
    const admin = await createAdminClient()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('Nenhum arquivo enviado.')
    const path = `${processoId}/assinados/${tipo}-${Date.now()}.pdf`
    const bytes = await file.arrayBuffer()
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: false })
    if (upErr) throw upErr
    const coluna = tipo === 'contrato' ? 'contrato_pdf_assinado_url' : 'termo_pdf_assinado_url'
    const { error } = await admin
      .from('corban_onboarding_processos')
      .update({ [coluna]: path, updated_at: new Date().toISOString() })
      .eq('id', processoId)
    if (error) throw error
    await registrarEvento(admin, processoId, 'pdf_assinado_salvo', { tipo, path }, user.id)
    revalidar(processoId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function aprovarBoasVindas(
  processoId: string,
): Promise<{ success: true; detalhe: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { processo, agente } = await carregarProcessoAgente(admin, processoId)
    if (processo.etapa_atual !== 'boas_vindas') throw new Error('O processo não está na etapa Boas-vindas.')

    const contato = resolverContatoParceiro(agente.corban_data || {}, agente.name)
    const tpl = templateBoasVindas(contato.nome, agente.arw_code)

    const avisos: string[] = []
    if (contato.email) {
      const r = await enviarEmailOnboarding({ to: contato.email, subject: tpl.assunto, html: tpl.html })
      if (!r.ok) avisos.push(`e-mail: ${r.detalhe}`)
    } else {
      avisos.push('cadastro sem e-mail — boas-vindas por e-mail não enviadas')
    }
    if (contato.telefone) {
      const r = await enviarWhatsAppOnboarding({ phone: contato.telefone, texto: tpl.texto, partnerId: agente.id })
      if (!r.ok) avisos.push(`WhatsApp: ${r.detalhe}`)
    }

    await registrarEvento(admin, processoId, 'boas_vindas_enviadas', { avisos }, user.id)
    await concluirEtapaGenerica(admin, processo, 'boas_vindas', 'concluido', user.id)
    revalidar(processoId)
    return { success: true, detalhe: avisos.length ? `Concluído com avisos: ${avisos.join(' · ')}` : 'Boas-vindas enviadas e processo concluído! 🎉' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ===========================================================================
// Fase E — Correção via magic link
// ===========================================================================

export async function solicitarCorrecao(
  processoId: string,
): Promise<{ success: true; detalhe: string; link: string } | { success: false; error: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    const admin = await createAdminClient()
    const { agente } = await carregarProcessoAgente(admin, processoId)

    const { data: reprovados, error: rErr } = await admin
      .from('corban_onboarding_itens')
      .select('id,rotulo,instrucoes_correcao')
      .eq('processo_id', processoId)
      .eq('status', 'reprovado')
    if (rErr) throw rErr
    if (!reprovados || reprovados.length === 0) throw new Error('Nenhum item reprovado para corrigir.')

    const { data: rpc, error: rpcErr } = await admin.rpc('corban_onboarding_criar_correcao', {
      p_processo_id: processoId,
      p_item_ids: reprovados.map((i: any) => i.id),
      p_created_by: user.id,
    })
    if (rpcErr) throw rpcErr
    const token = String((rpc as any)?.token || '')
    if (!token) throw new Error('A criação da correção não devolveu o token.')

    const link = `${PORTAL_URL}/correcao/${token}`
    const contato = resolverContatoParceiro(agente.corban_data || {}, agente.name)
    const itensTpl = reprovados.map((i: any) => ({ rotulo: String(i.rotulo), instrucoes: String(i.instrucoes_correcao || 'Reenvie corrigido.') }))
    const tpl = templateCorrecao(contato.nome, link, itensTpl)

    const avisos: string[] = []
    if (contato.email) {
      const r = await enviarEmailOnboarding({ to: contato.email, subject: tpl.assunto, html: tpl.html })
      if (!r.ok) avisos.push(`e-mail: ${r.detalhe}`)
    } else {
      avisos.push('cadastro sem e-mail')
    }
    if (contato.telefone) {
      const r = await enviarWhatsAppOnboarding({ phone: contato.telefone, texto: tpl.texto, partnerId: agente.id })
      if (!r.ok) avisos.push(`WhatsApp: ${r.detalhe}`)
    }

    const correcaoId = String((rpc as any)?.correcao_id || '')
    if (correcaoId) {
      await admin
        .from('corban_onboarding_correcoes')
        .update({ status: 'enviada', enviada_em: new Date().toISOString(), envio: { avisos } })
        .eq('id', correcaoId)
    }
    await registrarEvento(admin, processoId, 'correcao_enviada', { itens: reprovados.length, avisos }, user.id)
    revalidar(processoId)
    return {
      success: true,
      link,
      detalhe: avisos.length ? `Correção criada com avisos: ${avisos.join(' · ')}` : `Correção enviada (${reprovados.length} itens).`,
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
