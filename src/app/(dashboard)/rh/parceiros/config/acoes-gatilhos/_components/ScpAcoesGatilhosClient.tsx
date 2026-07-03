'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { AlertCircle, CheckCircle, Clock3, Copy, Edit2, Loader2, Plus, RefreshCw, Save, Search, ToggleLeft, ToggleRight, Zap } from 'lucide-react'
import CopyableFieldShell from '@/components/forms/CopyableFieldShell'
import {
  formatScpAutomationConfig,
  getScpAutomationTypeLabel,
  getScpAutomationTypes,
  normalizeScpAutomationCode,
  normalizeScpAutomationConfig,
  normalizeScpAutomationText,
  type ScpAutomationKind,
  type ScpAutomationRow,
} from '@/lib/scp-automations'

type Message = { type: 'success' | 'error'; text: string } | null

type Props = {
  initialActions: ScpAutomationRow[]
  initialTriggers: ScpAutomationRow[]
  initialError?: string | null
}

type Draft = {
  id?: string
  name: string
  code: string
  type: string
  description: string
  configText: string
  is_active: boolean
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
] as const

function getDefaultType(kind: ScpAutomationKind) {
  return getScpAutomationTypes(kind)[0]?.value || ''
}

function createEmptyDraft(kind: ScpAutomationKind): Draft {
  return {
    name: '',
    code: '',
    type: getDefaultType(kind),
    description: '',
    configText: '{}',
    is_active: true,
  }
}

function rowToDraft(row: ScpAutomationRow | null | undefined, kind: ScpAutomationKind): Draft {
  if (!row) return createEmptyDraft(kind)
  return {
    id: row.id,
    name: normalizeScpAutomationText(row.name),
    code: normalizeScpAutomationText(row.code),
    type: normalizeScpAutomationText(row.type) || getDefaultType(kind),
    description: normalizeScpAutomationText(row.description),
    configText: formatScpAutomationConfig(row.config),
    is_active: row.is_active !== false,
  }
}

function filterRows(rows: ScpAutomationRow[], query: string, statusFilter: (typeof STATUS_OPTIONS)[number]['value']) {
  const search = normalizeScpAutomationText(query).toLowerCase()
  return rows.filter((row) => {
    const statusMatch =
      statusFilter === 'all' ? true : statusFilter === 'active' ? row.is_active : !row.is_active

    if (!statusMatch) return false

    if (!search) return true

    const searchText = [
      row.name,
      row.code,
      row.type,
      row.description || '',
      JSON.stringify(row.config || {}),
    ]
      .join(' ')
      .toLowerCase()

    return searchText.includes(search)
  })
}

function emptyErrorMessage(kind: ScpAutomationKind) {
  return `Nenhuma ${kind === 'actions' ? 'ação' : 'gatilho'} encontrada.`
}

function getSingularKindLabel(kind: ScpAutomationKind) {
  return kind === 'actions' ? 'Ação' : 'Gatilho'
}

function AutomationField({
  label,
  helperText,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  helperText?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={value} displayValue={value}>
      <input
        type={type}
        className="form-control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </CopyableFieldShell>
  )
}

function AutomationSelectField({
  label,
  helperText,
  value,
  options,
  onChange,
}: {
  label: string
  helperText?: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const labelValue = options.find((item) => item.value === value)?.label || value
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={labelValue} displayValue={labelValue}>
      <select className="form-control" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </CopyableFieldShell>
  )
}

function AutomationTextareaField({
  label,
  helperText,
  value,
  onChange,
  placeholder,
  rows = 5,
}: {
  label: string
  helperText?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <CopyableFieldShell label={label} helperText={helperText} copyValue={value} displayValue={value}>
      <textarea
        className="form-control"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ resize: 'vertical' }}
      />
    </CopyableFieldShell>
  )
}

