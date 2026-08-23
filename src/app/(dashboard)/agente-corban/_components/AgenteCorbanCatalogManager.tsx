'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Edit2, Loader2, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import CopyableFieldShell from '@/components/forms/CopyableFieldShell'
import { type AgenteCorbanCatalogResource } from '@/lib/agente-corban'

type CatalogRow = {
  id: string
  name: string
  is_active: boolean
  deleted_at: string | null
  created_at: string | null
  updated_at: string | null
  /** Só no catálogo Tipo de Agente (comissionamento). */
  percentual_repasse?: number | null
  codigo_arw?: number | null
}

type Props = {
  resource: AgenteCorbanCatalogResource
  title: string
  description: string
  initialRows: CatalogRow[]
}

type Message = { type: 'success' | 'error'; text: string } | null

function formatDate(value: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('pt-BR')
}

export default function AgenteCorbanCatalogManager({ resource, title, description, initialRows }: Props) {
  const [rows, setRows] = useState<CatalogRow[]>(() => initialRows || [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const ehTipoAgente = resource === 'agente-corban-tipos-agente'
  const [percentualRepasse, setPercentualRepasse] = useState('')
  const [codigoArw, setCodigoArw] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)

  const sortedRows = useMemo(() => rows.slice().sort((a, b) => a.name.localeCompare(b.name)), [rows])

  function resetForm() {
    setEditingId(null)
    setName('')
    setIsActive(true)
    setPercentualRepasse('')
    setCodigoArw('')
  }

  function startEdit(row: CatalogRow) {
    setEditingId(row.id)
    setName(row.name || '')
    setIsActive(row.is_active !== false)
    setPercentualRepasse(row.percentual_repasse === null || row.percentual_repasse === undefined ? '' : String(row.percentual_repasse).replace('.', ','))
    setCodigoArw(row.codigo_arw === null || row.codigo_arw === undefined ? '' : String(row.codigo_arw))
  }

  async function reload() {
    setSaving(true)
    try {
      const { getAgenteCorbanCatalogRows } = await import('../actions')
      const result = await getAgenteCorbanCatalogRows(resource)
      if (result.success) {
        setRows(result.rows || [])
      } else {
        setMessage({ type: 'error', text: result.error || 'Falha ao recarregar registros.' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const { saveAgenteCorbanCatalogRow } = await import('../actions')
      const pctParsed = Number.parseFloat(percentualRepasse.replace(',', '.'))
      const codParsed = Number.parseInt(codigoArw, 10)
      const result = await saveAgenteCorbanCatalogRow(resource, {
        id: editingId || undefined,
        name,
        is_active: isActive,
        ...(ehTipoAgente
          ? {
              percentual_repasse: Number.isFinite(pctParsed) ? pctParsed : null,
              codigo_arw: Number.isFinite(codParsed) ? codParsed : null,
            }
          : {}),
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Falha ao salvar registro.' })
        return
      }

      setMessage({ type: 'success', text: editingId ? 'Registro atualizado.' : 'Registro criado.' })
      await reload()
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(row: CatalogRow) {
    setBusyId(row.id)
    setMessage(null)
    try {
      const { setAgenteCorbanCatalogStatus } = await import('../actions')
      const nextActive = !row.is_active
      const result = await setAgenteCorbanCatalogStatus(resource, row.id, nextActive)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Falha ao alterar status.' })
        return
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                is_active: nextActive,
                deleted_at: nextActive ? null : new Date().toISOString(),
              }
            : item,
        ),
      )
      setMessage({ type: 'success', text: nextActive ? 'Registro ativado.' : 'Registro inativado.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{title}</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>{description}</div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={reload} disabled={saving}>
            <RefreshCw size={16} className={saving ? 'spinner' : undefined} />
            Recarregar
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {editingId ? <CheckCircle2 size={16} /> : <Plus size={16} />}
            {editingId ? 'Salvar' : 'Novo'}
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
          }}
        >
          {message.text}
        </div>
      )}

      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div className="form-grid form-grid-3">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <CopyableFieldShell label="Nome" copyValue={name} displayValue={name}>
              <input
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Nome do ${title.toLowerCase()}`}
              />
            </CopyableFieldShell>
          </div>

          <CopyableFieldShell
            label="Status"
            copyValue={isActive ? 'Ativo' : 'Inativo'}
            displayValue={isActive ? 'Ativo' : 'Inativo'}
          >
            <select className="form-control" value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </CopyableFieldShell>

          {ehTipoAgente && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <CopyableFieldShell label="% Repasse (comissionamento)" copyValue={percentualRepasse} displayValue={percentualRepasse}>
                  <input
                    className="form-control"
                    inputMode="decimal"
                    placeholder="Ex.: 94 ou 97,5"
                    value={percentualRepasse}
                    onChange={(e) => setPercentualRepasse(e.target.value)}
                  />
                </CopyableFieldShell>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <CopyableFieldShell label="Código ARW" copyValue={codigoArw} displayValue={codigoArw}>
                  <input
                    className="form-control"
                    inputMode="numeric"
                    placeholder="Ex.: 24"
                    value={codigoArw}
                    onChange={(e) => setCodigoArw(e.target.value)}
                  />
                </CopyableFieldShell>
              </div>
            </>
          )}

          <div className="form-group" style={{ marginBottom: 0, display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />}
              {editingId ? 'Atualizar' : 'Criar'}
            </button>
          </div>
        </div>

        {editingId && (
          <div style={{ marginTop: '0.85rem', color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
            Você está editando um registro existente. As alterações serão salvas no mesmo item.
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                {ehTipoAgente && <th>% Repasse</th>}
                {ehTipoAgente && <th>Cód. ARW</th>}
                <th>Status</th>
                <th>Atualizado</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={ehTipoAgente ? 6 : 4} style={{ textAlign: 'center', padding: '3rem', color: 'var(--brs-gray-500)' }}>
                    Nenhum registro cadastrado.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <CopyableFieldShell copyValue={row.name} displayValue={row.name}>
                        <div className="form-control" style={{ display: 'flex', alignItems: 'center', minHeight: 42, background: '#fff' }}>
                          <span style={{ fontWeight: 700, color: 'var(--brs-gray-900)' }}>{row.name}</span>
                        </div>
                      </CopyableFieldShell>
                    </td>
                    {ehTipoAgente && (
                      <td>{row.percentual_repasse === null || row.percentual_repasse === undefined ? '-' : `${String(row.percentual_repasse).replace('.', ',')}%`}</td>
                    )}
                    {ehTipoAgente && <td>{row.codigo_arw ?? '-'}</td>}
                    <td>
                      <span className={`badge ${row.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {row.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>{formatDate(row.updated_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(row)}>
                          <Edit2 size={16} />
                          Editar
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${row.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => toggleStatus(row)}
                          disabled={busyId === row.id}
                        >
                          {busyId === row.id ? <Loader2 size={16} className="spinner" /> : row.is_active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                          {row.is_active ? 'Inativar' : 'Ativar'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                          <Trash2 size={16} />
                          Limpar
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
