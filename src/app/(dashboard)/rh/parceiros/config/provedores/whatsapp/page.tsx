'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  MessageSquare, Key, Save, Loader2, CheckCircle, AlertCircle, Plus, Edit2, Trash2, Star,
  Wifi, WifiOff, RefreshCw, Webhook, Send, X, ShieldCheck, Power, PowerOff, Copy,
} from 'lucide-react'
import {
  listZapiInstances, saveZapiInstance, deleteZapiInstance, setZapiInstanceActive, setZapiInstanceDefault,
  testZapiInstance, readZapiInstanceWebhooks, planZapiInstanceWebhooks, applyZapiInstanceWebhooks, sendZapiTestMessage,
  type WebhookOverview,
} from './actions'
import type { ZapiInstancePublic, WebhookChange, WebhookAction } from '@/lib/zapi'

type Msg = { type: 'success' | 'error'; text: string } | null

type Draft = {
  id?: string
  name: string
  instance_id: string
  token: string
  client_token: string
  is_active: boolean
  is_default: boolean
  has_token?: boolean
  has_client_token?: boolean
}

const emptyDraft: Draft = { name: '', instance_id: '', token: '', client_token: '', is_active: true, is_default: false }

function statusBadge(inst: ZapiInstancePublic) {
  const st = inst.last_status as any
  if (!st) return <span className="badge badge-gray">Não testada</span>
  const online = !!st.connected && !!st.smartphoneConnected
  if (online) return <span className="badge badge-success"><Wifi size={12} /> Conectada</span>
  if (st.connected && !st.smartphoneConnected) return <span className="badge badge-warning"><WifiOff size={12} /> Celular offline</span>
  return <span className="badge badge-danger"><WifiOff size={12} /> Desconectada</span>
}

