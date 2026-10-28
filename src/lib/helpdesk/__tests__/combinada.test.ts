/** HelpDesk combinada: código HD, responsável e etapas. Roda com: npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codigoHelpdesk, podeAgirMcp, validarAnexos, validarEtapasMcp } from '../validacao.ts'

const PESSOA = '11111111-2222-3333-4444-555555555555'

test('código HD: 4 dígitos com zero à esquerda, sem truncar acima de 9999', () => {
  assert.equal(codigoHelpdesk(1), 'HD-0001')
  assert.equal(codigoHelpdesk('42'), 'HD-0042')
  assert.equal(codigoHelpdesk(12345), 'HD-12345')
  for (const v of [null, undefined, 0, -1, 1.5, 'x']) assert.equal(codigoHelpdesk(v), 'HD-????')
})

test('pessoa responsável: IA não propõe plano nem executa, mas comenta e registra', () => {
  const comPessoa = (status: string) => ({ status, aprovado_por: PESSOA, responsavel_id: PESSOA })
  assert.equal(podeAgirMcp('propor_plano', comPessoa('aberto')).ok, false)
  assert.equal(podeAgirMcp('iniciar_execucao', comPessoa('aprovado')).ok, false)
  assert.equal(podeAgirMcp('comentar', comPessoa('aberto')).ok, true)
  assert.equal(podeAgirMcp('registrar_resultado', comPessoa('em_execucao')).ok, false)
  // sem responsável (ou só IA): regras de antes
  assert.equal(podeAgirMcp('propor_plano', { status: 'aberto', aprovado_por: null, responsavel_id: null }).ok, true)
  assert.equal(podeAgirMcp('iniciar_execucao', { status: 'aprovado', aprovado_por: PESSOA }).ok, true)
})

test('etapas: só com plano proposto, aprovado ou em execução', () => {
  for (const s of ['plano_proposto', 'aprovado', 'em_execucao']) assert.equal(podeAgirMcp('definir_etapas', { status: s, aprovado_por: null }).ok, true)
  for (const s of ['aberto', 'concluido', 'rejeitado']) assert.equal(podeAgirMcp('definir_etapas', { status: s, aprovado_por: null }).ok, false)
})

test('validação das etapas', () => {
  const r = validarEtapasMcp([{ titulo: ' migration ' }, { titulo: 'tela', status: 'concluida' }])
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.etapas, [{ titulo: 'migration', status: 'pendente' }, { titulo: 'tela', status: 'concluida' }])
  assert.equal(validarEtapasMcp([]).ok, false)
  assert.equal(validarEtapasMcp('x').ok, false)
  assert.equal(validarEtapasMcp([{ titulo: '' }]).ok, false)
  assert.equal(validarEtapasMcp([{ titulo: 'a', status: 'feita' }]).ok, false)
  assert.equal(validarEtapasMcp([{ titulo: 'a'.repeat(241) }]).ok, false)
  assert.equal(validarEtapasMcp(Array.from({ length: 21 }, () => ({ titulo: 'a' }))).ok, false)
})

test('imagem de comentário: mesma regra de path da abertura', () => {
  assert.equal(validarAnexos([{ path: `${PESSOA}/1760000000000-abc.png`, name: 'a.png', size: 10, type: 'image/png' }], PESSOA).ok, true)
  assert.equal(validarAnexos([{ path: `99999999-2222-3333-4444-555555555555/1-a.png`, name: 'a.png', size: 10, type: 'image/png' }], PESSOA).ok, false)
  assert.equal(validarAnexos(undefined, PESSOA).ok, true)
})
