import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizarEvento, sanitizarPayload, hashCurto } from '../normalizar.ts'
import { classificarEvento, dentroDoExpediente, type HorarioDia } from '../regras.ts'

test('normalizar: sanitiza segredos, valida tipo, descarta IP inválido e id não-uuid', () => {
  const e = normalizarEvento({
    fonte: 'Workspace_Login', tipo: 'login.falha', identidadeInformada: '  Fulano@BRS.com  ', ipObservado: 'nao-e-ip',
    identidadeValidadaUserId: 'abc', payload: { etapa: 'senha', senha: 'x', nested: { token: 't', jwt: 'eyJhbGciOiJ.x.y', ok: 1 } },
  })
  assert.equal(e.fonte, 'workspace_login')
  assert.equal(e.identidade_informada, 'fulano@brs.com')
  assert.equal(e.ip_observado, null)
  assert.equal(e.identidade_validada_user_id, null)
  assert.deepEqual(e.payload, { etapa: 'senha', senha: '[removido]', nested: { token: '[removido]', jwt: '[removido]', ok: 1 } })
  assert.throws(() => normalizarEvento({ fonte: 'x', tipo: 'Tipo Inválido!' }))
})

test('sanitizar: limita profundidade, arrays e valores longos/segredos', () => {
  assert.equal(sanitizarPayload('a'.repeat(500)) === '[removido]', true) // 40+ chars sem espaço parece token
  assert.equal((sanitizarPayload('um texto normal '.repeat(30)) as string).length, 300)
  assert.equal((sanitizarPayload(Array.from({ length: 50 }, (_, i) => i)) as number[]).length, 20)
})

test('regras: falha de login gera duas classificações sem expor e-mail/IP na chave', () => {
  const e = normalizarEvento({ fonte: 'w', tipo: 'login.falha', identidadeInformada: 'a@b.c', ipObservado: '203.0.113.9' })
  const c = classificarEvento(e)
  assert.deepEqual(c.map((x) => x.regra), ['login_falhas_identificador', 'login_falhas_origem'])
  assert.equal(c[0].contexto, `ident:${hashCurto('a@b.c')}`)
  assert.ok(!JSON.stringify(c).includes('a@b.c') && !JSON.stringify(c).includes('203.0.113.9'))
  // variar o case do e-mail cai na mesma chave
  assert.equal(hashCurto('A@B.c'), hashCurto('a@b.c'))
})

test('regras: login concluído só alerta fora do expediente e com identidade validada', () => {
  const base = { fonte: 'w', tipo: 'login.concluido', identidadeValidadaUserId: '11111111-1111-4111-8111-111111111111' }
  assert.equal(classificarEvento(normalizarEvento(base), { foraDoExpediente: false }).length, 0)
  assert.equal(classificarEvento(normalizarEvento(base), { foraDoExpediente: null }).length, 0)
  assert.equal(classificarEvento(normalizarEvento({ ...base, identidadeValidadaUserId: null }), { foraDoExpediente: true }).length, 0)
  assert.equal(classificarEvento(normalizarEvento(base), { foraDoExpediente: true })[0].regra, 'login_fora_expediente')
  // login.falha nunca vira "fora do expediente"
  assert.ok(!classificarEvento(normalizarEvento({ fonte: 'w', tipo: 'login.falha', identidadeInformada: 'a@b.c' }), { foraDoExpediente: true }).some((x) => x.regra === 'login_fora_expediente'))
})

test('regras: permissão/perfil/signup/pausa', () => {
  const r = (tipo: string) => classificarEvento(normalizarEvento({ fonte: 'w', tipo }))
  assert.equal(r('permissao.alterada')[0].gravidade, 'alta')
  assert.equal(r('perfil.alterado')[0].regra, 'permissao_alterada')
  assert.equal(r('signup.tentativa')[0].gravidade, 'critica')
  assert.equal(r('login.pausa')[0].regra, 'login_reincidencia')
  assert.deepEqual(r('desconhecido.x'), [])
})

test('expediente: fuso de Brasília, dois turnos, dia desabilitado, sem horário', () => {
  const h: HorarioDia[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, enabled: d < 5, start_time_1: '08:00', end_time_1: '12:00', start_time_2: '13:30', end_time_2: '18:00' }))
  // 2026-11-02 é segunda. 10:00 BRT = 13:00Z
  assert.equal(dentroDoExpediente(h, new Date('2026-11-02T13:00:00Z')), true)
  assert.equal(dentroDoExpediente(h, new Date('2026-11-02T16:00:00Z')), false) // 13:00 BRT: intervalo
  assert.equal(dentroDoExpediente(h, new Date('2026-11-02T17:00:00Z')), true) // 14:00 BRT
  assert.equal(dentroDoExpediente(h, new Date('2026-11-02T22:00:00Z')), false) // 19:00 BRT
  assert.equal(dentroDoExpediente(h, new Date('2026-11-07T14:00:00Z')), false) // sábado desabilitado
  assert.equal(dentroDoExpediente(h, new Date('2026-11-03T02:30:00Z')), false) // domingo->segunda: 23:30 BRT de segunda
  assert.equal(dentroDoExpediente([], new Date()), null)
})

test('I-3: identidade informada só vale se parecer e-mail/CPF; senão hash + marcador', () => {
  const a = normalizarEvento({ fonte: 'x', tipo: 'login.falha', identidadeInformada: 'MinhaSenha@123!' })
  assert.match(a.identidade_informada!, /^formato_invalido:[0-9a-f]{16}$/)
  assert.equal(normalizarEvento({ fonte: 'x', tipo: 'a', identidadeInformada: 'Fulano@BRS.com' }).identidade_informada, 'fulano@brs.com')
  assert.equal(normalizarEvento({ fonte: 'x', tipo: 'a', identidadeInformada: '123.456.789-01' }).identidade_informada, '123.456.789-01')
})

test('I-4: payload grande é cortado antes de sanitizar e termina rápido', () => {
  const grande: Record<string, unknown> = {}
  for (let a = 0; a < 40; a++) { const m: Record<string, unknown> = {}; for (let b = 0; b < 40; b++) m['j' + b] = 'valor'.repeat(5); grande['k' + a] = m }
  const t = Date.now()
  const e = normalizarEvento({ fonte: 'x', tipo: 'a', payload: grande })
  assert.equal((e.payload as { truncado?: boolean }).truncado, true)
  assert.ok(Date.now() - t < 500)
})
