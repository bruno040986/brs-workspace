'use client'

/**
 * Provedores e APIs › API Kaizom (ex-"Motor de Crédito (MySQL)") — credencial do banco do
 * fornecedor de higienização de margem (convênios públicos), cofre AES +
 * Testar conexão + Explorar schema (DESCRIBE + amostra), pra mapear a
 * tabela `consultas` antes da sincronização de verdade (fase 2, depois de
 * conhecido o schema). Permissão: sistema-config-motor-credito.
 */
import { useEffect, useState } from 'react'
import { Database, Download, KeyRound, Loader2, PlugZap, RotateCcw, Save, Search } from 'lucide-react'
import {
  explorarMotorCreditoSchema,
  getMotorCreditoConfig,
  lerAgoraMotorCredito,
  reposicionarCursorMotorCredito,
  saveMotorCreditoConfig,
  testMotorCreditoConnection,
  type ExploracaoMotorCredito,
} from '@/lib/motor-credito/config-actions'

export default function MotorCreditoProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [explorando, setExplorando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [temSenha, setTemSenha] = useState(false)
  const [host, setHost] = useState('')
  const [porta, setPorta] = useState('3306')
  const [banco, setBanco] = useState('')
  const [tabela, setTabela] = useState('consultas')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [exploracao, setExploracao] = useState<ExploracaoMotorCredito | null>(null)
  const [cursorValor, setCursorValor] = useState<string | null>(null)
  const [ultimaLeituraEm, setUltimaLeituraEm] = useState<string | null>(null)
  const [ultimaLeituraQtd, setUltimaLeituraQtd] = useState<number | null>(null)
  const [lendo, setLendo] = useState(false)
  const [reposicionando, setReposicionando] = useState(false)
  const [novoCursor, setNovoCursor] = useState('')

  function aplicarConfig(data: NonNullable<Awaited<ReturnType<typeof getMotorCreditoConfig>>['data']>) {
    setTemSenha(data.temSenha)
    setHost(data.host)
    setPorta(String(data.porta))
    setBanco(data.banco)
    setTabela(data.tabela)
    setUsuario(data.usuario)
    setAtivo(data.ativo)
    setCursorValor(data.cursorValor)
    setUltimaLeituraEm(data.ultimaLeituraEm)
    setUltimaLeituraQtd(data.ultimaLeituraQtd)
  }

  useEffect(() => {
    getMotorCreditoConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        aplicarConfig(res.data)
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await saveMotorCreditoConfig({
        host,
        porta: Number(porta) || 3306,
        banco,
        tabela,
        usuario,
        senha: senha.trim() || undefined,
        ativo,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (senha.trim()) setTemSenha(true)
      setSenha('')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await testMotorCreditoConnection()
      if (!res.ok) throw new Error(res.detalhe)
      setOkMsg(res.detalhe)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no teste.')
    } finally {
      setTestando(false)
    }
  }

  async function explorar() {
    setExplorando(true)
    setErro('')
    setExploracao(null)
    try {
      const res = await explorarMotorCreditoSchema()
      if (!res.success) throw new Error(res.error)
      setExploracao(res.data || null)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao explorar.')
    } finally {
      setExplorando(false)
    }
  }

  async function lerAgora() {
    setLendo(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await lerAgoraMotorCredito()
      if (!res.success) throw new Error(res.error)
      const r = res.data
      if (r?.pulado === 'lease') setOkMsg('Já tem uma leitura em andamento (lease ocupado) — tente de novo em alguns segundos.')
      else if (r?.pulado === 'inativo') setOkMsg('Integração desativada — ligue "Integração ativa" e salve antes de ler.')
      else if (r?.pulado === 'nao_configurado') setOkMsg('Configure a credencial antes de ler.')
      else setOkMsg(`Lidas ${r?.lidas ?? 0} linha(s) novas (${r?.inseridas ?? 0} inserida(s) na staging).`)
      const cfg = await getMotorCreditoConfig()
      if (cfg.success && cfg.data) aplicarConfig(cfg.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao ler agora.')
    } finally {
      setLendo(false)
    }
  }

  async function reposicionarCursor() {
    if (!novoCursor.trim()) return
    if (!window.confirm(`Reposicionar o cursor pra "${novoCursor.trim()}"? A próxima leitura vai reler tudo que estiver DEPOIS deste id (linhas repetidas são ignoradas — id já existente na staging).`)) return
    setReposicionando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await reposicionarCursorMotorCredito(novoCursor.trim())
      if (!res.success) throw new Error(res.error)
      setOkMsg('Cursor reposicionado.')
      setNovoCursor('')
      const cfg = await getMotorCreditoConfig()
      if (cfg.success && cfg.data) aplicarConfig(cfg.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao reposicionar o cursor (só root).')
    } finally {
      setReposicionando(false)
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}>
        <Loader2 size={18} className="animate-spin" /> Carregando…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Database size={24} /> API Kaizom
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Banco MySQL da Kaizom, fornecedora de higienização de margem (convênios públicos). A senha fica cifrada no cofre — nunca
        aparece na tela depois de salva. O cron lê a tabela a cada 5 min pra uma staging de revisão — nada vai direto ao
        WeSales (ver Gestão de Leads › API Kaizom — Revisão de Margens).
      </p>

      {erro && (
        <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>
          {erro}
        </div>
      )}
      {okMsg && (
        <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>
          {okMsg}
        </div>
      )}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Credencial
          {temSenha && <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700 }}>· configurada ✓</span>}
        </h2>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label style={rotulo}>Host</label>
            <input className="form-control" value={host} onChange={(e) => setHost(e.target.value)} placeholder="147.93.32.177" />
          </div>
          <div className="form-group">
            <label style={rotulo}>Porta</label>
            <input className="form-control" value={porta} onChange={(e) => setPorta(e.target.value)} inputMode="numeric" placeholder="3306" />
          </div>
          <div className="form-group">
            <label style={rotulo}>Banco</label>
            <input className="form-control" value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="bancobrs" />
          </div>
          <div className="form-group">
            <label style={rotulo}>Tabela</label>
            <input className="form-control" value={tabela} onChange={(e) => setTabela(e.target.value)} placeholder="consultas" />
          </div>
          <div className="form-group">
            <label style={rotulo}>Usuário</label>
            <input className="form-control" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="integracaobrs" />
          </div>
          <div className="form-group">
            <label style={rotulo}>Senha {temSenha ? '(preencha só para trocar)' : ''}</label>
            <input className="form-control" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={temSenha ? '••••••••' : 'senha do usuário MySQL'} autoComplete="off" />
          </div>
        </div>

        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={testar} disabled={testando || !temSenha} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Integração ativa
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Download size={17} /> Sincronização
        </h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          O cron lê até 500 linhas novas a cada 5 min pra staging (revisão em Gestão de Leads › API Kaizom — Revisão de Margens).
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem', marginBottom: '0.9rem' }}>
          <div>
            <span style={{ color: 'var(--brs-gray-400)' }}>Cursor atual (id): </span>
            <strong style={{ fontFamily: 'monospace' }}>{cursorValor ?? '—'}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--brs-gray-400)' }}>Última leitura: </span>
            <strong>{ultimaLeituraEm ? new Date(ultimaLeituraEm).toLocaleString('pt-BR') : '—'}{ultimaLeituraQtd !== null ? ` (${ultimaLeituraQtd} linha${ultimaLeituraQtd === 1 ? '' : 's'})` : ''}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={lerAgora} disabled={lendo || !temSenha} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {lendo ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Ler agora
          </button>
          <input
            className="form-control"
            style={{ maxWidth: 160 }}
            value={novoCursor}
            onChange={(e) => setNovoCursor(e.target.value.replace(/\D/g, ''))}
            placeholder="novo cursor (id)"
            inputMode="numeric"
          />
          <button className="btn btn-outline btn-sm" onClick={reposicionarCursor} disabled={reposicionando || !novoCursor.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Só root">
            {reposicionando ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Reposicionar cursor
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={17} /> Explorar tabela (mapeamento)
        </h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          DESCRIBE da tabela + até 5 linhas de amostra — use depois de salvar a credencial. Ajuda a confirmar o
          mapeamento de colunas (copie e me envie se algo mudar).
        </p>
        <button className="btn btn-outline btn-sm" onClick={explorar} disabled={explorando || !temSenha} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {explorando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Explorar
        </button>
        {exploracao && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.4rem' }}>Colunas</div>
            <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Tipo</th>
                    <th>Nulo</th>
                    <th>Chave</th>
                    <th>Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {exploracao.colunas.map((c) => (
                    <tr key={c.field}>
                      <td style={{ fontWeight: 600 }}>{c.field}</td>
                      <td>{c.type}</td>
                      <td>{c.nullable}</td>
                      <td>{c.key}</td>
                      <td>{c.extra}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.4rem' }}>
              Amostra ({exploracao.amostra.length} linha{exploracao.amostra.length === 1 ? '' : 's'})
            </div>
            {exploracao.amostra.length === 0 ? (
              <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.8rem' }}>Tabela sem linhas ainda.</div>
            ) : (
              <pre
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  background: 'var(--brs-gray-50)',
                  border: '1px solid var(--brs-gray-200)',
                  borderRadius: 8,
                  padding: '0.7rem',
                  fontSize: '0.72rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(exploracao.amostra, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
