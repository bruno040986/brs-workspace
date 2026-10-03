import type { EngineJob } from '@/lib/scp-engine/decisions'
import type { ResultadoEnvio } from './whatsapp'

// Imports pesados (engine, next/og, WeSales) ficam dinâmicos: handlers.ts carrega este módulo sempre.

const SEM_WHATSAPP = /sem_whatsapp|not.?on.?whatsapp/i

/**
 * Traduz o resultado do envio para o contrato do motor: confirmado = conclui;
 * rejeição definitiva (número sem WhatsApp) = conclui sem retentar; o resto lança
 * (o motor reagenda e a MESMA chave reaproveita o operation_id).
 */
function concluirOuLancar(r: ResultadoEnvio): 'enviado' | 'descartado' {
  if (r.resultado === 'confirmado') return 'enviado'
  if (r.resultado === 'rejeitado' && SEM_WHATSAPP.test(r.mensagem)) return 'descartado'
  throw new Error(`envio ${r.resultado}: ${r.mensagem}`.slice(0, 200))
}

async function handleWesalesSync(job: EngineJob): Promise<void> {
  const inscricaoId = String(job.payload?.inscricaoId || '')
  if (!inscricaoId) throw new Error('promocoes.wesales_sync sem inscricaoId')
  const { sincronizarInscricaoWesales } = await import('./wesales-sync')
  const r = await sincronizarInscricaoWesales(inscricaoId)
  if (r.status === 'erro') throw new Error(r.erro || 'falha no sync WeSales')
}

async function handleEnviarLinkNumeros(job: EngineJob): Promise<void> {
  const { handleEnviarLinkNumeros: h } = await import('./jobs-geracao')
  await h(job)
}

async function handleEnviarComprovante(job: EngineJob): Promise<void> {
  const tipo = String(job.payload?.tipo || '')
  const id = String(job.payload?.id || '')
  const n = Number(job.payload?.n || 1)
  if (!id) throw new Error('promocoes.enviar_comprovante sem id')

  if (tipo === 'indicacao') {
    const { enviarComprovanteIndicacao } = await import('./comprovante-envio')
    concluirOuLancar(await enviarComprovanteIndicacao(id, n))
    return
  }
  if (tipo !== 'numeros') throw new Error(`tipo de comprovante desconhecido: ${tipo}`)
  const { handleEnviarComprovanteNumeros: h } = await import('./jobs-geracao')
  await h(job)
}

async function handleRecalcularDireitos(job: EngineJob): Promise<void> {
  const inscricaoId = String(job.payload?.inscricaoId || '')
  if (!inscricaoId) throw new Error('promocoes.recalcular_direitos sem inscricaoId')
  const { recalcularDireitos } = await import('./direitos-service')
  await recalcularDireitos(inscricaoId)
}

async function handleAvisoPagamento(job: EngineJob): Promise<void> {
  const { handleAvisoPagamento: h } = await import('./jobs-remessa')
  await h(job)
}

export function registrarHandlersPromocao(deps: { registerHandler: (kind: string, fn: (job: EngineJob) => Promise<void>) => void }): void {
  deps.registerHandler('promocoes.wesales_sync', handleWesalesSync)
  deps.registerHandler('promocoes.enviar_link_numeros', handleEnviarLinkNumeros)
  deps.registerHandler('promocoes.enviar_comprovante', handleEnviarComprovante)
  deps.registerHandler('promocoes.aviso_pagamento', handleAvisoPagamento)
  deps.registerHandler('promocoes.recalcular_direitos', handleRecalcularDireitos)
}
