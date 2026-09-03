'use client'

/**
 * Provedores e APIs › Nuvidio — credenciais (cofre), departamento padrão e
 * chave do webhook. Permissão: sistema-config-nuvidio.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, PlugZap, Save, Video } from 'lucide-react'
import { getNuvidioConfig, saveNuvidioConfig, testNuvidioConnection } from '@/lib/nuvidio/config-actions'
import NuvidioLogo from '../../../../../nuvidio/_components/NuvidioLogo'

export default function NuvidioProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [temCredenciais, setTemCredenciais] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [departmentNome, setDepartmentNome] = useState('')
  const [webhookKey, setWebhookKey] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [departments, setDepartments] = useState<Array<{ id: string; nome: string }>>([])

  useEffect(() => {
    getNuvidioConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setTemCredenciais(res.data.temCredenciais)
        setDepartmentId(res.data.departmentPadraoId)
        setDepartmentNome(res.data.departmentPadraoNome)
        setWebhookKey(res.data.webhookKey)
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
      const res = await saveNuvidioConfig({
        apiKey: apiKey.trim() || undefined,
        apiSecret: apiSecret.trim() || undefined,
        departmentPadraoId: departmentId,
        departmentPadraoNome: departmentNome,
        webhookKey: webhookKey.trim() || undefined,
        isActive,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (apiKey.trim() || apiSecret.trim()) setTemCredenciais(true)
      setApiKey('')
      setApiSecret('')
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
      const res = await testNuvidioConnection()
      if (!res.ok) throw new Error(res.detalhe)
      setOkMsg(res.detalhe)
      setDepartments(res.departments || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no teste.')
    } finally {
      setTestando(false)
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
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <NuvidioLogo sufixo="— API" altura={30} />
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Credenciais da conta Nuvidio (painel deles → API) — cifradas no cofre, usadas só pelo servidor. Alimentam o
        subsistema Operacional › Nuvidio e a etapa 3 dos Cadastros Recebidos.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Credenciais
          {temCredenciais && <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700 }}>· configuradas ✓</span>}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
          <div>
            <label style={rotulo}>API KEY {temCredenciais ? '(preencha só para trocar)' : ''}</label>
            <input className="form-control" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={temCredenciais ? '••••••••' : 'API KEY'} autoComplete="off" />
          </div>
          <div>
            <label style={rotulo}>API SECRET {temCredenciais ? '(preencha só para trocar)' : ''}</label>
            <input className="form-control" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder={temCredenciais ? '••••••••' : 'API SECRET'} autoComplete="off" />
          </div>
        </div>
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={testar} disabled={testando || (!temCredenciais && !apiKey.trim())} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Integração ativa
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem' }}>Departamento padrão</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
          <div>
            <label style={rotulo}>Departamento</label>
            {departments.length > 0 ? (
              <select
                className="form-control"
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value)
                  setDepartmentNome(departments.find((d) => d.id === e.target.value)?.nome || '')
                }}
              >
                <option value="">— Escolha —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
            ) : (
              <input className="form-control" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="Id do departamento (use Testar conexão para listar)" />
            )}
          </div>
          <div>
            <label style={rotulo}>Nome (exibição)</label>
            <input className="form-control" value={departmentNome} onChange={(e) => setDepartmentNome(e.target.value)} placeholder="ex.: Confirmação de Propostas" />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.4rem' }}>Webhook</h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          Configure no painel da Nuvidio a URL abaixo (com a chave). Eventos de chamada atualizam os convites em tempo
          real e anexam a gravação sozinhos.
        </p>
        <label style={rotulo}>Chave do webhook (defina um segredo)</label>
        <input className="form-control" value={webhookKey} onChange={(e) => setWebhookKey(e.target.value)} placeholder="segredo-forte-aleatorio" />
        <p style={{ fontSize: '0.74rem', color: 'var(--brs-gray-400)', margin: '0.5rem 0 0', wordBreak: 'break-all' }}>
          URL: <code>https://gestao.brspromotora.com.br/api/nuvidio/webhook?key={webhookKey || '<chave>'}</code>
        </p>
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
