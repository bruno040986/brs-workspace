'use client'

/**
 * Card dedicado do Amigoz (login de operador + corban) com o painel de
 * DESCOBERTA: dispara as operações de leitura/simulação da API e mostra a
 * resposta bruta — é assim que fixamos o formato das margens e ofertas antes
 * de desenhar as telas (Fatia 2). Nada aqui cria cliente ou contrato.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, FlaskConical, KeyRound, Loader2, PlugZap, Save } from 'lucide-react'
import {
  executarDescobertaAmigoz,
  lerConfigAmigoz,
  listarChamadasAmigoz,
  salvarConfigAmigoz,
  testarConexaoAmigoz,
  type ChamadaResumo,
  type OperacaoDescoberta,
  type RespostaDescoberta,
} from '@/lib/if-credito/amigoz-actions'
import type { InstituicaoConfigResumo } from '@/lib/if-credito/config-actions'

const ROTULO: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

/** Modelos de payload por operação (campos da doc, valores de exemplo). */
const MODELOS: Record<OperacaoDescoberta, { rotulo: string; payload: string; dica: string }> = {
  convenios: { rotulo: 'Convênios do corban (GET)', payload: '', dica: 'Sem parâmetros.' },
  'consulta-margem': {
    rotulo: 'Consulta de margem (POST)',
    payload: '{\n  "cpf": "00000000000",\n  "averbadora": 5,\n  "convenio": 0,\n  "numero_matricula": null,\n  "senha_servidor": null\n}',
    dica: 'Averbadoras: 1 FACIL · 2 ZETRASOFT · 3 QUANTUM · 5 DATAPREV · 6 SERPRO · 7 NEOCONSIG · 8 SAFECONSIG. O id do convênio vem da lista de convênios.',
  },
  cartoes: { rotulo: 'Limite e status do cartão (POST)', payload: '{\n  "cpf": "00000000000"\n}', dica: 'Só para CPF com cartão ativo no Amigoz.' },
  'simulacao-cartao': {
    rotulo: 'Simulação de novo cartão (POST)',
    payload: '{\n  "cpf": "00000000000",\n  "convenio": 0,\n  "tipo_margem": 1,\n  "tipo_produto": 7,\n  "data_nascimento": "1980-01-01",\n  "margem": 0,\n  "margem_saque": 0\n}',
    dica: 'tipo_produto: 7 Cartão Benefício · 15 Cartão Consignado. Só simula, não digita.',
  },
  'simulacao-saque-v2': { rotulo: 'Simulação de saque complementar v2 (POST)', payload: '{\n  "cpf": "00000000000"\n}', dica: 'Cliente que já tem cartão.' },
  contratos: { rotulo: 'Listar contratos (GET)', payload: '{\n  "page": 1,\n  "items_per_page": 10\n}', dica: 'Filtros opcionais: cpf, status, tipo_produto.' },
}

