/**
 * Convênios do Amigoz + mapeamento com o convênio BRS (`if_convenio_mapeamento`,
 * genérico por IF — Fatia 2). SÓ servidor.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { chamarAmigozAutenticado, obterInstituicaoAmigoz, type ConfigAmigoz } from './client'

export type ConvenioAmigoz = {
  id: string
  nome: string
  averbadora: number | null
  senhaServidor: boolean
  matriculaObrigatoria: boolean
  produtos: Array<{ codigoProduto: number; tipoMargem: number }>
}

/** Esconde os convênios de teste do Amigoz ("SIMULAÇÃO_..._NÃO DIGITAR"). */
function ehConvenioSimulacao(nome: string): boolean {
  return /simula[cç][aã]o/i.test(nome) || /n[aã]o\s*digitar/i.test(nome)
}

let cacheConvenios: { expiraEm: number; dados: ConvenioAmigoz[] } | null = null
const TTL_CACHE_MS = 60 * 60_000 // 1h

/** Lista os convênios do corban no Amigoz (cache 1h em memória do processo). */
export async function listarConveniosAmigoz(cfg: ConfigAmigoz, criadoPor?: string | null, forcar = false): Promise<ConvenioAmigoz[]> {
  if (!forcar && cacheConvenios && cacheConvenios.expiraEm > Date.now()) return cacheConvenios.dados

  const r = await chamarAmigozAutenticado(cfg, 'convenios', 'GET', '/api/cliente/convenios', undefined, criadoPor)
  if (!r.ok || !Array.isArray(r.corpo)) {
    throw new Error('Não foi possível listar os convênios do Amigoz (ver Descoberta na config da IF).')
  }

  const dados: ConvenioAmigoz[] = (r.corpo as Array<Record<string, unknown>>)
    .filter((c) => typeof c.nome === 'string' && !ehConvenioSimulacao(c.nome))
    .map((c) => ({
      id: String(c.id ?? ''),
      nome: String(c.nome ?? ''),
      averbadora: c.averbadora === null || c.averbadora === undefined ? null : Number(c.averbadora),
      senhaServidor: c.senha_servidor === true,
      matriculaObrigatoria: c.matricula_obrigatoria === true,
      produtos: Array.isArray(c.produtos)
        ? (c.produtos as Array<Record<string, unknown>>).map((p) => ({
            codigoProduto: Number(p.codigo_produto),
            tipoMargem: Number(p.tipo_margem),
          }))
        : [],
    }))
    .filter((c) => c.id)

  cacheConvenios = { expiraEm: Date.now() + TTL_CACHE_MS, dados }
  return dados
}

export type MapeamentoConvenio = {
  convenioId: string
  convenioExternoId: string
  convenioExternoNome: string | null
  averbadoraExterna: number | null
  exigeMatricula: boolean
  exigeSenhaServidor: boolean
}

/** Todos os vínculos convênio BRS ↔ convênio Amigoz já salvos. */
export async function listarMapeamentosAmigoz(): Promise<MapeamentoConvenio[]> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) return []
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_convenio_mapeamento')
    .select('convenio_id, convenio_externo_id, convenio_externo_nome, averbadora_externa, exige_matricula, exige_senha_servidor')
    .eq('instituicao_financeira_id', inst.id)
  if (error) throw error
  return (data || []).map((r) => ({
    convenioId: String(r.convenio_id),
    convenioExternoId: String(r.convenio_externo_id),
    convenioExternoNome: r.convenio_externo_nome ? String(r.convenio_externo_nome) : null,
    averbadoraExterna: r.averbadora_externa === null ? null : Number(r.averbadora_externa),
    exigeMatricula: Boolean(r.exige_matricula),
    exigeSenhaServidor: Boolean(r.exige_senha_servidor),
  }))
}

export async function obterMapeamentoAmigoz(convenioId: string): Promise<MapeamentoConvenio | null> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) return null
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_convenio_mapeamento')
    .select('convenio_id, convenio_externo_id, convenio_externo_nome, averbadora_externa, exige_matricula, exige_senha_servidor')
    .eq('instituicao_financeira_id', inst.id)
    .eq('convenio_id', convenioId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    convenioId: String(data.convenio_id),
    convenioExternoId: String(data.convenio_externo_id),
    convenioExternoNome: data.convenio_externo_nome ? String(data.convenio_externo_nome) : null,
    averbadoraExterna: data.averbadora_externa === null ? null : Number(data.averbadora_externa),
    exigeMatricula: Boolean(data.exige_matricula),
    exigeSenhaServidor: Boolean(data.exige_senha_servidor),
  }
}

export async function salvarMapeamentoAmigoz(input: {
  convenioId: string
  convenioExternoId: string
  convenioExternoNome: string | null
  averbadoraExterna: number | null
  exigeMatricula: boolean
  exigeSenhaServidor: boolean
}): Promise<void> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) throw new Error('Amigoz não está cadastrada em Instituições Financeiras.')
  const admin = await createAdminClient()
  const { error } = await admin.from('if_convenio_mapeamento').upsert(
    {
      instituicao_financeira_id: inst.id,
      convenio_id: input.convenioId,
      convenio_externo_id: input.convenioExternoId,
      convenio_externo_nome: input.convenioExternoNome,
      averbadora_externa: input.averbadoraExterna,
      exige_matricula: input.exigeMatricula,
      exige_senha_servidor: input.exigeSenhaServidor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instituicao_financeira_id,convenio_id' }
  )
  if (error) throw error
}
