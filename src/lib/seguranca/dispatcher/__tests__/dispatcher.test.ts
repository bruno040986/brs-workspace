import test from 'node:test'
import assert from 'node:assert/strict'
import { executarCiclo, operationIdDerivado, processarIntencao } from '../dispatcher.ts'
import { montarEmail, montarResumo, montarTexto } from '../template.ts'
import { FakeDb, FakeCanal, canaisFake, OK, REJ, INC } from './fakes.ts'

let t0 = Date.parse('2026-11-01T12:00:00Z')
const relogio = () => new Date(t0)
const avanca = (s: number) => { t0 += s * 1000 }
const cenario = (prio: 'critica' | 'alta' = 'critica', canais: Parameters<typeof canaisFake>[0] = {}) => {
  t0 = Date.parse('2026-11-01T12:00:00Z')
  const db = new FakeDb(relogio); db.add('a', prio)
  return { db, deps: (c = canais) => ({ db, canais: canaisFake(c), owner: 'w1', agora: relogio }) }
}
const estado = (db: FakeDb, id = 'a') => db.intencoes.get(id)!.estado

test('§12-7 Telegram aceita: intenção aceita, WhatsApp e e-mail não são chamados, resumo só é checado', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([OK]), wa = new FakeCanal([OK]), em = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa, em }))
  assert.equal(estado(db), 'aceita'); assert.equal(tg.chamadas.length, 1); assert.equal(wa.chamadas.length + em.chamadas.length, 0)
  assert.match(tg.chamadas[0].texto!, /INC-7/); assert.equal(db.resumoChamadas, 1)
})

test('§12-7 Telegram 429: espera retry_after sem acionar WhatsApp; depois reenvia no Telegram', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([{ tipo: 'limitada', retryAfterSeg: 30 }, OK]), wa = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa }))
  assert.equal(estado(db), 'pendente'); assert.equal(db.finals.a.retry!.getTime(), t0 + 30_000); assert.equal(wa.chamadas.length, 0)
  avanca(10); await executarCiclo(deps({ tg, wa })); assert.equal(tg.chamadas.length, 1, 'antes do retry_after nada sai')
  avanca(25); await executarCiclo(deps({ tg, wa }))
  assert.equal(estado(db), 'aceita'); assert.equal(tg.chamadas.length, 2); assert.equal(wa.chamadas.length, 0)
})

test('§12-7 Telegram 429 prolongado: crítico passa para UMA contingência WhatsApp após 120 s', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([{ tipo: 'limitada', retryAfterSeg: 100 }]), wa = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa })); avanca(101); await executarCiclo(deps({ tg, wa })) // 2º 429 (retry em +100) -> ainda < 120 s? 101 < 120
  assert.equal(wa.chamadas.length, 0); avanca(25); await executarCiclo(deps({ tg, wa }))
  assert.equal(wa.chamadas.length, 1); assert.equal(estado(db), 'aceita')
})

test('§12-7 Telegram 403: contingência WhatsApp imediata, sem retry no Telegram', async () => {
  const { db, deps } = cenario('alta'); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_403', http: 403 }]), wa = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa }))
  assert.equal(tg.chamadas.length, 1); assert.equal(wa.chamadas.length, 1); assert.equal(wa.chamadas[0].instanciaId, 'i1'); assert.equal(estado(db), 'aceita')
})

test('§12-7 Telegram 5xx: 1 retry após 5 s, depois contingência', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_5xx', http: 502, transitoria: true }]), wa = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa })); assert.equal(estado(db), 'pendente'); assert.equal(wa.chamadas.length, 0)
  avanca(6); await executarCiclo(deps({ tg, wa })); assert.equal(tg.chamadas.length, 2); assert.equal(wa.chamadas.length, 1)
})

test('§12-7 Telegram timeout (incerto): crítico espera 90 s e faz UMA contingência marcada duplicata; alto não aciona WhatsApp', async () => {
  const c = cenario(); const tg = new FakeCanal([INC]), wa = new FakeCanal([OK])
  await executarCiclo(c.deps({ tg, wa })); assert.equal(wa.chamadas.length, 0); assert.equal(tg.chamadas.length, 1, 'sem reenvio no Telegram')
  avanca(91); await executarCiclo(c.deps({ tg, wa }))
  assert.equal(wa.chamadas.length, 1); assert.match(wa.chamadas[0].texto!, /Possível duplicata/); assert.equal(tg.chamadas.length, 1)
  const a = cenario('alta'); const tg2 = new FakeCanal([INC]), wa2 = new FakeCanal([OK])
  await executarCiclo(a.deps({ tg: tg2, wa: wa2 })); avanca(500); await executarCiclo(a.deps({ tg: tg2, wa: wa2 }))
  assert.equal(estado(a.db), 'incerta'); assert.equal(wa2.chamadas.length, 0)
})

