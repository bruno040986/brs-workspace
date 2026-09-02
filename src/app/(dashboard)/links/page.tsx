'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Plus, ExternalLink, Trash2, Edit2, Save, X, 
  Loader2, Globe, Link as LinkIcon, Search
} from 'lucide-react'
import { getLinks, saveLink, deleteLink } from './actions'

const SECTORS = [
  { id: 'adm', name: 'Administrativo' },
  { id: 'fin', name: 'Financeiro' },
  { id: 'rh', name: 'RH' },
  { id: 'ops', name: 'Operacional' },
  { id: 'mkt', name: 'Marketing' },
  { id: 'com', name: 'Comercial' },
  { id: 'acc', name: 'Acessos' },
  { id: 'tec', name: 'Tecnologia' },
]

export default function LinksPage() {
  const [links, setLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingLink, setEditingLink] = useState<any>({
    sector_id: '',
    label: '',
    url: '',
    is_external: false
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const result = await getLinks()
    if (result.success) {
      setLinks(result.data || [])
    } else {
      setError(result.error || 'Erro ao carregar links')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    
    try {
      const result = await saveLink(editingLink)
      if (!result.success) throw new Error(result.error)
      
      setIsModalOpen(false)
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este link?')) return
    
    const result = await deleteLink(id)
    if (result.success) {
      fetchData()
    } else {
      alert('Erro ao excluir: ' + result.error)
    }
  }

  const filteredLinks = links.filter(link => 
    link.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    SECTORS.find(s => s.id === link.sector_id)?.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="hub-container" style={{ animation: 'fadeIn 0.4s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--brs-navy)', margin: 0 }}>Gestão de Links</h1>
          <p style={{ color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>Cadastre e gerencie links úteis por setor</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setEditingLink({ sector_id: '', label: '', url: '', is_external: false })
          setIsModalOpen(true)
        }}>
          <Plus size={18} />
          Novo Link
        </button>
      </div>

      <div className="card">
        <div className="card-header" style={{ background: 'var(--brs-gray-50)' }}>
          <div className="search-input" style={{ maxWidth: '400px' }}>
            <Search />
            <input 
              type="text" 
              placeholder="Buscar por título ou setor..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Setor</th>
                <th>URL</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                    <Loader2 className="spinner" size={24} />
                    <p style={{ marginTop: '0.5rem', color: 'var(--brs-gray-400)' }}>Carregando links...</p>
                  </td>
                </tr>
              ) : filteredLinks.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                    <LinkIcon size={32} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
                    <p style={{ color: 'var(--brs-gray-400)' }}>Nenhum link encontrado.</p>
                  </td>
                </tr>
              ) : (
                filteredLinks.map((link) => (
                  <tr key={link.id}>
                    <td style={{ fontWeight: 600, color: 'var(--brs-navy)' }}>{link.label}</td>
                    <td>
                      <span className={`badge badge-${link.sector_id}`}>
                        {SECTORS.find(s => s.id === link.sector_id)?.name}
                      </span>
                    </td>
                    <td style={{ color: 'var(--brs-gray-400)', fontSize: '0.8rem' }}>{link.url}</td>
                    <td>
                      {link.is_external ? (
                        <span className="badge badge-info"><Globe size={12} /> Externo</span>
                      ) : (
                        <span className="badge badge-navy">Interno</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <a href={link.url} target="_blank" className="btn btn-ghost btn-sm btn-icon" title="Testar Link">
                          <ExternalLink size={16} />
                        </a>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => {
                          setEditingLink(link)
                          setIsModalOpen(true)
                        }}>
                          <Edit2 size={16} />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleDelete(link.id)} style={{ color: 'var(--brs-danger)' }}>
                          <Trash2 size={16} />
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

      {/* MODAL DE CADASTRO */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleSave}>
              <div className="modal-header">
                <h3 className="modal-title">{editingLink.id ? 'Editar Link' : 'Novo Link'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                {error && (
                  <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
                    {error}
                  </div>
                )}
                
                <div className="form-group">
                  <label className="form-label">Setor Responsável</label>
                  <select 
                    className="form-control" 
                    value={editingLink.sector_id} 
                    onChange={e => setEditingLink({...editingLink, sector_id: e.target.value})}
                    required
                  >
                    <option value="">Selecione um setor...</option>
                    {SECTORS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Título do Link</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="Ex: Painel de Controle, Relatórios..." 
                    value={editingLink.label}
                    onChange={e => setEditingLink({...editingLink, label: e.target.value})}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">URL (Link)</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="https://..." 
                    value={editingLink.url}
                    onChange={e => setEditingLink({...editingLink, url: e.target.value})}
                    required
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem' }}>
                  <input 
                    type="checkbox" 
                    id="is_external"
                    checked={editingLink.is_external}
                    onChange={e => setEditingLink({...editingLink, is_external: e.target.checked})}
                  />
                  <label htmlFor="is_external" style={{ fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
                    Link Externo (Abrir em nova aba)
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                  Salvar Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
