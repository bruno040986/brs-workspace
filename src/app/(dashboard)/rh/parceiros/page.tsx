'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getProcessCRMData,
  getProcessInstanceDetail,
  triggerStageActions,
  updateProcessInstance,
} from './actions'
import {
  AlertCircle,
  Archive,
  CheckCircle,
  Clock3,
  ClipboardList,
  FileText,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  X,
} from 'lucide-react'

type ProcessRow = {
  id: string
  name: string
  type: string
  is_active: boolean
}

type StageRow = {
  id: string
  name: string
  position: number
  color?: string | null
}

type PartnerRow = {
  name?: string | null
  cpf_cnpj?: string | null
  email_comissao?: string | null
  phone_whatsapp?: string | null
  arw_code?: string | null
  superintendente_id?: string | null
  supervisor_id?: string | null
  gerente_id?: string | null
}

type InstanceRow = {
  id: string
  identifier_value: string
  status: 'active' | 'archived' | 'completed' | 'canceled'
  current_stage_id?: string | null
  created_at?: string
  partner?: PartnerRow | null
}

type CommercialEntity = {
  id: string
  name: string
  role: 'superintendente' | 'supervisor' | 'gerente'
  parent_id?: string | null
}

type DetailTab = 'resumo' | 'respostas' | 'campos' | 'documentos' | 'comunicacoes' | 'timeline' | 'config'

function safeLower(value: any) {
  return String(value ?? '').toLowerCase()
}

function safeJson(value: any) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('pt-BR')
}