test('§12-8 WhatsApp primária indisponível: usa a reserva; a terceira não é chamada', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_403' }])
  const wa = new FakeCanal((n) => (n === 0 ? REJ : OK))
  await executarCiclo(deps({ tg, wa }))
  assert.deepEqual(wa.chamadas.map((c) => c.instanciaId), ['i1', 'i2']); assert.equal(estado(db), 'aceita')
  assert.notEqual(wa.chamadas[0].operationId, wa.chamadas[1].operationId, 'tentativas distintas, ids distintos')
})

test('§12-8 primária aceita: reservas não enviam', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_403' }]), wa = new FakeCanal([OK])
  await executarCiclo(deps({ tg, wa })); assert.equal(wa.chamadas.length, 1); assert.equal(estado(db), 'aceita')
})

test('§12-8 envio incerto no WhatsApp: não roda a lista; crítico escala UMA vez ao e-mail; alto só registra', async () => {
  const c = cenario(); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_403' }]), wa = new FakeCanal([INC]), em = new FakeCanal([OK])
  await executarCiclo(c.deps({ tg, wa, em }))
  assert.equal(wa.chamadas.length, 1); assert.equal(em.chamadas.length, 1)
  const a = cenario('alta'); const wa2 = new FakeCanal([INC]), em2 = new FakeCanal([OK])
  await executarCiclo(a.deps({ tg, wa: wa2, em: em2 }))
  assert.equal(wa2.chamadas.length, 1); assert.equal(em2.chamadas.length, 0); assert.equal(estado(a.db), 'incerta')
})

test('§12-10 todos os canais falham: e-mail tentado, intenção falhou, falha registrada, nada fictício', async () => {
  const { db, deps } = cenario(); const rej = { tipo: 'rejeitada' as const, categoria: 'http_403' }
  const tg = new FakeCanal([rej]), wa = new FakeCanal([REJ]), em = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_401' }])
  await executarCiclo(deps({ tg, wa, em }))
  assert.equal(wa.chamadas.length, 3); assert.equal(em.chamadas.length, 1); assert.equal(estado(db), 'falhou')
  assert.ok(db.falhas.includes('todos_canais_falharam')); assert.ok(!db.tents.some((t) => t.estado === 'aceita'))
})

test('I6 Telegram desabilitado: WhatsApp NÃO vira primário; e-mail recebe; sem e-mail fica pendente com motivo', async () => {
  const { db, deps } = cenario(); const wa = new FakeCanal([OK]), em = new FakeCanal([OK])
  await executarCiclo(deps({ wa, em }))
  assert.equal(wa.chamadas.length, 0); assert.equal(em.chamadas.length, 1); assert.equal(estado(db), 'aceita')
  const c2 = cenario(); const wa2 = new FakeCanal([OK])
  await executarCiclo(c2.deps({ wa: wa2 }))
  assert.equal(wa2.chamadas.length, 0); assert.equal(estado(c2.db), 'pendente'); assert.ok(c2.db.falhas.includes('canal_primario_desabilitado')); assert.equal(c2.db.tents.length, 0)
})

test('canal desabilitado nunca envia (não urgente): registra canal_desabilitado e não consome orçamento', async () => {
  const { db, deps } = cenario('critica'); db.add('r', 'media', 'resumo'); db.intencoes.get('a')!.estado = 'cancelada'
  await executarCiclo({ ...deps({}), canais: canaisFake({}) })
  assert.equal(estado(db, 'r'), 'falhou'); assert.equal(db.orcChamadas.length, 0)
  assert.deepEqual([...new Set(db.tents.map((t) => t.categoria_erro))], ['canal_desabilitado'])
})

test('I2/M4 orçamento HORÁRIO negado: volta a pendente na próxima hora, sem envio e sem marcar falha do canal; depois envia', async () => {
  const { db, deps } = cenario(); db.orcamento = { permitido: false, motivo: 'global_hora' }; const tg = new FakeCanal([OK])
  await executarCiclo(deps({ tg }))
  assert.equal(estado(db), 'pendente'); assert.equal(tg.chamadas.length, 0)
  assert.equal(db.finals['a'].retry!.toISOString(), '2026-11-01T13:00:00.000Z')
  assert.equal(db.tents[0].categoria_erro, 'orcamento') // preparada antes de consumir (M4)
  t0 = Date.parse('2026-11-01T13:00:01Z'); db.orcamento = { permitido: true, motivo: null }
  await executarCiclo(deps({ tg })); assert.equal(tg.chamadas.length, 1); assert.equal(estado(db), 'aceita')
})

