'use server'

/**
 * Sorteio (frente C): apura pela Loteria Federal com aproximação circular,
 * mostra a cadeia de tentativas e grava auditoria. Nunca devolve CPF completo.
 */
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import type { PermissionAction } from '@/lib/auth/permissions'
import { apurarContemplado, parseNumeroLoteria } from './sorteio'
import { mascararCpf, mascararTelefone } from './mascara'
import { titularesDosNumeros } from './direitos-service'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CH = 'comercial-promocoes'
const SERIE = 100000
const msg = (e: unknown) => (e instanceof Error ? e.message : (e as any)?.message || String(e))

type Tentativa = { numero: string; direcao: 'exato' | 'superior' | 'inferior'; distancia: number; situacao: 'nao_distribuido' | 'bloqueado' | 'desconsiderado' | 'contemplado' }
type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }

async function ctx(slug: string, acao: PermissionAction = 'can_view') {
  const { user } = await requirePermission(CH, acao)
  const db: any = await createAdminClient()
  const { data: camp } = await db.from('promocao_campanhas').select('*').eq('slug', slug).maybeSingle()
  if (!camp) throw new Error('Campanha não encontrada.')
  return { db, camp, userId: user.id as string }
}

async function montarView(db: any, s: any) {
  if (!s) return null
  let ganhador: any = null
  if (s.numero_id) {
    const { data: n } = await db.from('promocao_numeros').select('id, numero, titular_tipo, titular_id').eq('id', s.numero_id).maybeSingle()
    if (n) {
      const t = (await titularesDosNumeros(db, [n])).get(`${n.titular_tipo}:${n.titular_id}`)
      const tabela = n.titular_tipo === 'inscricao' ? 'promocao_inscricoes' : 'promocao_indicadores'
      const { data: ct } = await db.from(tabela).select('telefone').eq('id', n.titular_id).maybeSingle()
      ganhador = { nome: t?.nome, cpf: t ? mascararCpf(t.cpf) : '', telefone: ct ? mascararTelefone(ct.telefone) : '', tipo: n.titular_tipo }
    }
  }
  const { data: ev } = await db.from('promocao_eventos').select('dados, created_at, tipo').eq('entidade', 'sorteio').eq('entidade_id', s.id).order('created_at', { ascending: false }).limit(20)
  const cadeia = (ev || []).find((e: any) => e.tipo === 'sorteio.apurado')?.dados?.cadeia || []
  return {
    id: s.id,
    status: s.status,
    dataExtracao: s.data_extracao,
    numeroExtraido: s.numero_extraido,
    contemplado: s.numero_contemplado === null ? null : String(s.numero_contemplado).padStart(5, '0'),
    distancia: s.distancia,
    direcao: s.direcao,
    ganhador,
    cadeia: cadeia as Tentativa[],
    historico: (ev || []).map((e: any) => ({ tipo: e.tipo, em: e.created_at })),
  }
}

