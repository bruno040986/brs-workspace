import { describe, it } from 'node:test'
import assert from 'node:assert'
import { estimarTokens, mesclarPerfil, montarPrompt, restaurarOverride, validarPerfil, type PerfilQualificacao } from '../perfis.ts'

const padrao = {
  identidade: { nome_assistente: 'Lia' },
  tom: 'cordial',
  objetivo: 'qualificar',
  limites: { max_turnos: 10, max_msgs_agente: { ycloud: 10, baileys: 25, zapi: 25 }, gasto_dia_max_usd: 5, proibicoes: ['a'] },
  coleta: [{ ordem: 1, campo: 'nome', obrigatorio: true }, { ordem: 2, campo: 'produto', obrigatorio: true, opcoes: ['fgts'] }],
  pos_qualificacao: { pedir_documento: false, mensagem_transferencia: '', mensagem_espera: '', mensagem_fora_expediente: '', mensagem_fallback_erro: '', mensagem_optout: '' },
  roteamento: { modo: 'rodizio', master_id: null, atendente_fixo_id: null, ordem: [], max_abertas: 5, espera_master_min: 15, destinos: {} },
  modelos: { provedor: 'openrouter', principal: 'm', fallbacks: [], fallback_gratuito: null },
  tempos: { agrupar_s: { ycloud: 8, baileys: 4, zapi: 4 }, digitacao_ms_por_char: 25, digitacao_min_ms: 1500, digitacao_max_ms: 4000, digitacao_oficial_ms: 0 },
  horario: { janela: null, fuso: 'America/Sao_Paulo' },
} as PerfilQualificacao

describe('perfis (fatia 3)', () => {
  it('merge aplica override por caminho sem tocar no padrão nem nos irmãos', () => {
    const r = mesclarPerfil(padrao, { 'identidade.nome_assistente': 'Ana', 'limites.max_turnos': 6 })
    assert.strictEqual(r.identidade.nome_assistente, 'Ana')
    assert.strictEqual(r.limites.max_turnos, 6)
    assert.strictEqual(r.limites.gasto_dia_max_usd, 5)
    assert.strictEqual(padrao.identidade.nome_assistente, 'Lia')
  })
  it('array é substituído inteiro e sem overrides devolve cópia igual', () => {
    assert.deepStrictEqual(mesclarPerfil(padrao, { 'limites.proibicoes': ['x', 'y'] }).limites.proibicoes, ['x', 'y'])
    assert.deepStrictEqual(mesclarPerfil(padrao, null), padrao)
  })
  it('restaurar remove o override e o merge volta ao padrão', () => {
    const ov = { 'identidade.nome_assistente': 'Ana', 'tom': 'seco' }
    const sem = restaurarOverride(ov, 'identidade.nome_assistente')
    assert.deepStrictEqual(sem, { tom: 'seco' })
    assert.strictEqual(mesclarPerfil(padrao, sem).identidade.nome_assistente, 'Lia')
    assert.deepStrictEqual(restaurarOverride(ov), {})
  })
  it('validação pega nome vazio, limites ruins e campo repetido', () => {
    assert.deepStrictEqual(validarPerfil(padrao), [])
    const ruim = mesclarPerfil(padrao, { 'identidade.nome_assistente': ' ', 'limites.max_turnos': 0, coleta: [{ ordem: 1, campo: 'a' }, { ordem: 2, campo: 'a' }] })
    assert.strictEqual(validarPerfil(ruim).length, 3)
  })
  it('prompt inclui nome, produtos e BC; tokens ~ 4 chars', () => {
    const t = montarPrompt(padrao, [{ titulo: 'T', conteudo_md: 'corpo' }])
    assert.ok(t.includes('Lia') && t.includes('fgts') && t.includes('corpo'))
    assert.strictEqual(estimarTokens('abcdefgh'), 2)
  })
})
