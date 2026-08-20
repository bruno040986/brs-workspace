'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, KanbanSquare, Link2, Lock, Plus, Repeat, Rows3, Video } from 'lucide-react'
import {
  AGENDA_PRIORITIES,
  AGENDA_TASK_STATUSES,
  itemTypeMeta,
  priorityOrder,
  type AgendaItem,
  type AgendaTaskStatus,
} from '@/lib/agenda/types'
import { getAgendaItemById, listAgendaItems, updateTaskStatus, type AgendaBootstrap } from '../actions'
import ItemEditorModal from './ItemEditorModal'
import CalendarView from './CalendarView'
import ReportView from './ReportView'

type AgendaClientProps = {
  bootstrap: AgendaBootstrap
}

function priorityMeta(priority: string) {
  return AGENDA_PRIORITIES.find((p) => p.value === priority) || AGENDA_PRIORITIES[1]
}

function formatDueDate(value: string | null) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year?.slice(2)}`
}

function formatDateTime(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isOverdue(item: AgendaItem) {
  if (item.status === 'feito' || !item.due_date) return false
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return item.due_date < todayStr
}

function AvatarStack({ item }: { item: AgendaItem }) {
  const involved = item.participants.filter((p) => p.role === 'envolvido')
  const shown = involved.slice(0, 4)
  return (
    <div style={{ display: 'flex' }} title={involved.map((p) => p.name).join(', ')}>
      {shown.map((p, index) => (
        <div
          key={p.user_id}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            overflow: 'hidden',
            background: 'var(--brs-navy)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            fontWeight: 700,
            border: '2px solid var(--brs-surface)',
            marginLeft: index === 0 ? 0 : -8,
          }}
        >
          {p.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            p.name.charAt(0)
          )}
        </div>
      ))}
      {involved.length > shown.length && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'var(--brs-gray-100)',
            color: 'var(--brs-gray-600)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.6rem',
            fontWeight: 700,
            border: '2px solid var(--brs-surface)',
            marginLeft: -8,
          }}
        >
          +{involved.length - shown.length}
        </div>
      )}
    </div>
  )
}

export default function AgendaClient({ bootstrap }: AgendaClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewParam = searchParams.get('view')
  const view =
    viewParam === 'compromissos'
      ? 'compromissos'
      : viewParam === 'agenda'
        ? 'agenda'
        : viewParam === 'relatorio'
          ? 'relatorio'
          : 'tarefas'
  const openItemId = searchParams.get('item')

  const [items, setItems] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'minhas' | 'todas'>('minhas')
  const [taskLayout, setTaskLayout] = useState<'kanban' | 'lista'>('kanban')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<AgendaItem | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<AgendaTaskStatus | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const draggedIdRef = useRef<string | null>(null)
  const openedFromUrlRef = useRef(false)

  const reload = useCallback(async () => {
    if (view === 'agenda' || view === 'relatorio') {
      setReloadKey((key) => key + 1)
      return
    }
    setLoading(true)
    try {
      const data = await listAgendaItems({ kind: view, scope })
      setItems(data)
    } finally {
      setLoading(false)
    }
  }, [view, scope])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (!openItemId || openedFromUrlRef.current) return
    openedFromUrlRef.current = true
    const target = items.find((item) => item.id === openItemId)
    if (target) {
      setEditingItem(target)
      setEditorOpen(true)
      return
    }
    // Deep-link do sino: o item pode não estar na listagem atual
    // (outra visão, outro filtro) — busca direto.
    getAgendaItemById(openItemId).then((item) => {
      if (item && !item.masked) {
        setEditingItem(item)
        setEditorOpen(true)
      }
    })
  }, [openItemId, items])

  function openEditor(item: AgendaItem | null) {
    setEditingItem(item)
    setEditorOpen(true)
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditingItem(null)
    if (openItemId) router.replace(view === 'tarefas' ? '/agenda' : `/agenda?view=${view}`)
  }

  async function handleDrop(status: AgendaTaskStatus) {
    const itemId = draggedIdRef.current
    draggedIdRef.current = null
    setDragOverStatus(null)
    if (!itemId) return
    const current = items.find((item) => item.id === itemId)
    if (!current || current.status === status) return

    const previous = items
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, status } : item)))
    const res = await updateTaskStatus(itemId, status)
    if (!res.success) {
      setItems(previous)
      window.alert(res.error || 'Não foi possível mover a tarefa.')
    } else if (res.recurred) {
      // Recorrente concluída: voltou a Pendente com a próxima data.
      await reload()
    }
  }

  const tasksByStatus = useMemo(() => {
    const map = new Map<AgendaTaskStatus, AgendaItem[]>()
    for (const status of AGENDA_TASK_STATUSES) map.set(status.value, [])
    for (const item of items) {
      if (!item.status) continue
      map.get(item.status)?.push(item)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const byPriority = priorityOrder(a.priority) - priorityOrder(b.priority)
        if (byPriority !== 0) return byPriority
        return (a.due_date || '9999').localeCompare(b.due_date || '9999')
      })
    }
    return map
  }, [items])

  const sortedListTasks = useMemo(
    () =>
      [...items].sort((a, b) => {
        const statusOrder = AGENDA_TASK_STATUSES.findIndex((s) => s.value === a.status) - AGENDA_TASK_STATUSES.findIndex((s) => s.value === b.status)
        if (statusOrder !== 0) return statusOrder
        return priorityOrder(a.priority) - priorityOrder(b.priority)
      }),
    [items],
  )

  const cardStyle: React.CSSProperties = {
    background: 'var(--brs-surface)',
    border: '1px solid var(--brs-gray-100)',
    borderRadius: 12,
    padding: '0.65rem 0.75rem',
    cursor: 'pointer',
    display: 'grid',
    gap: '0.4rem',
  }

  function TaskCard({ item }: { item: AgendaItem }) {
    const pMeta = priorityMeta(item.priority)
    const overdue = isOverdue(item)
    return (
      <div
        draggable={!item.masked}
        onDragStart={() => {
          draggedIdRef.current = item.id
        }}
        onClick={() => !item.masked && openEditor(item)}
        style={{ ...cardStyle, borderLeft: `3px solid ${pMeta.color}`, opacity: item.masked ? 0.6 : 1 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>
            {item.masked && <Lock size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />}
            {item.title}
          </span>
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: pMeta.color, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {pMeta.label}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
          <AvatarStack item={item} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {item.recurrence && (
              <span title="Tarefa recorrente" style={{ color: 'var(--brs-gray-400)', display: 'flex' }}>
                <Repeat size={13} />
              </span>
            )}
            {item.links.length > 0 && (
              <span title={item.links.map((l) => l.label).join(', ')} style={{ color: 'var(--brs-gray-400)', display: 'flex' }}>
                <Link2 size={13} />
              </span>
            )}
            {item.due_date && (
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: overdue ? 'var(--brs-danger)' : 'var(--brs-gray-400)' }}>
                {formatDueDate(item.due_date)}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {(view === 'tarefas' || view === 'compromissos') && (
          <div style={{ display: 'flex', border: '1px solid var(--brs-gray-200)', borderRadius: 999, overflow: 'hidden' }}>
            {(['minhas', 'todas'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                style={{
                  border: 'none',
                  padding: '0.35rem 0.9rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: scope === value ? 'var(--brs-navy)' : 'transparent',
                  color: scope === value ? '#fff' : 'var(--brs-gray-600)',
                }}
              >
                {value === 'minhas' ? 'Minhas' : 'Todas'}
              </button>
            ))}
          </div>
          )}

          {view === 'tarefas' && (
            <div style={{ display: 'flex', border: '1px solid var(--brs-gray-200)', borderRadius: 999, overflow: 'hidden' }}>
              {(
                [
                  { value: 'kanban', label: 'Kanban', icon: KanbanSquare },
                  { value: 'lista', label: 'Lista', icon: Rows3 },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTaskLayout(option.value)}
                  style={{
                    border: 'none',
                    padding: '0.35rem 0.8rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    background: taskLayout === option.value ? 'var(--brs-navy)' : 'transparent',
                    color: taskLayout === option.value ? '#fff' : 'var(--brs-gray-600)',
                  }}
                >
                  <option.icon size={14} /> {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {bootstrap.canInclude && view !== 'relatorio' && (
          <button type="button" className="btn btn-primary" onClick={() => openEditor(null)}>
            <Plus size={16} /> {view === 'tarefas' ? 'Nova tarefa' : 'Novo compromisso'}
          </button>
        )}
      </div>

      {view === 'relatorio' ? (
        <ReportView reloadKey={reloadKey} />
      ) : view === 'agenda' ? (
        <CalendarView bootstrap={bootstrap} onOpenItem={openEditor} reloadKey={reloadKey} />
      ) : loading ? (
        <div style={{ color: 'var(--brs-gray-400)', padding: '2rem 0', textAlign: 'center' }}>Carregando…</div>
      ) : view === 'compromissos' ? (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {items.length === 0 ? (
            <div style={{ color: 'var(--brs-gray-400)', padding: '2rem 0', textAlign: 'center' }}>
              Nenhum compromisso por vir. Crie o primeiro!
            </div>
          ) : (
            items.map((item) => {
              const tMeta = itemTypeMeta(item.item_type)
              return (
                <div
                  key={item.id}
                  onClick={() => !item.masked && openEditor(item)}
                  style={{ ...cardStyle, borderLeft: `3px solid ${tMeta.color}`, opacity: item.masked ? 0.6 : 1 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>
                      {item.masked && <Lock size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />}
                      {item.title}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: tMeta.color, textTransform: 'uppercase' }}>{tMeta.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>{formatDateTime(item.start_at)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      {item.meeting_link && (
                        <a
                          href={item.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-info)' }}
                        >
                          <Video size={14} /> Entrar
                        </a>
                      )}
                      <AvatarStack item={item} />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : taskLayout === 'kanban' ? (
        <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(230px, 1fr))', gap: '0.75rem', minWidth: 960 }}>
            {AGENDA_TASK_STATUSES.map((statusMeta) => {
              const columnItems = tasksByStatus.get(statusMeta.value) || []
              return (
                <div
                  key={statusMeta.value}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverStatus(statusMeta.value)
                  }}
                  onDragLeave={() => setDragOverStatus((prev) => (prev === statusMeta.value ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(statusMeta.value)
                  }}
                  style={{
                    background: dragOverStatus === statusMeta.value ? 'var(--brs-gray-100)' : 'var(--brs-gray-50)',
                    border: '1px solid var(--brs-gray-100)',
                    borderRadius: 14,
                    padding: '0.7rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.55rem',
                    minHeight: 220,
                    transition: 'background 120ms',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--brs-gray-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {statusMeta.label}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-400)' }}>{columnItems.length}</span>
                  </div>
                  {columnItems.map((item) => (
                    <TaskCard key={item.id} item={item} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--brs-gray-400)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '0.5rem 0.6rem' }}>Tarefa</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Envolvidos</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Prioridade</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Status</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Data</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Vínculo</th>
              </tr>
            </thead>
            <tbody>
              {sortedListTasks.map((item) => {
                const pMeta = priorityMeta(item.priority)
                return (
                  <tr
                    key={item.id}
                    onClick={() => !item.masked && openEditor(item)}
                    style={{ borderTop: '1px solid var(--brs-gray-100)', cursor: item.masked ? 'default' : 'pointer' }}
                  >
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>
                      {item.masked && <Lock size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />}
                      {item.title}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', color: 'var(--brs-gray-600)' }}>
                      {item.participants.filter((p) => p.role === 'envolvido').map((p) => p.name.split(' ')[0]).join(', ') || '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700, color: pMeta.color }}>{pMeta.label}</td>
                    <td style={{ padding: '0.55rem 0.6rem', color: 'var(--brs-gray-600)' }}>
                      {AGENDA_TASK_STATUSES.find((s) => s.value === item.status)?.label || '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', color: isOverdue(item) ? 'var(--brs-danger)' : 'var(--brs-gray-600)', fontWeight: isOverdue(item) ? 700 : 400 }}>
                      {formatDueDate(item.due_date) || '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', color: 'var(--brs-gray-400)', fontSize: '0.78rem' }}>
                      {item.links.map((l) => l.label).join(', ') || '—'}
                    </td>
                  </tr>
                )
              })}
              {sortedListTasks.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem 0.6rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>
                    Nenhuma tarefa por aqui. Crie a primeira!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ItemEditorModal
        open={editorOpen}
        onClose={closeEditor}
        onSaved={reload}
        bootstrap={bootstrap}
        item={editingItem}
        defaultType={view === 'tarefas' ? 'tarefa' : 'reuniao_virtual'}
      />
    </div>
  )
}
