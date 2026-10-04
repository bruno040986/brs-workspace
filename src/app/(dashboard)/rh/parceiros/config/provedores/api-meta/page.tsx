'use client'

/** Provedores e APIs › API Meta — config da API de Conversões. Permissão: sistema-config-api-meta. */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, PlugZap, Save, Megaphone } from 'lucide-react'
import { getMetaCapiConfig, saveMetaCapiConfig, testMetaCapiConnection } from '@/lib/meta/config-actions'

export default function ApiMetaProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [temToken, setTemToken] = useState(false)
  const [token, setToken] = useState('')
  const [testEventCode, setTestEventCode] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [datasetNome, setDatasetNome] = useState('')

  useEffect(() => {
    getMetaCapiConfig()
      .then((res) => {
        if (!res.success || !res.data) return setErro(res.error || 'Sem permissão.')
        setTemToken(res.data.temToken)
        setTestEventCode(res.data.testEventCode)
        setDatasetId(res.data.datasetId)
        setDatasetNome(res.data.datasetNome)
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    const res = await saveMetaCapiConfig({ token: token.trim() || undefined, testEventCode, datasetId, datasetNome }).catch(() => ({ success: false, error: 'Erro ao salvar.' }))
    if (res.success) {
      setOkMsg('Configuração salva!')
      if (token.trim()) setTemToken(true)
      setToken('')
    } else setErro(res.error || 'Erro ao salvar.')
    setSalvando(false)
  }

  async function testar() {
    setTestando(true)
    setErro('')
    setOkMsg('')
    const res = await testMetaCapiConnection().catch(() => ({ ok: false, detalhe: 'Falha no teste.' }))
    if (res.ok) setOkMsg(res.detalhe)
    else setErro(res.detalhe)
    setTestando(false)
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', margin: '0.8rem 0 0.3rem' }

  if (carregando) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Megaphone size={24} /> API Meta
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Configuração da API de Conversões da Meta. O token fica cifrado no cofre e é usado só pelo servidor; nunca volta para esta tela.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Credencial
          {temToken && <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700 }}>· token configurado ✓</span>}
        </h2>
        <label style={rotulo}>Token de acesso da API de Conversões {temToken ? '(preencha só para substituir)' : ''}</label>
        <input className="form-control" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={temToken ? '••••••••' : 'cole o token gerado na Meta'} autoComplete="off" />
        <label style={rotulo}>ID do Conjunto de Dados (10 a 20 dígitos)</label>
        <input className="form-control" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} inputMode="numeric" maxLength={20} />
        <label style={rotulo}>Nome do Conjunto de Dados</label>
        <input className="form-control" value={datasetNome} onChange={(e) => setDatasetNome(e.target.value)} maxLength={120} />
        <label style={rotulo}>Código de Evento de Teste (opcional, ex.: TEST12345)</label>
        <input className="form-control" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} maxLength={40} style={{ maxWidth: 320 }} />
        <div style={{ marginTop: '0.9rem' }}>
          <button className="btn btn-outline btn-sm" onClick={testar} disabled={testando || !temToken} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </button>
          <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.74rem', marginLeft: 10 }}>Usa a configuração salva; salve antes de testar.</span>
        </div>
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
