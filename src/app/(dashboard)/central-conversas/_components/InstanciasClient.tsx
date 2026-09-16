'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar, DollarSign, Edit2, History, Loader2, MessageSquare, Plus, Power, QrCode, RefreshCw, Send, Trash2, Users, Wifi, WifiOff, X } from 'lucide-react'
import {
  conectarInstancia,
  criarInstanciaBrs,
  desconectarInstancia,
  excluirInstancia,
  listarRecargasInstancia,
  registrarRecargaInstancia,
  salvarChipInstancia,
  statusInstancia,
  type InstanciaRecargaItem,
  type InstanciaView,
} from '@/lib/central-conversas/actions'
import { listarDepartamentos, setDepartamentoInstancia, type DepartamentoRow } from '@/lib/central-conversas/departamentos-actions'

type View = Awaited<ReturnType<typeof import('@/lib/central-conversas/actions').getCentralConversasView>>

const STATUS_LABEL: Record<string, string> = {
  desconectada: 'Desconectada',
  aguardando_qr: 'Aguardando QR Code',
  conectando: 'Conectando…',
  conectada: 'Conectada',
  erro: 'Erro',
}

const TIPO_NUMERO_LABEL: Record<string, string> = {
  celular: 'Celular',
  fixo: 'Fixo',
  virtual: 'Virtual',
}

const TIPO_PLANO_LABEL: Record<string, string> = {
  pre_pago: 'Pré-pago',
  pos_pago: 'Pós-pago',
  virtual: 'Virtual',
}

function TelegramLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .54-1.43.53-.47-.01-1.37-.26-2.04-.48-.82-.27-1.47-.42-1.42-.88.03-.24.37-.49 1.02-.74 3.99-1.74 6.66-2.89 8.01-3.46 3.81-1.6 4.6-1.88 5.12-1.89.11 0 .37.03.54.17.14.12.18.28.2.45-.02.07-.02.13-.03.22z" />
    </svg>
  )
}

