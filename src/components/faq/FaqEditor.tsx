'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, MessageCircleQuestion, Plus, Power, PowerOff, Trash2, X } from 'lucide-react'
import {
  excluirFaq,
  getFaqCategoriasSugestoes,
  getFaqConvenio,
  getFaqGeral,
  salvarFaq,
  setFaqStatus,
  type FaqEntidadeTipo,
  type FaqEscopo,
  type FaqItem,
} from '@/app/(dashboard)/convenios/faq-actions'

export type FaqContexto = { tipo: FaqEntidadeTipo; id: string; nome: string }

const ENTIDADE_TIPO_LABEL: Record<FaqEntidadeTipo, string> = {
  instituicao_financeira: 'Instituição Financeira',
  forma_contrato: 'Forma de Contrato',
  averbadora: 'Averbadora',
}

type Editing = {
  id?: string
  categoria: string
  pergunta: string
  resposta: string
  ordem: number
  entidade_tipo: FaqEntidadeTipo | null
  entidade_id: string | null
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function FaqEditor({
  escopo,
  entidadeTipo,
  entidadeId,
  convenioId,
  contextos,
  titulo,
}: {
  escopo: FaqEscopo
  entidadeTipo?: FaqEntidadeTipo
  entidadeId?: string
  convenioId?: string
  contextos?: FaqContexto[]
  titulo?: string
}) {
  const [items, setItems] = useState<FaqItem[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      if (escopo === 'geral' && entidadeTipo && entidadeId) {
        const res = await getFaqGeral(entidadeTipo, entidadeId)
        if (res.success) setItems(res.items || [])
        else setMessage({ type: 'error', text: res.error || 'Erro ao carregar FAQ.' })
      } else if (escopo === 'convenio' && convenioId) {
        const res = await getFaqConvenio(convenioId)
        if (res.success) setItems(res.proprias || [])
        else setMessage({ type: 'error', text: res.error || 'Erro ao carregar FAQ.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar FAQ.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getFaqCategoriasSugestoes().then(setCategorias).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escopo, entidadeTipo, entidadeId, convenioId])

  function openNew() {
    setEditing({ categoria: '', pergunta: '', resposta: '', ordem: items.length, entidade_tipo: null, entidade_id: null })
    setIsModalOpen(true)
  }

  function openEdit(item: FaqItem) {
    setEditing({
      id: item.id,
      categoria: item.categoria || '',
      pergunta: item.pergunta,
      resposta: item.resposta,
      ordem: item.ordem,
      entidade_tipo: item.entidade_tipo,
      entidade_id: item.entidade_id,
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.pergunta.trim() || !editing?.resposta.trim()) {
      setMessage({ type: 'error', text: 'Informe a pergunta e a resposta.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarFaq({
        id: editing.id,
        escopo,
        convenio_id: escopo === 'convenio' ? convenioId : null,
        entidade_tipo: escopo === 'geral' ? entidadeTipo || null : editing.entidade_tipo,
        entidade_id: escopo === 'geral' ? entidadeId || null : editing.entidade_id,
        categoria: editing.categoria,
        pergunta: editing.pergunta,
        resposta: editing.resposta,
        ordem: editing.ordem,
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'FAQ atualizada.' : 'FAQ criada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a FAQ.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar a FAQ.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: FaqItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const proximoStatus = item.status === 'arquivado' ? 'ativo' : 'arquivado'
      const res = await setFaqStatus(item.id, proximoStatus)
      if (res.success) await loadData()
      else setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleExcluir(item: FaqItem) {
    if (!window.confirm(`Excluir a FAQ "${item.pergunta}"? Essa ação não pode ser desfeita.`)) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirFaq(item.id)
      if (res.success) await loadData()
      else setMessage({ type: 'error', text: res.error || 'Erro ao excluir a FAQ.' })
    } finally {
      setBusyId(null)
    }
  }

  function nomeContexto(item: FaqItem): string | null {
    if (!item.entidade_tipo) return null
    return item.contexto_nome ? `${ENTIDADE_TIPO_LABEL[item.entidade_tipo]} · ${item.contexto_nome}` : ENTIDADE_TIPO_LABEL[item.entidade_tipo]
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800 }}>
          <MessageCircleQuestion size={16} />
          {titulo || 'FAQ'}
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={openNew}>
          <Plus size={14} />
          Nova FAQ
        </button>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '0.75rem',
            padding: '0.6rem 0.8rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.4rem',
            alignItems: 'center',
            fontSize: '0.82rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', textAlign: 'center', padding: '1.25rem' }}>Nenhuma FAQ cadastrada.</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Pergunta</th>
                {escopo === 'geral' && <th>Usos</th>}
                {escopo === 'convenio' && <th>Contexto</th>}
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.categoria || '-'}</td>
                  <td style={{ fontWeight: 600, maxWidth: 320 }}>{item.pergunta}</td>
                  {escopo === 'geral' && <td>{item.usos ?? 0} convênio(s)</td>}
                  {escopo === 'convenio' && <td style={{ fontSize: '0.82rem' }}>{nomeContexto(item) || '—'}</td>}
                  <td>
                    <span className={`badge ${item.status === 'ativo' ? 'badge-success' : item.status === 'rascunho' ? 'badge-warning' : 'badge-gray'}`}>
                      {item.status === 'ativo' ? 'Ativa' : item.status === 'rascunho' ? 'Rascunho' : 'Arquivada'}
                    </span>
                    {item.origem === 'ia' && <span className="badge badge-gray" style={{ marginLeft: '0.35rem' }}>IA</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm btn-acao ${item.status === 'ativo' ? 'btn-outline' : 'btn-primary'}`}
                        onClick={() => handleToggle(item)}
                        disabled={busyId === item.id}
                        title={item.status === 'ativo' ? 'Arquivar' : 'Reativar'}
                        aria-label={item.status === 'ativo' ? 'Arquivar' : 'Reativar'}
                      >
                        {busyId === item.id ? <Loader2 size={14} className="spinner" /> : item.status === 'ativo' ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-acao"
                        onClick={() => handleExcluir(item)}
                        disabled={busyId === item.id}
                        title="Excluir"
                        aria-label="Excluir"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && editing && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? 'Editar FAQ' : 'Nova FAQ'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Categoria</label>
                  <input
                    type="text"
                    className="form-control"
                    list="faq-categorias-sugestoes"
                    value={editing.categoria}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, categoria: e.target.value } : prev))}
                  />
                  <datalist id="faq-categorias-sugestoes">
                    {categorias.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Pergunta <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    value={editing.pergunta}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, pergunta: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Resposta <span className="required">*</span></label>
                  <textarea
                    className="form-control"
                    rows={4}
                    required
                    value={editing.resposta}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, resposta: e.target.value } : prev))}
                  />
                </div>
                {escopo === 'convenio' && contextos && contextos.length > 0 && (
                  <div className="form-group" style={{ marginTop: '0.75rem' }}>
                    <label className="form-label">Contexto (opcional)</label>
                    <select
                      className="form-control"
                      value={editing.entidade_tipo && editing.entidade_id ? `${editing.entidade_tipo}:${editing.entidade_id}` : ''}
                      onChange={(e) => {
                        const [tipo, id] = e.target.value.split(':')
                        setEditing((prev) => (prev ? { ...prev, entidade_tipo: (tipo as FaqEntidadeTipo) || null, entidade_id: id || null } : prev))
                      }}
                    >
                      <option value="">Regra geral do convênio (sem contexto)</option>
                      {contextos.map((c) => (
                        <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
                          {ENTIDADE_TIPO_LABEL[c.tipo]} · {c.nome}
                        </option>
                      ))}
                    </select>
                    <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
                      Use quando esta pergunta/resposta é uma exceção ligada a uma instituição, forma ou averbadora específica deste convênio.
                    </div>
                  </div>
                )}
                <div className="form-group" style={{ marginTop: '0.75rem', maxWidth: 160 }}>
                  <label className="form-label">Ordem</label>
                  <input
                    type="number"
                    className="form-control"
                    value={editing.ordem}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, ordem: Number(e.target.value) || 0 } : prev))}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
