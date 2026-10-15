// Decide o aviso mostrado ao salvar um comercial (sem dependências: testável isolado).
export type DomainResult = { success: boolean; alreadyExists?: boolean; status?: number; error?: string }

export function domainWarning(slug: string | null | undefined, cardEnabled: boolean, result?: DomainResult | null): string | null {
  const s = String(slug || '').trim()
  if (!s) return null
  const host = `${s}.brspromotora.com.br`
  if (!cardEnabled) {
    return `Cartão desabilitado: o endereço ${host} não foi criado. Habilite o cartão para ativá-lo.`
  }
  if (!result || result.success) return null
  // Motivo curto: nunca repassa o corpo cru da Vercel (pode conter detalhes internos).
  const motivo = result.status ? `erro ${result.status} da Vercel` : String(result.error || 'falha desconhecida').slice(0, 80)
  return `O endereço ${host} não foi registrado na Vercel (${motivo}). Tente salvar novamente ou avise o suporte.`
}