test('I2 orçamento DIÁRIO (canal_dia) negado é terminal (suprimida_orcamento)', async () => {
  const { db, deps } = cenario(); db.orcamento = { permitido: false, motivo: 'canal_dia' }; const tg = new FakeCanal([OK])
  await executarCiclo(deps({ tg })); assert.equal(estado(db), 'suprimida_orcamento'); assert.equal(tg.chamadas.length, 0)
})

test('Pós-revisão (3): regra_dia negada ADIA para o próximo dia (SP), sem envio, categoria própria; depois envia', async () => {
  const { db, deps } = cenario(); db.orcamento = { permitido: false, motivo: 'regra_dia' }; const tg = new FakeCanal([OK])
  await executarCiclo(deps({ tg }))
  assert.equal(estado(db), 'pendente'); assert.equal(tg.chamadas.length, 0)
  assert.equal(db.finals['a'].retry!.toISOString(), '2026-11-02T03:00:00.000Z')
  assert.equal(db.tents[0].categoria_erro, 'orcamento_regra_dia')
  t0 = Date.parse('2026-11-02T03:00:01Z'); db.orcamento = { permitido: true, motivo: null }
  await executarCiclo(deps({ tg })); assert.equal(tg.chamadas.length, 1); assert.equal(estado(db), 'aceita')
})

test('I5 e-mail 429: espera retry_after e reenvia; não vira todos_canais_falharam', async () => {
  const { db, deps } = cenario('alta'); const rej = { tipo: 'rejeitada' as const, categoria: 'http_403' }
  const tg = new FakeCanal([rej]), wa = new FakeCanal([REJ]), em = new FakeCanal([{ tipo: 'limitada', retryAfterSeg: 30 }, OK])
  await executarCiclo(deps({ tg, wa, em }))
  assert.equal(estado(db), 'pendente'); assert.ok(!db.falhas.includes('todos_canais_falharam')); assert.equal(em.chamadas.length, 1)
  avanca(31); await executarCiclo(deps({ tg, wa, em }))
  assert.equal(em.chamadas.length, 2); assert.equal(estado(db), 'aceita')
})

test('I4 conflito de chave no WhatsApp é incerto: não avança de instância, registra para reconciliação', async () => {
  const { db, deps } = cenario('alta'); const tg = new FakeCanal([{ tipo: 'rejeitada', categoria: 'http_403' }])
  const wa = new FakeCanal([{ tipo: 'incerta', categoria: 'engine_conflito_chave' }])
  await executarCiclo(deps({ tg, wa }))
  assert.equal(wa.chamadas.length, 1); assert.equal(estado(db), 'incerta'); assert.ok(db.falhas.includes('whatsapp_conflito_chave'))
})

test('I3 ciclo respeita o orçamento de tempo e o limite padrão de 2 intenções', async () => {
  const { db, deps } = cenario(); db.add('b'); db.add('c'); const tg = new FakeCanal([OK])
  const r = await executarCiclo(deps({ tg })); assert.equal(r.reivindicadas, 2)
  const c2 = cenario(); c2.db.add('b'); const tg2 = new FakeCanal([OK])
  const r2 = await executarCiclo(c2.deps({ tg: tg2 }), 5, -1); assert.equal(r2.processadas, 0); assert.equal(tg2.chamadas.length, 0)
})

test('M1 template: regra com nome de Object.prototype não usa o protótipo', () => {
  const i = { codigo: 'INC-1', regra: 'constructor', gravidade: 'alta' as const, versao_alerta: 1, eventos_total: 3, eventos_suprimidos: 0, agregado: false, janela_inicio: '', janela_fim: '' }
  assert.match(montarTexto({ incidente: i, tipo: 'alerta' }), /Regra "constructor" acionada \(3 evento/)
})

test('§12-13 lease perdido: o provedor não é chamado', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([OK]); const [it] = await db.claim('w1', 1)
  db.intencoes.get('a')!.lease_until = t0 - 1 // venceu entre o claim e o envio
  await processarIntencao(deps({ tg }), it); assert.equal(tg.chamadas.length, 0)
})

