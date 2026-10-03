import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atingiuLimite, botaoDoEstado, comLease, dentroDoHorario, ehUltimaTentativa, escolherCandidata, gatesGlobais, instanciaAindaPermitida, mapearResultadoParaStatus, motivoReavaliacao, reservarSlots, slotsDoPedido, TETO_CAMPANHA_DIA, type GateCampanha } from '../atendimento-regras.ts'
import {
  CONSENTIMENTO_INDICADO_GRAVADO,
  CONSENTIMENTO_INDICADO_TEXTO,
  textoAtendimentoIndicado,
  textoAtendimentoServidor,
  textoIndicadorParaIndicado,
  urlWhatsappIndicado,
} from '../atendimento-textos.ts'

const agora = new Date('2026-10-10T12:00:00Z')
const base: GateCampanha = {
  status: 'ativa', inicio_em: '2026-10-01T00:00:00Z', fim_em: '2026-11-01T00:00:00Z', atendimento_pausado: false,
  atendimento_liberado_em: '2026-10-05T00:00:00Z', parceiro_atendimento_id: 'p', instancia_atendimento_id: 'i',
}

test('gatesGlobais', () => {
  assert.equal(gatesGlobais(base, agora), 'ok')
  assert.equal(gatesGlobais({ ...base, status: 'rascunho' }, agora), 'inativa')
  assert.equal(gatesGlobais({ ...base, fim_em: '2026-10-02T00:00:00Z' }, agora), 'fora_do_periodo')
  assert.equal(gatesGlobais({ ...base, atendimento_pausado: true }, agora), 'pausado')
  assert.equal(gatesGlobais({ ...base, atendimento_liberado_em: null }, agora), 'nao_liberado')
  assert.equal(gatesGlobais({ ...base, atendimento_liberado_em: '2026-12-01T00:00:00Z' }, agora), 'nao_liberado')
  assert.equal(gatesGlobais({ ...base, instancia_atendimento_id: null }, agora), 'sem_instancia')
})

const c = (id: string, o: object = {}) => ({ id, status: 'conectada', deletedAt: null, agenteParceiroId: 'p', enviosHora: 0, enviosDia: 0, ...o })
const ctx = { parceiroId: 'p', instanciaOtpId: 'otp', limiteHora: 40, limiteDia: 200 }

test('escolherCandidata', () => {
  assert.deepEqual(escolherCandidata([c('a'), c('b')], ctx), { id: 'a' })
  assert.deepEqual(escolherCandidata([c('a', { enviosHora: 40 }), c('b')], ctx), { id: 'b' })
  assert.deepEqual(escolherCandidata([c('a', { enviosDia: 200 }), c('b')], ctx), { id: 'b' })
  assert.deepEqual(escolherCandidata([c('a', { enviosHora: 39 })], ctx), { id: 'a' })
  assert.equal(escolherCandidata([c('otp')], ctx), 'nenhuma_conectada')
  assert.equal(escolherCandidata([c('a', { agenteParceiroId: 'x' })], ctx), 'nenhuma_conectada')
  assert.equal(escolherCandidata([c('a', { status: 'desconectada' }), c('b', { deletedAt: 'x' })], ctx), 'nenhuma_conectada')
  assert.equal(escolherCandidata([c('a', { enviosHora: 99 }), c('b', { enviosHora: 99 })], ctx), 'todas_cheias')
  assert.equal(escolherCandidata([], ctx), 'nenhuma_conectada')
})

test('limite deslizante', () => {
  assert.equal(atingiuLimite(29, 30), false)
  assert.equal(atingiuLimite(30, 30), true)
})

test('mapearResultadoParaStatus', () => {
  assert.equal(mapearResultadoParaStatus({ resultado: 'confirmado' }), 'enviado')
  assert.equal(mapearResultadoParaStatus({ resultado: 'incerto', mensagem: 'x' }), 'incerto')
  assert.equal(mapearResultadoParaStatus({ resultado: 'rejeitado', mensagem: 'numero_sem_whatsapp' }), 'rejeitado')
  assert.equal(mapearResultadoParaStatus({ resultado: 'rejeitado', mensagem: 'INSTANCIA_DESCONECTADA' }), 'pendente')
})

