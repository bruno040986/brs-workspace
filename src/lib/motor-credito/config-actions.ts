'use server'

/**
 * Card "API Kaizom" (ex-"Motor de Crédito (MySQL)") em Provedores e APIs — credencial no
 * cofre AES, teste de conexão e exploração de schema (DESCRIBE + amostra),
 * pra mapear a tabela `consultas` do fornecedor antes de escrever a
 * sincronização de verdade. Permissão: `sistema-config-motor-credito`.
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { lerConsultasKaizom, type ResultadoLeitura } from './leitor'
import { createAdminClient } from '@/lib/supabase/server'
import {
  amostrarLinhasMotorCredito,
  descreverTabelaMotorCredito,
  lerMotorCreditoConfigPublica,
  salvarMotorCreditoConfig,
  testarConexaoMotorCredito,
  type ColunaDescricao,
  type MotorCreditoConfigPublica,
} from './mysql-client'

const RESOURCE = 'sistema-config-motor-credito'

export async function getMotorCreditoConfig(): Promise<{ success: boolean; data?: MotorCreditoConfigPublica; error?: string }> {
  try {
    await requirePermission(RESOURCE)
    return { success: true, data: await lerMotorCreditoConfigPublica() }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function saveMotorCreditoConfig(input: {
  host: string
  porta: number
  banco: string
  tabela: string
  usuario: string
  senha?: string
  ativo: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermission(RESOURCE, 'can_edit')
    if (!input.host.trim()) throw new Error('Informe o host.')
    if (!input.banco.trim()) throw new Error('Informe o banco.')
    if (!input.usuario.trim()) throw new Error('Informe o usuário.')
    await salvarMotorCreditoConfig({ ...input, updatedBy: user.id })
    revalidatePath('/rh/parceiros/config/provedores/motor-credito')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function testMotorCreditoConnection(): Promise<{ ok: boolean; detalhe: string }> {
  try {
    await requirePermission(RESOURCE)
    return await testarConexaoMotorCredito()
  } catch (err: any) {
    return { ok: false, detalhe: err.message }
  }
}

export type ExploracaoMotorCredito = { colunas: ColunaDescricao[]; amostra: Record<string, unknown>[] }

/** DESCRIBE + até 5 linhas — resultado vai pra tela pro Bruno me copiar (mapeamento das colunas reais). */
export async function explorarMotorCreditoSchema(): Promise<{ success: boolean; data?: ExploracaoMotorCredito; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const [colunas, amostra] = await Promise.all([descreverTabelaMotorCredito(), amostrarLinhasMotorCredito(5)])
    return { success: true, data: { colunas, amostra } }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/** D10 — "Ler agora": mesma função do cron, disparada pela tela (respeita o lease). */
export async function lerAgoraMotorCredito(): Promise<{ success: boolean; data?: ResultadoLeitura; error?: string }> {
  try {
    await requirePermission(RESOURCE, 'can_edit')
    const data = await lerConsultasKaizom()
    revalidatePath('/rh/parceiros/config/provedores/motor-credito')
    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * D10 — "Reposicionar cursor" (só root). Seguro pelo D5: reler linhas já
 * vistas não duplica nada (`mysql_id` unique + insert ignorando duplicata).
 */
export async function reposicionarCursorMotorCredito(novoCursor: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission('sistema-usuarios-root', 'can_edit')
    const valor = String(novoCursor || '').trim()
    if (!/^\d{1,18}$/.test(valor)) throw new Error('Cursor deve ser um número inteiro (id da consulta).')
    const admin = await createAdminClient()
    const { error } = await admin.from('motor_credito_mysql_config').update({ cursor_coluna: 'id', cursor_valor: valor }).eq('id', 1)
    if (error) throw error
    revalidatePath('/rh/parceiros/config/provedores/motor-credito')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
