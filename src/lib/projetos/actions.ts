'use server'

/**
 * Projetos — server actions da tela /projetos (autor = usuário logado).
 * Permissão `projetos`: can_view lê, can_include cria, can_edit altera.
 * A lógica fica em ./service (compartilhada com a rota MCP das IAs).
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import * as svc from './service'
import { codigoProjeto, parseCodigoProjeto } from './puro'
import type {
  ActionResult,
  Agente,
  Mensagem,
  ProjetoDetalhe,
  ProjetoResumo,
  ProjetoStatus,
  TarefaPrioridade,
  TarefaStatus,
} from './tipos'

function falha(err: unknown, padrao: string): { success: false; error: string } {
  if (err instanceof Error) return { success: false, error: err.message }
  const msg = (err as { message?: unknown } | null)?.message
  return { success: false, error: typeof msg === 'string' && msg ? msg : padrao }
}

function revalidar(codigo?: string) {
  revalidatePath('/projetos')
  const n = parseCodigoProjeto(codigo)
  if (n) revalidatePath(`/projetos/${codigoProjeto(n)}`)
}

export async function listarProjetos(): Promise<ActionResult<ProjetoResumo[]>> {
  try {
    await requirePermission('projetos', 'can_view')
    return { success: true, data: await svc.listarProjetos(await createAdminClient()) }
  } catch (err) {
    return falha(err, 'Erro ao listar projetos.')
  }
}

export async function listarAgentes(): Promise<ActionResult<Agente[]>> {
  try {
    await requirePermission('projetos', 'can_view')
    return { success: true, data: await svc.listarAgentes(await createAdminClient()) }
  } catch (err) {
    return falha(err, 'Erro ao listar IAs.')
  }
}

export async function criarProjeto(input: {
  titulo: string
  objetivo: string
  ideiaPrincipal: string
  redatorAgenteId: string | null
  participanteIds: string[]
  iniciar: boolean
}): Promise<ActionResult<{ codigo: string }>> {
  try {
    const { user } = await requirePermission('projetos', 'can_include')
    const r = await svc.criarProjeto(await createAdminClient(), user.id, input)
    revalidar(r.codigo)
    return { success: true, data: r }
  } catch (err) {
    return falha(err, 'Erro ao criar projeto.')
  }
}

export async function lerProjeto(codigo: string): Promise<ActionResult<ProjetoDetalhe>> {
  try {
    await requirePermission('projetos', 'can_view')
    return { success: true, data: await svc.lerProjeto(await createAdminClient(), codigo) }
  } catch (err) {
    return falha(err, 'Erro ao ler projeto.')
  }
}

export async function atualizarProjeto(
  codigo: string,
  input: { titulo?: string; objetivo?: string; ideiaPrincipal?: string; redatorAgenteId?: string | null; participanteIds?: string[] },
): Promise<ActionResult> {
  try {
    await requirePermission('projetos', 'can_edit')
    await svc.atualizarProjeto(await createAdminClient(), codigo, input)
    revalidar(codigo)
    return { success: true, data: undefined }
  } catch (err) {
    return falha(err, 'Erro ao atualizar projeto.')
  }
}

export async function atualizarProjetoStatus(codigo: string, status: ProjetoStatus): Promise<ActionResult> {
  try {
    const { user } = await requirePermission('projetos', 'can_edit')
    await svc.mudarStatusProjeto(await createAdminClient(), codigo, status, { usuarioId: user.id })
    revalidar(codigo)
    return { success: true, data: undefined }
  } catch (err) {
    return falha(err, 'Erro ao mudar o status.')
  }
}

export async function enviarMensagem(input: {
  codigo: string
  tarefaNumero?: number | null
  tipo: 'mensagem' | 'decisao'
  conteudo: string
}): Promise<ActionResult> {
  try {
    const { user } = await requirePermission('projetos', 'can_include')
    if (input.tipo !== 'mensagem' && input.tipo !== 'decisao') throw new Error('Tipo de mensagem inválido.')
    await svc.registrarMensagem(await createAdminClient(), input, { usuarioId: user.id })
    revalidar(input.codigo)
    return { success: true, data: undefined }
  } catch (err) {
    return falha(err, 'Erro ao enviar mensagem.')
  }
}

/** Chat do projeto. Sem revalidatePath: a tela busca o chat por polling. */
export async function enviarChat(input: { codigo: string; conteudo: string }): Promise<ActionResult> {
  try {
    const { user } = await requirePermission('projetos', 'can_include')
    await svc.enviarChat(await createAdminClient(), { usuarioId: user.id }, input)
    return { success: true, data: undefined }
  } catch (err) {
    return falha(err, 'Erro ao enviar mensagem no chat.')
  }
}

export async function ouvirChat(input: {
  codigo: string
  desde?: string | null
  limite?: number
}): Promise<ActionResult<{ mensagens: Mensagem[]; cursor: string | null }>> {
  try {
    await requirePermission('projetos', 'can_view')
    return { success: true, data: await svc.ouvirChat(await createAdminClient(), input) }
  } catch (err) {
    return falha(err, 'Erro ao carregar o chat.')
  }
}

export async function criarTarefa(input: {
  codigo: string
  titulo: string
  descricao?: string
  responsavelAgenteId?: string | null
  prioridade?: TarefaPrioridade
  prazo?: string | null
}): Promise<ActionResult<{ numero: number }>> {
  try {
    const { user } = await requirePermission('projetos', 'can_include')
    const r = await svc.criarTarefa(await createAdminClient(), input, { usuarioId: user.id })
    revalidar(input.codigo)
    return { success: true, data: { numero: r.numero } }
  } catch (err) {
    return falha(err, 'Erro ao criar tarefa.')
  }
}

export async function atualizarTarefa(input: {
  codigo: string
  numero: number
  status?: TarefaStatus
  responsavelAgenteId?: string | null
  titulo?: string
  descricao?: string
  prioridade?: TarefaPrioridade
  prazo?: string | null
}): Promise<ActionResult> {
  try {
    const { user } = await requirePermission('projetos', 'can_edit')
    await svc.atualizarTarefa(await createAdminClient(), input, { usuarioId: user.id })
    revalidar(input.codigo)
    return { success: true, data: undefined }
  } catch (err) {
    return falha(err, 'Erro ao atualizar tarefa.')
  }
}

/** Gera (ou troca) o token MCP da IA e devolve a URL completa para colar no conector. */
export async function gerarTokenAgente(agenteId: string): Promise<ActionResult<{ url: string }>> {
  try {
    await requirePermission('projetos', 'can_delete')
    const token = await svc.gerarTokenAgente(await createAdminClient(), agenteId)
    const base = String(process.env.NEXT_PUBLIC_APP_URL || 'https://workspace.brspromotora.com.br').replace(/\/+$/, '')
    revalidatePath('/projetos')
    return { success: true, data: { url: `${base}/api/projetos/mcp/${token}` } }
  } catch (err) {
    return falha(err, 'Erro ao gerar token.')
  }
}
