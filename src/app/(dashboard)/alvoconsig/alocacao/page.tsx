'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Search, Send, Undo2 } from 'lucide-react'
import { contarDisponiveisNoWeSales, encerrarCampanhaAgora, getCampanhas, getConveniosAtivos, getParceirosHabilitados } from '../actions'

type Parceiro = { agenteParceiroId: string; nome: string; arwCode: string }
type Convenio = { id: string; nome: string; codigo: string | null }
type Campanha = {
  id: string
  descricao: string
  base_tag: string
  qtd_solicitada: number
  qtd_alocada: number
  vigencia_inicio: string
  vigencia_fim: string
  status: 'montando' | 'ativa' | 'encerrando' | 'encerrada' | 'cancelada'
  agentes_parceiros?: { id: string; name: string; fantasy_name: string | null } | null
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

const STATUS_LABEL: Record<Campanha['status'], string> = {
  montando: 'Montando',
  ativa: 'Ativa',
  encerrando: 'Encerrando (aguardando fila)',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
}
const STATUS_BADGE: Record<Campanha['status'], string> = {
  montando: 'badge-gray',
  ativa: 'badge-success',
  encerrando: 'badge-warning',
  encerrada: 'badge-gray',
  cancelada: 'badge-danger',
}

function formatDateBR(value: string) {
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')
  } catch {
    return value
  }
}

