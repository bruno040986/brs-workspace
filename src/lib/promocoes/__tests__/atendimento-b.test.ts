import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atingiuLimite, botaoDoEstado, escolherCandidata, gatesGlobais, mapearResultadoParaStatus, type GateCampanha } from '../atendimento-regras.ts'
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
