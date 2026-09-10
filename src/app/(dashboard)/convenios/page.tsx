'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle, Edit2, Landmark, Loader2, Plus, Power, PowerOff, Search } from 'lucide-react'
import { getConvenios, setConvenioStatus } from './actions'
import { getTiposAtivos, type TipoConvenio } from './cadastros-actions'

type ConvenioItem = {
  id: string
  nome: string
  nome_reduzido: string
  codigo: string | null
  codigo_sistema: string
  esfera: string
  tipo_convenio_id: string | null
  tipo_convenio_nome?: string
  abrangencia: string
  bc_score: number
  is_active: boolean
}

function capitalizar(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

const ABRANGENCIA_LABEL: Record<string, string> = { municipal: 'Municipal', estadual: 'Estadual', nacional: 'Nacional' }

function CompletudeBar({ score }: { score: number }) {
  const cor = score >= 75 ? '#059669' : score >= 25 ? '#D97706' : 'var(--brs-gray-300)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ width: 64, height: 6, borderRadius: 4, background: 'var(--brs-gray-100)', overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: cor, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', fontWeight: 600 }}>{score}%</span>
    </div>
  )
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function ConveniosPage() {
  const router = useRouter()
  const [items, setItems] = useState<ConvenioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [esferaFilter, setEsferaFilter] = useState('all')
  const [bcFilter, setBcFilter] = useState<'all' | 'com' | 'sem'>('all')
  const [tipos, setTipos] = useState<TipoConvenio[]>([])

  async function loadData() {
    setLoading(true)
    try {
      const res = await getConvenios()
      if (res.success) setItems((res.items || []) as ConvenioItem[])
      else setMessage({ type: 'error', text: res.error || 'Erro ao carregar os convênios.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar os convênios.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    getTiposAtivos().then(setTipos).catch(() => setTipos([]))
  }, [])

  const esferasDisponiveis = useMemo(() => {
    return [...new Set(tipos.map((t) => (t.esfera_nome || '').toLowerCase()).filter(Boolean))].sort()
  }, [tipos])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const matchesSearch =
        !query ||
        String(item.nome || '').toLowerCase().includes(query) ||
        String(item.codigo || '').toLowerCase().includes(query)
      const matchesEsfera = esferaFilter === 'all' || (item.esfera || '').toLowerCase() === esferaFilter
      const matchesBc = bcFilter === 'all' || (bcFilter === 'com' ? item.bc_score > 0 : item.bc_score === 0)
      return matchesSearch && matchesEsfera && matchesBc
    })
  }, [items, searchQuery, esferaFilter, bcFilter])

  async function handleToggle(item: ConvenioItem) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const nextActive = !item.is_active
      const res = await setConvenioStatus(item.id, nextActive)
      if (res.success) {
        setMessage({ type: 'success', text: nextActive ? 'Convênio reativado.' : 'Convênio inativado.' })
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
            <Landmark size={18} />
            Convênios
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Cadastro de convênios (órgãos/empregadores) — dados básicos + Base de Conhecimento para o agente de IA.
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={() => router.push('/convenios/novo')}>
          <Plus size={16} />
          Novo Convênio
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
            placeholder="Buscar por nome ou código..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control" style={{ width: '180px' }} value={esferaFilter} onChange={(e) => setEsferaFilter(e.target.value)}>
          <option value="all">Todas as esferas</option>
          {esferasDisponiveis.map((esf) => (
            <option key={esf} value={esf}>{capitalizar(esf)}</option>
          ))}
        </select>
        <select className="form-control" style={{ width: '220px' }} value={bcFilter} onChange={(e) => setBcFilter(e.target.value as 'all' | 'com' | 'sem')}>
          <option value="all">Todos (com/sem BC)</option>
          <option value="com">Com Base de Conhecimento</option>
          <option value="sem">Sem Base de Conhecimento</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Nome Reduzido</th>
                <th>Cód. Sistema</th>
                <th>Tipo</th>
                <th>Esfera</th>
                <th>Abrangência</th>
                <th>Completude BC</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}>
                    <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Landmark size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum convênio encontrado</h3>
                      <p>Cadastre o primeiro convênio para montar a base de coeficientes.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                    <td>{item.nome_reduzido || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.codigo_sistema}</td>
                    <td>{item.tipo_convenio_nome || '-'}</td>
                    <td>{capitalizar(item.esfera) || '-'}</td>
                    <td>{ABRANGENCIA_LABEL[item.abrangencia] || '-'}</td>
                    <td><CompletudeBar score={item.bc_score || 0} /></td>
                    <td>
                      <span className={`badge ${item.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {item.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-acao"
                          onClick={() => router.push(`/convenios/${item.id}`)}
                          title="Editar"
                          aria-label="Editar"
                        >
                          <Edit2 size={15} />
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
    </div>
  )
}