export async function getSorteio(slug: string): Promise<R<{ sorteio: any; dataSorteio: string }>> {
  try {
    const { db, camp } = await ctx(slug)
    const { data: s } = await db.from('promocao_sorteios').select('*').eq('campanha_id', camp.id).maybeSingle()
    return { ok: true, sorteio: await montarView(db, s), dataSorteio: camp.data_sorteio }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function apurarSorteio(slug: string, textoNumero: string, dataExtracao: string): Promise<R<{ sorteio: any }>> {
  try {
    const { db, camp, userId } = await ctx(slug, 'can_edit')
    const n = parseNumeroLoteria(textoNumero)
    if (n === null) throw new Error('Número da Loteria Federal inválido (5 algarismos do 1º prêmio).')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataExtracao)) throw new Error('Informe a data da extração.')
    const { data: atual } = await db.from('promocao_sorteios').select('id, status').eq('campanha_id', camp.id).maybeSingle()
    if (atual?.status === 'validado') throw new Error('Sorteio já validado. Anule-o antes de apurar de novo.')

    const { data: todos } = await db.from('promocao_numeros').select('id, numero, status, titular_tipo, titular_id, inscricao_id').eq('campanha_id', camp.id)
    const { data: bloq } = await db.from('promocao_cpfs_bloqueados').select('cpf').or(`campanha_id.is.null,campanha_id.eq.${camp.id}`)
    const bloqueados = new Set((bloq || []).map((b: any) => b.cpf))
    const { data: canc } = await db.from('promocao_inscricoes').select('id').eq('campanha_id', camp.id).eq('status', 'cancelada')
    const canceladas = new Set((canc || []).map((c: any) => c.id))
    const tit = await titularesDosNumeros(db, todos || [])

    const porNumero = new Map<number, { id: string; motivo: 'ok' | 'desconsiderado' | 'bloqueado' }>()
    for (const x of todos || []) {
      const t = tit.get(`${x.titular_tipo}:${x.titular_id}`)
      const motivo = x.status !== 'valido' ? 'desconsiderado' : !t || bloqueados.has(t.cpf) || canceladas.has(x.inscricao_id) ? 'bloqueado' : 'ok'
      porNumero.set(x.numero, { id: x.id, motivo })
    }
    const validos = new Set<number>([...porNumero].filter(([, v]) => v.motivo === 'ok').map(([k]) => k))
    const r = apurarContemplado(n, validos, SERIE)

    const cadeia: Tentativa[] = []
    const lim = r ? r.distancia : Math.floor(SERIE / 2)
    const situ = (num: number): Tentativa['situacao'] => {
      const v = porNumero.get(num)
      return !v ? 'nao_distribuido' : v.motivo === 'ok' ? 'contemplado' : v.motivo
    }
    for (let d = 0; d <= lim && cadeia.length < 400; d++) {
      const sup = (n + d) % SERIE
      cadeia.push({ numero: String(sup).padStart(5, '0'), direcao: d === 0 ? 'exato' : 'superior', distancia: d, situacao: situ(sup) })
      if (d > 0) {
        const inf = (n - d + SERIE) % SERIE
        if (!(r && d === r.distancia && r.direcao === 'superior')) cadeia.push({ numero: String(inf).padStart(5, '0'), direcao: 'inferior', distancia: d, situacao: situ(inf) })
      }
    }

    const row = {
      campanha_id: camp.id,
      data_extracao: dataExtracao,
      numero_extraido: String(n).padStart(5, '0'),
      numero_contemplado: r ? r.numero : null,
      distancia: r ? r.distancia : null,
      direcao: r ? r.direcao : null,
      numero_id: r ? porNumero.get(r.numero)!.id : null,
      status: 'apurado',
      apurado_por: userId,
      apurado_em: new Date().toISOString(),
      validado_por: null,
      validado_em: null,
    }
    const { data: s, error } = await db.from('promocao_sorteios').upsert(row, { onConflict: 'campanha_id' }).select('*').single()
    if (error) throw error
    await db.from('promocao_eventos').insert({
      campanha_id: camp.id,
      entidade: 'sorteio',
      entidade_id: s.id,
      tipo: 'sorteio.apurado',
      dados: { numeroExtraido: row.numero_extraido, contemplado: r?.numero ?? null, distancia: r?.distancia ?? null, direcao: r?.direcao ?? null, totalValidos: validos.size, cadeia: cadeia.slice(-400) },
      ator_user_id: userId,
    })
    revalidatePath(`/promocoes/${slug}/sorteio`)
    return { ok: true, sorteio: await montarView(db, s) }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}

export async function decidirSorteio(slug: string, acao: 'validar' | 'anular', observacao = ''): Promise<R> {
  try {
    const { db, camp, userId } = await ctx(slug, 'can_edit')
    const { data: s } = await db.from('promocao_sorteios').select('id, status').eq('campanha_id', camp.id).maybeSingle()
    if (!s) throw new Error('Nada apurado ainda.')
    const agora = new Date().toISOString()
    const patch = acao === 'validar' ? { status: 'validado', validado_por: userId, validado_em: agora, observacao: observacao || null } : { status: 'anulado', observacao: observacao || null }
    if (acao === 'validar' && s.status !== 'apurado') throw new Error('Só sorteio apurado pode ser validado.')
    const { error } = await db.from('promocao_sorteios').update(patch).eq('id', s.id)
    if (error) throw error
    await db.from('promocao_eventos').insert({ campanha_id: camp.id, entidade: 'sorteio', entidade_id: s.id, tipo: acao === 'validar' ? 'sorteio.validado' : 'sorteio.anulado', dados: { observacao }, ator_user_id: userId })
    revalidatePath(`/promocoes/${slug}/sorteio`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e) }
  }
}