test('botaoDoEstado', () => {
  const ok = { pedidoStatus: null, gate: 'ok' as const, telefoneVerificado: true, bloqueado: false, algumaConectada: true }
  assert.equal(botaoDoEstado(ok), 'disponivel')
  assert.equal(botaoDoEstado({ ...ok, pedidoStatus: 'enviado' }), 'ja_enviado')
  assert.equal(botaoDoEstado({ ...ok, pedidoStatus: 'incerto' }), 'ja_enviado')
  assert.equal(botaoDoEstado({ ...ok, pedidoStatus: 'rejeitado' }), 'falhou')
  assert.equal(botaoDoEstado({ ...ok, gate: 'pausado' }), 'indisponivel')
  assert.equal(botaoDoEstado({ ...ok, gate: 'fora_horario' }), 'fora_horario')
  assert.equal(botaoDoEstado({ ...ok, gate: 'fora_horario', telefoneVerificado: false }), 'indisponivel')
  assert.equal(botaoDoEstado({ ...ok, telefoneVerificado: false }), 'indisponivel')
  assert.equal(botaoDoEstado({ ...ok, bloqueado: true }), 'indisponivel')
  assert.equal(botaoDoEstado({ ...ok, algumaConectada: false }), 'indisponivel')
})

test('textos finais iguais ao contrato', () => {
  assert.equal(
    textoAtendimentoServidor({ nome: 'Maria Souza', codigo: 'NA-1' }),
    'Olá, Maria! Aqui é a NuAzul. Você pediu atendimento na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás (código NA-1). Responda esta mensagem que um atendente continua com você. Se não foi você, é só ignorar.',
  )
  assert.equal(
    textoAtendimentoIndicado({ nome: 'João Lima', nomeIndicador: 'Ana Paula Reis', numeroIndicacao: 'IND-9' }),
    'Olá, João! Ana Paula Reis indicou você na promoção NuAzul – Você Sempre no Azul | Valparaíso de Goiás (número de indicação IND-9) para falar sobre consignado e concorrer a um iPhone 17. Responda esta mensagem que um atendente continua com você. Se não quiser receber mais mensagens, responda SAIR.',
  )
  assert.equal(CONSENTIMENTO_INDICADO_TEXTO, 'Você tem autorização do indicado para receber mensagem do nosso número? Se NÃO tiver, use o botão "Enviar pelo meu WhatsApp".')
  assert.equal(CONSENTIMENTO_INDICADO_GRAVADO, `${CONSENTIMENTO_INDICADO_TEXTO} [Tenho autorização — enviar]`)
})

test('botão B: wa.me do indicado com link interno', () => {
  const t = textoIndicadorParaIndicado({ nomeIndicado: 'João Lima', nomeIndicador: 'Ana', numeroIndicacao: 'IND-9', codigoInscricao: 'NA-2', contatoDigitos: '556131991754' })
  assert.match(t, /^Oi, João! Aqui é Ana\. Indiquei você na promoção/)
  assert.match(t, /\nhttps:\/\/wa\.me\/556131991754\?text=/)
  const url = urlWhatsappIndicado('5561999990000', t)
  assert.ok(url.startsWith('https://wa.me/5561999990000?text='))
  assert.equal(decodeURIComponent(url.split('?text=')[1]), t)
})

test('horário 7h-21h em São Paulo e gate fora_horario', () => {
  assert.equal(dentroDoHorario(new Date('2026-10-10T09:59:00Z')), false) // 06:59
  assert.equal(dentroDoHorario(new Date('2026-10-10T10:00:00Z')), true) // 07:00
  assert.equal(dentroDoHorario(new Date('2026-10-10T23:59:00Z')), true) // 20:59
  assert.equal(dentroDoHorario(new Date('2026-10-11T00:00:00Z')), false) // 21:00
  assert.equal(gatesGlobais(base, new Date('2026-10-11T02:00:00Z')), 'fora_horario')
  assert.equal(gatesGlobais({ ...base, atendimento_pausado: true }, new Date('2026-10-11T02:00:00Z')), 'pausado')
})