export default function AlocacaoPage() {
  const [parceiros, setParceiros] = useState<Parceiro[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [parceiroId, setParceiroId] = useState('')
  const [convenioId, setConvenioId] = useState('')
  const [baseTag, setBaseTag] = useState('')
  const [quantidade, setQuantidade] = useState('500')
  const [vigenciaFim, setVigenciaFim] = useState('')
  const [descricao, setDescricao] = useState('')
  const [disponiveis, setDisponiveis] = useState<number | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [criando, setCriando] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [parceirosRes, conveniosRes, campanhasRes] = await Promise.all([getParceirosHabilitados(), getConveniosAtivos(), getCampanhas()])
      if (parceirosRes.success) setParceiros((parceirosRes.items || []) as Parceiro[])
      if (conveniosRes.success) setConvenios((conveniosRes.items || []) as Convenio[])
      if (campanhasRes.success) setCampanhas((campanhasRes.items || []) as unknown as Campanha[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function consultarDisponiveis() {
    if (!baseTag.trim()) {
      setMessage({ type: 'error', text: 'Informe a base (tag) para consultar.' })
      return
    }
    setConsultando(true)
    setDisponiveis(null)
    try {
      const res = await contarDisponiveisNoWeSales(baseTag)
      if (res.success) setDisponiveis(res.disponiveis ?? 0)
      else setMessage({ type: 'error', text: res.error || 'Erro ao consultar o WeSales.' })
    } finally {
      setConsultando(false)
    }
  }

  async function handleCriarCampanha(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true)
    setMessage(null)
    try {
      const res = await fetch('/api/alvoconsig/campanhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agenteParceiroId: parceiroId,
          convenioId: convenioId || undefined,
          baseTagSlug: baseTag,
          quantidade: Number.parseInt(quantidade, 10),
          vigenciaFim,
          descricao,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao criar a campanha.' })
        return
      }
      setMessage({
        type: 'success',
        text: `Campanha criada: ${Number(json.alocados).toLocaleString('pt-BR')} de ${Number(json.encontrados).toLocaleString('pt-BR')} contato(s) encontrados foram copiados e já entraram na fila de sincronização com o WeSales.`,
      })
      setDescricao('')
      setDisponiveis(null)
      await loadData()
    } catch {
      setMessage({ type: 'error', text: 'Erro ao criar a campanha.' })
    } finally {
      setCriando(false)
    }
  }

  async function handleEncerrar(campanha: Campanha) {
    if (!window.confirm(`Encerrar a campanha "${campanha.descricao || campanha.base_tag}" agora? Leads não concretizados voltam para o pool no WeSales (tag "disponivel").`)) return
    setBusyId(campanha.id)
    setMessage(null)
    try {
      const res = await encerrarCampanhaAgora(campanha.id)
      if (res.success) {
        setMessage({ type: 'success', text: `Campanha encerrada. ${res.expurgados || 0} cópia(s) expurgada(s), ${res.mantidos || 0} mantida(s) (negociação aberta/certificação pendente).` })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao encerrar a campanha.' })
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Send size={18} />
          Campanhas
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Aloca contatos do WeSales (tag da base + disponível) para um parceiro, com vigência. Os leads continuam no WeSales — aqui só copiamos o mínimo para atendimento rápido.
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex', gap: '0.5rem', alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleCriarCampanha} className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 240 }}>
            <label className="form-label">Parceiro <span className="required">*</span></label>
            <select className="form-control" required value={parceiroId} onChange={(e) => setParceiroId(e.target.value)}>
              <option value="">Selecione...</option>
              {parceiros.map((parceiro) => (
                <option key={parceiro.agenteParceiroId} value={parceiro.agenteParceiroId}>{parceiro.nome} ({parceiro.arwCode})</option>
              ))}
            </select>
            {parceiros.length === 0 && !loading && (
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                Nenhum parceiro com AlvoConsig habilitado (aba AlvoConsig no Agente Corban).
              </div>
            )}
          </div>
          <div className="form-group" style={{ minWidth: 200 }}>
            <label className="form-label">Convênio (p/ calcular ofertas) <span className="required">*</span></label>
            <select className="form-control" required value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">Selecione...</option>
              {convenios.map((conv) => (
                <option key={conv.id} value={conv.id}>{conv.nome}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label className="form-label">Base (tag no WeSales) <span className="required">*</span></label>
            <input type="text" className="form-control" required placeholder="Ex.: mesquita-refin-2026-08" value={baseTag} onChange={(e) => { setBaseTag(e.target.value); setDisponiveis(null) }} />
          </div>
          <div className="form-group" style={{ width: 140 }}>
            <label className="form-label">Quantidade <span className="required">*</span></label>
            <input type="number" min={1} max={20000} className="form-control" required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div className="form-group" style={{ width: 170 }}>
            <label className="form-label">Vigência até <span className="required">*</span></label>
            <input type="date" className="form-control" required value={vigenciaFim} onChange={(e) => setVigenciaFim(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Descrição</label>
            <input type="text" className="form-control" placeholder="Ex.: Prefeitura Mesquita — Refin ago/26" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={consultarDisponiveis} disabled={consultando || !baseTag.trim()}>
            {consultando ? <Loader2 size={15} className="spinner" /> : <Search size={15} />}
            Consultar disponíveis no WeSales
          </button>
          {disponiveis !== null && (
            <span style={{ fontSize: '0.875rem', color: 'var(--brs-gray-500)' }}>
              Disponíveis nessa base: <strong style={{ color: 'var(--brs-gray-800)' }}>{disponiveis.toLocaleString('pt-BR')}</strong>
            </span>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <button type="submit" className="btn btn-primary" disabled={criando || !parceiroId || !convenioId || !baseTag.trim() || !vigenciaFim}>
              {criando ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
              Criar campanha
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parceiro</th>
                <th>Descrição</th>
                <th>Base</th>
                <th>Alocados</th>
                <th>Vigência</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : campanhas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Send size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma campanha criada</h3>
                      <p>Crie a primeira campanha para um parceiro.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                campanhas.map((campanha) => (
                  <tr key={campanha.id}>
                    <td style={{ fontWeight: 600 }}>{campanha.agentes_parceiros?.fantasy_name || campanha.agentes_parceiros?.name || '-'}</td>
                    <td>{campanha.descricao || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{campanha.base_tag}</td>
                    <td>{campanha.qtd_alocada.toLocaleString('pt-BR')} / {campanha.qtd_solicitada.toLocaleString('pt-BR')}</td>
                    <td style={{ fontSize: '0.85rem' }}>{formatDateBR(campanha.vigencia_inicio)} — {formatDateBR(campanha.vigencia_fim)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[campanha.status]}`}>{STATUS_LABEL[campanha.status]}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {(campanha.status === 'ativa' || campanha.status === 'encerrando') && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm btn-acao"
                          onClick={() => handleEncerrar(campanha)}
                          disabled={busyId === campanha.id}
                          title="Encerrar agora"
                          aria-label="Encerrar agora"
                        >
                          {busyId === campanha.id ? <Loader2 size={15} className="spinner" /> : <Undo2 size={15} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
