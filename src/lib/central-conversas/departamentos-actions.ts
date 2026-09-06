'use server'

/**
 * BRS Messenger — Fase A: Departamentos (paridade Digisac). Fonte da verdade
 * da FILIAÇÃO é o Chatwoot (Teams); esta tabela é o espelho que guarda o que
 * o Chatwoot não guarda (ordem, distribuição automática, "recebe grupos").
 * Regras do Messenger ≠ CRM (ver docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md
 * §0): nada aqui deriva de chat_instancias.papel/permite_grupos.
 * Permissão: `central-conversas` (configurar).
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { contaBrs, clienteChatwootBrs } from './actions'

export type DepartamentoRow = {
  id: string
  nome: string
  ordem: number
  ativo: boolean
  distribuicaoAutomatica: boolean
  ehGrupos: boolean
  chatwootTeamId: number | null
  membroIds: string[]
}

export async function listarDepartamentos(): Promise<{ success: boolean; data?: DepartamentoRow[]; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const admin = await createAdminClient()
    const conta = await contaBrs()
    if (!conta) return { success: true, data: [] }
    const [{ data: deps, error }, { data: membros }] = await Promise.all([
      admin.from('chat_departamentos').select('id, nome, ordem, ativo, distribuicao_automatica, eh_grupos, chatwoot_team_id').eq('conta_id', conta.id).order('ordem'),
      admin.from('chat_departamento_membros').select('departamento_id, user_id'),
    ])
    if (error) throw error
    const membrosPorDepto = new Map<string, string[]>()
    for (const m of membros || []) {
      const lista = membrosPorDepto.get(m.departamento_id) || []
      lista.push(m.user_id)
      membrosPorDepto.set(m.departamento_id, lista)
    }
    const data: DepartamentoRow[] = (deps || []).map((d: any) => ({
      id: String(d.id),
      nome: String(d.nome),
      ordem: Number(d.ordem) || 0,
      ativo: Boolean(d.ativo),
      distribuicaoAutomatica: Boolean(d.distribuicao_automatica),
      ehGrupos: Boolean(d.eh_grupos),
      chatwootTeamId: d.chatwoot_team_id === null ? null : Number(d.chatwoot_team_id),
      membroIds: membrosPorDepto.get(String(d.id)) || [],
    }))
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export type UsuarioParaDepartamento = { id: string; nome: string; email: string }

/** Usuários elegíveis (ativos, com permissão `conversas`) pro seletor de membros. */
export async function listarUsuariosParaDepartamento(): Promise<UsuarioParaDepartamento[]> {
  try {
    await requirePermission('central-conversas', 'can_view')
    const admin = await createAdminClient()
    const { data: usuarios } = await admin.from('users').select('id, name, nome_exibicao, email').neq('active', false).not('email', 'is', null)
    const { hasPermissionForUser } = await import('@/lib/auth/server')
    const elegiveis: UsuarioParaDepartamento[] = []
    for (const u of usuarios || []) {
      if (await hasPermissionForUser(String(u.id), 'conversas', 'can_view')) {
        elegiveis.push({ id: String(u.id), nome: String(u.nome_exibicao || u.name || u.email), email: String(u.email) })
      }
    }
    return elegiveis.sort((a, b) => a.nome.localeCompare(b.nome))
  } catch {
    return []
  }
}

