'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { getAlertConfig, saveAlertConfig, type AlertConfigState } from '@/lib/system-health/alert-config'

function getReadableErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export type MonitoramentoConfigView = AlertConfigState & { can_edit: boolean }

export async function getMonitoramentoConfigView(): Promise<MonitoramentoConfigView> {
  const { permissions } = await requirePermission('central-integracoes', 'can_view')
  const canEdit = permissions.some(
    (permission) => permission.resource_name === 'central-integracoes' && Boolean(permission.can_edit),
  )
  const config = await getAlertConfig()
  return { ...config, can_edit: canEdit }
}

export async function updateMonitoramentoConfig(formData: FormData) {
  await requirePermission('central-integracoes', 'can_edit')

  const id = String(formData.get('id') || '')
  const telefone = String(formData.get('telefone') || '').trim()
  const mensagemDegradado = String(formData.get('mensagem_degradado') || '').trim()
  const mensagemRecuperado = String(formData.get('mensagem_recuperado') || '').trim()

  if (telefone && !/^\d{10,13}$/.test(telefone.replace(/\D/g, ''))) {
    throw new Error('Telefone inválido — use DDI+DDD+número, só dígitos (ex.: 5511999999999).')
  }

  try {
    const result = await saveAlertConfig({
      id: id || undefined,
      telefone: telefone.replace(/\D/g, ''),
      mensagemDegradado,
      mensagemRecuperado,
    })
    revalidatePath('/central-integracoes/monitoramento')
    return { success: true, id: result.id }
  } catch (error) {
    throw new Error(getReadableErrorMessage(error, 'Não foi possível salvar a configuração de monitoramento.'))
  }
}
