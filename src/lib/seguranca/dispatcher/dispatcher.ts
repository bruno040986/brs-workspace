import { createHash } from 'node:crypto'
import { montarEmail, montarResumo, montarTexto } from './template.ts'
import { CONFIG_PADRAO, type Canais, type Canal, type DispatcherDb, type EstadoFinal, type Incidente, type Intencao, type Relogio, type ResultadoEnvio, type Tentativa } from './tipos.ts'

/**
 * M06: política Telegram -> WhatsApp (uma instância por vez) -> e-mail. PLANO-MESTRE §8, PT02 §5.4-5.7.
 * Regras que NÃO podem regredir (cada uma tem teste):
 *  - tentativa gravada ANTES do efeito (preparar) e atualizada depois; sem lease válido nada sai;
 *  - falha de gravação depois de provedor ter respondido => NÃO reenvia e NÃO finaliza: o lease vence e o claim do M05
 *    marca a intenção 'incerta' (reconciliação), nunca volta a 'pendente';
 *  - WhatsApp só avança de instância após rejeição COMPROVADA; incerta/aceita encerram a lista;
 *  - Telegram incerto/429 só leva à contingência dentro dos prazos da política; no máximo UMA contingência;
 *  - canal desabilitado nunca envia: registra tentativa 'canal_desabilitado';
 *  - o dispatcher nunca cria incidente notificável sobre si mesmo (db.falha usa gravidade 'media', 1/h por categoria).
 */
export type Deps = { db: DispatcherDb; canais: Canais; owner: string; agora?: Relogio; log?: (msg: string, extra?: Record<string, unknown>) => void }

