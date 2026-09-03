'use client'

/**
 * Provedores e APIs › QuarkRH — Auth-token (cofre) + Testar conexão +
 * Explorar API (sonda os endpoints e mostra os shapes para o mapeamento da
 * integração de RH/folha). Permissão: sistema-config-quarkrh.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, PlugZap, Save, Search, Users } from 'lucide-react'
import {
  explorarQuarkEndpoints,
  getQuarkConfig,
  saveQuarkConfig,
  testQuarkConnection,
} from '@/lib/quark/config-actions'
import type { SondaResultado } from '@/lib/quark/client'

export default function QuarkProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [explorando, setExplorando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [temToken, setTemToken] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.quark.tec.br/rh/ext')
  const [isActive, setIsActive] = useState(true)
  const [sonda, setSonda] = useState<SondaResultado[]>([])

  useEffect(() => {
    getQuarkConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setTemToken(res.data.temToken)
        setBaseUrl(res.data.baseUrl)
        setIsActive(res.data.isActive)
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await saveQuarkConfig({ authToken: authToken.trim() || undefined, baseUrl, isActive })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (authToken.trim()) setTemToken(true)
      setAuthToken('')
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
      const res = await testQuarkConnection()
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
    setSonda([])
    try {
      const res = await explorarQuarkEndpoints()
      if (!res.success) throw new Error(res.error)
      setSonda(res.data || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao explorar.')
    } finally {
      setExplorando(false)
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  if (carregando) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Users size={24} /> API QuarkRH
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Token de acesso à API do QuarkRH (você gera no seu acesso Quark) — cifrado no cofre, usado só pelo servidor.
        Base da integração de RH e folha; nesta fase, apenas leitura e mapeamento.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Credencial
          {temToken && <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700 }}>· configurada ✓</span>}
        </h2>
        <label style={rotulo}>Auth-token {temToken ? '(preencha só para trocar)' : ''}</label>
        <input className="form-control" type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder={temToken ? '••••••••' : 'cole o Auth-token gerado no Quark'} autoComplete="off" />
        <label style={{ ...rotulo, marginTop: '0.8rem' }}>Base URL</label>
        <input className="form-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={testar} disabled={testando || (!temToken && !authToken.trim())} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Integração ativa
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={17} /> Explorar API (mapeamento)
        </h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          Sonda os endpoints candidatos e mostra o status + uma amostra de cada resposta. Use após configurar o token —
          o resultado ajuda a mapear o que a API expõe (copie e me envie).
        </p>
        <button className="btn btn-outline btn-sm" onClick={explorar} disabled={explorando || !temToken} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {explorando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Explorar endpoints
        </button>
        {sonda.length > 0 && (
          <div style={{ marginTop: '1rem', maxHeight: 420, overflow: 'auto', border: '1px solid var(--brs-gray-200)', borderRadius: 8 }}>
            {sonda.map((s) => (
              <div key={s.path} style={{ padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--brs-gray-100)', fontSize: '0.72rem' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: s.status >= 200 && s.status < 300 ? 'var(--brs-success)' : s.status === 401 ? 'var(--brs-danger)' : s.status === 404 ? 'var(--brs-gray-400)' : '#d97706', minWidth: 34 }}>{s.status || 'ERR'}</span>
                  <code style={{ fontWeight: 700 }}>{s.path}</code>
                </div>
                <pre style={{ margin: '0.3rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--brs-gray-600)', fontFamily: 'monospace', fontSize: '0.68rem' }}>{s.amostra}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
