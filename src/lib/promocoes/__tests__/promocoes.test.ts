/** Frente A — lógica pura da promoção NuAzul Servidor Premiado. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularElegibilidade, direitosDoIndicador, montarSnapshotGeracao, indicacaoVale, inscricaoPodeSerIndicada, operacoesConsideradasParaIndicador, pctCartaoDaFaixa } from '../elegibilidade.ts'
import { PARAMETROS_PADRAO, type OperacaoConfirmada } from '../tipos.ts'
import { apurarContemplado, parseNumeroLoteria } from '../sorteio.ts'
import { ehDiaUtil, prazoLink, prazoPix, somarDiasUteis, dataCivilSp } from '../dias-uteis.ts'
import { cpfValido, maiorDe18, validarNascimento, decidirNascimentoNoContato, nomeCompletoValido, pixValido, telefoneBrValido, telefoneParaE164Digitos, textoConvenioLivre } from '../validacao.ts'
import { formatarCnpj, formatarCpf, formatarValor, mascararCpf, mascararPix, mascararTelefone, nomeCurto } from '../mascara.ts'
import { formatarCodigo, formatarNumeroSorte, gerarCodigoOtp, gerarToken, hashToken } from '../codigos.ts'
import { textoAvisoPagamento, textoAberturaAtendimento, urlWhatsapp, textoLinkIndicador } from '../mensagens.ts'

const op = (id: string, tipo: OperacaoConfirmada['tipo'], reais: number, dig = '2026-10-05', pag: string | null = '2026-10-06'): OperacaoConfirmada => ({
  id, tipo, valorCentavos: Math.round(reais * 100), dataDigitacao: dig, dataPagamento: pag,
})

// ---------------------------------------------------------------- elegibilidade
test('exemplo do regulamento: 7.500 → 2 números e saldo 2.500; +2.500 → mais 2 (4 no total)', () => {
  const ops1 = [op('a', 'novo', 3750), op('b', 'saque_cartao_consignado', 3750)]
  const e1 = calcularElegibilidade(ops1, 0)
  assert.equal(e1.numerosCalculados, 2)
  assert.equal(e1.numerosAEmitir, 2)
  assert.equal(e1.saldoCentavos, 250000)
  assert.equal(e1.proporcaoOk, true) // 50% de cartão na faixa 5–10 mil

  const ops2 = [...ops1, op('c', 'saque_cartao_beneficio', 2500)]
  const e2 = calcularElegibilidade(ops2, 2)
  assert.equal(e2.totalCentavos, 1000000)
  assert.equal(e2.pct, 50) // 10.000,00 ainda está na faixa 50%
  assert.equal(e2.numerosDevidos, 4)
  assert.equal(e2.numerosAEmitir, 2)
  assert.equal(e2.saldoCentavos, 0)
})

test('faixas de proporção: limites inclusivos em centavos', () => {
  const f = PARAMETROS_PADRAO.faixasCartao
  assert.equal(pctCartaoDaFaixa(500000, f), 50)
  assert.equal(pctCartaoDaFaixa(1000000, f), 50)
  assert.equal(pctCartaoDaFaixa(1000001, f), 40)
  assert.equal(pctCartaoDaFaixa(1500000, f), 40)
  assert.equal(pctCartaoDaFaixa(1500001, f), 30)
  assert.equal(pctCartaoDaFaixa(2000001, f), 25)
  assert.equal(pctCartaoDaFaixa(3000000, f), 25)
  assert.equal(pctCartaoDaFaixa(3000001, f), 20)
  assert.equal(pctCartaoDaFaixa(99999999, f), 20)
})

test('abaixo do mínimo ou sem proporção → 0 novos; informa saldo e cartão faltante', () => {
  const e = calcularElegibilidade([op('a', 'novo', 4000)], 0)
  assert.equal(e.atingiuMinimo, false)
  assert.equal(e.numerosCalculados, 0)
  assert.equal(e.saldoCentavos, 400000)

  const semCartao = calcularElegibilidade([op('a', 'novo', 8000)], 0)
  assert.equal(semCartao.proporcaoOk, false)
  assert.equal(semCartao.numerosCalculados, 0)
  assert.equal(semCartao.cartaoFaltanteCentavos, 400000) // 50% de 8.000
})

test('nunca revoga: proporção quebra depois de emitir → devidos = emitidos, a emitir = 0', () => {
  const ops = [op('a', 'novo', 2500), op('b', 'saque_cartao_consignado', 2500), op('c', 'novo', 6000)]
  // total 11.000 → faixa 40% → cartão 2.500 (22,7%) não bate
  const e = calcularElegibilidade(ops, 2)
  assert.equal(e.proporcaoOk, false)
  assert.equal(e.numerosCalculados, 0)
  assert.equal(e.numerosDevidos, 2)
  assert.equal(e.numerosAEmitir, 0)
  assert.equal(e.saldoCentavos, 100000)
})

test('regra de data da indicação (§9): modos', () => {
  const ops = [
    op('antes', 'novo', 3000, '2026-10-02', '2026-10-09'),
    op('depois', 'saque_cartao_consignado', 3000, '2026-10-10', '2026-10-12'),
  ]
  const inscrita = '2026-10-08T22:30:00Z' // 19:30 em SP de 08/10
  assert.deepEqual(operacoesConsideradasParaIndicador(ops, inscrita, 'sem_restricao').map((o) => o.id), ['antes', 'depois'])
  // 1ª proposta em 02/10 < indicação 08/10 → indicação não vale: nada conta
  assert.deepEqual(operacoesConsideradasParaIndicador(ops, inscrita, 'digitacao_apos_inscricao', '2026-10-02').map((o) => o.id), [])
  assert.deepEqual(operacoesConsideradasParaIndicador(ops, inscrita, 'pagamento_apos_inscricao').map((o) => o.id), ['antes', 'depois'])
  assert.equal(dataCivilSp('2026-10-09T02:30:00Z'), '2026-10-08')
})

test('§9.1/9.3: indicação antes da 1ª proposta vale; depois não vale', () => {
  const ops = [op('a', 'novo', 6000, '2026-10-10', '2026-10-15')]
  assert.equal(indicacaoVale('2026-10-08T15:00:00Z', '2026-10-10'), true)
  assert.equal(operacoesConsideradasParaIndicador(ops, '2026-10-08T15:00:00Z', 'digitacao_apos_inscricao', '2026-10-10').length, 1)
  assert.equal(indicacaoVale('2026-10-12T15:00:00Z', '2026-10-10'), false)
  assert.equal(operacoesConsideradasParaIndicador(ops, '2026-10-12T15:00:00Z', 'digitacao_apos_inscricao', '2026-10-10').length, 0)
  assert.equal(direitosDoIndicador(operacoesConsideradasParaIndicador(ops, '2026-10-12T15:00:00Z', 'digitacao_apos_inscricao', '2026-10-10')).pixDevido, false)
})

test('§9.6: proposta cancelada e substituída — vale pela PRIMEIRA (a cancelada entra no mínimo)', () => {
  // cancelada digitada 10/10, substituta 14/10; indicação 09/10 antes da primeira → vale
  const confirmadas = [op('nova', 'novo', 6000, '2026-10-14', '2026-10-16')]
  assert.equal(operacoesConsideradasParaIndicador(confirmadas, '2026-10-09T15:00:00Z', 'digitacao_apos_inscricao', '2026-10-10').length, 1)
  // indicação 12/10: depois da cancelada (1ª), ainda que antes da substituta → não vale
  assert.equal(operacoesConsideradasParaIndicador(confirmadas, '2026-10-12T15:00:00Z', 'digitacao_apos_inscricao', '2026-10-10').length, 0)
})

test('§9.4: inscrição direta não vincula; indicação anterior + inscrição posterior vincula', () => {
  assert.equal(inscricaoPodeSerIndicada('direta', '2026-10-09T10:00:00Z', '2026-10-08T10:00:00Z'), false)
  assert.equal(inscricaoPodeSerIndicada('indicacao', '2026-10-07T10:00:00Z', '2026-10-08T10:00:00Z'), false)
  assert.equal(inscricaoPodeSerIndicada('indicacao', '2026-10-09T10:00:00Z', '2026-10-08T10:00:00Z'), true)
})

test('§9: sem nenhuma proposta ainda (servidor indicado que se inscreve depois) → vale', () => {
  assert.equal(indicacaoVale('2026-10-08T15:00:00Z', null), true)
})

test('direitos do indicador: pix só exige mínimo; número exige proporção; máx 1', () => {
  const soNovo = direitosDoIndicador([op('a', 'novo', 6000)])
  assert.equal(soNovo.pixDevido, true)
  assert.equal(soNovo.numeroDevido, false)
  const comCartao = direitosDoIndicador([op('a', 'novo', 3000), op('b', 'saque_cartao_beneficio', 3000)])
  assert.equal(comCartao.pixDevido, true)
  assert.equal(comCartao.numeroDevido, true)
  assert.equal(direitosDoIndicador([op('a', 'novo', 4999.99)]).pixDevido, false)
})

test('snapshot incremental: consome operações em ordem e pula o já utilizado', () => {
  const ops = [op('b', 'saque_cartao_consignado', 3750, '2026-10-05', '2026-10-07'), op('a', 'novo', 3750, '2026-10-05', '2026-10-06'), op('c', 'saque_cartao_beneficio', 2500, '2026-10-10', '2026-10-11')]
  const s1 = montarSnapshotGeracao(ops, 0, 2)
  assert.equal(s1.usadoNestaCentavos, 500000)
  assert.equal(s1.saldoCentavos, 500000)
  assert.deepEqual(s1.vinculos, [{ operacaoId: 'a', valorUtilizadoCentavos: 375000 }, { operacaoId: 'b', valorUtilizadoCentavos: 125000 }])
  const s2 = montarSnapshotGeracao(ops, 500000, 2)
  assert.deepEqual(s2.vinculos, [{ operacaoId: 'b', valorUtilizadoCentavos: 250000 }, { operacaoId: 'c', valorUtilizadoCentavos: 250000 }])
  assert.equal(s2.saldoCentavos, 0)
})

// ---------------------------------------------------------------- sorteio
test('aproximação circular: exato, superior antes de inferior, wrap 99999→00000', () => {
  assert.deepEqual(apurarContemplado(12345, new Set([12345])), { numero: 12345, distancia: 0, direcao: 'exato' })
  assert.deepEqual(apurarContemplado(100, new Set([103, 97])), { numero: 103, distancia: 3, direcao: 'superior' }) // equidistante → superior
  assert.deepEqual(apurarContemplado(100, new Set([104, 97])), { numero: 97, distancia: 3, direcao: 'inferior' })
  assert.deepEqual(apurarContemplado(99999, new Set([0])), { numero: 0, distancia: 1, direcao: 'superior' })
  assert.deepEqual(apurarContemplado(0, new Set([99998])), { numero: 99998, distancia: 2, direcao: 'inferior' })
  assert.equal(apurarContemplado(5, new Set()), null)
  assert.equal(parseNumeroLoteria('12.345'), 12345)
  assert.equal(parseNumeroLoteria('012345'), 12345)
  assert.equal(parseNumeroLoteria('123'), null)
})

// ---------------------------------------------------------------- dias úteis
test('dias úteis atravessando 12/10 e 02/11; prazos de 3 e 5', () => {
  assert.equal(ehDiaUtil('2026-10-12'), false)
  assert.equal(ehDiaUtil('2026-10-13'), true)
  assert.equal(ehDiaUtil('2026-10-10'), false) // sábado
  assert.equal(somarDiasUteis('2026-10-09', 1), '2026-10-13') // sex → pula sáb, dom, feriado
  assert.equal(somarDiasUteis('2026-10-30', 1), '2026-11-03') // sex → sáb, dom, Finados
  // confirmada 09/10 22:00 SP (= 10/10 01:00 UTC) → base 09/10
  assert.equal(prazoLink('2026-10-10T01:00:00Z'), '2026-10-15')
  assert.equal(prazoPix('2026-10-10T01:00:00Z'), '2026-10-19')
})

// ---------------------------------------------------------------- validação
test('CPF: válido, inválido, repetido, com máscara', () => {
  assert.equal(cpfValido('529.982.247-25'), true)
  assert.equal(cpfValido('52998224725'), true)
  assert.equal(cpfValido('52998224726'), false)
  assert.equal(cpfValido('11111111111'), false)
  assert.equal(cpfValido('123'), false)
})

test('telefone BR e E.164', () => {
  assert.equal(telefoneBrValido('(61) 99999-0000'), true)
  assert.equal(telefoneBrValido('6199990000'), true) // fixo 10 dígitos
  assert.equal(telefoneBrValido('61899990000'), false) // 11 dígitos sem 9
  assert.equal(telefoneBrValido('0199999000'), false) // DDD inválido
  assert.equal(telefoneParaE164Digitos('+55 61 99999-0000'), '5561999990000')
  assert.equal(telefoneParaE164Digitos('61999990000'), '5561999990000')
  assert.equal(telefoneParaE164Digitos('123'), null)
})

test('maior de 18, nome completo, pix', () => {
  assert.equal(maiorDe18('2008-10-02', '2026-10-02'), true)
  assert.equal(maiorDe18('2008-10-03', '2026-10-02'), false)
  assert.equal(nomeCompletoValido('Maria da Silva'), true)
  assert.equal(nomeCompletoValido('Maria'), false)
  assert.equal(nomeCompletoValido('Jo3 Silva'), false)
  assert.equal(pixValido('email', 'a@b.co'), true)
  assert.equal(pixValido('aleatoria', '123e4567-e89b-12d3-a456-426614174000'), true)
  assert.equal(pixValido('aleatoria', 'abc'), false)
  assert.equal(pixValido('cpf', '52998224725'), true)
  assert.equal(pixValido('dados_bancarios', null), true)
})

// ---------------------------------------------------------------- máscaras e códigos
test('máscaras no padrão do regulamento', () => {
  assert.equal(mascararCpf('12345678901'), '*23.***.789-**') // visíveis: dígitos 2–3 e 7–9
  assert.equal(formatarCpf('12345678901'), '123.456.789-01')
  assert.equal(mascararTelefone('5561999990000'), '(61) *****-0000')
  assert.equal(mascararPix('email', 'maria@gmail.com'), 'm***@gmail.com')
  assert.equal(nomeCurto('Maria da Silva Souza'), 'Maria S.')
  assert.equal(formatarValor(5000), '50,00')
  assert.equal(formatarValor(123456), '1.234,56')
  assert.equal(formatarCodigo('VPG', 100001), 'VPG-100001')
  assert.equal(formatarNumeroSorte(7), '00007')
})

test('token e OTP', () => {
  const t = gerarToken()
  assert.equal(t.hash, hashToken(t.token))
  assert.equal(t.hash.length, 64)
  assert.ok(t.token.length >= 43)
  assert.match(gerarCodigoOtp(), /^\d{6}$/)
})

// ---------------------------------------------------------------- mensagens
test('M6 — aviso de pagamento segue o texto exato', () => {
  const txt = textoAvisoPagamento({
    valor: formatarValor(10000),
    itens: [{ nome: 'Fulano de Tal', cpfMascarado: mascararCpf('12345678901') }, { nome: 'Ciclano Silva', cpfMascarado: mascararCpf('98765432100') }],
    pixChave: '52998224725',
    pagadorCnpjFmt: formatarCnpj('41356863000183'),
    pagadorNome: 'Blue Pay Solutions Ltda',
  })
  assert.equal(txt, [
    'Pela sua indicação na promoção NuAzul - Você sempre no azul | Servidor Premiado, hoje estamos realizando o pagamento de R$ 100,00 referente as indicações abaixo. Obrigado!',
    'Fulano de Tal - CPF *23.***.789-**',
    'Ciclano Silva - CPF *87.***.321-**',
    '',
    'Para sua conferência o valor será pago pelo CNPJ 41.356.863/0001-83 em nome de Blue Pay Solutions Ltda até as 20:00h de hoje no pix cadastrado:',
    'Chave Pix: 52998224725',
  ].join('\n'))
})

test('M7 — abertura do atendimento e URL wa.me', () => {
  const texto = textoAberturaAtendimento({ codigo: 'VPG-100001', numeroIndicacao: 'IND-100002' })
  assert.ok(texto.endsWith('Meu código de inscrição é VPG-100001. Número de indicação: IND-100002.'))
  assert.ok(urlWhatsapp('5561999990000', 'oi lá').startsWith('https://wa.me/5561999990000?text=oi%20l'))
})

test('telefoneParaE164Digitos normaliza para wa.me (55 + DDD + número)', () => {
  assert.equal(telefoneParaE164Digitos('6131991754'), '556131991754')
  assert.equal(telefoneParaE164Digitos('61981617033'), '5561981617033')
  assert.equal(telefoneParaE164Digitos('556131991754'), '556131991754')
  assert.equal(telefoneParaE164Digitos('(61) 3199-1754'), '556131991754')
  assert.equal(telefoneParaE164Digitos(''), null)
})

test('texto do sorteio lê a data da campanha, com fallback 09/12/2026', () => {
  const v = { nome: 'A', indicado: 'B', url: 'u', prazo: '2026-12-08', contato: '61999999999' }
  assert.match(textoLinkIndicador({ ...v, sorteio: '2026-12-09' }), /Federal de 09\/12\/2026/)
  assert.match(textoLinkIndicador(v), /Federal de 09\/12\/2026/)
  assert.match(textoLinkIndicador({ ...v, sorteio: '2026-12-16' }), /Federal de 16\/12\/2026/)
})

test('validarNascimento: ausente, inválida, futura e menor falham; válida passa', () => {
  const hoje = '2026-10-03'
  assert.equal(validarNascimento(undefined, hoje), null)
  assert.equal(validarNascimento('', hoje), null)
  assert.equal(validarNascimento('1990-02-30', hoje), null)
  assert.equal(validarNascimento('lixo', hoje), null)
  assert.equal(validarNascimento('2027-01-01', hoje), null)
  assert.equal(validarNascimento('2008-10-04', hoje), null)
  assert.equal(validarNascimento('2008-10-03', hoje), '2008-10-03')
  assert.equal(validarNascimento('1985-05-20', hoje), '1985-05-20')
})

test('decidirNascimentoNoContato: vazio grava, igual mantém, diferente diverge', () => {
  assert.equal(decidirNascimentoNoContato(undefined, '1985-05-20'), 'gravar')
  assert.equal(decidirNascimentoNoContato('', '1985-05-20'), 'gravar')
  assert.equal(decidirNascimentoNoContato('1985-05-20T00:00:00.000Z', '1985-05-20'), 'manter')
  assert.equal(decidirNascimentoNoContato('1990-01-01', '1985-05-20'), 'divergente')
})

test('textoConvenioLivre: trim, sem HTML, limite 120, vazio → null', () => {
  assert.equal(textoConvenioLivre('  Prefeitura   de <b>Formosa</b>\n '), 'Prefeitura de Formosa')
  assert.equal(textoConvenioLivre('<script>x</script>'), null)
  assert.equal(textoConvenioLivre('a'), null)
  assert.equal(textoConvenioLivre(123), null)
  assert.equal(textoConvenioLivre('x'.repeat(300))?.length, 120)
})
