'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Edit2,
  Images,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  deleteHubBanner,
  getHubBanners,
  saveHubBanner,
  setHubBannerStatus,
  updateHubBannerOrder,
} from './actions'
import {
  HUB_BANNER_DEFAULT_SECONDS,
  HUB_BANNER_MAX_SECONDS,
  HUB_BANNER_MIN_SECONDS,
  isHubBannerWithinSchedule,
  type HubBannerRecord,
} from '@/lib/hub-banners'

type FeedbackMessage = {
  type: 'success' | 'error'
  text: string
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function toDateInputValue(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function formatDate(iso?: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('pt-BR')
}

function scheduleLabel(item: HubBannerRecord) {
  const start = formatDate(item.starts_at)
  const end = formatDate(item.ends_at)
  if (start && end) return `${start} a ${end}`
  if (start) return `A partir de ${start}`
  if (end) return `Até ${end}`
  return 'Sem prazo'
}

function statusBadge(item: HubBannerRecord) {
  if (!item.is_active) return { className: 'badge badge-gray', label: 'Inativo' }
  const now = new Date()
  if (item.starts_at && now < new Date(item.starts_at)) return { className: 'badge badge-warning', label: 'Agendado' }
  if (item.ends_at && now > new Date(item.ends_at)) return { className: 'badge badge-gray', label: 'Encerrado' }
  return { className: 'badge badge-success', label: 'Em veiculação' }
}

export default function HubBannersPage() {
  const [items, setItems] = useState<HubBannerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<HubBannerRecord | null>(null)

  const [title, setTitle] = useState('')
  const [displaySeconds, setDisplaySeconds] = useState(HUB_BANNER_DEFAULT_SECONDS)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getHubBanners()
      if (res.success) {
        setItems((res.banners || []) as HubBannerRecord[])
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar os banners.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os banners.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function resetForm() {
    setTitle('')
    setDisplaySeconds(HUB_BANNER_DEFAULT_SECONDS)
    setStartsAt('')
    setEndsAt('')
    setImageBase64(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openNewModal() {
    setEditingItem(null)
    resetForm()
    setIsModalOpen(true)
  }

  function openEditModal(item: HubBannerRecord) {
    setEditingItem(item)
    setTitle(String(item.title || ''))
    setDisplaySeconds(Number(item.display_seconds) || HUB_BANNER_DEFAULT_SECONDS)
    setStartsAt(toDateInputValue(item.starts_at))
    setEndsAt(toDateInputValue(item.ends_at))
    setImageBase64(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setIsModalOpen(true)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione um arquivo de imagem (PNG, JPG, WEBP ou GIF).' })
      event.target.value = ''
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage({ type: 'error', text: 'A imagem deve ter no máximo 5MB.' })
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageBase64(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim()
    if (!normalizedTitle) {
      setMessage({ type: 'error', text: 'Informe um título para o banner.' })
      return
    }
    if (!editingItem && !imageBase64) {
      setMessage({ type: 'error', text: 'Selecione a imagem do banner.' })
      return
    }
    if (startsAt && endsAt && startsAt > endsAt) {
      setMessage({ type: 'error', text: 'O início da vigência deve ser anterior ao fim.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const res = await saveHubBanner({
        id: editingItem?.id,
        title: normalizedTitle,
        display_seconds: displaySeconds,
        starts_at: startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : null,
        ends_at: endsAt ? new Date(`${endsAt}T23:59:59.999`).toISOString() : null,
        is_active: editingItem?.is_active ?? true,
        image_base64: imageBase64,
      })

      if (res.success) {
        setMessage({ type: 'success', text: editingItem ? 'Banner atualizado com sucesso.' : 'Banner criado com sucesso.' })
        setIsModalOpen(false)
        setEditingItem(null)
        resetForm()
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o banner.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o banner.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(item: HubBannerRecord) {
    if (!item.id) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setHubBannerStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Banner reativado.' : 'Banner inativado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar o status.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao alterar o status.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(item: HubBannerRecord) {
    if (!item.id) return
    if (!window.confirm(`Excluir o banner "${item.title}"? Ele deixará de aparecer na home.`)) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await deleteHubBanner(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Banner excluído.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao excluir o banner.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir o banner.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    setItems(reordered)
    const res = await updateHubBannerOrder(reordered.map((item) => String(item.id)))
    if (!res.success) {
      setMessage({ type: 'error', text: res.error || 'Erro ao reordenar os banners.' })
      await loadData()
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Images size={18} />
            Banners da Home
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Gerencie as imagens exibidas no banner da página inicial do Workspace. Com mais de um banner ativo, a home alterna entre eles respeitando o tempo de exposição de cada um.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNewModal}>
          <Plus size={16} />
          Novo Banner
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
                <th style={{ width: 60 }}>Ordem</th>
                <th>Banner</th>
                <th>Tempo de exposição</th>
                <th>Vigência</th>
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
                      <Images size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum banner cadastrado</h3>
                      <p>Enquanto não houver banner cadastrado, a home continua exibindo a imagem padrão.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, index) => {
                  const badge = statusBadge(item)
                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => handleMove(index, -1)}
                            disabled={index === 0}
                            aria-label="Mover para cima"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => handleMove(index, 1)}
                            disabled={index === items.length - 1}
                            aria-label="Mover para baixo"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <img
                            src={item.image_url}
                            alt={item.title}
                            style={{ width: 120, height: 48, objectFit: 'contain', borderRadius: 8, background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-200)' }}
                          />
                          <div style={{ fontWeight: 600, color: 'var(--brs-gray-800)' }}>{item.title}</div>
                        </div>
                      </td>
                      <td>{item.display_seconds}s</td>
                      <td>
                        <span style={{ color: item.is_active && !isHubBannerWithinSchedule(item) ? 'var(--brs-gray-400)' : undefined }}>
                          {scheduleLabel(item)}
                        </span>
                      </td>
                      <td>
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditModal(item)}>
                            <Edit2 size={16} />
                            Editar
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${item.is_active ? 'btn-outline' : 'btn-primary'}`}
                            onClick={() => handleToggleStatus(item)}
                            disabled={busyId === item.id}
                          >
                            {busyId === item.id ? <Loader2 size={16} className="spinner" /> : null}
                            {item.is_active ? 'Inativar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#991B1B' }}
                            onClick={() => handleDelete(item)}
                            disabled={busyId === item.id}
                          >
                            <Trash2 size={16} />
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(event) => event.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <div className="modal-header">
                <h3 className="modal-title">{editingItem ? 'Editar Banner' : 'Novo Banner'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)} aria-label="Fechar">
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Título</label>
                  <input
                    type="text"
                    className="form-control"
                    maxLength={120}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ex.: Campanha de fim de ano"
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Imagem</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="form-control"
                    onChange={handleFileChange}
                  />
                  <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Upload size={13} />
                    PNG, JPG, WEBP ou GIF até 5MB. A área do banner tem 240px de altura; a imagem é ajustada sem corte.
                  </div>
                  {(imageBase64 || editingItem?.image_url) && (
                    <img
                      src={imageBase64 || editingItem?.image_url}
                      alt="Pré-visualização do banner"
                      style={{ marginTop: '0.75rem', width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 10, background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-200)' }}
                    />
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Tempo de exposição (segundos)</label>
                  <input
                    type="number"
                    className="form-control"
                    min={HUB_BANNER_MIN_SECONDS}
                    max={HUB_BANNER_MAX_SECONDS}
                    value={displaySeconds}
                    onChange={(event) => setDisplaySeconds(Number(event.target.value))}
                  />
                  <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Tempo que esta imagem fica visível antes de alternar para a próxima (quando houver mais de um banner ativo).
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Início da vigência (opcional)</label>
                    <input
                      type="date"
                      className="form-control"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fim da vigência (opcional)</label>
                    <input
                      type="date"
                      className="form-control"
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                    />
                  </div>
                </div>
                <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '-0.5rem' }}>
                  Sem datas, o banner fica em veiculação contínua. Com fim de vigência, ele deixa de aparecer automaticamente ao término.
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
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
