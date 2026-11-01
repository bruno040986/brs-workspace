import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { decifrarTexto } from '@/lib/central-conversas/cofre'
import { engine } from '@/lib/central-conversas/engine'
import { executarCiclo } from './dispatcher'
import { TelegramBotAdapter } from './adapters/telegram'
import { EngineWhatsAppAdapter } from './adapters/whatsapp'
import { ResendEmailAdapter } from './adapters/email'
import type { Canais, DispatcherDb, InstanciaWhatsApp, Tentativa } from './tipos'

/** Fiação de produção (banco real + adapters reais). Não é importado pelos testes. Nenhum segredo vai a log. */
type Admin = Awaited<ReturnType<typeof createAdminClient>>
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export function criarDb(admin: Admin): DispatcherDb {
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args)
    if (error) throw new Error(`${fn}:${error.code ?? 'erro'}`)
    return data as T
  }
  return {
    claim: (owner, limite) => rpc('seg_intencao_claim', { p_owner: owner, p_limite: limite }),
    async incidente(id) {
      const { data, error } = await admin.from('seg_v_incidentes').select('codigo, regra, gravidade, versao_alerta, eventos_total, eventos_suprimidos, agregado, janela_inicio, janela_fim').eq('id', id).maybeSingle()
      if (error) throw new Error('incidente') // I1: erro de leitura NUNCA vira 'cancelada'; o catch registra falha e o lease devolve a intenção
      return (data as never) ?? null
    },
    async tentativas(id) {
      const { data, error } = await admin.from('seg_notificacao_tentativas').select('id, n, canal, config_ref, operation_id, estado, categoria_erro, retry_after_ate, criado_em').eq('intencao_id', id).order('criado_em')
      if (error) throw new Error('tentativas')
      return (data ?? []) as Tentativa[]
    },
    preparar: (intencao, owner, canal, ref, op) => rpc('seg_tentativa_preparar', { p_intencao: intencao, p_owner: owner, p_canal: canal, p_config_ref: ref, p_operation_id: op }),
    async atualizarTentativa(id, patch) {
      const { error } = await admin.from('seg_notificacao_tentativas').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', id).in('estado', ['preparada', 'enviando', 'limitada']) // M3: não sobrescreve 'incerta' gravada pela varredura
      if (error) throw new Error('atualizar_tentativa')
    },
    finish: (id, owner, estado, retry) => rpc('seg_intencao_finish', { p_id: id, p_owner: owner, p_estado: estado, p_retry_apos: retry?.toISOString() ?? null }),
    consumirOrcamento: (canal, inc, ref, prio) => rpc('seg_orcamento_consumir', { p_canal: canal, p_incidente: inc, p_instancia: ref, p_prioridade: prio }),
    async config() {
      const { data } = await admin.from('seg_config').select('chave, valor').like('chave', 'contingencia.%')
      return Object.fromEntries((data ?? []).filter((r: { valor: unknown }) => typeof r.valor === 'number').map((r: { chave: string; valor: number }) => [r.chave, r.valor]))
    },
    resumoCriar: () => rpc('seg_resumo_criar', {}),
    resumoDados: (id) => rpc('seg_resumo_dados', { p_incidente: id }),
    async falha(cat, det) { await admin.rpc('seg_dispatcher_falha', { p_categoria: cat, p_detalhe: det ?? null }) },
  }
}

async function segredos(admin: Admin, canal: string): Promise<Record<string, string>> {
  const { data } = await admin.from('seg_destinos_protegidos').select('chave, valor_cifrado').eq('canal', canal)
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { chave: string; valor_cifrado: string }[]) {
    try { out[r.chave] = decifrarTexto(r.valor_cifrado) } catch { /* cofre ausente/chave errada: canal fica sem adapter */ }
  }
  return out
}

/** I7: o engine ainda não expõe o modo durável da conta; só aceita se o status trouxer `durable: true`. Sem isso o adapter falha fechado. */
const duravel = async (id: string) => {
  const st = (await engine.status(id)) as { durable?: unknown; detalhe?: { durable?: unknown } | null }
  return st?.durable === true || st?.detalhe?.durable === true
}

/** Carrega configuração + segredos. Canal só ganha adapter se habilitado E completo. Instância WhatsApp só entra se existir, for da conta BRS e o número conferir. */
export async function carregarCanais(admin: Admin, falha: (c: string, d?: string) => Promise<void>): Promise<Canais> {
  const { data: cfgs } = await admin.from('seg_canais_config').select('canal, habilitado, config')
  const por = Object.fromEntries(((cfgs ?? []) as { canal: string; habilitado: boolean; config: Record<string, unknown> }[]).map((c) => [c.canal, c]))
  const canais: Canais = {
    telegram: { habilitado: false, adapter: null },
    whatsapp: { habilitado: false, instancias: [], adapter: null },
    email: { habilitado: false, adapter: null },
  }
  if (por.telegram?.habilitado) {
    const s = await segredos(admin, 'telegram')
    if (s.bot_token && s.chat_id) canais.telegram = { habilitado: true, adapter: new TelegramBotAdapter(s.bot_token, s.chat_id) }
  }
  if (por.whatsapp?.habilitado) {
    const s = await segredos(admin, 'whatsapp')
    const lista = ((por.whatsapp.config?.instancias ?? []) as { ordem: number; instancia_id: string | null; numero_esperado: string }[]).filter((i) => i.instancia_id)
    const ids = lista.map((i) => i.instancia_id as string)
    const { data: reais } = ids.length
      ? await admin.from('chat_instancias').select('id, numero, owner_tipo, deleted_at').in('id', ids)
      : { data: [] as never[] }
    const ok: InstanciaWhatsApp[] = []
    for (const i of lista) {
      const r = ((reais ?? []) as { id: string; numero: string | null; owner_tipo: string; deleted_at: string | null }[]).find((x) => x.id === i.instancia_id)
      // allowlist explícita + conta BRS + número conferido (conferência de ids/numeração pendente do Bruno).
      if (r && r.owner_tipo === 'brs' && !r.deleted_at && dig(r.numero).endsWith(dig(i.numero_esperado).slice(-10))) ok.push({ ordem: i.ordem, instanciaId: i.instancia_id as string })
      else await falha('whatsapp_instancia_invalida', `ordem ${i.ordem}`)
    }
    if (ok.length && s.destino) {
      canais.whatsapp = { habilitado: true, instancias: ok, adapter: new EngineWhatsAppAdapter((id, dest, texto, op) => engine.enviar(id, dest, texto, op), s.destino, duravel) }
    }
  }
  if (por.email?.habilitado) {
    const destino = String(por.email.config?.destino ?? '')
    const { data: r } = await admin.from('resend_config').select('is_active, api_key, from_email').limit(1).maybeSingle()
    if (destino && r?.is_active && r.api_key && r.from_email) canais.email = { habilitado: true, adapter: new ResendEmailAdapter(r.api_key, r.from_email, destino) }
  }
  return canais
}

/** Um ciclo completo em produção. Idempotente e seguro para chamadas concorrentes (lease no banco). */
export async function rodarDispatcher(owner = `disp-${Math.random().toString(36).slice(2, 10)}`, limite = 2) {
  const admin = await createAdminClient()
  const db = criarDb(admin)
  const canais = await carregarCanais(admin, (c, d) => db.falha(c, d))
  return executarCiclo({ db, canais, owner }, limite)
}
