/**
 * Verificação executável do Disparo de WhatsApp: normalização de telefone
 * (Z-API), renderização de template e regras de agendamento (puras).
 *
 * COMO RODAR (a partir da raiz do projeto):
 *
 *   1. Compilar os módulos puros para JS (o erro TS2307 do alias @/ é esperado):
 *
 *      npx tsc src/lib/zapi/phone.ts src/lib/zapi/format.ts \
 *        src/lib/disparo-whatsapp/schedule.ts src/lib/disparo-whatsapp/recipients.ts \
 *        src/lib/disparo-whatsapp/types.ts \
 *        --outDir /tmp/wa-build --module commonjs --target ES2020 \
 *        --moduleResolution node --skipLibCheck --esModuleInterop
 *
 *   2. Rodar:
 *
 *      BUILD_DIR=/tmp/wa-build node scripts/verify-disparo-whatsapp.js
 */

const path = require('path')
const Module = require('module')

const BUILD = process.env.BUILD_DIR || '/tmp/wa-build'

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/zapi/')) return path.join(BUILD, 'zapi', request.replace('@/lib/zapi/', '') + '.js')
  if (request.startsWith('@/lib/disparo-whatsapp/')) return path.join(BUILD, 'disparo-whatsapp', request.replace('@/lib/disparo-whatsapp/', '') + '.js')
  return originalResolve.call(this, request, ...rest)
}

let phone, format, schedule, recipients
try {
  phone = require(path.join(BUILD, 'zapi', 'phone.js'))
  format = require(path.join(BUILD, 'zapi', 'format.js'))
  schedule = require(path.join(BUILD, 'disparo-whatsapp', 'schedule.js'))
  recipients = require(path.join(BUILD, 'disparo-whatsapp', 'recipients.js'))
} catch (err) {
  console.error(`\n✗ Não consegui carregar o build em ${BUILD}. Rode o passo 1 do cabeçalho.\n  ${err.message}\n`)
  process.exit(1)
}

let pass = 0
let fail = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  failures.push(`  ✗ ${name}\n      esperado: ${e}\n      obtido:   ${a}`)
}

// --- Telefone -------------------------------------------------------------
check('celular com máscara', phone.normalizeBrPhone('(11) 99999-8888'), '5511999998888')
check('celular sem DDI', phone.normalizeBrPhone('11999998888'), '5511999998888')
check('celular com 55', phone.normalizeBrPhone('5511999998888'), '5511999998888')
check('celular com +55', phone.normalizeBrPhone('+55 11 99999-8888'), '5511999998888')
check('fixo 8 dígitos', phone.normalizeBrPhone('(11) 3333-4444'), '551133334444')
check('zero à esquerda (0xx)', phone.normalizeBrPhone('011 99999-8888'), '5511999998888')
check('vazio', phone.normalizeBrPhone(''), null)
check('curto', phone.normalizeBrPhone('99999'), null)
check('DDD inválido', phone.normalizeBrPhone('5510999998888'), null)
check('9 dígitos sem 9 inicial', phone.normalizeBrPhone('11 89999-8888'), null)
check('formatação exibição', phone.formatBrPhone('5511999998888'), '+55 (11) 99999-8888')
check('formatação fixo', phone.formatBrPhone('551133334444'), '+55 (11) 3333-4444')

// --- Template -------------------------------------------------------------
check('renderTemplate simples', format.renderTemplate('Olá {{nome}}, valor {{ valor }}', { nome: 'Ana', valor: 'R$ 10' }), 'Olá Ana, valor R$ 10')
check('renderTemplate case/acentos', format.renderTemplate('{{Nome}} {{Razão Social}}', { nome: 'Ana', razao_social: 'ACME' }), 'Ana ACME')
check('renderTemplate ausente', format.renderTemplate('Oi {{x}}!', {}), 'Oi !')
check('extractTemplateVariables', format.extractTemplateVariables('{{a}} e {{ b }} e {{a}}'), ['a', 'b'])
check('renderPartnerTags', format.renderPartnerTags('{{name}}/{{arw_code}}', { name: 'Ana' }, { arw_code: 'A1' }), 'Ana/A1')
check('composeButtonMessage', format.composeButtonMessage({ title: 'T', message: 'M', footer: 'F' }), '*T*\n\nM\n\n_F_')

