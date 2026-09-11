'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle,
  Edit2,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Power,
  PowerOff,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  excluirDocumento,
  getDocumentoUrl,
  getDocumentos,
  salvarDocumento,
  setDocumentoStatus,
  type DocumentoConvenio,
  type TipoDocumento,
} from '../../documentos-actions'
import { lerDocumentoComJarvis } from '../../pesquisa-actions'

const IA_STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  nao_lido: { label: 'Não lido pela IA', badge: 'badge-gray' },
  processando: { label: 'Processando...', badge: 'badge-warning' },
  concluido: { label: 'Lido pela IA', badge: 'badge-success' },
  erro: { label: 'Erro na leitura', badge: 'badge-danger' },
}

type Editing = {
  id?: string
  titulo: string
  texto: string
  url: string
  ordem: number
  arquivoNovo: File | null
  removerArquivo: boolean
  resumo_ia?: string | null
  arquivo_nome?: string | null
  arquivo_tamanho?: number | null
  temArquivo?: boolean
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentosLista({
  convenioId,
  tipo,
  convenioInstituicaoId,
  titulo,
}: {
  convenioId: string
  tipo: TipoDocumento
  convenioInstituicaoId?: string
  titulo: string
}) {
  const [items, setItems] = useState<DocumentoConvenio[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [lendoComJarvis, setLendoComJarvis] = useState(false)
  const router = useRouter()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getDocumentos(convenioId, tipo, convenioInstituicaoId)
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar documentos.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar documentos.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioId, tipo, convenioInstituicaoId])

  function openNew() {
    setEditing({ titulo: '', texto: '', url: '', ordem: items.length, arquivoNovo: null, removerArquivo: false })
    setIsModalOpen(true)
  }

  function openEdit(item: DocumentoConvenio) {
    setEditing({
      id: item.id,
      titulo: item.titulo,
      texto: item.texto || '',
      url: item.url || '',
      ordem: item.ordem,
      arquivoNovo: null,
      removerArquivo: false,
      resumo_ia: item.resumo_ia,
      arquivo_nome: item.arquivo_nome,
      arquivo_tamanho: item.arquivo_tamanho,
      temArquivo: item.temArquivo,
    })
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.titulo.trim()) {
      setMessage({ type: 'error', text: 'Informe o título do documento.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const fd = new FormData()
      if (editing.id) fd.append('id', editing.id)
      fd.append('convenio_id', convenioId)
      fd.append('tipo', tipo)
      if (convenioInstituicaoId) fd.append('convenio_instituicao_id', convenioInstituicaoId)
      fd.append('titulo', editing.titulo)
      fd.append('texto', editing.texto || '')
      fd.append('url', editing.url || '')
      fd.append('ordem', String(editing.ordem ?? 0))
      if (editing.arquivoNovo) fd.append('arquivo', editing.arquivoNovo)
      if (editing.removerArquivo) fd.append('remover_arquivo', '1')

      const res = await salvarDocumento(fd)
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Documento atualizado.' : 'Documento criado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o documento.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o documento.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleAbrir(item: DocumentoConvenio) {
    if (item.temArquivo) {
      const res = await getDocumentoUrl(item.id)
      if (res.success && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
      else setMessage({ type: 'error', text: res.error || 'Erro ao abrir o arquivo.' })
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  async function handleToggle(item: DocumentoConvenio) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await setDocumentoStatus(item.id, !item.is_active)
      if (res.success) await loadData()
      else setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleLerComJarvis() {
    if (!editing?.id) return
    setLendoComJarvis(true)
    setMessage(null)
    try {
      const res = await lerDocumentoComJarvis(editing.id)
      if (res.success) {
        setIsModalOpen(false)
        router.push(`/convenios/${convenioId}?aba=bc&sub=pesquisa`)
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao iniciar a leitura com o Jarvis.' })
      }
    } finally {
      setLendoComJarvis(false)
    }
  }

  async function handleExcluir(item: DocumentoConvenio) {
    if (!window.confirm(`Excluir "${item.titulo}"? Essa ação não pode ser desfeita.`)) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirDocumento(item.id)
      if (res.success) await loadData()
      else setMessage({ type: 'error', text: res.error || 'Erro ao excluir o documento.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontWeight: 800 }}>{titulo}</div>
          <button type="button" className="btn btn-outline btn-sm" onClick={openNew}>
            <Plus size={14} />
            Novo Documento
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', textAlign: 'center', padding: '1.25rem' }}>Nenhum documento cadastrado.</div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Conteúdo</th>
                  <th>Leitura IA</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const iaInfo = IA_STATUS_LABEL[item.ia_status] || IA_STATUS_LABEL.nao_lido
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.titulo}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--brs-gray-500)' }}>
                          {item.temArquivo && <span title="Tem arquivo anexado"><Paperclip size={14} /></span>}
                          {item.url && <span title="Tem link"><Link2 size={14} /></span>}
                          {item.texto && <span title="Tem texto colado"><FileText size={14} /></span>}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${iaInfo.badge}`}>{iaInfo.label}</span>
                      </td>
                      <td>
                        <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {(item.temArquivo || item.url) && (
                            <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => handleAbrir(item)} title="Abrir" aria-label="Abrir">
                              <ExternalLink size={14} />
                            </button>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm btn-acao ${item.is_active ? 'btn-outline' : 'btn-primary'}`}
                            onClick={() => handleToggle(item)}
                            disabled={busyId === item.id}
                            title={item.is_active ? 'Inativar' : 'Ativar'}
                            aria-label={item.is_active ? 'Inativar' : 'Ativar'}
                          >
                            {busyId === item.id ? <Loader2 size={14} className="spinner" /> : item.is_active ? <PowerOff size={14} /> : <Power size={14} />}
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && editing && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing.id ? 'Editar Documento' : 'Novo Documento'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Título <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    value={editing.titulo}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, titulo: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Texto Integral (opcional se houver link ou arquivo)</label>
                  <textarea
                    className="form-control"
                    rows={6}
                    value={editing.texto}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, texto: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Link Externo</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="https://..."
                    value={editing.url}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, url: e.target.value } : prev))}
                  />
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Arquivo (PDF, DOCX, TXT, MD, PNG ou JPEG — até 4 MB; maior que isso, use o Link)</label>
                  {editing.temArquivo && !editing.arquivoNovo && !editing.removerArquivo ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                      <Paperclip size={14} />
                      <span>{editing.arquivo_nome} {editing.arquivo_tamanho ? `(${formatBytes(editing.arquivo_tamanho)})` : ''}</span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing((prev) => (prev ? { ...prev, removerArquivo: true } : prev))}>
                        Remover
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      className="form-control"
                      accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, arquivoNovo: e.target.files?.[0] || null, removerArquivo: false } : prev))}
                    />
                  )}
                  {editing.removerArquivo && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.3rem' }}>
                      Arquivo será removido ao salvar.{' '}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing((prev) => (prev ? { ...prev, removerArquivo: false } : prev))}>
                        Desfazer
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem', maxWidth: 160 }}>
                  <label className="form-label">Ordem</label>
                  <input
                    type="number"
                    className="form-control"
                    value={editing.ordem}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, ordem: Number(e.target.value) || 0 } : prev))}
                  />
                </div>

                {editing.resumo_ia && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: 10, background: 'var(--brs-gray-50)', border: '1px solid var(--brs-gray-100)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                      <Sparkles size={14} />
                      Resumo (IA)
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-700)', whiteSpace: 'pre-wrap' }}>{editing.resumo_ia}</div>
                  </div>
                )}

                <div style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handleLerComJarvis}
                    disabled={!editing.id || lendoComJarvis}
                    title={editing.id ? undefined : 'Salve o documento primeiro'}
                  >
                    {lendoComJarvis ? <Loader2 size={14} className="spinner" /> : <Sparkles size={14} />}
                    Ler com o Jarvis
                  </button>
                  {!editing.id && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', marginTop: '0.3rem' }}>
                      Salve o documento primeiro para poder lê-lo com o Jarvis.
                    </div>
                  )}
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