export default function InstanciasClient({ view }: { view: View }) {
  const [instancias, setInstancias] = useState<InstanciaView[]>(view.instancias)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({
    nome: '',
    provedor: 'baileys' as 'baileys' | 'zapi',
    numero_informado: '',
    tipo_numero: '' as '' | 'celular' | 'fixo' | 'virtual',
    operadora_id: '',
    tipo_plano: '' as '' | 'pre_pago' | 'pos_pago' | 'virtual',
    instanceId: '',
    token: '',
    clientToken: '',
  })
  const [mostrarForm, setMostrarForm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [departamentos, setDepartamentos] = useState<DepartamentoRow[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Estado do Modal de Edição de Chip
  const [editandoChip, setEditandoChip] = useState<{
    instanciaId: string
    nome: string
    numero_informado: string
    tipo_numero: '' | 'celular' | 'fixo' | 'virtual'
    operadora_id: string
    tipo_plano: '' | 'pre_pago' | 'pos_pago' | 'virtual'
  } | null>(null)
  const [salvandoChip, setSalvandoChip] = useState(false)

  // Estado do Modal de Controle de Recargas
  const [modalRecarga, setModalRecarga] = useState<{
    instancia: InstanciaView
    historico: InstanciaRecargaItem[]
    carregandoHistorico: boolean
    dataRecarga: string
    valor: string
    proximaRecarga: string
    salvando: boolean
  } | null>(null)

  const operadoras = view.operadoras || []
  const inboxTelegram = view.inboxes.filter((i) => i.channel_type === 'Channel::Telegram')

  useEffect(() => {
    listarDepartamentos().then((res) => res.success && setDepartamentos(res.data || []))
  }, [])

  async function mudarDepartamento(inst: InstanciaView, departamentoId: string) {
    const anterior = inst.departamento_id
    setInstancias((atual) => atual.map((i) => (i.id === inst.id ? { ...i, departamento_id: departamentoId || null } : i)))
    const res = await setDepartamentoInstancia(inst.id, departamentoId || null)
    if (!res.success) {
      setInstancias((atual) => atual.map((i) => (i.id === inst.id ? { ...i, departamento_id: anterior } : i)))
      setMensagem({ tipo: 'erro', texto: res.error || 'Falha ao definir o departamento.' })
    }
  }

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
        numero_informado: novo.numero_informado || null,
        tipo_numero: novo.tipo_numero || null,
        operadora_id: novo.operadora_id || null,
        tipo_plano: novo.tipo_plano || null,
        zapi: novo.provedor === 'zapi' ? { instanceId: novo.instanceId, token: novo.token, clientToken: novo.clientToken } : undefined,
      })
      const nova = await statusInstancia(res.id)
      setInstancias((atual) => [...atual, nova])
      setNovo({
        nome: '',
        provedor: 'baileys',
        numero_informado: '',
        tipo_numero: '',
        operadora_id: '',
        tipo_plano: '',
        instanceId: '',
        token: '',
        clientToken: '',
      })
      setMostrarForm(false)
      setMensagem({ tipo: 'ok', texto: 'Instância criada com sucesso. Clique em "Conectar" pra gerar o QR Code.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao criar instância.' })
    } finally {
      setCriando(false)
    }
  }

  async function handleSalvarChip(e: React.FormEvent) {
    e.preventDefault()
    if (!editandoChip) return
    setSalvandoChip(true)
    setMensagem(null)
    try {
      await salvarChipInstancia({
        instanciaId: editandoChip.instanciaId,
        nome: editandoChip.nome || null,
        numero_informado: editandoChip.numero_informado || null,
        tipo_numero: editandoChip.tipo_numero || null,
        operadora_id: editandoChip.operadora_id || null,
        tipo_plano: editandoChip.tipo_plano || null,
      })
      const atualizada = await statusInstancia(editandoChip.instanciaId)
      setInstancias((atual) => atual.map((i) => (i.id === editandoChip.instanciaId ? atualizada : i)))
      setEditandoChip(null)
      setMensagem({ tipo: 'ok', texto: 'Dados do chip atualizados com sucesso.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao salvar dados do chip.' })
    } finally {
      setSalvandoChip(false)
    }
  }

  async function handleAbrirModalRecarga(inst: InstanciaView) {
    const hojeStr = new Date().toISOString().slice(0, 10)
    const dRecarga = new Date()
    dRecarga.setHours(0, 0, 0, 0)
    const dProx = new Date(dRecarga)
    dProx.setDate(dProx.getDate() + 60)
    const proxStr = dProx.toISOString().slice(0, 10)

    setModalRecarga({
      instancia: inst,
      historico: [],
      carregandoHistorico: true,
      dataRecarga: hojeStr,
      valor: '',
      proximaRecarga: proxStr,
      salvando: false,
    })

    const res = await listarRecargasInstancia(inst.id)
    if (res.success && res.recargas) {
      setModalRecarga((m) => (m ? { ...m, historico: res.recargas || [], carregandoHistorico: false } : null))
    } else {
      setModalRecarga((m) => (m ? { ...m, carregandoHistorico: false } : null))
    }
  }

  function handleDataRecargaChange(novaData: string) {
    if (!modalRecarga) return
    const dRec = new Date(novaData + 'T00:00:00')
    if (!isNaN(dRec.getTime())) {
      const dProx = new Date(dRec)
      dProx.setDate(dProx.getDate() + 60)
      const proxStr = dProx.toISOString().slice(0, 10)
      setModalRecarga({ ...modalRecarga, dataRecarga: novaData, proximaRecarga: proxStr })
    } else {
      setModalRecarga({ ...modalRecarga, dataRecarga: novaData })
    }
  }

  async function handleRegistrarRecarga(e: React.FormEvent) {
    e.preventDefault()
    if (!modalRecarga) return
    const valClean = modalRecarga.valor.replace(',', '.')
    const valNum = parseFloat(valClean)
    if (isNaN(valNum) || valNum <= 0) {
      alert('Informe um valor de recarga válido.')
      return
    }
    setModalRecarga((m) => (m ? { ...m, salvando: true } : null))
    try {
      await registrarRecargaInstancia({
        instanciaId: modalRecarga.instancia.id,
        data_recarga: modalRecarga.dataRecarga,
        valor: valNum,
        proxima_recarga: modalRecarga.proximaRecarga,
      })
      const atualizada = await statusInstancia(modalRecarga.instancia.id)
      setInstancias((atual) => atual.map((i) => (i.id === modalRecarga.instancia.id ? atualizada : i)))
      const recs = await listarRecargasInstancia(modalRecarga.instancia.id)
      setModalRecarga((m) =>
        m
          ? {
              ...m,
              instancia: atualizada,
              historico: recs.recargas || [],
              valor: '',
              salvando: false,
            }
          : null
      )
      setMensagem({ tipo: 'ok', texto: 'Recarga registrada com sucesso!' })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao registrar recarga.')
      setModalRecarga((m) => (m ? { ...m, salvando: false } : null))
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

  const maxProxDateStr = (() => {
    if (!modalRecarga?.dataRecarga) return ''
    const d = new Date(modalRecarga.dataRecarga + 'T00:00:00')
    if (isNaN(d.getTime())) return ''
    d.setDate(d.getDate() + 60)
    return d.toISOString().slice(0, 10)
  })()

  return (
    <div className="page-container">
      {/* CABEÇALHO MODERNO SEGUINDO A IDENTIDADE DO WORKSPACE */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)', flexShrink: 0 }}>
            <MessageSquare size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: 'var(--color-ink)' }}>
              Instâncias WhatsApp
            </h1>
          </div>
        </div>

        {podeCriar && (
          <button type="button" className="btn btn-primary" style={{ padding: '0.55rem 1.1rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setMostrarForm((v) => !v)}>
            <Plus size={16} /> Nova instância
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
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
          <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: 14 }}>Dados Principais</div>
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
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

          <div style={{ borderTop: '1px solid var(--color-line)', paddingTop: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-ink-subtle)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Cadastro do Chip <span style={{ fontSize: 11, fontWeight: 400, textTransform: 'none' }}>(Opcional agora, dá pra completar depois)</span>
            </div>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <label className="form-field">
                <span className="form-label">Número</span>
                <input className="form-input" placeholder="(61) 90000-0000" value={novo.numero_informado} onChange={(e) => setNovo({ ...novo, numero_informado: e.target.value })} />
              </label>
              <label className="form-field">
                <span className="form-label">Tipo de número</span>
                <select className="form-input" value={novo.tipo_numero} onChange={(e) => setNovo({ ...novo, tipo_numero: e.target.value as any })}>
                  <option value="">Selecione...</option>
                  <option value="celular">Celular</option>
                  <option value="fixo">Fixo</option>
                  <option value="virtual">Virtual</option>
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Operadora</span>
                <select className="form-input" value={novo.operadora_id} onChange={(e) => setNovo({ ...novo, operadora_id: e.target.value })}>
                  <option value="">Selecione...</option>
                  {operadoras.map((op) => (
                    <option key={op.id} value={op.id}>{op.nome}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Tipo de plano</span>
                <select className="form-input" value={novo.tipo_plano} onChange={(e) => setNovo({ ...novo, tipo_plano: e.target.value as any })}>
                  <option value="">Selecione...</option>
                  <option value="pos_pago">Pós-Pago</option>
                  <option value="pre_pago">Pré-Pago</option>
                  <option value="virtual">Virtual</option>
                </select>
              </label>
            </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
        {instancias.map((inst) => {
          const conectada = inst.status === 'conectada'
          return (
            <div key={inst.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* CABEÇALHO DO CARD COM NOME EXPANDIDO E BADGE CONECTADA LOGO ABAIXO */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                {inst.operadora_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inst.operadora_logo_url}
                    alt={inst.operadora_nome || 'Operadora'}
                    style={{ width: 80, height: 80, borderRadius: 16, objectFit: 'contain', border: '1px solid var(--color-line)', background: '#fff', padding: 4, flexShrink: 0 }}
                  />
                ) : (
                  <span style={{ width: 80, height: 80, borderRadius: 16, display: 'grid', placeItems: 'center', background: conectada ? 'rgba(16,185,129,.12)' : 'rgba(10,17,40,.06)', color: conectada ? '#059669' : 'var(--color-ink-subtle)', flexShrink: 0 }}>
                    {conectada ? <Wifi size={32} /> : <WifiOff size={32} />}
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-ink)', lineHeight: 1.25, wordBreak: 'break-word' }}>
                    {inst.nome}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {inst.provedor === 'zapi' ? 'Z-API' : 'Baileys'} · <Users size={12} /> {inst.permite_grupos ? 'com grupos' : 'sem grupos'}
                  </div>
                  <div style={{ marginTop: 2 }}>
                    <span className={`badge ${conectada ? 'badge-success' : inst.status === 'erro' ? 'badge-danger' : ''}`} style={{ fontSize: 11 }}>
                      {STATUS_LABEL[inst.status] || inst.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Informações do Chip / Badges */}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                {inst.numero ? (
                  <span style={{ fontWeight: 600 }}>+{inst.numero}</span>
                ) : inst.numero_informado ? (
                  <span style={{ fontWeight: 600 }}>{inst.numero_informado}</span>
                ) : null}
                {inst.operadora_nome && (
                  <span className="badge" style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', color: 'var(--color-ink)' }}>
                    {inst.operadora_nome}
                  </span>
                )}
                {inst.tipo_numero && (
                  <span className="badge" style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', color: 'var(--color-ink-muted)' }}>
                    {TIPO_NUMERO_LABEL[inst.tipo_numero] || inst.tipo_numero}
                  </span>
                )}
                {inst.tipo_plano && (
                  <span className="badge" style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', color: 'var(--color-ink-muted)' }}>
                    {TIPO_PLANO_LABEL[inst.tipo_plano] || inst.tipo_plano}
                  </span>
                )}
                {view.can_edit && (
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', color: 'var(--color-ink-subtle)', marginLeft: 'auto' }}
                    title="Editar dados da instância e chip"
                    onClick={() =>
                      setEditandoChip({
                        instanciaId: inst.id,
                        nome: inst.nome,
                        numero_informado: inst.numero_informado || '',
                        tipo_numero: inst.tipo_numero || '',
                        operadora_id: inst.operadora_id || '',
                        tipo_plano: inst.tipo_plano || '',
                      })
                    }
                  >
                    <Edit2 size={13} />
                  </button>
                )}
              </div>

              {/* Controle de Recargas para Pré-Pago */}
              {inst.tipo_plano === 'pre_pago' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg-subtle, rgba(0,0,0,0.03))', padding: '0.5rem 0.75rem', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RefreshCw size={14} style={{ color: inst.dias_para_recarga !== null && inst.dias_para_recarga <= 5 ? '#ef4444' : 'var(--color-ink-subtle)' }} />
                    <span>
                      {inst.dias_para_recarga === null ? (
                        <em style={{ color: 'var(--color-ink-subtle)' }}>Sem recargas registradas</em>
                      ) : inst.dias_para_recarga < 0 ? (
                        <strong style={{ color: '#ef4444' }}>Recarga atrasada em {Math.abs(inst.dias_para_recarga)} dia(s)</strong>
                      ) : inst.dias_para_recarga === 0 ? (
                        <strong style={{ color: '#f59e0b' }}>Recarga HOJE!</strong>
                      ) : (
                        <strong style={{ color: inst.dias_para_recarga <= 7 ? '#f59e0b' : '#10b981' }}>Recarga em {inst.dias_para_recarga} dia(s)</strong>
                      )}
                    </span>
                  </div>
                  {view.can_edit && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => handleAbrirModalRecarga(inst)}
                    >
                      <Plus size={12} /> Recarga
                    </button>
                  )}
                </div>
              )}

              {view.can_edit && (
                <label className="form-field" style={{ margin: 0 }}>
                  <span className="form-label" style={{ fontSize: 11 }}>Departamento padrão</span>
                  <select
                    className="form-input"
                    value={inst.departamento_id || ''}
                    onChange={(e) => mudarDepartamento(inst, e.target.value)}
                  >
                    <option value="">Sem departamento padrão</option>
                    {departamentos.map((d) => (
                      <option key={d.id} value={d.id}>{d.nome}</option>
                    ))}
                  </select>
                </label>
              )}

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

        {/* CARD PARA SINCRONIZAR TELEGRAM */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px stroke var(--color-line)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
            <div style={{ width: 80, height: 80, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)', color: '#fff', flexShrink: 0, boxShadow: '0 4px 12px rgba(42, 171, 238, 0.25)' }}>
              <TelegramLogo size={42} />
            </div>
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-ink)', lineHeight: 1.25 }}>
                Telegram
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
                Bot / Canal Telegram · Chatwoot
              </div>
              <div style={{ marginTop: 2 }}>
                <span className={`badge ${inboxTelegram.length > 0 ? 'badge-success' : ''}`} style={{ fontSize: 11, background: inboxTelegram.length > 0 ? undefined : 'rgba(42,171,238,0.12)', color: inboxTelegram.length > 0 ? undefined : '#0284c7' }}>
                  {inboxTelegram.length > 0 ? 'Conectado' : 'Pronto p/ integrar'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)', marginTop: '0.1rem' }}>
            {inboxTelegram.length > 0
              ? `Bot ativo: ${inboxTelegram.map((i) => i.name).join(', ')}`
              : 'Sincronize bots ou canais do Telegram via BotFather para enviar e receber conversas no Atendimento.'}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem' }}>
            <a
              href={`${view.chatwootUrl}/app/accounts/${view.conta?.chatwootAccountId || 1}/settings/inboxes/new`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}
            >
              <Send size={14} /> Sincronizar Telegram
            </a>
          </div>
        </div>
      </div>

      {/* MODAL DE EDIÇÃO DOS DADOS DO CHIP E INSTÂNCIA */}
      {editandoChip && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 999, padding: '1rem' }}>
          <form onSubmit={handleSalvarChip} className="card" style={{ width: '100%', maxWidth: 480, padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Editar dados da instância e chip</h3>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEditandoChip(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <label className="form-field">
                <span className="form-label">Nome da Instância</span>
                <input
                  className="form-input"
                  required
                  placeholder="Ex.: Suporte, Financeiro, Disparo 01"
                  value={editandoChip.nome}
                  onChange={(e) => setEditandoChip({ ...editandoChip, nome: e.target.value })}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Número do Chip</span>
                <input
                  className="form-input"
                  placeholder="(61) 90000-0000"
                  value={editandoChip.numero_informado}
                  onChange={(e) => setEditandoChip({ ...editandoChip, numero_informado: e.target.value })}
                />
              </label>

              <label className="form-field">
                <span className="form-label">Tipo de número</span>
                <select
                  className="form-input"
                  value={editandoChip.tipo_numero}
                  onChange={(e) => setEditandoChip({ ...editandoChip, tipo_numero: e.target.value as any })}
                >
                  <option value="">Selecione...</option>
                  <option value="celular">Celular</option>
                  <option value="fixo">Fixo</option>
                  <option value="virtual">Virtual</option>
                </select>
              </label>

              <label className="form-field">
                <span className="form-label">Operadora</span>
                <select
                  className="form-input"
                  value={editandoChip.operadora_id}
                  onChange={(e) => setEditandoChip({ ...editandoChip, operadora_id: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {operadoras.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.nome}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span className="form-label">Tipo de plano</span>
                <select
                  className="form-input"
                  value={editandoChip.tipo_plano}
                  onChange={(e) => setEditandoChip({ ...editandoChip, tipo_plano: e.target.value as any })}
                >
                  <option value="">Selecione...</option>
                  <option value="pos_pago">Pós-Pago</option>
                  <option value="pre_pago">Pré-Pago</option>
                  <option value="virtual">Virtual</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditandoChip(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={salvandoChip}>
                {salvandoChip ? <Loader2 size={16} className="spinner" /> : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DE CONTROLE DE RECARGAS */}
      {modalRecarga && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 999, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: 540, padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Controle de Recargas</h3>
                <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
                  {modalRecarga.instancia.nome} {modalRecarga.instancia.numero_informado ? `(${modalRecarga.instancia.numero_informado})` : ''}
                </div>
              </div>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setModalRecarga(null)}>
                <X size={18} />
              </button>
            </div>

            {/* Formulário de Nova Recarga */}
            <form onSubmit={handleRegistrarRecarga} style={{ background: 'var(--color-bg-subtle, rgba(0,0,0,0.02))', padding: '1rem', borderRadius: 8, marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} /> Nova Recarga
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <label className="form-field">
                  <span className="form-label">Data da Recarga</span>
                  <input
                    type="date"
                    className="form-input"
                    required
                    value={modalRecarga.dataRecarga}
                    onChange={(e) => handleDataRecargaChange(e.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span className="form-label">Valor (R$)</span>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="30,00"
                    value={modalRecarga.valor}
                    onChange={(e) => setModalRecarga({ ...modalRecarga, valor: e.target.value })}
                  />
                </label>

                <label className="form-field">
                  <span className="form-label">Próxima Recarga</span>
                  <input
                    type="date"
                    className="form-input"
                    required
                    min={modalRecarga.dataRecarga}
                    max={maxProxDateStr}
                    value={modalRecarga.proximaRecarga}
                    onChange={(e) => setModalRecarga({ ...modalRecarga, proximaRecarga: e.target.value })}
                  />
                  <span style={{ fontSize: 10, color: 'var(--color-ink-subtle)', marginTop: 2 }}>Máx.: 60 dias após recarga</span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary btn-sm" disabled={modalRecarga.salvando} style={{ width: '100%' }}>
                {modalRecarga.salvando ? <Loader2 size={14} className="spinner" /> : 'Registrar Recarga'}
              </button>
            </form>

            {/* Histórico de Recargas */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={14} /> Histórico de Recargas
              </div>

              {modalRecarga.carregandoHistorico ? (
                <div style={{ textAlign: 'center', padding: '1rem', fontSize: 13, color: 'var(--color-ink-subtle)' }}>
                  <Loader2 size={16} className="spinner" /> Carregando histórico...
                </div>
              ) : modalRecarga.historico.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1rem', fontSize: 13, color: 'var(--color-ink-subtle)' }}>
                  Nenhuma recarga registrada até o momento.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-line)', textAlign: 'left', color: 'var(--color-ink-subtle)' }}>
                        <th style={{ padding: '6px 8px' }}>Data</th>
                        <th style={{ padding: '6px 8px' }}>Valor</th>
                        <th style={{ padding: '6px 8px' }}>Próxima Recarga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalRecarga.historico.map((item) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--color-line)' }}>
                          <td style={{ padding: '6px 8px' }}>
                            {new Date(item.data_recarga + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </td>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                            R$ {item.valor.toFixed(2).replace('.', ',')}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {new Date(item.proxima_recarga + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
