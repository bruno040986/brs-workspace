/**
 * Convênios do Amigoz + vínculo com o convênio BRS (`if_convenio_mapeamento`,
 * genérico por IF — Fatia 2). SÓ servidor.
 *
 * Um convênio BRS pode ter VÁRIAS variantes na IF (achado do Bruno, 15/09:
 * o Amigoz fatia "INSS" em "INSS" e "INSS - Aposentadoria por Invalidez",
 * entre outros exemplos) — cada linha desta tabela é UMA variante; a
 * unicidade é por variante (`instituicao_financeira_id, convenio_externo_id`),
 * nunca por convênio BRS. `ordem` decide em que ordem o worker tenta as
 * variantes quando o operador não sabe de antemão qual vale pra cada CPF.
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

export type VarianteConvenio = {
  id: string
  convenioId: string
  convenioExternoId: string
  convenioExternoNome: string | null
  rotulo: string | null
  averbadoraExterna: number | null
  exigeMatricula: boolean
  exigeSenhaServidor: boolean
  ordem: number
}

function mapVariante(row: Record<string, unknown>): VarianteConvenio {
  return {
    id: String(row.id),
    convenioId: String(row.convenio_id),
    convenioExternoId: String(row.convenio_externo_id),
    convenioExternoNome: row.convenio_externo_nome ? String(row.convenio_externo_nome) : null,
    rotulo: row.rotulo ? String(row.rotulo) : null,
    averbadoraExterna: row.averbadora_externa === null ? null : Number(row.averbadora_externa),
    exigeMatricula: Boolean(row.exige_matricula),
    exigeSenhaServidor: Boolean(row.exige_senha_servidor),
    ordem: Number(row.ordem) || 0,
  }
}

/** Todas as variantes já vinculadas (de todos os convênios BRS), pra tela de vínculo. */
export async function listarVariantesAmigoz(): Promise<VarianteConvenio[]> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) return []
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_convenio_mapeamento')
    .select('id, convenio_id, convenio_externo_id, convenio_externo_nome, rotulo, averbadora_externa, exige_matricula, exige_senha_servidor, ordem')
    .eq('instituicao_financeira_id', inst.id)
    .order('convenio_id', { ascending: true })
    .order('ordem', { ascending: true })
  if (error) throw error
  return (data || []).map(mapVariante)
}

/** Variantes de UM convênio BRS, na ordem de tentativa. */
export async function listarVariantesPorConvenio(convenioId: string): Promise<VarianteConvenio[]> {
  const inst = await obterInstituicaoAmigoz()
  if (!inst) return []
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('if_convenio_mapeamento')
    .select('id, convenio_id, convenio_externo_id, convenio_externo_nome, rotulo, averbadora_externa, exige_matricula, exige_senha_servidor, ordem')
    .eq('instituicao_financeira_id', inst.id)
    .eq('convenio_id', convenioId)
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(mapVariante)
}

/**
 * Vincula uma variante do Amigoz a um convênio BRS. Upsert por variante
 * (instituicao_financeira_id + convenio_externo_id) — escolher de novo um
 * convênio do Amigoz já vinculado MOVE o vínculo pro convênio BRS novo, não
 * duplica linha.
 */
export async function adicionarVarianteAmigoz(input: {
  convenioId: string
  convenioExternoId: string
  convenioExternoNome: string | null
  rotulo?: string | null
  averbadoraExterna: number | null
  exigeMatricula: boolean
  exigeSenhaServidor: boolean
  ordem?: number
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
      rotulo: input.rotulo ?? null,
      averbadora_externa: input.averbadoraExterna,
      exige_matricula: input.exigeMatricula,
      exige_senha_servidor: input.exigeSenhaServidor,
      ordem: input.ordem ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instituicao_financeira_id,convenio_externo_id' }
  )
  if (error) throw error
}

export async function atualizarVarianteAmigoz(
  varianteId: string,
  patch: { rotulo?: string | null; exigeMatricula?: boolean; exigeSenhaServidor?: boolean; ordem?: number }
): Promise<void> {
  const admin = await createAdminClient()
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.rotulo !== undefined) row.rotulo = patch.rotulo
  if (patch.exigeMatricula !== undefined) row.exige_matricula = patch.exigeMatricula
  if (patch.exigeSenhaServidor !== undefined) row.exige_senha_servidor = patch.exigeSenhaServidor
  if (patch.ordem !== undefined) row.ordem = patch.ordem
  const { error } = await admin.from('if_convenio_mapeamento').update(row).eq('id', varianteId)
  if (error) throw error
}

export async function removerVarianteAmigoz(varianteId: string): Promise<void> {
  const admin = await createAdminClient()
  const { error } = await admin.from('if_convenio_mapeamento').delete().eq('id', varianteId)
  if (error) throw error
}
