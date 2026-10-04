// ponytail: sem pacote server-only no projeto; só importar de código de servidor.
/**
 * API de Conversões da Meta — config no cofre (`api_meta_config`, linha id=1).
 * O token só sai daqui para código de servidor; nunca para o navegador.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'
import { executarTesteMeta, validarMetaCapi, type MetaCapiInput } from './config-regras'

type Row = { token_enc: string | null; test_event_code: string | null; dataset_id: string | null; dataset_nome: string | null; updated_at: string | null }

async function lerRow(): Promise<Row | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('api_meta_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (String(error.message || '').includes('api_meta_config')) return null
    throw error
  }
  return (data as Row | null) || null
}

export type MetaCapiConfig = { token: string; testEventCode: string | null; datasetId: string; datasetNome: string | null }

/** Config descriptografada para o envio da API de Conversões; null se faltar token ou datasetId. */
export async function lerConfigMetaCapi(): Promise<MetaCapiConfig | null> {
  const row = await lerRow()
  if (!row?.token_enc || !row.dataset_id) return null
  return { token: decifrarTexto(row.token_enc), testEventCode: row.test_event_code || null, datasetId: row.dataset_id, datasetNome: row.dataset_nome || null }
}

export type MetaCapiPublica = { temToken: boolean; testEventCode: string; datasetId: string; datasetNome: string; atualizadoEm: string | null }

export async function lerMetaCapiPublica(): Promise<MetaCapiPublica> {
  const row = await lerRow()
  return { temToken: Boolean(row?.token_enc), testEventCode: row?.test_event_code || '', datasetId: row?.dataset_id || '', datasetNome: row?.dataset_nome || '', atualizadoEm: row?.updated_at || null }
}

export async function salvarMetaCapi(input: MetaCapiInput, updatedBy: string): Promise<{ ok: boolean; erro?: string }> {
  const v = validarMetaCapi(input)
  if (!v.ok) return { ok: false, erro: v.erro }
  const atual = await lerRow()
  if (!v.valor.token && !atual?.token_enc) return { ok: false, erro: 'Informe o token de acesso.' }
  const admin = await createAdminClient()
  const { error } = await admin.from('api_meta_config').upsert(
    {
      id: 1,
      token_enc: v.valor.token ? cifrarTexto(v.valor.token) : atual?.token_enc || null,
      test_event_code: v.valor.testEventCode || null,
      dataset_id: v.valor.datasetId,
      dataset_nome: v.valor.datasetNome || null,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'id' },
  )
  if (error) return { ok: false, erro: 'Erro ao gravar a configuração.' }
  return { ok: true }
}

export async function testarConexaoMeta(): Promise<{ ok: boolean; detalhe: string }> {
  const cfg = await lerConfigMetaCapi()
  if (!cfg) return { ok: false, detalhe: 'Configure o token e o ID do conjunto de dados antes de testar.' }
  return executarTesteMeta(cfg)
}
