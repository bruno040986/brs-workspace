'use client'

/**
 * Provedores e APIs › Motor de Crédito (MySQL) — credencial do banco do
 * fornecedor de higienização de margem (convênios públicos), cofre AES +
 * Testar conexão + Explorar schema (DESCRIBE + amostra), pra mapear a
 * tabela `consultas` antes da sincronização de verdade (fase 2, depois de
 * conhecido o schema). Permissão: sistema-config-motor-credito.
 */
import { useEffect, useState } from 'react'
import { Database, KeyRound, Loader2, PlugZap, Save, Search } from 'lucide-react'
import {
  explorarMotorCreditoSchema,
  getMotorCreditoConfig,
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

  useEffect(() => {
    getMotorCreditoConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setTemSenha(res.data.temSenha)
        setHost(res.data.host)
        setPorta(String(res.data.porta))
        setBanco(res.data.banco)
        setTabela(res.data.tabela)
        setUsuario(res.data.usuario)
        setAtivo(res.data.ativo)
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
        <Database size={24} /> Motor de Crédito (MySQL)
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Banco do fornecedor de higienização de margem (convênios públicos). A senha fica cifrada no cofre — nunca
        aparece na tela depois de salva. Fase 1: só credencial + exploração de schema; a sincronização automática
        (leitura periódica → revisão → envio ao WeSales) vem depois do mapeamento das colunas.
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
