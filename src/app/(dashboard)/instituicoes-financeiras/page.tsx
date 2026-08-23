'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Building2, CheckCircle, Edit2, Eye, Loader2, Plus, Power, PowerOff, Search } from 'lucide-react'
import { INSTITUICAO_TIPOS, type InstituicaoTipo } from '@/lib/financial-institutions'
import { getInstituicoesFinanceiras, setInstituicaoFinanceiraStatus } from './actions'

type InstituicaoListItem = {
  id: string
  name: string
  cnpj?: string | null
  razao_social?: string | null
  institution_type?: string | null
  logo_url?: string | null
  logo_wide_url?: string | null
  is_active: boolean
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function maskCnpjDisplay(value: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14)
  if (!digits) return '-'
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function tipoLabel(value: string | null | undefined) {
  return INSTITUICAO_TIPOS.find((item) => item.value === value)?.label || '-'
}

export default function InstituicoesFinanceirasPage() {
  const [items, setItems] = useState<InstituicaoListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [tipoFilter, setTipoFilter] = useState<'all' | InstituicaoTipo>('all')

  async function loadData() {
    setLoading(true)
    try {
      const res = await getInstituicoesFinanceiras()
      if (res.success) setItems((res.items || []) as InstituicaoListItem[])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as instituições financeiras.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar as instituições financeiras.' })
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
      const matchesSearch =
        !query ||
        String(item.name || '').toLowerCase().includes(query) ||
        String(item.razao_social || '').toLowerCase().includes(query) ||
        String(item.cnpj || '').includes(query.replace(/\D/g, '') || query)
      const matchesTipo = tipoFilter === 'all' || String(item.institution_type || '') === tipoFilter
      return matchesSearch && matchesTipo
    })
  }, [items, searchQuery, tipoFilter])

  async function handleToggle(item: InstituicaoListItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setInstituicaoFinanceiraStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Instituição financeira reativada.' : 'Instituição financeira inativada.' })
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
            Instituições Financeiras
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro completo das instituições financeiras parceiras — base para o site institucional e outros subsistemas.
          </div>
        </div>

        <Link href="/instituicoes-financeiras/novo" className="btn btn-primary">
          <Plus size={16} />
          Nova Instituição
        </Link>
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
            placeholder="Buscar por nome comercial, razão social ou CNPJ..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control" style={{ width: '180px' }} value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value as any)}>
          <option value="all">Todos os tipos</option>
          {INSTITUICAO_TIPOS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Logotipo</th>
                <th>Nome Comercial</th>
                <th>Razão Social</th>
                <th>CNPJ</th>
                <th>Tipo</th>
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
                      <h3>Nenhuma instituição financeira encontrada</h3>
                      <p>Crie a primeira instituição financeira parceira para montar a base.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--brs-gray-200)', background: '#fff', display: 'grid', placeItems: 'center' }}>
                        {item.logo_url || item.logo_wide_url ? (
                          <img src={item.logo_url || item.logo_wide_url || ''} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        ) : (
                          <Building2 size={18} color="var(--brs-gray-400)" />
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>{item.razao_social || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{maskCnpjDisplay(String(item.cnpj || ''))}</td>
                    <td>{tipoLabel(item.institution_type)}</td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {item.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Link href={`/instituicoes-financeiras/${item.id}?mode=view`} className="btn btn-ghost btn-sm btn-acao" title="Visualizar" aria-label="Visualizar">
                          <Eye size={15} />
                        </Link>
                        <Link href={`/instituicoes-financeiras/${item.id}`} className="btn btn-ghost btn-sm btn-acao" title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </Link>
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
    </div>
  )
}
