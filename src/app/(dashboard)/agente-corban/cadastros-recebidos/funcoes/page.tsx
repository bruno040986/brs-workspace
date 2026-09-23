'use client'

/**
 * Agente Corban › Cadastros Recebidos › Funções — catálogo das funções de
 * quem preenche o cadastro no Portal Parceiro (etapa 0 "Identificação").
 * Mesmo padrão de tela das Operadoras de Telefonia: tabela densa + modal.
 * A chave é gerada do nome na criação e não muda (vai para corban_data).
 */
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, Loader2, Plus, Power, PowerOff, UserCog, X } from 'lucide-react'
import { getFuncoes, salvarFuncao, setFuncaoStatus, type CadastroFuncao } from './actions'

type Editing = { id?: string; chave?: string; nome: string; exige_descricao: boolean; ordem: number }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function CadastroFuncoesPage() {
  const [items, setItems] = useState<CadastroFuncao[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    try {
      const res = await getFuncoes()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as funções.' })
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao carregar as funções.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carga inicial fora do corpo síncrono do efeito (react-hooks/set-state-in-effect).
    void Promise.resolve().then(loadData)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no mount
  }, [])

  function openNew() {
    const proximaOrdem = items.length ? Math.max(...items.map((i) => i.ordem)) + 10 : 10
    setEditing({ nome: '', exige_descricao: false, ordem: proximaOrdem })
  }

  function openEdit(item: CadastroFuncao) {
    setEditing({ id: item.id, chave: item.chave, nome: item.nome, exige_descricao: item.exige_descricao, ordem: item.ordem })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome da função.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarFuncao({ id: editing.id, nome: editing.nome, exige_descricao: editing.exige_descricao, ordem: editing.ordem })
      if (res.success) {
        setMessage({ type: 'success', text: editing.id ? 'Função atualizada.' : 'Função criada.' })
        setEditing(null)
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a função.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao salvar a função.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: CadastroFuncao) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setFuncaoStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Função reativada.' : 'Função inativada — some do portal, cadastros antigos mantêm o valor.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: (error instanceof Error && error.message) || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserCog size={18} />
            Funções de Quem Preenche o Cadastro
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Opções da etapa &quot;Identificação&quot; do Portal Parceiro (função da pessoa na empresa). A chave fica gravada no
            cadastro e não muda; renomear só altera o nome exibido.
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Função
        </button>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.875rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Ordem</th>
                <th>Função</th>
                <th>Chave</th>
                <th>Pede descrição</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <UserCog size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma função cadastrada</h3>
                      <p>Cadastre as funções que a pessoa pode ter na empresa (sócio, funcionário, contador…).</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ color: 'var(--brs-gray-500)' }}>{item.ordem}</td>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>
                      <code style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>{item.chave}</code>
                    </td>
                    <td>{item.exige_descricao ? <span className="badge badge-warning">Sim (texto livre)</span> : <span style={{ color: 'var(--brs-gray-400)' }}>Não</span>}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativa' : 'Inativa'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-acao"
                          onClick={() => handleToggle(item)}
                          disabled={busyId === item.id}
                          title={item.is_active ? 'Inativar' : 'Reativar'}
                          aria-label={item.is_active ? 'Inativar' : 'Reativar'}
                        >
                          {busyId === item.id ? <Loader2 size={15} className="spinner" /> : item.is_active ? <PowerOff size={15} /> : <Power size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? 'Editar Função' : 'Nova Função'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setEditing(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nome *</label>
                  <input
                    className="form-control"
                    placeholder="Ex.: Gerente comercial"
                    value={editing.nome}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, nome: e.target.value } : prev))}
                    autoFocus
                  />
                  {editing.chave && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.35rem' }}>
                      Chave: <code>{editing.chave}</code> (fixa)
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Ordem no portal</label>
                  <input
                    type="number"
                    className="form-control"
                    style={{ maxWidth: 140 }}
                    value={editing.ordem}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, ordem: Number(e.target.value) } : prev))}
                  />
                </div>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={editing.exige_descricao}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, exige_descricao: e.target.checked } : prev))}
                  />
                  Pede uma descrição em texto livre (ex.: &quot;Outro&quot;)
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
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
