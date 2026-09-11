'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, CheckCircle, Edit2, ExternalLink, Loader2, MessageCircleQuestion, Plus, Power, PowerOff, Search, Upload, X } from 'lucide-react'
import { maskCnpj, onlyDigits } from '@/lib/company-bank-accounts'
import { normalizeCnpjWsCompleto } from '@/lib/cnpj-consulta'
import { normalizarUrl } from '@/lib/url-site'
import FaqEditor from '@/components/faq/FaqEditor'
import { EditableFilePreview } from '@/app/(dashboard)/promotoras/_components/PromotoraEditor'
import { getAverbadoras, salvarAverbadora, setAverbadoraStatus, type Averbadora } from './actions'

type EditingAverbadora = {
  id?: string
  cnpj: string
  razao_social: string
  nome: string
  site_institucional: string
  logo_wide_url: string
  logo_url: string
}

function WideFilePreview({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
}) {
  const uploaded = String(value || '').trim()

  function handleFile(file: File | null) {
    if (!file || disabled) return
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      <label
        style={{
          width: 220,
          height: 88,
          borderRadius: 14,
          border: '1px solid var(--brs-gray-200)',
          overflow: 'hidden',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {!disabled && (
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0] || null)} />
        )}
        {uploaded ? (
          <img src={uploaded} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', gap: '0.3rem', color: 'var(--brs-gray-400)' }}>
            <Upload size={20} />
            {!disabled && <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Clique para enviar</span>}
          </div>
        )}
      </label>
    </div>
  )
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function AverbadorasPage() {
  const [items, setItems] = useState<Averbadora[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<EditingAverbadora | null>(null)
  const [saving, setSaving] = useState(false)
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [faqItem, setFaqItem] = useState<Averbadora | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await getAverbadoras()
      if (res.success) setItems(res.items || [])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as averbadoras.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar as averbadoras.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      if (!query) return true
      return (
        String(item.nome || '').toLowerCase().includes(query) ||
        String(item.razao_social || '').toLowerCase().includes(query) ||
        onlyDigits(item.cnpj).includes(onlyDigits(query))
      )
    })
  }, [items, searchQuery])

  function openNew() {
    setEditing({ cnpj: '', razao_social: '', nome: '', site_institucional: '', logo_wide_url: '', logo_url: '' })
    setIsModalOpen(true)
  }

  function openEdit(item: Averbadora) {
    setEditing({
      id: item.id,
      cnpj: item.cnpj || '',
      razao_social: item.razao_social || '',
      nome: item.nome || '',
      site_institucional: item.site_institucional || '',
      logo_wide_url: item.logo_wide_url || '',
      logo_url: item.logo_url || '',
    })
    setIsModalOpen(true)
  }

  async function fillByCnpj() {
    if (!editing) return
    const cnpj = onlyDigits(editing.cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido para consulta.' })
      return
    }
    setConsultandoCnpj(true)
    try {
      const res = await fetch(`/api/cnpjws/cnpj/${cnpj}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.razao_social) throw new Error(data?.error || data?.message || 'CNPJ não encontrado.')
      const rica = normalizeCnpjWsCompleto(data)
      setEditing((prev) => (prev ? { ...prev, cnpj, razao_social: rica.razao_social || prev.razao_social } : prev))
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar o CNPJ.' })
    } finally {
      setConsultandoCnpj(false)
    }
  }

  function handleSiteBlur() {
    if (!editing?.site_institucional?.trim()) return
    try {
      const normalizada = normalizarUrl(editing.site_institucional)
      setEditing((prev) => (prev ? { ...prev, site_institucional: normalizada } : prev))
    } catch {
      // deixa o texto como digitado — o erro real aparece só ao tentar salvar
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (onlyDigits(editing.cnpj).length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido (14 dígitos).' })
      return
    }
    if (!editing.nome.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome da averbadora.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarAverbadora({
        id: editing.id,
        cnpj: editing.cnpj,
        razao_social: editing.razao_social,
        nome: editing.nome,
        site_institucional: editing.site_institucional || null,
        logo_wide_url: editing.logo_wide_url || null,
        logo_url: editing.logo_url || null,
      })
      if (res.success) {
        setIsModalOpen(false)
        setEditing(null)
        setMessage({ type: 'success', text: editing.id ? 'Averbadora atualizada.' : 'Averbadora criada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar a averbadora.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar a averbadora.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(item: Averbadora) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setAverbadoraStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Averbadora reativada.' : 'Averbadora inativada.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao alterar status.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={18} />
            Averbadoras
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro de averbadoras — vinculadas aos convênios em Cadastros › Convênios.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Plus size={16} />
          Nova Averbadora
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

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nome, razão social ou CNPJ..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Nome Averbadora</th>
                <th>CNPJ</th>
                <th>Razão Social</th>
                <th>Site</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Building2 size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma averbadora encontrada</h3>
                      <p>Cadastre a primeira averbadora para vincular aos convênios.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--brs-gray-200)', background: '#fff', display: 'grid', placeItems: 'center' }}>
                        {item.logo_url ? (
                          <img src={item.logo_url} alt={`Logotipo de ${item.nome}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <Building2 size={16} style={{ color: 'var(--brs-gray-300)' }} />
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{maskCnpj(item.cnpj)}</td>
                    <td>{item.razao_social || '-'}</td>
                    <td>
                      {item.site_institucional ? (
                        <a href={item.site_institucional} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--brs-navy)' }}>
                          Site <ExternalLink size={12} />
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>{item.is_active ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => openEdit(item)} title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => setFaqItem(item)} title="FAQ" aria-label="FAQ">
                          <MessageCircleQuestion size={15} />
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm btn-acao ${item.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => handleToggle(item)}
                          disabled={busyId === item.id}
                          title={item.is_active ? 'Inativar' : 'Ativar'}
                          aria-label={item.is_active ? 'Inativar' : 'Ativar'}
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

      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editing?.id ? 'Editar Averbadora' : 'Nova Averbadora'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">CNPJ <span className="required">*</span></label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-control"
                      required
                      placeholder="00.000.000/0000-00"
                      value={maskCnpj(editing?.cnpj || '')}
                      onChange={(e) => setEditing((prev) => (prev ? { ...prev, cnpj: onlyDigits(e.target.value) } : prev))}
                      onBlur={() => onlyDigits(editing?.cnpj || '').length === 14 && fillByCnpj()}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-outline btn-sm" onClick={fillByCnpj} disabled={consultandoCnpj}>
                      {consultandoCnpj ? <Loader2 size={15} className="spinner" /> : 'Buscar'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Razão Social</label>
                  <input
                    type="text"
                    className="form-control"
                    value={editing?.razao_social || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, razao_social: e.target.value } : prev))}
                  />
                </div>

                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Nome Averbadora <span className="required">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    placeholder="Ex.: Neoconsig"
                    value={editing?.nome || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, nome: e.target.value } : prev))}
                  />
                </div>

                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label">Site Institucional</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Ex.: neoconsig.com.br"
                    value={editing?.site_institucional || ''}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, site_institucional: e.target.value } : prev))}
                    onBlur={handleSiteBlur}
                  />
                </div>

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <WideFilePreview
                    label="Logotipo horizontal 500x200px"
                    value={editing?.logo_wide_url || ''}
                    disabled={false}
                    onChange={(next) => setEditing((prev) => (prev ? { ...prev, logo_wide_url: next } : prev))}
                  />
                  <EditableFilePreview
                    label="Logotipo quadrado 500x500px"
                    value={editing?.logo_url || ''}
                    disabled={false}
                    onChange={(next) => setEditing((prev) => (prev ? { ...prev, logo_url: next } : prev))}
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

      {faqItem && (
        <div className="modal-backdrop" onClick={() => setFaqItem(null)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">FAQ — {faqItem.nome}</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setFaqItem(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <FaqEditor escopo="geral" entidadeTipo="averbadora" entidadeId={faqItem.id} titulo={`FAQ (regra geral) — ${faqItem.nome}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