test('limite atômico: slot ocupado nega e para na ordem', async () => {
  const camp = { limite_atendimento_indicador_hora: 30, limite_atendimento_instancia_hora: 40, limite_atendimento_instancia_dia: 200 }
  const slots = slotsDoPedido(camp, { tipo: 'indicado', indicadorId: 'd1', instanciaId: 'i1' })
  assert.deepEqual(slots.map((x) => x.chave), ['rl:atend:indicador:d1', 'rl:atend:camp:d', 'rl:atend:inst:i1:h', 'rl:atend:inst:i1:d'])
  assert.equal(slots[1].limite, TETO_CAMPANHA_DIA)
  assert.equal(slotsDoPedido(camp, { tipo: 'servidor', indicadorId: null, instanciaId: 'i1' }).length, 3)
  const usados = new Map<string, number>()
  const tentar = async (k: string, lim: number) => { const n = (usados.get(k) ?? 0) + 1; usados.set(k, n); return n <= lim }
  const pequeno = { ...camp, limite_atendimento_indicador_hora: 1 }
  assert.equal(await reservarSlots(slotsDoPedido(pequeno, { tipo: 'indicado', indicadorId: 'd1', instanciaId: 'i1' }), tentar), null)
  assert.equal(await reservarSlots(slotsDoPedido(pequeno, { tipo: 'indicado', indicadorId: 'd1', instanciaId: 'i1' }), tentar), 'LIMITE_INDICADOR')
  assert.equal(usados.get('rl:atend:camp:d'), 1) // parou no indicador
  const cheia = { ...camp, limite_atendimento_instancia_hora: 0 }
  assert.equal(await reservarSlots(slotsDoPedido(cheia, { tipo: 'servidor', indicadorId: null, instanciaId: 'i2' }), tentar), 'LIMITE_INSTANCIA')
})

test('lease: só um executor envia', async () => {
  let livre = true
  let envios = 0
  const adquirir = async () => { if (!livre) return false; livre = false; return true }
  const enviar = async () => { envios++; return 'enviou' }
  const r = await Promise.all([comLease(adquirir, enviar, 'em andamento'), comLease(adquirir, enviar, 'em andamento')])
  assert.equal(envios, 1)
  assert.deepEqual(r.sort(), ['em andamento', 'enviou'])
})

test('reavaliação na hora do envio', () => {
  const camp = { ...base, instancia_atendimento_reserva_id: 'r' }
  const inst = { status: 'conectada', deletedAt: null, agenteParceiroId: 'p' }
  assert.equal(motivoReavaliacao(camp, 'i', inst, agora), null)
  assert.equal(motivoReavaliacao(camp, 'r', inst, agora), null)
  assert.equal(motivoReavaliacao({ ...camp, atendimento_pausado: true }, 'i', inst, agora), 'PAUSADO')
  assert.equal(motivoReavaliacao(camp, 'x', inst, agora), 'INSTANCIA_TROCADA')
  assert.equal(motivoReavaliacao(camp, 'i', { ...inst, status: 'desconectada' }, agora), 'INSTANCIA_OFFLINE')
  assert.equal(motivoReavaliacao(camp, 'i', { ...inst, agenteParceiroId: 'z' }, agora), 'PARCEIRO_DIFERENTE')
  assert.equal(motivoReavaliacao(camp, 'i', inst, new Date('2026-10-11T02:00:00Z')), 'FORA_HORARIO')
  assert.equal(instanciaAindaPermitida(camp, 'r'), true)
  assert.equal(instanciaAindaPermitida(camp, 'otp'), false)
})

test('última tentativa do job (ESGOTADO)', () => {
  assert.equal(ehUltimaTentativa({ attempts: 3, max_attempts: 5 }), false)
  assert.equal(ehUltimaTentativa({ attempts: 4, max_attempts: 5 }), true)
  assert.equal(ehUltimaTentativa({}), false)
})