test('§12-13 gravação falha DEPOIS do provedor aceitar: sem reenvio, sem finish; lease vence => incerta', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([OK]), wa = new FakeCanal([OK]); db.falharAtualizar = true
  await executarCiclo(deps({ tg, wa }))
  assert.equal(tg.chamadas.length, 1); assert.equal(estado(db), 'em_envio'); assert.ok(db.falhas.includes('persistencia_pos_envio'))
  db.falharAtualizar = false; avanca(200); await executarCiclo(deps({ tg, wa }))
  assert.equal(estado(db), 'incerta'); assert.equal(tg.chamadas.length, 1); assert.equal(wa.chamadas.length, 0)
})

test('§12-13 crash entre preparar e provedor: lease vence com tentativa enviando => incerta, nunca reenvia', async () => {
  const { db, deps } = cenario(); const tg = new FakeCanal([OK]); const [it] = await db.claim('w0', 1)
  await db.preparar(it.id, 'w0', 'telegram', '', operationIdDerivado(it.id, 'telegram', '', 1)) // w0 morreu aqui
  avanca(200); await executarCiclo(deps({ tg }))
  assert.equal(estado(db), 'incerta'); assert.equal(tg.chamadas.length, 0)
})

test('§12-13 concorrência: dois workers simultâneos enviam cada intenção uma única vez', async () => {
  const { db } = cenario(); for (const k of ['b', 'c', 'd']) db.add(k)
  const tg = new FakeCanal([OK]); const mk = (owner: string) => ({ db, canais: canaisFake({ tg }), owner, agora: relogio })
  await Promise.all([executarCiclo(mk('w1'), 2), executarCiclo(mk('w2'), 2)])
  assert.equal(tg.chamadas.length, 4); for (const id of ['a', 'b', 'c', 'd']) assert.equal(estado(db, id), 'aceita')
})

test('§12-14 recuperação: resumo é intenção própria, só contagens, e resumo aceito não gera outro resumo', async () => {
  const { db, deps } = cenario(); db.add('r', 'media', 'resumo'); const tg = new FakeCanal([OK])
  await executarCiclo(deps({ tg }), 5)
  const txt = tg.chamadas.map((c) => c.texto).find((x) => /resumo após recuperação/.test(x!))!
  assert.match(txt, /3 entregue\(s\) por outro canal, 2 suprimida\(s\)/); assert.equal(db.resumoChamadas, 1, 'só o alerta dispara checagem; o resumo não')
})

test('anti-recursão: falha do dispatcher vira db.falha (chave fixa no SQL) e nunca lança', async () => {
  const { db, deps } = cenario(); db.incidente = async () => { throw new Error('banco caiu') }
  await executarCiclo(deps({ tg: new FakeCanal([OK]) })); assert.deepEqual(db.falhas, ['processamento'])
})

test('operationId derivado: estável, formato uuid, distinto por canal/instância', () => {
  const a = operationIdDerivado('i', 'whatsapp', 'x', 1)
  assert.equal(a, operationIdDerivado('i', 'whatsapp', 'x', 1)); assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a, operationIdDerivado('i', 'whatsapp', 'y', 1)); assert.notEqual(a, operationIdDerivado('i', 'telegram', 'x', 1))
})

test('template: sem dados não confiáveis, mostra suprimidos, HTML escapado', () => {
  const inc = { codigo: 'INC-9<script>', regra: 'regra_x<b>', gravidade: 'critica' as const, versao_alerta: 1, eventos_total: 12, eventos_suprimidos: 40, agregado: true, janela_inicio: '', janela_fim: '' }
  const txt = montarTexto({ incidente: inc, tipo: 'alerta' })
  assert.ok(!txt.includes('<') && !txt.includes('>')); assert.match(txt, /Mais 40 evento/); assert.match(txt, /Volume anômalo/)
  assert.match(txt, /Este alerta não depende de análise por IA/)
  const m = montarEmail('a <b>&</b>', 'INC-1', 'alta'); assert.ok(m.html.includes('&lt;b&gt;') && !m.html.includes('<b>'))
  assert.match(montarTexto({ incidente: inc, tipo: 'alerta', iaMotivo: 'orcamento local' }), /Não foi possível acionar o Jarvis: orcamento local/)
  assert.match(montarResumo({ suprimidas_orcamento: 1, incertas: 0, falhas: 0, por_contingencia: 0 }), /Nada será reenviado/)
})