function AutomationPanel({
  kind,
  title,
  description,
  icon: Icon,
  initialRows,
  initialError,
}: {
  kind: ScpAutomationKind
  title: string
  description: string
  icon: ComponentType<{ size?: number }>
  initialRows: ScpAutomationRow[]
  initialError?: string | null
}) {
  const [rows, setRows] = useState<ScpAutomationRow[]>(() => initialRows || [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => createEmptyDraft(kind))
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]['value']>('active')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [message, setMessage] = useState<Message>(initialError ? { type: 'error', text: initialError } : null)

  const filteredRows = useMemo(
    () => filterRows(rows, searchTerm, statusFilter),
    [rows, searchTerm, statusFilter],
  )

  const selectedRow = useMemo(
    () => rows.find((row: ScpAutomationRow) => row.id === selectedId) || null,
    [rows, selectedId],
  )

  useEffect(() => {
    setRows(initialRows || [])
  }, [initialRows])

  useEffect(() => {
    if (selectedRow) {
      setDraft(rowToDraft(selectedRow, kind))
      setIsCreatingNew(false)
      return
    }

    if (!selectedId && !isCreatingNew) {
      setDraft((current) => ({
        ...createEmptyDraft(kind),
        configText: current.configText || '{}',
      }))
    }
  }, [kind, selectedId, selectedRow, isCreatingNew])

  useEffect(() => {
    if (selectedId || isCreatingNew) return
    if (rows.length === 0) return
    setSelectedId(rows[0].id)
  }, [rows, selectedId, isCreatingNew])

  async function reload(nextSelectedId?: string | null) {
    setLoading(true)
    setMessage(null)
    try {
      const { getScpAutomationRows } = await import('../../../actions')
      const res = await getScpAutomationRows(kind)
      if (!res.success) {
        setMessage({ type: 'error', text: res.error || 'Falha ao recarregar os registros.' })
        return
      }

      const nextRows = res.rows || []
      setRows(nextRows)

      if (nextSelectedId) {
        setSelectedId(nextRows.some((row: ScpAutomationRow) => row.id === nextSelectedId) ? nextSelectedId : nextRows[0]?.id || null)
        return
      }

      if (!selectedId && nextRows[0]?.id) {
        setSelectedId(nextRows[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  function createNew() {
    setIsCreatingNew(true)
    setSelectedId(null)
    setDraft(createEmptyDraft(kind))
    setMessage(null)
  }

  async function handleSave() {
    const name = normalizeScpAutomationText(draft.name)
    const code = normalizeScpAutomationCode(draft.code)
    const type = normalizeScpAutomationText(draft.type)
    const description = normalizeScpAutomationText(draft.description)

    if (!name || !code || !type) {
      setMessage({ type: 'error', text: 'Preencha nome, código técnico e tipo antes de salvar.' })
      return
    }

    let parsedConfig: Record<string, any> = {}
    try {
      const raw = String(draft.configText || '').trim()
      parsedConfig = raw ? normalizeScpAutomationConfig(JSON.parse(raw)) : {}
    } catch {
      setMessage({ type: 'error', text: 'O campo Configuração precisa conter um JSON válido.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const { saveScpAutomationRow } = await import('../../../actions')
      const res = await saveScpAutomationRow(kind, {
        id: draft.id,
        name,
        code,
        type,
        description,
        config: parsedConfig,
        is_active: draft.is_active,
      })

      if (!res.success) {
        setMessage({ type: 'error', text: res.error || 'Falha ao salvar o registro.' })
        return
      }

      setMessage({ type: 'success', text: draft.id ? 'Registro atualizado com sucesso.' : 'Registro criado com sucesso.' })
      await reload(res.id || null)
      if (res.id) setSelectedId(res.id)
      setIsCreatingNew(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDuplicate() {
    if (!selectedRow) return
    setBusyId(selectedRow.id)
    setMessage(null)
    try {
      const { duplicateScpAutomationRow } = await import('../../../actions')
      const res = await duplicateScpAutomationRow(kind, selectedRow.id)
      if (!res.success) {
        setMessage({ type: 'error', text: res.error || 'Falha ao duplicar o registro.' })
        return
      }

      setMessage({ type: 'success', text: 'Registro duplicado com sucesso.' })
      await reload(res.id || null)
      if (res.id) setSelectedId(res.id)
      setIsCreatingNew(false)
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleStatus(targetRow?: ScpAutomationRow | null) {
    const row = targetRow || selectedRow
    if (!row) return
    setBusyId(row.id)
    setMessage(null)
    try {
      const { setScpAutomationRowStatus } = await import('../../../actions')
      const nextActive = !row.is_active
      const res = await setScpAutomationRowStatus(kind, row.id, nextActive)
      if (!res.success) {
        setMessage({ type: 'error', text: res.error || 'Falha ao alterar status.' })
        return
      }

      setMessage({ type: 'success', text: nextActive ? 'Registro ativado.' : 'Registro inativado.' })
      await reload(row.id)
      setIsCreatingNew(false)
    } finally {
      setBusyId(null)
    }
  }

  async function handleReload() {
    await reload(selectedId)
  }

  const typeOptions = getScpAutomationTypes(kind)

  return (
    <div className="card" style={{ padding: '1rem', overflow: 'hidden', minHeight: 'calc(100dvh - 220px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '1.1rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
            <Icon size={18} />
            {title}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>{description}</div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={handleReload} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinner' : undefined} />
            Recarregar
          </button>
          <button type="button" className="btn btn-outline" onClick={createNew}>
            <Plus size={16} />
            Novo
          </button>
          <button type="button" className="btn btn-outline" onClick={handleDuplicate} disabled={!selectedRow || busyId === selectedRow?.id}>
            {busyId === selectedRow?.id ? <Loader2 size={16} className="spinner" /> : <Copy size={16} />}
            Duplicar
          </button>
          <button type="button" className={`btn ${selectedRow?.is_active ? 'btn-outline' : 'btn-primary'}`} onClick={() => void handleToggleStatus()} disabled={!selectedRow || busyId === selectedRow?.id}>
            {busyId === selectedRow?.id ? <Loader2 size={16} className="spinner" /> : selectedRow?.is_active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
            {selectedRow?.is_active ? 'Inativar' : 'Ativar'}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
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
          <span>{message.text}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 0.36fr) minmax(0, 0.64fr)', gap: '1rem', minHeight: 0, height: 'calc(100dvh - 320px)' }}>
        <div className="card" style={{ padding: '1rem', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ fontWeight: 800, marginBottom: '0.75rem', color: 'var(--brs-gray-800)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Search size={16} />
            Lista
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label className="form-label">Buscar</label>
            <input
              className="form-control"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Nome, código, tipo, descrição..."
            />
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label className="form-label">Status</label>
            <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ overflowY: 'auto', paddingRight: '0.25rem', minHeight: 0, display: 'grid', gap: '0.5rem' }}>
            {filteredRows.length === 0 ? (
              <div style={{ padding: '1rem', border: '1px dashed var(--brs-gray-200)', borderRadius: 8, color: 'var(--brs-gray-600)' }}>
                {emptyErrorMessage(kind)}
              </div>
            ) : (
              filteredRows.map((row: ScpAutomationRow) => {
                const active = selectedRow?.id === row.id
                return (
                  <div
                    key={row.id}
                    style={{
                      border: `1px solid ${active ? 'var(--brs-navy)' : 'var(--brs-gray-100)'}`,
                      borderRadius: 12,
                      background: active ? 'var(--brs-primary-50)' : '#fff',
                      padding: '0.85rem',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{row.name || 'Sem nome'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginTop: '0.2rem' }}>
                          <span style={{ fontFamily: 'monospace' }}>{row.code || 'sem_codigo'}</span>
                          {' · '}
                          {getScpAutomationTypeLabel(kind, row.type)}
                        </div>
                      </div>

                      <span className={`badge ${row.is_active ? 'badge-success' : 'badge-gray'}`}>{row.is_active ? 'Ativo' : 'Inativo'}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setIsCreatingNew(false); setSelectedId(row.id) }}>
                        <Edit2 size={14} />
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === row.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedId(row.id)
                          void handleToggleStatus(row)
                        }}
                      >
                        {busyId === row.id ? <Loader2 size={14} className="spinner" /> : row.is_active ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                        {row.is_active ? 'Inativar' : 'Ativar'}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>
                {selectedRow ? selectedRow.name : `Novo ${getSingularKindLabel(kind)}`}
              </div>
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
                {selectedRow ? `ID ${selectedRow.id}` : 'Cadastro novo e independente do fluxo.'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className={`badge ${draft.is_active ? 'badge-success' : 'badge-gray'}`}>{draft.is_active ? 'Ativo' : 'Inativo'}</span>
              <span className="badge badge-navy">{selectedRow ? 'Registro existente' : 'Novo registro'}</span>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleSave()
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0, flex: 1 }}
          >
            <div className="form-grid form-grid-3">
              <AutomationField
                label="Nome"
                value={draft.name}
                onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                placeholder="Nome da ação ou gatilho"
              />

              <AutomationField
                label="Código técnico"
                helperText="Use snake_case. O código precisa ser único."
                value={draft.code}
                onChange={(value) => setDraft((current) => ({ ...current, code: value }))}
                placeholder="codigo_tecnico"
              />

              <AutomationSelectField
                label="Tipo"
                value={draft.type}
                options={typeOptions}
                onChange={(value) => setDraft((current) => ({ ...current, type: value }))}
              />
            </div>

            <div className="form-grid form-grid-2">
              <AutomationSelectField
                label="Status"
                value={draft.is_active ? 'active' : 'inactive'}
                options={[
                  { value: 'active', label: 'Ativo' },
                  { value: 'inactive', label: 'Inativo' },
                ]}
                onChange={(value) => setDraft((current) => ({ ...current, is_active: value === 'active' }))}
              />

              <AutomationField
                label="Descrição"
                value={draft.description}
                onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
                placeholder="Descreva o objetivo da automação"
              />
            </div>

            <AutomationTextareaField
              label="Config específica"
              helperText={`Armazene parâmetros em JSON. Exemplo: {"template_id":"...","timeout_minutes":30}`}
              value={draft.configText}
              onChange={(value) => setDraft((current) => ({ ...current, configText: value }))}
              placeholder='{"chave":"valor"}'
              rows={10}
            />

            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                Biblioteca global e reutilizável do SCP. O Construtor de Processos apenas referenciará estes registros.
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline" onClick={createNew}>
                  <Plus size={16} />
                  Novo
                </button>
                <button type="button" className="btn btn-outline" onClick={handleDuplicate} disabled={!selectedRow || busyId === selectedRow?.id}>
                  {busyId === selectedRow?.id ? <Loader2 size={16} className="spinner" /> : <Copy size={16} />}
                  Duplicar
                </button>
                <button type="button" className={`btn ${draft.is_active ? 'btn-outline' : 'btn-primary'}`} onClick={() => void handleToggleStatus()} disabled={!selectedRow || busyId === selectedRow?.id}>
                  {busyId === selectedRow?.id ? <Loader2 size={16} className="spinner" /> : draft.is_active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                  {draft.is_active ? 'Inativar' : 'Ativar'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                  Salvar alterações
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function ScpAcoesGatilhosClient(props: Props) {
  const [activeTab, setActiveTab] = useState<ScpAutomationKind>('actions')

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
            Ações e Gatilhos (SCP)
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>
            Biblioteca global de automações reutilizáveis. O Construtor de Processo consumirá estas peças por referência.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--brs-gray-500)' }}>
          <Clock3 size={16} />
          Menu independente de processo
        </div>
      </div>

      <div className="tabs-list" style={{ marginBottom: '1rem' }}>
        <button type="button" className={`tab-btn ${activeTab === 'actions' ? 'active' : ''}`} onClick={() => setActiveTab('actions')}>
          <Zap size={16} />
          Ações
        </button>
        <button type="button" className={`tab-btn ${activeTab === 'triggers' ? 'active' : ''}`} onClick={() => setActiveTab('triggers')}>
          <Clock3 size={16} />
          Gatilhos
        </button>
      </div>

      <div style={{ display: activeTab === 'actions' ? 'block' : 'none' }}>
        <AutomationPanel
          kind="actions"
          title="Ações"
          description="Cadastre ações globais reutilizáveis para criação, atualização, envio, validação e status."
          icon={Zap}
          initialRows={props.initialActions}
          initialError={props.initialError}
        />
      </div>

      <div style={{ display: activeTab === 'triggers' ? 'block' : 'none' }}>
        <AutomationPanel
          kind="triggers"
          title="Gatilhos"
          description="Cadastre gatilhos globais reutilizáveis para entrada, saída, webhook, timeout e retornos externos."
          icon={Clock3}
          initialRows={props.initialTriggers}
          initialError={props.initialError}
        />
      </div>
    </div>
  )
}