export function operationIdDerivado(intencaoId: string, canal: Canal, configRef: string, versao: number): string {
  const h = createHash('sha256').update(`seg-dispatch|${intencaoId}|${canal}|${configRef}|${versao}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50 // versão 5 (derivado, determinístico)
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

type Acao =
  | { acao: 'enviar'; canal: Canal; configRef: string; instanciaId?: string; possivelDuplicata?: boolean }
  | { acao: 'finalizar'; estado: EstadoFinal; falha?: string }
  | { acao: 'aguardar'; ate: Date }

const ms = (iso: string) => new Date(iso).getTime()

/** Decisão PURA a partir do histórico de tentativas. Sem rede, sem banco. */
export function decidir(it: Intencao, tents: Tentativa[], canais: Canais, cfg: Record<string, number>, agora: Date): Acao {
  const urgente = (it.prioridade === 'alta' || it.prioridade === 'critica') && it.tipo !== 'resumo'
  const crit = it.prioridade === 'critica' && it.tipo !== 'resumo'
  const doCanal = (c: Canal) => tents.filter((t) => t.canal === c).sort((a, b) => a.n - b.n)
  const fimAceito = tents.some((t) => t.estado === 'aceita')
  if (fimAceito) return { acao: 'finalizar', estado: 'aceita' }
  const incertaQualquer = tents.some((t) => t.estado === 'incerta' || t.estado === 'enviando' || t.estado === 'preparada')
  const sobra = (): Acao => ({ acao: 'finalizar', estado: incertaQualquer ? 'incerta' : 'falhou', falha: incertaQualquer ? undefined : 'todos_canais_falharam' })
  const criado = ms(it.criado_em)

  // ---- Telegram
  const tg = doCanal('telegram')
  const ult = tg[tg.length - 1]
  let contingencia = false
  if (!ult) return { acao: 'enviar', canal: 'telegram', configRef: '' }
  if (ult.estado === 'limitada') {
    const prazo = criado + 1000 * (crit ? cfg['contingencia.telegram_429_critico_s'] : cfg['contingencia.telegram_429_alto_s'])
    const retry = ult.retry_after_ate ? ms(ult.retry_after_ate) : agora.getTime()
    if (agora.getTime() >= prazo) contingencia = true
    else if (agora.getTime() < retry) return { acao: 'aguardar', ate: new Date(Math.min(retry, prazo)) }
    else return { acao: 'enviar', canal: 'telegram', configRef: '' }
  } else if (ult.estado === 'rejeitada_comprovada') {
    if (ult.categoria_erro === 'http_5xx' && tg.filter((t) => t.categoria_erro === 'http_5xx').length === 1) {
      const quando = ms(ult.criado_em) + 1000 * cfg['contingencia.telegram_5xx_retry_s']
      return agora.getTime() >= quando ? { acao: 'enviar', canal: 'telegram', configRef: '' } : { acao: 'aguardar', ate: new Date(quando) }
    }
    contingencia = true // permanente (400/401/403), desabilitado ou 5xx repetido
  } else { // incerta / enviando / preparada
    if (!crit) return { acao: 'finalizar', estado: 'incerta' } // alto: sem contingência; o próximo resumo informa a incerteza
    const quando = ms(ult.criado_em) + 1000 * cfg['contingencia.telegram_incerto_critico_s']
    if (agora.getTime() < quando) return { acao: 'aguardar', ate: new Date(quando) }
    contingencia = true
  }
  if (!contingencia) return sobra()
  if (!urgente) return { acao: 'finalizar', estado: incertaQualquer ? 'incerta' : 'falhou', falha: incertaQualquer ? undefined : 'canal_nao_urgente_falhou' }
  const possivelDuplicata = tg.some((t) => t.estado === 'incerta' || t.estado === 'enviando')

  // ---- WhatsApp: uma instância por vez, só avança com rejeição comprovada
  const wa = doCanal('whatsapp')
  const waDesab = wa.some((t) => t.categoria_erro === 'canal_desabilitado')
  let waEsgotado = false
  if (!canais.whatsapp.habilitado || !canais.whatsapp.adapter || canais.whatsapp.instancias.length === 0) {
    if (!waDesab) return { acao: 'enviar', canal: 'whatsapp', configRef: '', possivelDuplicata }
    waEsgotado = true
  } else {
    waEsgotado = true
    for (const inst of [...canais.whatsapp.instancias].sort((a, b) => a.ordem - b.ordem)) {
      const ts = wa.filter((t) => t.config_ref === inst.instanciaId)
      if (ts.length === 0) { waEsgotado = false; return { acao: 'enviar', canal: 'whatsapp', configRef: inst.instanciaId, instanciaId: inst.instanciaId, possivelDuplicata } }
      const u = ts[ts.length - 1]
      if (u.estado !== 'rejeitada_comprovada') return sobraDepoisDeIncerta()
    }
  }
  function sobraDepoisDeIncerta(): Acao {
    // WhatsApp incerto/aceito: não circula pelas reservas. Crítico escala UMA vez ao último canal (e-mail); alto registra a incerteza.
    const emailFeito = doCanal('email').length > 0
    if (crit && !emailFeito) return { acao: 'enviar', canal: 'email', configRef: '', possivelDuplicata: true }
    return { acao: 'finalizar', estado: 'incerta' }
  }
  if (!waEsgotado) return sobra()

  // ---- E-mail (último canal)
  const em = doCanal('email')
  if (em.length === 0) return { acao: 'enviar', canal: 'email', configRef: '', possivelDuplicata: possivelDuplicata || incertaQualquer }
  return sobra()
}

function montarMensagem(canal: Canal, it: Intencao, inc: Incidente, resumo: Awaited<ReturnType<DispatcherDb['resumoDados']>>, dup: boolean) {
  const texto = it.tipo === 'resumo' && resumo
    ? montarResumo(resumo)
    : montarTexto({ incidente: inc, tipo: it.tipo, possivelDuplicata: dup ? { versao: it.versao_alerta } : null })
  return canal === 'email' ? { texto, ...montarEmail(texto, inc.codigo, inc.gravidade) } : { texto, assunto: '', html: '' }
}

const sleepNone = async () => {}
async function comRetry<T>(fn: () => Promise<T>, vezes = 3): Promise<T> {
  let e: unknown
  for (let i = 0; i < vezes; i++) { try { return await fn() } catch (err) { e = err; await sleepNone() } }
  throw e
}

/** Processa UMA intenção já reivindicada (lease do owner). Nunca lança. */
export async function processarIntencao(d: Deps, it: Intencao): Promise<void> {
  const agora = d.agora ?? (() => new Date())
  const log = d.log ?? (() => {})
  try {
    const [inc, cfgDb] = [await d.db.incidente(it.incidente_id), await d.db.config()]
    if (!inc) { await d.db.finish(it.id, d.owner, 'cancelada'); return }
    const cfg: Record<string, number> = { ...CONFIG_PADRAO, ...cfgDb }
    const tents = await d.db.tentativas(it.id)
    const resumo = it.tipo === 'resumo' ? await d.db.resumoDados(it.incidente_id) : null

    for (let passo = 0; passo < 10; passo++) {
      const a = decidir(it, tents, d.canais, cfg, agora())
      if (a.acao === 'aguardar') { await d.db.finish(it.id, d.owner, 'pendente', a.ate); return }
      if (a.acao === 'finalizar') {
        if (a.falha) await d.db.falha(a.falha, `intencao sem canal funcional (${inc.codigo})`).catch(() => {})
        await d.db.finish(it.id, d.owner, a.estado)
        if (a.estado === 'aceita' && it.tipo !== 'resumo' && tents.some((t) => t.canal === 'telegram' && t.estado === 'aceita')) {
          await d.db.resumoCriar().catch(() => d.db.falha('resumo_criar').catch(() => {}))
        }
        return
      }
      // ---- enviar
      const canalCfg = d.canais[a.canal]
      const funciona = canalCfg.habilitado && canalCfg.adapter !== null && (a.canal !== 'whatsapp' || a.configRef !== '')
      if (funciona) {
        const orc = await d.db.consumirOrcamento(a.canal, it.incidente_id, a.configRef, it.prioridade)
        if (!orc.permitido) { await d.db.finish(it.id, d.owner, 'suprimida_orcamento'); log('orcamento_negado', { motivo: orc.motivo }); return }
      }
      const opId = operationIdDerivado(it.id, a.canal, a.configRef, it.versao_alerta)
      const t = await d.db.preparar(it.id, d.owner, a.canal, a.configRef, opId) // lança 'seg_lease_perdido': sai sem efeito
      let r: ResultadoEnvio
      if (!funciona) {
        r = { tipo: 'rejeitada', categoria: 'canal_desabilitado' }
      } else {
        const m = montarMensagem(a.canal, it, inc, resumo, Boolean(a.possivelDuplicata))
        try {
          if (a.canal === 'telegram') r = await d.canais.telegram.adapter!.enviar({ texto: m.texto })
          else if (a.canal === 'whatsapp') r = await d.canais.whatsapp.adapter!.enviar({ instanciaId: a.instanciaId!, texto: m.texto, operationId: opId })
          else r = await d.canais.email.adapter!.enviar({ assunto: m.assunto, html: m.html, operationId: opId })
        } catch {
          r = { tipo: 'incerta', categoria: 'excecao_adapter' } // o adapter não deveria lançar; depois da chamada, assume-se incerto
        }
      }
      const patch = r.tipo === 'aceita' ? { estado: 'aceita' as const, provider_message_id: r.messageId ?? null }
        : r.tipo === 'limitada' ? { estado: 'limitada' as const, categoria_erro: 'http_429', http_status: 429, retry_after_ate: new Date(agora().getTime() + 1000 * r.retryAfterSeg).toISOString() }
        : r.tipo === 'rejeitada' ? { estado: 'rejeitada_comprovada' as const, categoria_erro: r.categoria, http_status: r.http ?? null }
        : { estado: 'incerta' as const, categoria_erro: r.categoria }
      try {
        await comRetry(() => d.db.atualizarTentativa(t.id, patch))
      } catch {
        // Provedor já respondeu e não conseguimos gravar: NÃO reenviar e NÃO finalizar. Lease vence => claim marca 'incerta'.
        await d.db.falha('persistencia_pos_envio', `canal ${a.canal}`).catch(() => {})
        return
      }
      tents.push({ ...t, estado: patch.estado, categoria_erro: ('categoria_erro' in patch ? patch.categoria_erro : null) ?? null, retry_after_ate: ('retry_after_ate' in patch ? patch.retry_after_ate : null) ?? null, criado_em: agora().toISOString() })
    }
    await d.db.falha('loop_excedido').catch(() => {}) // proteção: nunca deveria ocorrer
  } catch (e) {
    log('erro_processamento', { msg: e instanceof Error ? e.message.slice(0, 80) : 'erro' })
    await d.db.falha('processamento', e instanceof Error ? e.message : 'erro').catch(() => {})
  }
}

export type Estatisticas = { reivindicadas: number }
/** Um ciclo do worker: claim com lease e processamento sequencial. */
export async function executarCiclo(d: Deps, limite = 5): Promise<Estatisticas> {
  let lote: Intencao[]
  try { lote = await d.db.claim(d.owner, limite) } catch { await d.db.falha('claim').catch(() => {}); return { reivindicadas: 0 } }
  for (const it of lote) await processarIntencao(d, it)
  return { reivindicadas: lote.length }
}
