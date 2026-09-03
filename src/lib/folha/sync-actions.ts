'use server'

/**
 * Folha — Etapa 1: sincronização de colaboradores do QuarkRH.
 * Puxa `/v1/colaboradores/` e faz UPSERT em `employees` por CPF. NUNCA
 * sobrescreve `gross_salary` (o Quark não expõe salário; é dado do Workspace)
 * nem dados bancários — só os campos que o Quark é a fonte da verdade (nome,
 * cargo, setor, vínculo, admissão, PIS, eSocial). Permissão: `rh-quark-sync`.
 */
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/server'
import { listarColaboradoresQuark } from '@/lib/quark/client'

export type SyncLogRow = {
  id: string
  total_recebidos: number
  criados: number
  atualizados: number
  ignorados: number
  erros: number
  detalhe: any
  created_at: string
}

export async function sincronizarColaboradoresQuark(): Promise<{
  success: true; criados: number; atualizados: number; ignorados: number; total: number
} | { success: false; error: string }> {
  try {
    const { user } = await requirePermission('rh-quark-sync', 'can_include')
    const admin = await createAdminClient()

    const colaboradores = await listarColaboradoresQuark()
    if (colaboradores.length === 0) {
      return { success: false, error: 'A API não retornou colaboradores (verifique o token/departamento no card QuarkRH).' }
    }

    // CPFs já existentes no Workspace
    const cpfs = colaboradores.map((c) => c.cpf).filter(Boolean)
    const { data: existentes } = await admin.from('employees').select('id, cpf').in('cpf', cpfs)
    const idPorCpf = new Map((existentes || []).map((e: any) => [String(e.cpf), String(e.id)]))

    let criados = 0
    let atualizados = 0
    let ignorados = 0
    const amostraErros: string[] = []

    for (const c of colaboradores) {
      if (!c.cpf || !c.nome) {
        ignorados++
        continue
      }
      // Campos onde o Quark é a fonte da verdade (NUNCA salário/banco/VT).
      const campos: Record<string, unknown> = {
        name: c.nome,
        cpf: c.cpf,
        job_title: c.cargo || undefined,
        department: c.setor || undefined,
        employment_type: c.vinculo || undefined,
        esocial_registration: c.esocial || undefined,
        pis: c.pis || undefined,
        admission_date: c.admissao || undefined,
      }
      // remove undefined pra não zerar o que o Quark não trouxe
      Object.keys(campos).forEach((k) => campos[k] === undefined && delete campos[k])

      try {
        const existenteId = idPorCpf.get(c.cpf)
        if (existenteId) {
          const { error } = await admin.from('employees').update(campos).eq('id', existenteId)
          if (error) throw error
          atualizados++
        } else {
          const { error } = await admin.from('employees').insert({ ...campos, status: 'active', vt_status: 'sem_informacao' })
          if (error) throw error
          criados++
        }
      } catch (err) {
        if (amostraErros.length < 10) amostraErros.push(`${c.nome}: ${err instanceof Error ? err.message : 'erro'}`)
      }
    }

    const erros = amostraErros.length
    await admin.from('folha_sync_logs').insert({
      origem: 'quark_colaboradores',
      total_recebidos: colaboradores.length,
      criados,
      atualizados,
      ignorados,
      erros,
      detalhe: { amostraErros },
      actor_id: user.id,
    })

    revalidatePath('/rh/quark-sync')
    revalidatePath('/rh/colaboradores')
    return { success: true, criados, atualizados, ignorados, total: colaboradores.length }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function listarSyncLogs(): Promise<{ success: boolean; data?: SyncLogRow[]; error?: string }> {
  try {
    await requirePermission('rh-quark-sync')
    const admin = await createAdminClient()
    const { data, error } = await admin.from('folha_sync_logs').select('*').order('created_at', { ascending: false }).limit(30)
    if (error) throw error
    return { success: true, data: (data || []) as SyncLogRow[] }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
