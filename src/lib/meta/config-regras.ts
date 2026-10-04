/** Validação pura dos campos do card "API Meta" (sem imports de servidor). */
export type MetaCapiInput = { token?: string; testEventCode?: string; datasetId?: string; datasetNome?: string }

export function validarMetaCapi(i: MetaCapiInput): { ok: true; valor: Required<MetaCapiInput> } | { ok: false; erro: string } {
  const token = (i.token ?? '').trim()
  const testEventCode = (i.testEventCode ?? '').trim()
  const datasetId = (i.datasetId ?? '').trim()
  const datasetNome = (i.datasetNome ?? '').trim()
  if (token && (token.length > 600 || /\s/.test(token))) return { ok: false, erro: 'Token inválido (sem espaços ou quebras de linha, até 600 caracteres).' }
  if (testEventCode && !/^[A-Za-z0-9_-]{1,40}$/.test(testEventCode)) return { ok: false, erro: 'Código de evento de teste inválido (letras, números, _ e -, até 40).' }
  if (!/^\d{10,20}$/.test(datasetId)) return { ok: false, erro: 'ID do conjunto de dados deve ter de 10 a 20 dígitos.' }
  if (datasetNome.length > 120) return { ok: false, erro: 'Nome do conjunto de dados: até 120 caracteres.' }
  return { ok: true, valor: { token, testEventCode, datasetId, datasetNome } }
}

type CfgTeste = { token: string; testEventCode: string | null; datasetId: string }

/** Teste da API de Conversões: envia 1 PageView com test_event_code (nunca polui produção). */
export async function executarTesteMeta(cfg: CfgTeste, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detalhe: string }> {
  if (!/^\d{10,20}$/.test(cfg.datasetId)) return { ok: false, detalhe: 'ID do conjunto de dados inválido.' }
  if (!cfg.testEventCode) return { ok: false, detalhe: 'Salve um Código de Evento de Teste antes de testar.' }
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v21.0/${cfg.datasetId}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{ event_name: 'PageView', event_time: Math.floor(Date.now() / 1000), action_source: 'website', event_source_url: 'https://nuazul.com.br', user_data: { client_user_agent: 'brs-workspace-teste' } }],
        test_event_code: cfg.testEventCode,
      }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let corpo: any = null
    try { corpo = await res.json() } catch { /* corpo não é JSON */ }
    if (res.ok) {
      if (corpo?.events_received === 1) return { ok: true, detalhe: 'Evento de teste enviado — confira em Gerenciador de Eventos › Testar eventos' }
      return { ok: false, detalhe: 'A Meta respondeu sem confirmar o recebimento do evento.' }
    }
    const e = corpo?.error ?? {}
    const msg = String(e.message ?? 'sem detalhe').replaceAll(cfg.token, '[token]').slice(0, 200)
    const partes = [`${res.status}`, e.code != null ? `código ${e.code}` : '', e.error_subcode != null ? `subcódigo ${e.error_subcode}` : ''].filter(Boolean).join(', ')
    return { ok: false, detalhe: `A Meta recusou (${partes}): ${msg}${e.fbtrace_id ? ` [trace ${e.fbtrace_id}]` : ''}` }
  } catch {
    return { ok: false, detalhe: 'Sem resposta da Meta.' }
  }
}