export default function WhatsappConfigPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ZapiInstancePublic[]>([])
  const [message, setMessage] = useState<Msg>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [webhookFor, setWebhookFor] = useState<ZapiInstancePublic | null>(null)
  const [testSendFor, setTestSendFor] = useState<ZapiInstancePublic | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listZapiInstances()
    if (res.success) setItems(res.items)
    else setMessage({ type: 'error', text: res.error || 'Erro ao carregar instâncias.' })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setDraft({ ...emptyDraft, is_default: items.length === 0 })
    setTestResult(null)
  }

  function openEdit(inst: ZapiInstancePublic) {
    setDraft({
      id: inst.id,
      name: inst.name,
      instance_id: inst.instance_id,
      token: '',
      client_token: '',
      is_active: inst.is_active,
      is_default: inst.is_default,
      has_token: inst.has_token,
      has_client_token: inst.has_client_token,
    })
    setTestResult(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    setMessage(null)
    const res = await saveZapiInstance({
      id: draft.id,
      name: draft.name,
      instance_id: draft.instance_id,
      token: draft.token,
      client_token: draft.client_token,
      is_active: draft.is_active,
      is_default: draft.is_default,
    })
    if (res.success) {
      setMessage({ type: 'success', text: 'Instância salva com sucesso.' })
      setDraft(null)
      await load()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
    }
    setSaving(false)
  }

  async function handleTestDraft() {
    if (!draft) return
    setTesting('draft')
    setTestResult(null)
    const res = await testZapiInstance({
      id: draft.id,
      instance_id: draft.instance_id,
      token: draft.token || undefined,
      client_token: draft.client_token || undefined,
    })
    if (res.success) {
      const phone = res.device?.phone ? ` · número ${res.device.phone}` : ''
      setTestResult({ ok: !!res.online, text: res.online ? `Conectada${phone}` : `Não conectada (${res.status?.error || 'sem detalhe'})${phone}` })
    } else {
      setTestResult({ ok: false, text: res.error || 'Falha ao testar.' })
    }
    setTesting(null)
  }

  async function handleTestSaved(inst: ZapiInstancePublic) {
    setTesting(inst.id)
    const res = await testZapiInstance({ id: inst.id })
    if (res.success) {
      setMessage({ type: res.online ? 'success' : 'error', text: res.online ? `"${inst.name}" está conectada${res.device?.phone ? ` (número ${res.device.phone})` : ''}.` : `"${inst.name}" não está conectada: ${res.status?.error || 'sem detalhe'}.` })
    } else {
      setMessage({ type: 'error', text: res.error || 'Falha ao testar.' })
    }
    await load()
    setTesting(null)
  }

  async function handleDelete(inst: ZapiInstancePublic) {
    if (!window.confirm(`Excluir a instância "${inst.name}"? Esta ação não pode ser desfeita.`)) return
    setBusyId(inst.id)
    const res = await deleteZapiInstance(inst.id)
    if (res.success) { setMessage({ type: 'success', text: 'Instância excluída.' }); await load() }
    else setMessage({ type: 'error', text: res.error || 'Erro ao excluir.' })
    setBusyId(null)
  }

  async function handleToggleActive(inst: ZapiInstancePublic) {
    setBusyId(inst.id)
    const res = await setZapiInstanceActive(inst.id, !inst.is_active)
    if (!res.success) setMessage({ type: 'error', text: res.error || 'Erro.' })
    await load()
    setBusyId(null)
  }

  async function handleSetDefault(inst: ZapiInstancePublic) {
    setBusyId(inst.id)
    const res = await setZapiInstanceDefault(inst.id)
    if (!res.success) setMessage({ type: 'error', text: res.error || 'Erro.' })
    await load()
    setBusyId(null)
  }

  const banner = message && (
    <div style={{
      padding: '0.85rem 1rem', borderRadius: 10, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
      background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B',
      border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
    }}>
      {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <span style={{ fontSize: '0.875rem', fontWeight: 500, flex: 1 }}>{message.text}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessage(null)}><X size={14} /></button>
    </div>
  )

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>Configurações de API - WhatsApp (Z-API)</h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Instâncias Z-API usadas nos disparos, no WhatsApp de boas-vindas do parceiro e nas ações do motor SCP. Cada instância é um número de WhatsApp.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nova instância</button>
      </div>

      {banner}

      {loading ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--brs-gray-600)', padding: '2rem' }}>
          <Loader2 className="spinner" size={16} /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', color: 'var(--brs-gray-300)' }} />
          Nenhuma instância Z-API cadastrada. Clique em <strong>Nova instância</strong> para começar.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {items.map((inst) => {
            const device = inst.last_device as any
            const busy = busyId === inst.id
            return (
              <div key={inst.id} className="card" style={{ padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                  <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22C55E', padding: '0.5rem', borderRadius: 8 }}>
                    <MessageSquare size={22} />
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--brs-gray-800)', fontSize: '1rem' }}>{inst.name}</span>
                      {inst.is_default && <span className="badge badge-gold"><Star size={12} /> Padrão</span>}
                      {statusBadge(inst)}
                      {!inst.is_active && <span className="badge badge-gray">Inativa</span>}
                      {inst.webhook_mode !== 'none' && (
                        <span className="badge badge-info"><Webhook size={12} /> Webhooks {inst.webhook_mode === 'relay' ? 'com relay' : 'diretos'}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginTop: 4, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span>ID: <code>{inst.instance_id.slice(0, 6)}…{inst.instance_id.slice(-4)}</code></span>
                      {device?.phone && <span>Número: <strong>{device.phone}</strong>{device?.isBusiness ? ' (Business)' : ''}</span>}
                      {inst.last_checked_at && <span>Testada em {new Date(inst.last_checked_at).toLocaleString('pt-BR')}</span>}
                      {!inst.has_client_token && <span style={{ color: '#b45309' }}>Sem Client-Token</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-outline btn-sm" disabled={testing === inst.id} onClick={() => handleTestSaved(inst)} title="Testar conexão">
                      {testing === inst.id ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />} Testar
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setWebhookFor(inst)} title="Webhooks"><Webhook size={14} /> Webhooks</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setTestSendFor(inst)} title="Enviar mensagem de teste"><Send size={14} /> Teste</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(inst)}><Edit2 size={14} /> Editar</button>
                    {!inst.is_default && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleSetDefault(inst)} title="Tornar padrão"><Star size={14} /></button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleToggleActive(inst)} title={inst.is_active ? 'Inativar' : 'Ativar'}>
                      {inst.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleDelete(inst)} style={{ color: '#B91C1C' }} title="Excluir"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal add/edit */}
      {draft && (
        <div className="modal-backdrop" onClick={() => !saving && setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{draft.id ? 'Editar instância Z-API' : 'Nova instância Z-API'}</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}><X size={16} /></button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome (identificação interna) <span className="required">*</span></label>
                  <input className="form-control" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Comercial – número 1" required />
                </div>
                <div className="form-group">
                  <label className="form-label">ID da Instância (Z-API) <span className="required">*</span></label>
                  <input className="form-control" value={draft.instance_id} onChange={(e) => setDraft({ ...draft, instance_id: e.target.value.trim() })} placeholder="3Cxxxxxxxxxxxxxxxxxxxxxx" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Token da Instância {draft.id ? '' : <span className="required">*</span>}</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}><Key size={16} /></span>
                    <input type="password" className="form-control" style={{ paddingLeft: '2.25rem' }} value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value.trim() })}
                      placeholder={draft.has_token ? 'Deixe em branco para manter o token atual' : 'Token da instância'} autoComplete="off" required={!draft.id} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Client-Token (token de segurança da conta)</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}><ShieldCheck size={16} /></span>
                    <input type="password" className="form-control" style={{ paddingLeft: '2.25rem' }} value={draft.client_token} onChange={(e) => setDraft({ ...draft, client_token: e.target.value.trim() })}
                      placeholder={draft.has_client_token ? 'Deixe em branco para manter o atual' : 'Painel Z-API → Segurança → Token de Segurança da Conta'} autoComplete="off" />
                  </div>
                  <div className="form-hint">Recomendado. Sem ele, os envios falham assim que o token de segurança for ativado no painel da Z-API.</div>
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> Ativa
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} /> Instância padrão (boas-vindas e motor SCP)
                  </label>
                </div>
                {testResult && (
                  <div style={{ marginTop: '1rem', padding: '0.6rem 0.85rem', borderRadius: 8, fontSize: '0.85rem', background: testResult.ok ? '#ECFDF5' : '#FEF2F2', color: testResult.ok ? '#065F46' : '#991B1B' }}>
                    {testResult.text}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" disabled={testing === 'draft' || !draft.instance_id || (!draft.token && !draft.has_token)} onClick={handleTestDraft}>
                  {testing === 'draft' ? <Loader2 size={16} className="spinner" /> : <Wifi size={16} />} Testar conexão
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />} Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {webhookFor && <WebhookModal instance={webhookFor} onClose={() => { setWebhookFor(null); load() }} />}
      {testSendFor && <TestSendModal instance={testSendFor} onClose={() => setTestSendFor(null)} />}
    </div>
  )
}