function JsonBox({ valor }: { valor: unknown }) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2)
  return (
    <pre style={{ margin: 0, padding: '0.7rem', background: 'var(--brs-gray-50, #f8fafc)', border: '1px solid var(--brs-gray-200)', borderRadius: 8, fontSize: '0.72rem', maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {texto}
    </pre>
  )
}

export function AmigozCard({
  instituicao,
  logo,
  onAtualizado,
}: {
  instituicao: InstituicaoConfigResumo
  logo: React.ReactNode
  onAtualizado: (patch: Partial<InstituicaoConfigResumo>) => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [baseUrl, setBaseUrl] = useState('')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [corbanId, setCorbanId] = useState('')
  const [ativo, setAtivo] = useState(false)
  const [temSenha, setTemSenha] = useState(false)
  const [tokenExpira, setTokenExpira] = useState<string | null>(null)

  const [operacao, setOperacao] = useState<OperacaoDescoberta>('consulta-margem')
  const [payload, setPayload] = useState(MODELOS['consulta-margem'].payload)
  const [executando, setExecutando] = useState(false)
  const [resposta, setResposta] = useState<RespostaDescoberta | null>(null)
  const [historico, setHistorico] = useState<ChamadaResumo[]>([])
  const [aberto, setAberto] = useState<string | null>(null)

  async function recarregarHistorico() {
    const res = await listarChamadasAmigoz(20)
    if (res.success) setHistorico(res.data || [])
  }

  useEffect(() => {
    lerConfigAmigoz(instituicao.id)
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Erro ao carregar configuração.')
          return
        }
        setBaseUrl(res.data.base_url)
        setUsuario(res.data.usuario)
        setCorbanId(res.data.corban_id_externo)
        setAtivo(res.data.ativo)
        setTemSenha(res.data.temSenha)
        setTokenExpira(res.data.token_expira_em)
      })
      .catch(() => setErro('Erro ao carregar configuração.'))
      .finally(() => setCarregando(false))
    listarChamadasAmigoz(20).then((res) => {
      if (res.success) setHistorico(res.data || [])
    })
  }, [instituicao.id])

  async function salvar() {
    if (salvando) return
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await salvarConfigAmigoz({
        instituicao_financeira_id: instituicao.id,
        base_url: baseUrl,
        usuario,
        senha: senha.trim() || undefined,
        corban_id_externo: corbanId,
        ativo,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (senha.trim()) {
        setTemSenha(true)
        setTokenExpira(null)
      }
      setSenha('')
      onAtualizado({ temConfig: true, ativo })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    if (testando) return
    setTestando(true)
    setErro('')
    setOkMsg('')
    setResposta(null)
    try {
      const res = await testarConexaoAmigoz()
      if (!res.success || !res.data) throw new Error(res.error)
      setOkMsg('Conexão OK: login, corban e convênios responderam.')
      setResposta(res.data)
      const cfg = await lerConfigAmigoz(instituicao.id)
      if (cfg.success && cfg.data) setTokenExpira(cfg.data.token_expira_em)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no teste de conexão.')
    } finally {
      setTestando(false)
      recarregarHistorico()
    }
  }

  async function executar() {
    if (executando) return
    setExecutando(true)
    setErro('')
    setResposta(null)
    try {
      const res = await executarDescobertaAmigoz({ operacao, payloadJson: payload })
      if (!res.success || !res.data) throw new Error(res.error)
      setResposta(res.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro na descoberta.')
    } finally {
      setExecutando(false)
      recarregarHistorico()
    }
  }

  return (
    <div className="card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        {logo}
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {instituicao.name}
            {temSenha && (
              <span style={{ fontSize: '0.68rem', color: 'var(--brs-success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> configurada
              </span>
            )}
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
            Cartão benefício/consignado e saque — login de operador + corban (JWT), REST síncrona, sem webhook
          </span>
        </div>
      </div>

      {erro && <div style={{ padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{erro}</div>}
      {okMsg && <div style={{ padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8, background: 'rgba(22,163,74,0.08)', color: 'var(--brs-success)', fontWeight: 600, fontSize: '0.8rem' }}>{okMsg}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '1rem 0' }}><Loader2 size={18} className="animate-spin" /> Carregando configuração…</div>
      ) : (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <KeyRound size={14} /> Credencial
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <div>
              <label style={ROTULO}>Base URL</label>
              <input className="form-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://parceiros.amigozconsig.com.br" />
            </div>
            <div>
              <label style={ROTULO}>ID do corban no Amigoz</label>
              <input className="form-control" value={corbanId} onChange={(e) => setCorbanId(e.target.value)} placeholder="ex.: 123" inputMode="numeric" autoComplete="off" />
            </div>
            <div>
              <label style={ROTULO}>Usuário</label>
              <input className="form-control" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label style={ROTULO}>Senha {temSenha ? '(preencha só para trocar)' : ''}</label>
              <input className="form-control" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={temSenha ? '•••• já configurada' : ''} autoComplete="new-password" />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Integração ativa
            </label>
            {tokenExpira && (
              <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
                Token em cache válido até {new Date(tokenExpira).toLocaleString('pt-BR')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
            </button>
            <button className="btn btn-outline" onClick={testar} disabled={testando || !temSenha} title={!temSenha ? 'Salve usuário e senha primeiro' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {testando ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Testar conexão e listar convênios
            </button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--brs-gray-200)', margin: '1.2rem 0' }} />

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FlaskConical size={14} /> Descoberta — chamadas de leitura e simulação (resposta bruta)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.8rem', alignItems: 'start' }}>
            <div>
              <label style={ROTULO}>Operação</label>
              <select
                className="form-control"
                value={operacao}
                onChange={(e) => {
                  const op = e.target.value as OperacaoDescoberta
                  setOperacao(op)
                  setPayload(MODELOS[op].payload)
                }}
              >
                {(Object.keys(MODELOS) as OperacaoDescoberta[]).map((op) => (
                  <option key={op} value={op}>{MODELOS[op].rotulo}</option>
                ))}
              </select>
              <p style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', margin: '0.5rem 0 0' }}>{MODELOS[operacao].dica}</p>
              <button className="btn btn-primary btn-sm" onClick={executar} disabled={executando || !temSenha} style={{ marginTop: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {executando ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Executar
              </button>
            </div>
            <div>
              <label style={ROTULO}>Payload (JSON) — corpo no POST, query no GET</label>
              <textarea className="form-control" rows={8} value={payload} onChange={(e) => setPayload(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} spellCheck={false} />
            </div>
          </div>

          {resposta && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.4rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${resposta.sucesso ? 'badge-success' : 'badge-danger'}`}>HTTP {resposta.http_status || '—'}</span>
                <span>{resposta.operacao}</span>
                <span style={{ color: 'var(--brs-gray-400)', fontWeight: 500 }}>{resposta.duracao_ms} ms</span>
              </div>
              <JsonBox valor={resposta.corpo} />
            </div>
          )}

          {historico.length > 0 && (
            <div style={{ marginTop: '1.2rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-500)', marginBottom: '0.4rem' }}>Últimas chamadas registradas</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Quando</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Operação</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>HTTP</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>ms</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((c) => (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--brs-gray-100, #f1f5f9)' }}>
                        <td style={{ padding: '0.3rem 0.4rem', whiteSpace: 'nowrap' }}>{new Date(c.created_at).toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{c.operacao} <span style={{ color: 'var(--brs-gray-400)' }}>{c.metodo} {c.caminho}</span></td>
                        <td style={{ padding: '0.3rem 0.4rem' }}><span className={`badge ${c.sucesso ? 'badge-success' : 'badge-danger'}`}>{c.http_status ?? '—'}</span></td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{c.duracao_ms ?? '—'}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setAberto(aberto === c.id ? null : c.id)}>{aberto === c.id ? 'Fechar' : 'Ver resposta'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {aberto && <div style={{ marginTop: '0.6rem' }}><JsonBox valor={historico.find((c) => c.id === aberto)?.resposta ?? null} /></div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
