'use client'

/**
 * Provedores e APIs › Nuvidio — credenciais (cofre), departamento padrão e
 * chave do webhook. Permissão: sistema-config-nuvidio.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, PlugZap, RefreshCw, Save, Video } from 'lucide-react'
import {
  getNuvidioConfig,
  listarWebhooksNuvidio,
  reprocessarWebhooksNuvidio,
  saveNuvidioConfig,
  testNuvidioConnection,
  type NuvidioWebhookRow,
} from '@/lib/nuvidio/config-actions'
import NuvidioLogo from '../../../../../nuvidio/_components/NuvidioLogo'

type Depto = { id: string; nome: string }

/** Lista de departamentos da Nuvidio (ou campo de id, se a lista ainda não carregou). */
function SeletorDepartamento({ rotulo, lista, id, nome, onChange }: { rotulo: React.CSSProperties; lista: Depto[]; id: string; nome: string; onChange: (id: string, nome: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
      <div>
        <label style={rotulo}>Departamento</label>
        {lista.length > 0 ? (
          <select className="form-control" value={id} onChange={(e) => onChange(e.target.value, lista.find((d) => d.id === e.target.value)?.nome || '')}>
            <option value="">— Escolha —</option>
            {lista.map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </select>
        ) : (
          <input className="form-control" value={id} onChange={(e) => onChange(e.target.value, nome)} placeholder="Id do departamento (use Testar conexão para listar)" />
        )}
      </div>
      <div>
        <label style={rotulo}>Nome (exibição)</label>
        <input className="form-control" value={nome} onChange={(e) => onChange(id, e.target.value)} placeholder="ex.: Confirmação de Propostas" />
      </div>
    </div>
  )
}

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
  const [onbId, setOnbId] = useState('')
  const [onbNome, setOnbNome] = useState('')
  const [webhookKey, setWebhookKey] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [departments, setDepartments] = useState<Array<{ id: string; nome: string }>>([])
  const [webhooks, setWebhooks] = useState<NuvidioWebhookRow[]>([])
  const [webhooksMsg, setWebhooksMsg] = useState('')
  const [reprocessando, setReprocessando] = useState(false)

  async function carregarWebhooks() {
    const res = await listarWebhooksNuvidio()
    if (res.success && res.data) setWebhooks(res.data)
  }

  async function reprocessar() {
    setReprocessando(true)
    setWebhooksMsg('')
    try {
      const res = await reprocessarWebhooksNuvidio()
      if (!res.success) throw new Error(res.error)
      setWebhooksMsg(`${res.total} reprocessado(s), ${res.casaram} casaram com convite.`)
      await carregarWebhooks()
    } catch (err) {
      setWebhooksMsg(err instanceof Error ? err.message : 'Falha ao reprocessar.')
    } finally {
      setReprocessando(false)
    }
  }

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
        setOnbId(res.data.departmentOnboardingId)
        setOnbNome(res.data.departmentOnboardingNome)
        setWebhookKey(res.data.webhookKey)
        setIsActive(res.data.isActive)
        // com credenciais salvas, já carrega a lista pra os seletores aparecerem prontos
        if (res.data.temCredenciais) {
          testNuvidioConnection().then((t) => t.ok && setDepartments(t.departments || [])).catch(() => {})
        }
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
    carregarWebhooks().catch(() => {})
  }, [])

  async function salvar(): Promise<boolean> {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await saveNuvidioConfig({
        apiKey: apiKey.trim() || undefined,
        apiSecret: apiSecret.trim() || undefined,
        departmentPadraoId: departmentId,
        departmentPadraoNome: departmentNome,
        departmentOnboardingId: onbId,
        departmentOnboardingNome: onbNome,
        webhookKey: webhookKey.trim() || undefined,
        isActive,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (apiKey.trim() || apiSecret.trim()) setTemCredenciais(true)
      setApiKey('')
      setApiSecret('')
      return true
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
      return false
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    // o teste lê o cofre: credenciais digitadas precisam ser salvas antes
    if ((apiKey.trim() || apiSecret.trim()) && !(await salvar())) return
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
        <NuvidioLogo sufixo="API" altura={60} />
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
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {apiKey.trim() || apiSecret.trim() ? 'Salvar e testar' : 'Testar conexão'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Integração ativa
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.3rem' }}>Departamento padrão — clientes de empréstimo</h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          Fila que atende a confirmação de propostas de clientes. Vem pré-selecionado em Operacional › Nuvidio › Criar Link
          (dá para trocar a cada link).
        </p>
        <SeletorDepartamento rotulo={rotulo} lista={departments} id={departmentId} nome={departmentNome} onChange={(i, n) => { setDepartmentId(i); setDepartmentNome(n) }} />
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.3rem' }}>Departamento de Cadastro de Parceiros</h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          Fila que atende a videochamada de onboarding. O sistema usa este departamento sozinho ao gerar o link na etapa
          Nuvidio dos Cadastros Recebidos.
        </p>
        <SeletorDepartamento rotulo={rotulo} lista={departments} id={onbId} nome={onbNome} onChange={(i, n) => { setOnbId(i); setOnbNome(n) }} />
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.4rem' }}>Webhook</h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
          No painel da Nuvidio (Desenvolvedores › Configurar webhooks), adicione um webhook por evento — <b>Novo cliente
          esperando</b>, <b>Nova chamada iniciada</b> e <b>Chamada finalizada</b> — todos com a URL abaixo, ligue
          "Enviar dados completos" e, em "Autenticação (opcional)", cole esta mesma chave. Os eventos atualizam os
          convites em tempo real e anexam a gravação sozinhos.
        </p>
        <label style={rotulo}>Chave do webhook (defina um segredo)</label>
        <input className="form-control" value={webhookKey} onChange={(e) => setWebhookKey(e.target.value)} placeholder="segredo-forte-aleatorio" />
        <p style={{ fontSize: '0.74rem', color: 'var(--brs-gray-400)', margin: '0.5rem 0 0', wordBreak: 'break-all' }}>
          URL: <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/nuvidio/webhook?key={webhookKey || '<chave>'}</code>
        </p>
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>

      <div className="card" style={{ padding: '1.2rem', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Webhooks recebidos (últimos 50)</h2>
          <button className="btn btn-outline btn-sm" onClick={() => carregarWebhooks()} title="Atualizar" style={{ marginLeft: 'auto' }}><RefreshCw size={13} /></button>
          <button className="btn btn-outline btn-sm" onClick={reprocessar} disabled={reprocessando || !webhooks.some((w) => !w.convite_id)}>
            {reprocessando ? <Loader2 size={13} className="animate-spin" /> : null} Reprocessar sem correspondência
          </button>
        </div>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.76rem', margin: '0 0 0.7rem' }}>
          Tudo que a Nuvidio manda entra aqui antes de qualquer regra. "Sem correspondência" = o evento chegou mas não achou
          o convite (o motivo aparece na linha); depois de criar convites pelo Workspace, use Reprocessar.
        </p>
        {webhooksMsg && <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.6rem' }}>{webhooksMsg}</div>}
        {webhooks.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhum webhook recebido ainda.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '0.76rem' }}>
              <thead>
                <tr><th>Quando</th><th>Evento</th><th>Cliente</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(w.recebido_em).toLocaleString('pt-BR')}</td>
                    <td><code>{w.hook_type || '?'}</code></td>
                    <td>{w.cliente}</td>
                    <td style={{ color: w.convite_id ? 'var(--brs-success)' : w.erro ? '#b45309' : 'var(--brs-gray-400)', fontWeight: 600 }}>
                      {w.convite_id ? 'Casou com convite' : w.erro || 'Pendente'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
