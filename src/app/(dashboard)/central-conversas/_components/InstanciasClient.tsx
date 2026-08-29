'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Power, QrCode, RefreshCw, Trash2, Users, Wifi, WifiOff } from 'lucide-react'
import {
  conectarInstancia,
  criarInstanciaBrs,
  desconectarInstancia,
  excluirInstancia,
  statusInstancia,
  type InstanciaView,
} from '@/lib/central-conversas/actions'

type View = Awaited<ReturnType<typeof import('@/lib/central-conversas/actions').getCentralConversasView>>

const STATUS_LABEL: Record<string, string> = {
  desconectada: 'Desconectada',
  aguardando_qr: 'Aguardando QR Code',
  conectando: 'Conectando…',
  conectada: 'Conectada',
  erro: 'Erro',
}

export default function InstanciasClient({ view }: { view: View }) {
  const [instancias, setInstancias] = useState<InstanciaView[]>(view.instancias)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({ nome: '', provedor: 'baileys' as 'baileys' | 'zapi', instanceId: '', token: '', clientToken: '' })
  const [mostrarForm, setMostrarForm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Enquanto alguma instância estiver aguardando QR/conectando, atualiza a cada 3s.
  const atualizar = useCallback(async () => {
    const pendentes = instancias.filter((i) => ['aguardando_qr', 'conectando'].includes(i.status))
    if (!pendentes.length) return
    const novas = await Promise.all(pendentes.map((i) => statusInstancia(i.id).catch(() => null)))
    setInstancias((atual) => atual.map((i) => novas.find((n) => n?.id === i.id) || i))
  }, [instancias])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(atualizar, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [atualizar])

  async function handleCriar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true)
    setMensagem(null)
    try {
      const res = await criarInstanciaBrs({
        nome: novo.nome,
        provedor: novo.provedor,
        zapi: novo.provedor === 'zapi' ? { instanceId: novo.instanceId, token: novo.token, clientToken: novo.clientToken } : undefined,
      })
      const nova = await statusInstancia(res.id)
      setInstancias((atual) => [...atual, nova])
      setNovo({ nome: '', provedor: 'baileys', instanceId: '', token: '', clientToken: '' })
      setMostrarForm(false)
      setMensagem({ tipo: 'ok', texto: 'Instância criada. Clique em "Conectar" pra gerar o QR Code.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao criar instância.' })
    } finally {
      setCriando(false)
    }
  }

  async function acao(inst: InstanciaView, qual: 'conectar' | 'desconectar' | 'excluir') {
    if (qual === 'excluir' && !window.confirm(`Excluir a instância "${inst.nome}"? A sessão do WhatsApp será encerrada.`)) return
    setBusy(inst.id)
    setMensagem(null)
    try {
      if (qual === 'conectar') {
        const r = await conectarInstancia(inst.id)
        if (r.provedor === 'zapi') {
          setMensagem({ tipo: r.conectada ? 'ok' : 'erro', texto: r.conectada ? 'Z-API conectada. Configure o webhook de mensagens na Z-API com a URL abaixo.' : 'Z-API sem conexão no painel deles — escaneie o QR lá primeiro.' })
          setInstancias((atual) => atual.map((i) => (i.id === inst.id ? { ...i, status: r.conectada ? 'conectada' : 'desconectada', ultimo_erro: r.webhookUrl ? `Webhook Z-API: ${r.webhookUrl}` : null } : i)))
        } else {
          setInstancias((atual) => atual.map((i) => (i.id === inst.id ? { ...i, status: 'conectando', ultimo_qr: null } : i)))
        }
      } else if (qual === 'desconectar') {
        await desconectarInstancia(inst.id)
        setInstancias((atual) => atual.map((i) => (i.id === inst.id ? { ...i, status: 'desconectada', numero: null, ultimo_qr: null } : i)))
      } else {
        await excluirInstancia(inst.id)
        setInstancias((atual) => atual.filter((i) => i.id !== inst.id))
      }
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Falha na operação.' })
    } finally {
      setBusy(null)
    }
  }

  const podeCriar = view.can_edit && instancias.length < view.limite && !!view.conta

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Instâncias WhatsApp</h1>
          <p className="page-subtitle">
            Números da BRS conectados por QR Code (Baileys) ou Z-API. Todas são <strong>receptivas</strong> e aceitam grupos — é por elas que o suporte aos parceiros e às IFs entra no chat.
          </p>
        </div>
        {podeCriar && (
          <button type="button" className="btn btn-primary" onClick={() => setMostrarForm((v) => !v)}>
            <Plus size={16} /> Nova instância
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <StatusChip ok={!!view.conta} label={view.conta ? `Chatwoot: ${view.conta.nome}` : 'Chatwoot ainda não provisionado'} />
        <StatusChip ok={view.engineOk} label={view.engineOk ? 'Engine no ar' : 'Engine fora do ar / não configurado'} />
        <StatusChip ok={view.cofreOk} label={view.cofreOk ? 'Cofre de credenciais ativo' : 'Cofre não configurado'} />
        <span className="badge" style={{ marginLeft: 'auto' }}>{instancias.length} / {view.limite} instâncias</span>
      </div>

      {mensagem && (
        <div className={`alert ${mensagem.tipo === 'ok' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1rem' }}>
          {mensagem.texto}
        </div>
      )}

      {mostrarForm && (
        <form onSubmit={handleCriar} className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <label className="form-field">
              <span className="form-label">Nome da instância</span>
              <input className="form-input" required placeholder="Ex.: Suporte, Financeiro, Comercial" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            </label>
            <label className="form-field">
              <span className="form-label">Provedor</span>
              <select className="form-input" value={novo.provedor} onChange={(e) => setNovo({ ...novo, provedor: e.target.value as 'baileys' | 'zapi' })}>
                <option value="baileys">Baileys (QR Code, grátis)</option>
                <option value="zapi">Z-API (gerenciado)</option>
              </select>
            </label>
            {novo.provedor === 'zapi' && (
              <>
                <label className="form-field">
                  <span className="form-label">Z-API — ID da instância</span>
                  <input className="form-input" required value={novo.instanceId} onChange={(e) => setNovo({ ...novo, instanceId: e.target.value })} />
                </label>
                <label className="form-field">
                  <span className="form-label">Z-API — Token da instância</span>
                  <input className="form-input" required type="password" value={novo.token} onChange={(e) => setNovo({ ...novo, token: e.target.value })} />
                </label>
                <label className="form-field">
                  <span className="form-label">Z-API — Client-Token (segurança da conta, opcional)</span>
                  <input className="form-input" type="password" value={novo.clientToken} onChange={(e) => setNovo({ ...novo, clientToken: e.target.value })} />
                </label>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="submit" className="btn btn-primary" disabled={criando}>
              {criando ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />} Criar
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {!view.conta && (
        <div className="card" style={{ padding: '1.25rem', color: 'var(--color-ink-muted)' }}>
          O Chatwoot da BRS ainda não foi provisionado — as instâncias aparecem aqui assim que a conta existir.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {instancias.map((inst) => {
          const conectada = inst.status === 'conectada'
          return (
            <div key={inst.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: conectada ? 'rgba(16,185,129,.12)' : 'rgba(10,17,40,.06)', color: conectada ? '#059669' : 'var(--color-ink-subtle)' }}>
                  {conectada ? <Wifi size={20} /> : <WifiOff size={20} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{inst.nome}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
                    {inst.provedor === 'zapi' ? 'Z-API' : 'Baileys'} · receptiva · <Users size={12} style={{ verticalAlign: '-2px' }} /> grupos
                  </div>
                </div>
                <span className={`badge ${conectada ? 'badge-success' : inst.status === 'erro' ? 'badge-danger' : ''}`}>{STATUS_LABEL[inst.status] || inst.status}</span>
              </div>

              {inst.numero && <div style={{ fontSize: 13 }}>Número: <strong>+{inst.numero}</strong>{inst.nome_perfil ? ` · ${inst.nome_perfil}` : ''}</div>}

              {inst.status === 'aguardando_qr' && inst.ultimo_qr && (
                <div style={{ textAlign: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={inst.ultimo_qr} alt="QR Code" style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--color-line)' }} />
                  <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)', marginTop: 4 }}>
                    WhatsApp → Dispositivos conectados → Conectar dispositivo. O código renova sozinho.
                  </div>
                </div>
              )}
              {inst.status === 'conectando' && !inst.ultimo_qr && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-ink-subtle)' }}>
                  <Loader2 size={16} className="spinner" /> Iniciando sessão…
                </div>
              )}
              {inst.ultimo_erro && <div style={{ fontSize: 12, color: inst.status === 'erro' ? 'var(--color-danger)' : 'var(--color-ink-subtle)', wordBreak: 'break-all' }}>{inst.ultimo_erro}</div>}

              {view.can_edit && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto' }}>
                  {!conectada ? (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy === inst.id} onClick={() => acao(inst, 'conectar')}>
                      {busy === inst.id ? <Loader2 size={14} className="spinner" /> : <QrCode size={14} />} {inst.status === 'aguardando_qr' ? 'Novo QR' : 'Conectar'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy === inst.id} onClick={() => acao(inst, 'desconectar')}>
                      <Power size={14} /> Desconectar
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === inst.id} onClick={() => statusInstancia(inst.id).then((n) => setInstancias((a) => a.map((i) => (i.id === n.id ? n : i))))}>
                    <RefreshCw size={14} />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === inst.id} onClick={() => acao(inst, 'excluir')} style={{ marginLeft: 'auto' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? 'badge-success' : 'badge-danger'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: ok ? '#10b981' : '#ef4444' }} /> {label}
    </span>
  )
}