export async function salvarDepartamento(input: {
  id?: string
  nome: string
  ordem: number
  ativo: boolean
  distribuicaoAutomatica: boolean
  ehGrupos: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const nome = String(input.nome || '').trim()
    if (!nome) throw new Error('Dê um nome ao departamento.')
    const admin = await createAdminClient()
    const conta = await contaBrs()
    if (!conta) throw new Error('Chatwoot não provisionado.')
    const cli = await clienteChatwootBrs()

    let chatwootTeamId: number | null = null
    if (input.id) {
      const { data: atual } = await admin.from('chat_departamentos').select('chatwoot_team_id').eq('id', input.id).maybeSingle()
      chatwootTeamId = atual?.chatwoot_team_id ?? null
    }

    if (cli) {
      if (chatwootTeamId) {
        await cli.atualizarTeam(chatwootTeamId, { nome, distribuicaoAutomatica: input.distribuicaoAutomatica })
      } else {
        const team = await cli.criarTeam({ nome, distribuicaoAutomatica: input.distribuicaoAutomatica })
        chatwootTeamId = team.id
      }
    }

    const row = {
      conta_id: conta.id,
      nome,
      ordem: Math.round(Number(input.ordem)) || 0,
      ativo: Boolean(input.ativo),
      distribuicao_automatica: Boolean(input.distribuicaoAutomatica),
      eh_grupos: Boolean(input.ehGrupos),
      chatwoot_team_id: chatwootTeamId,
      updated_at: new Date().toISOString(),
    }

    if (input.id) {
      const { error } = await admin.from('chat_departamentos').update(row).eq('id', input.id)
      if (error) throw error
    } else {
      const { error } = await admin.from('chat_departamentos').insert(row)
      // índice único (conta_id, eh_grupos) — só um departamento de grupos por conta.
      if (error) throw error.code === '23505' ? new Error('Já existe um departamento com esse nome ou já marcado como "recebe grupos".') : error
    }

    revalidatePath('/central-conversas/departamentos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setMembrosDepartamento(departamentoId: string, userIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const admin = await createAdminClient()
    const desejados = new Set(userIds)

    const [{ data: depto }, { data: atuaisRows }] = await Promise.all([
      admin.from('chat_departamentos').select('chatwoot_team_id').eq('id', departamentoId).maybeSingle(),
      admin.from('chat_departamento_membros').select('user_id').eq('departamento_id', departamentoId),
    ])
    const atuais = new Set((atuaisRows || []).map((r: any) => String(r.user_id)))
    const adicionar = [...desejados].filter((id) => !atuais.has(id))
    const remover = [...atuais].filter((id) => !desejados.has(id))

    if (adicionar.length) {
      const { error } = await admin.from('chat_departamento_membros').insert(adicionar.map((user_id) => ({ departamento_id: departamentoId, user_id })))
      if (error) throw error
    }
    if (remover.length) {
      const { error } = await admin.from('chat_departamento_membros').delete().eq('departamento_id', departamentoId).in('user_id', remover)
      if (error) throw error
    }

    // Sincroniza o Chatwoot (best-effort: resolve o agent id por e-mail).
    if (depto?.chatwoot_team_id && (adicionar.length || remover.length)) {
      try {
        const cli = await clienteChatwootBrs()
        if (cli) {
          const { data: usuarios } = await admin.from('users').select('id, email').in('id', [...adicionar, ...remover])
          const agentes = await cli.agentes()
          const agentePorEmail = new Map(agentes.map((a) => [String(a.email || '').toLowerCase(), a.id]))
          const idsCw = (uids: string[]) =>
            uids
              .map((uid) => {
                const email = (usuarios || []).find((u: any) => String(u.id) === uid)?.email
                return email ? agentePorEmail.get(String(email).toLowerCase()) : undefined
              })
              .filter((x): x is number => typeof x === 'number')
          const addCw = idsCw(adicionar)
          const remCw = idsCw(remover)
          if (addCw.length) await cli.adicionarMembrosTeam(depto.chatwoot_team_id, addCw)
          if (remCw.length) await cli.removerMembrosTeam(depto.chatwoot_team_id, remCw)
        }
      } catch (err) {
        console.error('[departamentos] sync de membros no Chatwoot falhou (segue só no espelho)', err)
      }
    }

    revalidatePath('/central-conversas/departamentos')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function setDepartamentoInstancia(instanciaId: string, departamentoId: string | null): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('central-conversas', 'can_edit')
    const admin = await createAdminClient()
    const { error } = await admin.from('chat_instancias').update({ departamento_id: departamentoId }).eq('id', instanciaId)
    if (error) throw error
    revalidatePath('/central-conversas')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
