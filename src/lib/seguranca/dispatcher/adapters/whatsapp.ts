import type { ResultadoEnvio, WhatsAppAdapter } from '../tipos.ts'

/** Assinatura mínima do cliente do engine (central-conversas/engine.ts `engine.enviar`), injetada para não acoplar testes. */
export type EnviarEngine = (instanciaId: string, destino: string, texto: string, opcoes: { operationId: string }) => Promise<unknown>

/**
 * WhatsApp via engine do CRM (mesmo cliente do Workspace: UMA tentativa de POST, operationId obrigatório).
 * Classificação por nome do erro, definida no cliente do engine:
 *  - EngineErro (rejeição comprovada: INSTANCIA_INELEGIVEL, INSTANCIA_DESCONECTADA, 4xx de contrato...) => rejeitada
 *  - EngineEnvioIncertoError (timeout, 5xx, DELIVERY_UNCERTAIN, corpo ilegível) => INCERTA: não circula pelas reservas
 *  - Error comum lançado antes da rede (validação local) => rejeitada (nada saiu)
 * 2xx só chega aqui com ok:true + id (o cliente já exige).
 */
export class EngineWhatsAppAdapter implements WhatsAppAdapter {
  private enviarEngine: EnviarEngine
  private destino: string
  private verificarDuravel: ((instanciaId: string) => Promise<boolean>) | null
  constructor(enviarEngine: EnviarEngine, destino: string, verificarDuravel: ((instanciaId: string) => Promise<boolean>) | null = null) { this.enviarEngine = enviarEngine; this.destino = destino; this.verificarDuravel = verificarDuravel }

  async enviar({ instanciaId, texto, operationId }: { instanciaId: string; texto: string; operationId: string }): Promise<ResultadoEnvio> {
    // I7: operationId só tem efeito com a conta BRS em modo durável no engine. Sem verificação positiva, nada sai (falha fechado).
    let duravel = false
    try { duravel = this.verificarDuravel ? await this.verificarDuravel(instanciaId) : false } catch { duravel = false }
    if (!duravel) return { tipo: 'rejeitada', categoria: 'engine_nao_duravel' }
    try {
      const r = (await this.enviarEngine(instanciaId, this.destino, texto, { operationId })) as { id?: string; messageId?: string } | null
      return { tipo: 'aceita', messageId: String(r?.messageId || r?.id || '') || undefined }
    } catch (e) {
      const nome = e instanceof Error ? e.name : ''
      if (nome === 'EngineEnvioIncertoError') return { tipo: 'incerta', categoria: `engine_${String((e as { motivo?: string }).motivo ?? 'incerto').replace(/[^a-z0-9_]/g, '')}` }
      // I4: conflito de conteúdo = o ledger já tem a chave (houve envio anterior): incerteza, nunca avançar de instância.
      if (nome === 'EngineErro' && (e as { codigo?: string }).codigo === 'OPERATION_CONTENT_CONFLICT') return { tipo: 'incerta', categoria: 'engine_conflito_chave' }
      if (nome === 'EngineErro') return { tipo: 'rejeitada', categoria: String((e as { codigo?: string }).codigo ?? 'engine_erro').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40), http: (e as { status?: number }).status }
      return { tipo: 'rejeitada', categoria: 'validacao_local' }
    }
  }
}