// --- Agendamento ----------------------------------------------------------
const tz = 'America/Sao_Paulo'
// 2026-08-19 é quarta-feira. 14:00 em SP = 17:00Z
const wed14 = new Date('2026-08-19T17:00:00Z')
check('sem restrição → agora', schedule.nextEligibleAt(wed14, { timezone: tz }).toISOString(), wed14.toISOString())
check('dentro da janela → agora', schedule.nextEligibleAt(wed14, { timezone: tz, window_start: '08:00', window_end: '18:00' }).toISOString(), wed14.toISOString())
check('antes da janela → início janela', schedule.nextEligibleAt(new Date('2026-08-19T09:00:00Z'), { timezone: tz, window_start: '08:00', window_end: '18:00' }).toISOString(), '2026-08-19T11:00:00.000Z')
check('depois da janela → próximo dia 08:00', schedule.nextEligibleAt(new Date('2026-08-19T22:00:00Z'), { timezone: tz, window_start: '08:00', window_end: '18:00' }).toISOString(), '2026-08-20T11:00:00.000Z')
// sexta 19:00 SP (22:00Z) com dias úteis + janela → segunda 08:00 SP = 11:00Z (24/08)
check('sexta noite dias úteis → segunda 08:00', schedule.nextEligibleAt(new Date('2026-08-21T22:00:00Z'), { timezone: tz, allowed_weekdays: [1, 2, 3, 4, 5], window_start: '08:00', window_end: '18:00' }).toISOString(), '2026-08-24T11:00:00.000Z')
// sábado só fim de semana sem janela → agora
check('sábado permitido', schedule.nextEligibleAt(new Date('2026-08-22T15:00:00Z'), { timezone: tz, allowed_weekdays: [0, 6] }).toISOString(), '2026-08-22T15:00:00.000Z')
// start_at futuro
check('start_at futuro', schedule.nextEligibleAt(wed14, { timezone: tz, start_at: '2026-08-25T13:00:00Z' }).toISOString(), '2026-08-25T13:00:00.000Z')
// start_at futuro fora da janela → ajusta pra janela do dia
check('start_at futuro fora da janela', schedule.nextEligibleAt(wed14, { timezone: tz, start_at: '2026-08-25T03:00:00Z', window_start: '08:00', window_end: '18:00' }).toISOString(), '2026-08-25T11:00:00.000Z')
check('lista vazia de dias cai no default (todos)', schedule.nextEligibleAt(wed14, { timezone: tz, allowed_weekdays: [] }) === null, false)
check('janela invertida → nunca', schedule.nextEligibleAt(wed14, { timezone: tz, window_start: '18:00', window_end: '08:00' }), null)

// gate
check('gate sem pendentes → complete', schedule.evaluateGate({ schedule_mode: 'direct', timezone: tz }, [], wed14, false), { kind: 'complete' })
check('gate direto ok → go', schedule.evaluateGate({ schedule_mode: 'direct', timezone: tz }, [], wed14, true), { kind: 'go' })
const slots = [
  { position: 0, run_at: '2026-08-19T13:00:00Z', quantity: 2, sent_count: 2 },
  { position: 1, run_at: '2026-08-19T20:00:00Z', quantity: 3, sent_count: 0 },
]
check('gate lotes espera próximo', schedule.evaluateGate({ schedule_mode: 'batches', timezone: tz }, slots, wed14, true).kind, 'wait')
check('gate lotes go', schedule.evaluateGate({ schedule_mode: 'batches', timezone: tz }, slots, new Date('2026-08-19T20:00:01Z'), true), { kind: 'go' })
check('gate lotes completos', schedule.evaluateGate({ schedule_mode: 'batches', timezone: tz }, [{ position: 0, run_at: '2026-08-19T13:00:00Z', quantity: 2, sent_count: 2 }], wed14, true), { kind: 'complete' })

// rotação
check('rotação desligada', schedule.pickTemplateIndex('sequential', false, 7, 3), 0)
check('rotação sequencial', [0, 1, 2, 3, 4].map((n) => schedule.pickTemplateIndex('sequential', true, n, 3)), [0, 1, 2, 0, 1])
check('rotação aleatória dentro do range', schedule.pickTemplateIndex('random', true, 0, 3, () => 0.99), 2)
check('randomBetween inclusivo', [schedule.randomBetween(15, 20, () => 0), schedule.randomBetween(15, 20, () => 0.999)], [15, 20])

// lotes
check('validateSlots ok', schedule.validateSlots([{ position: 0, run_at: '2026-08-19T13:00:00Z', quantity: 2 }, { position: 1, run_at: '2026-08-19T15:00:00Z', quantity: 3 }], 5), { ok: true })
check('validateSlots soma errada', schedule.validateSlots([{ position: 0, run_at: '2026-08-19T13:00:00Z', quantity: 2 }], 5).ok, false)
check('validateSlots fora de ordem', schedule.validateSlots([{ position: 0, run_at: '2026-08-19T15:00:00Z', quantity: 2 }, { position: 1, run_at: '2026-08-19T13:00:00Z', quantity: 3 }], 5).ok, false)

// destinatários
const built = recipients.buildRecipientsFromRows(
  [{ nome: 'A', telefone: '(11) 99999-8888' }, { nome: 'B', telefone: '11999998888' }, { nome: 'C', telefone: 'abc' }, { nome: 'D', telefone: '(21) 98888-7777' }],
  'telefone', 'nome',
)
check('dedupe + inválidos', [built.recipients.length, built.invalid.length, built.duplicates], [2, 1, 1])
check('variáveis únicas', recipients.uniqueVariableNames(['Nome', 'Telefone', 'nome', 'Valor (R$)']), ['nome', 'telefone', 'nome_2', 'valor_r'])
check('guessPhoneColumn', recipients.guessPhoneColumn(['nome', 'celular_whatsapp']), 'celular_whatsapp')
check('parsePastedTable', recipients.parsePastedTable('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
check('readPath array', recipients.readPath({ socios: [{ phone: '1' }, { phone: '2' }, {}] }, 'socios[].phone'), ['1', '2'])
check('readPath simples', recipients.readPath({ commercial: { whatsapp_atendimento: '9' } }, 'commercial.whatsapp_atendimento'), ['9'])

console.log(`\n${pass} passaram, ${fail} falharam`)
if (failures.length) console.log(failures.join('\n'))
process.exit(fail ? 1 : 0)