export default function ParceirosCRMPage() {
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [selectedProcessId, setSelectedProcessId] = useState<string>('')
  const [stages, setStages] = useState<StageRow[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [entities, setEntities] = useState<CommercialEntity[]>([])

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'completed' | 'canceled' | 'all'>('active')
  const [filterSuperintendente, setFilterSuperintendente] = useState('')
  const [filterSupervisor, setFilterSupervisor] = useState('')
  const [filterGerente, setFilterGerente] = useState('')

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('resumo')

  async function loadData(processId?: string) {
    setLoading(true)
    setMessage(null)
    const res = await getProcessCRMData(processId)
    if (res.success) {
      setProcesses((res.processes || []) as any)
      setSelectedProcessId(String(res.selectedProcessId || ''))
      setStages((res.stages || []) as any)
      setInstances((res.instances || []) as any)
      setEntities((res.commercialEntities || []) as any)
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao carregar o CRM.' })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredSuperintendentes = useMemo(
    () => entities.filter((e) => e.role === 'superintendente'),
    [entities]
  )
  const filteredSupervisores = useMemo(
    () => entities.filter((e) => e.role === 'supervisor' && (!filterSuperintendente || e.parent_id === filterSuperintendente)),
    [entities, filterSuperintendente]
  )
  const filteredGerentes = useMemo(
    () => entities.filter((e) => e.role === 'gerente' && (!filterSupervisor || e.parent_id === filterSupervisor)),
    [entities, filterSupervisor]
  )

  const filteredInstances = useMemo(() => {
    const term = safeLower(searchTerm).trim()
    return instances.filter((inst) => {
      if (statusFilter !== 'all' && inst.status !== statusFilter) return false

      const partner = inst.partner
      const matchesSearch =
        !term ||
        safeLower(partner?.name).includes(term) ||
        safeLower(partner?.cpf_cnpj).includes(term) ||
        safeLower(partner?.arw_code).includes(term) ||
        safeLower(inst.identifier_value).includes(term)

      const matchesSuper = !filterSuperintendente || String(partner?.superintendente_id || '') === filterSuperintendente
      const matchesSuperv = !filterSupervisor || String(partner?.supervisor_id || '') === filterSupervisor
      const matchesGerente = !filterGerente || String(partner?.gerente_id || '') === filterGerente

      return matchesSearch && matchesSuper && matchesSuperv && matchesGerente
    })
  }, [instances, searchTerm, statusFilter, filterSuperintendente, filterSupervisor, filterGerente])

  const stagesWithFallback = useMemo<StageRow[]>(() => {
    if (stages.length) return stages
    return [{ id: '__no_stage__', name: 'Sem etapas', position: 0, color: '#64748B' }]
  }, [stages])

  const instancesByStage = useMemo(() => {
    const map = new Map<string, InstanceRow[]>()
    for (const st of stagesWithFallback) map.set(st.id, [])
    for (const inst of filteredInstances) {
      const stageId = inst.current_stage_id || '__no_stage__'
      if (!map.has(stageId)) map.set(stageId, [])
      map.get(stageId)!.push(inst)
    }
    for (const [, list] of map) {
      list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    }
    return map
  }, [filteredInstances, stagesWithFallback])

  async function handleMoveStage(instanceId: string, newStageId: string) {
    setMessage(null)
    const res = await updateProcessInstance({ id: instanceId, current_stage_id: newStageId })
    if (res.success) {
      setInstances((prev) => prev.map((i) => (i.id === instanceId ? { ...i, current_stage_id: newStageId } : i)))
      setMessage({ type: 'success', text: 'Etapa atualizada.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao mover etapa.' })
    }
  }

  async function handleArchive(instanceId: string) {
    if (!confirm('Arquivar este card?')) return
    const res = await updateProcessInstance({ id: instanceId, status: 'archived' })
    if (res.success) {
      setInstances((prev) => prev.map((i) => (i.id === instanceId ? { ...i, status: 'archived' } : i)))
      setMessage({ type: 'success', text: 'Card arquivado.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao arquivar card.' })
    }
  }

  async function handleRunStage(instanceId: string) {
    if (!confirm('Executar as ações da etapa atual (gerar contrato / disparos)? Esta ação é intencional e pode enviar documentos para assinatura.')) return
    setMessage(null)
    const res = await triggerStageActions(instanceId)
    if (res.success) {
      setMessage({ type: 'success', text: 'Ações da etapa enfileiradas. O motor vai processá-las.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao executar ações da etapa.' })
    }
  }

  async function openDetail(instanceId: string) {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    setDetailTab('resumo')
    const res = await getProcessInstanceDetail(instanceId)
    if (res.success) setDetail(res)
    else setDetail({ error: res.error || 'Erro ao carregar detalhe.' })
    setDetailLoading(false)
  }

  const detailEvents = useMemo<any[]>(() => (Array.isArray(detail?.events) ? detail.events : []), [detail?.events])
  const detailDocsEvents = useMemo<any[]>(
    () => detailEvents.filter((e) => /assin|doc|contract|envelope/i.test(String(e?.event_type || ''))),
    [detailEvents]
  )
  const detailCommsEvents = useMemo<any[]>(
    () => detailEvents.filter((e) => /email|whats|mensagem|comunic/i.test(String(e?.event_type || ''))),
    [detailEvents]
  )

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>CRM Parceiros</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>Filtre por tipo de processo para ver o Kanban e cards daquele fluxo.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--brs-gray-100)', padding: '2px', borderRadius: '6px' }}>
          <button type="button" className="btn btn-ghost btn-xs btn-icon" onClick={() => setViewMode('kanban')} style={{ background: viewMode === 'kanban' ? '#fff' : 'transparent', borderRadius: '4px', border: 'none' }} title="Kanban">
            <LayoutGrid size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-xs btn-icon" onClick={() => setViewMode('table')} style={{ background: viewMode === 'table' ? '#fff' : 'transparent', borderRadius: '4px', border: 'none' }} title="Tabela">
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 0.8fr', gap: '0.75rem', alignItems: 'end' }}>
          <div className="form-group">
            <label className="form-label">Tipo de Processo</label>
            <select className="form-control" value={selectedProcessId} onChange={async (e) => loadData(e.target.value)} disabled={loading || !processes.length}>
              {processes.length === 0 ? <option value="">Nenhum processo cadastrado</option> : processes.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (inativo)'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Busca</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
              <input className="form-control" style={{ paddingLeft: '34px' }} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Nome, CNPJ/CPF, identificador..." />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Superintendente</label>
            <select className="form-control" value={filterSuperintendente} onChange={(e) => { setFilterSuperintendente(e.target.value); setFilterSupervisor(''); setFilterGerente('') }}>
              <option value="">Todos</option>
              {filteredSuperintendentes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Supervisor</label>
            <select className="form-control" value={filterSupervisor} onChange={(e) => { setFilterSupervisor(e.target.value); setFilterGerente('') }} disabled={!filteredSupervisores.length}>
              <option value="">Todos</option>
              {filteredSupervisores.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Gerente</label>
            <select className="form-control" value={filterGerente} onChange={(e) => setFilterGerente(e.target.value)} disabled={!filteredGerentes.length}>
              <option value="">Todos</option>
              {filteredGerentes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="active">Ativos</option>
              <option value="archived">Arquivados</option>
              <option value="completed">Concluídos</option>
              <option value="canceled">Cancelados</option>
              <option value="all">Todos</option>
            </select>
          </div>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Loader2 className="spinner" size={18} />
            Carregando...
          </div>
        </div>
      ) : viewMode === 'kanban' ? (
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {stagesWithFallback.map((st) => {
            const list = instancesByStage.get(st.id) || []
            return (
              <div key={st.id} style={{ minWidth: 320, maxWidth: 360, flex: '0 0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--brs-gray-800)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: st.color || '#64748B' }} />
                    {st.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{list.length}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {list.map((inst) => {
                    const title = String(inst.partner?.name || '').trim() || `#${inst.identifier_value}`
                    const subtitle = inst.partner?.cpf_cnpj ? String(inst.partner.cpf_cnpj) : inst.identifier_value
                    return (
                      <div key={inst.id} className="card" style={{ padding: '0.9rem', borderLeft: `4px solid ${st.color || '#64748B'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                            <button type="button" className="btn btn-ghost btn-xs" title="Executar ações desta etapa" onClick={() => handleRunStage(inst.id)}>Executar etapa</button>
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => openDetail(inst.id)}>Detalhes</button>
                            <button type="button" className="btn btn-ghost btn-xs btn-icon" title="Arquivar" onClick={() => handleArchive(inst.id)}>
                              <Archive size={16} />
                            </button>
                          </div>
                        </div>
                        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select className="form-control" value={inst.current_stage_id || '__no_stage__'} onChange={(e) => handleMoveStage(inst.id, e.target.value)} style={{ height: 34, padding: '2px 8px', fontSize: '0.85rem' }}>
                            {stagesWithFallback.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                  {list.length === 0 && <div style={{ padding: '0.75rem', color: 'var(--brs-gray-400)', border: '1px dashed var(--brs-gray-200)', borderRadius: 10 }}>Nenhum card aqui.</div>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: '1rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                <th style={{ padding: '0.75rem 0.5rem' }}>Parceiro</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Identificador</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Etapa</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredInstances.map((inst) => {
                const stage = stages.find((s) => s.id === inst.current_stage_id) || null
                return (
                  <tr key={inst.id} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>{inst.partner?.name || '—'}</td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--brs-gray-600)' }}>{inst.identifier_value}</td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--brs-gray-600)' }}>{stage?.name || '—'}</td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--brs-gray-600)' }}>{inst.status}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-outline" onClick={() => handleRunStage(inst.id)}>Executar etapa</button>
                        <button type="button" className="btn btn-outline" onClick={() => openDetail(inst.id)}>Detalhes</button>
                        <button type="button" className="btn btn-outline" onClick={() => handleArchive(inst.id)}>Arquivar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredInstances.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '1rem', color: 'var(--brs-gray-500)' }}>Nenhum resultado para os filtros atuais.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem' }} onClick={() => setDetailOpen(false)}>
          <div className="card" style={{ width: 'min(1100px, 100%)', maxHeight: 'min(84dvh, 860px)', overflow: 'hidden', padding: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--brs-gray-100)' }}>
              <div style={{ fontWeight: 900, color: 'var(--brs-gray-900)' }}>Detalhe da Instância</div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDetailOpen(false)} title="Fechar">
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', maxHeight: 'calc(min(84dvh, 860px) - 60px)' }}>
              {detailLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Loader2 className="spinner" size={18} />
                  Carregando detalhe...
                </div>
              ) : detail?.error ? (
                <div style={{ color: 'var(--brs-danger)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <AlertCircle size={18} />
                  {detail.error}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                    {[
                      { id: 'resumo', label: 'Resumo', icon: ClipboardList },
                      { id: 'respostas', label: 'Respostas', icon: FileText },
                      { id: 'campos', label: 'Campos + Validações', icon: CheckCircle },
                      { id: 'documentos', label: 'Documentos', icon: FileText },
                      { id: 'comunicacoes', label: 'Comunicações', icon: Mail },
                      { id: 'timeline', label: 'Timeline', icon: Clock3 },
                      { id: 'config', label: 'Config', icon: MessageSquare },
                    ].map((tab) => {
                      const Icon = tab.icon
                      return (
                        <button key={tab.id} type="button" className="btn btn-ghost" onClick={() => setDetailTab(tab.id as DetailTab)} style={{ border: `1px solid ${detailTab === tab.id ? 'var(--brs-primary-300)' : 'var(--brs-gray-200)'}`, background: detailTab === tab.id ? 'var(--brs-primary-50)' : '#fff', color: detailTab === tab.id ? 'var(--brs-primary-700)' : 'var(--brs-gray-700)', fontWeight: detailTab === tab.id ? 700 : 600 }}>
                          <Icon size={14} />
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>

                  {detailTab === 'resumo' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Parceiro</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--brs-gray-700)' }}>
                          <div><strong>Nome:</strong> {detail.instance?.partner?.name || '—'}</div>
                          <div><strong>CNPJ/CPF:</strong> {detail.instance?.partner?.cpf_cnpj || '—'}</div>
                          <div><strong>E-mail:</strong> {detail.instance?.partner?.email_comissao || '—'}</div>
                          <div><strong>WhatsApp:</strong> {detail.instance?.partner?.phone_whatsapp || '—'}</div>
                        </div>
                      </div>
                      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Processo</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--brs-gray-700)' }}>
                          <div><strong>Nome:</strong> {detail.instance?.process?.name || '—'}</div>
                          <div><strong>Identificador:</strong> {detail.instance?.identifier_value || '—'}</div>
                          <div><strong>Status:</strong> {detail.instance?.status || '—'}</div>
                          <div><strong>Criado em:</strong> {formatDate(detail.instance?.created_at)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {detailTab === 'respostas' && (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Snapshot do formulário (último envio)</div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem', background: 'var(--brs-gray-50)', border: '1px solid var(--brs-gray-100)', padding: '0.75rem', borderRadius: 10 }}>
                        {safeJson((detail.snapshots?.[0]?.payload) || {})}
                      </pre>
                    </div>
                  )}

                  {detailTab === 'campos' && (
                    <div style={{ display: 'grid', gap: '0.85rem' }}>
                      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Campos de backoffice</div>
                        {(detail.fields || []).length === 0 ? (
                          <div style={{ color: 'var(--brs-gray-500)' }}>Nenhum campo interno preenchido.</div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ textAlign: 'left' }}>
                                  <th style={{ padding: '0.45rem', borderBottom: '1px solid var(--brs-gray-100)' }}>Campo</th>
                                  <th style={{ padding: '0.45rem', borderBottom: '1px solid var(--brs-gray-100)' }}>Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(detail.fields || []).map((field: any) => (
                                  <tr key={field.id}>
                                    <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--brs-gray-50)', fontFamily: 'monospace' }}>{field.key}</td>
                                    <td style={{ padding: '0.45rem', borderBottom: '1px solid var(--brs-gray-50)' }}>{safeJson(field.value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                      <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Validações (auditoria)</div>
                        {(detail.validations || []).length === 0 ? (
                          <div style={{ color: 'var(--brs-gray-500)' }}>Nenhuma validação registrada.</div>
                        ) : (
                          <div style={{ display: 'grid', gap: '0.5rem' }}>
                            {(detail.validations || []).map((v: any) => (
                              <div key={v.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.6rem' }}>
                                <div style={{ fontWeight: 700 }}>{v.key}</div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                                  Validado por: {v.validator?.name || 'Usuário não identificado'} em {formatDate(v.validated_at)}
                                </div>
                                {v.note ? <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>Obs: {v.note}</div> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === 'documentos' && (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Eventos de documentos/assinatura</div>
                      {detailDocsEvents.length === 0 ? (
                        <div style={{ color: 'var(--brs-gray-500)' }}>Sem eventos de documento registrados.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.45rem' }}>
                          {detailDocsEvents.map((evt: any) => (
                            <div key={evt.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.6rem' }}>
                              <div style={{ fontWeight: 700 }}>{evt.event_type}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{formatDate(evt.created_at)}</div>
                              <pre style={{ margin: '0.45rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.78rem' }}>{safeJson(evt.payload)}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detailTab === 'comunicacoes' && (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Comunicações (e-mail / WhatsApp)</div>
                      {detailCommsEvents.length === 0 ? (
                        <div style={{ color: 'var(--brs-gray-500)' }}>Sem envios registrados.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.45rem' }}>
                          {detailCommsEvents.map((evt: any) => (
                            <div key={evt.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.6rem' }}>
                              <div style={{ fontWeight: 700 }}>{evt.event_type}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{formatDate(evt.created_at)}</div>
                              <pre style={{ margin: '0.45rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.78rem' }}>{safeJson(evt.payload)}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detailTab === 'timeline' && (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Linha do tempo</div>
                      {detailEvents.length === 0 ? (
                        <div style={{ color: 'var(--brs-gray-500)' }}>Sem eventos registrados.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '0.45rem' }}>
                          {detailEvents.map((evt: any) => (
                            <div key={evt.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.6rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700 }}>{evt.event_type}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{formatDate(evt.created_at)}</div>
                              </div>
                              <pre style={{ margin: '0.45rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.78rem' }}>{safeJson(evt.payload)}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detailTab === 'config' && (
                    <div className="card" style={{ padding: '1rem', border: '1px solid var(--brs-gray-100)' }}>
                      <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Configuração da instância (somente leitura)</div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--brs-gray-700)', marginBottom: '0.6rem' }}>
                        <div><strong>Processo:</strong> {detail.instance?.process?.name || '—'}</div>
                        <div><strong>Tipo:</strong> {detail.instance?.process?.type || '—'}</div>
                        <div><strong>Versão:</strong> {detail.instance?.process?.config?.publication?.version || 1}</div>
                        <div><strong>Status publicação:</strong> {detail.instance?.process?.config?.publication?.status || 'draft'}</div>
                      </div>
                      <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Etapas do processo</div>
                      {(detail.stageModels || []).length === 0 ? (
                        <div style={{ color: 'var(--brs-gray-500)' }}>Nenhuma etapa disponível.</div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {(detail.stageModels || []).map((st: any) => (
                            <span key={st.id} style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 999, padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>
                              {Number(st.position || 0) + 1}. {st.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