// =========================================================================
// Modal de webhooks
// =========================================================================

const OWNER_LABEL: Record<string, { text: string; cls: string }> = {
  ours: { text: 'BRS Gestão', cls: 'badge-success' },
  external: { text: 'Externo (ex.: ARW)', cls: 'badge-warning' },
  empty: { text: 'Vazio', cls: 'badge-gray' },
}

const ACTION_LABEL: Record<WebhookAction, string> = {
  configure_empty: 'Configurar os vazios',
  assume_relay: 'Assumir com relay (mantém o ARW)',
  restore: 'Restaurar originais',
}

function WebhookModal({ instance, onClose }: { instance: ZapiInstancePublic; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<WebhookOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ action: WebhookAction; changes: WebhookChange[] } | null>(null)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await readZapiInstanceWebhooks(instance.id)
    if (res.success) setOverview(res.overview)
    else setError(res.error || 'Falha ao ler webhooks.')
    setLoading(false)
  }, [instance.id])

  useEffect(() => { load() }, [load])

  async function makePlan(action: WebhookAction) {
    setResult(null)
    const res = await planZapiInstanceWebhooks(instance.id, action)
    if (!res.success) { setError(res.error || 'Falha ao planejar.'); return }
    if (!res.changes.length) { setResult('Nada a alterar para essa ação.'); return }
    setPlan({ action, changes: res.changes })
  }

  async function apply() {
    if (!plan) return
    setApplying(true)
    const res = await applyZapiInstanceWebhooks(instance.id, plan.changes)
    if (res.success) {
      setResult(`${res.applied} webhook(s) atualizado(s)${res.failed?.length ? `; ${res.failed.length} falharam` : ''}.`)
      setPlan(null)
      await load()
    } else {
      setError(res.error || 'Falha ao aplicar.')
    }
    setApplying(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title"><Webhook size={16} style={{ verticalAlign: -3 }} /> Webhooks — {instance.name}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)', marginTop: 0 }}>
            A instância pode ser compartilhada com o ARW. Nada é sobrescrito sem confirmação: em <strong>relay</strong>, o BRS Gestão recebe o evento e repassa para a URL original.
          </p>
          {overview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--brs-gray-500)' }}>Nossa URL:</span>
              <code style={{ background: 'var(--brs-gray-50)', padding: '2px 6px', borderRadius: 6, wordBreak: 'break-all' }}>{overview.ourUrl}</code>
              <button type="button" className="btn btn-ghost btn-sm" title="Copiar" onClick={() => navigator.clipboard?.writeText(overview.ourUrl)}><Copy size={12} /></button>
            </div>
          )}
          {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
          {result && <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>{result}</div>}
          {loading ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--brs-gray-600)' }}><Loader2 className="spinner" size={16} /> Consultando a Z-API…</div>
          ) : overview ? (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Webhook</th><th>URL atual</th><th>Dono</th><th>Relay (original)</th></tr></thead>
                <tbody>
                  {overview.states.map((s) => (
                    <tr key={s.kind}>
                      <td style={{ fontWeight: 600 }}>{s.label}</td>
                      <td style={{ fontSize: '0.75rem', wordBreak: 'break-all', maxWidth: 280 }}>{s.currentUrl || <span style={{ color: 'var(--brs-gray-400)' }}>—</span>}</td>
                      <td><span className={`badge ${OWNER_LABEL[s.owner].cls}`}>{OWNER_LABEL[s.owner].text}</span></td>
                      <td style={{ fontSize: '0.75rem', wordBreak: 'break-all', maxWidth: 220 }}>{s.relayUrl || <span style={{ color: 'var(--brs-gray-400)' }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {plan && (
            <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', border: '1px solid #FDE68A', background: '#FFFBEB', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#92400E' }}>Confirmar: {ACTION_LABEL[plan.action]}</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
                {plan.changes.map((c) => (
                  <li key={c.kind}><strong>{c.kind}</strong>: {c.fromUrl || '(vazio)'} → {c.toUrl || '(vazio)'}{c.relayUrl ? ` · relay guardado: ${c.relayUrl}` : ''}</li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlan(null)}>Cancelar</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={applying} onClick={apply}>{applying ? <Loader2 size={14} className="spinner" /> : <CheckCircle size={14} />} Aplicar</button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={load}><RefreshCw size={14} /> Reler</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={() => makePlan('configure_empty')}>Configurar os vazios</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={() => makePlan('assume_relay')}>Assumir com relay</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={() => makePlan('restore')}>Restaurar originais</button>
        </div>
      </div>
    </div>
  )
}

// =========================================================================
// Modal de envio de teste
// =========================================================================

function TestSendModal({ instance, onClose }: { instance: ZapiInstancePublic; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [text, setText] = useState('Teste de conexão do BRS Gestão ✅')
  const [sending, setSending] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setRes(null)
    const r = await sendZapiTestMessage(instance.id, phone, text)
    setRes(r.success ? { ok: true, text: `Enviada! messageId ${r.messageId}` } : { ok: false, text: r.error || 'Falha.' })
    setSending(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={send}>
          <div className="modal-header">
            <h3 className="modal-title">Mensagem de teste — {instance.name}</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Telefone (com DDD)</label>
              <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" required />
            </div>
            <div className="form-group">
              <label className="form-label">Mensagem</label>
              <textarea className="form-control" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            {res && <div className={`alert ${res.ok ? 'alert-success' : 'alert-error'}`}>{res.text}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
            <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? <Loader2 size={16} className="spinner" /> : <Send size={16} />} Enviar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
