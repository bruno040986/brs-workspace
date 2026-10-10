/** Decisão pura do cron de conferência: 401 (conta inteira) ou N falhas seguidas interrompem o lote. */
export const MAX_FALHAS_SEGUIDAS = 3

export function deveInterromperLote(status: number, falhasSeguidas: number): boolean {
  return status === 401 || falhasSeguidas >= MAX_FALHAS_SEGUIDAS
}
