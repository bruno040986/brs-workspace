'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { itemTypeMeta, type AgendaItem } from '@/lib/agenda/types'
import { listAgendaItems, type AgendaBootstrap } from '../actions'

type CalendarViewProps = {
  bootstrap: AgendaBootstrap
  onOpenItem: (item: AgendaItem) => void
  reloadKey: number
}

type ViewMode = 'mes' | 'semana' | 'dia'

const HOUR_START = 7
const HOUR_END = 20
const HOUR_HEIGHT = 44

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(date: Date) {
  const d = startOfDay(date)
  return addDays(d, -d.getDay())
}

function dateKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function itemDayKey(item: AgendaItem): string {
  if (item.start_at) return dateKey(new Date(item.start_at))
  return item.due_date || ''
}

function monthLabel(date: Date) {
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default function CalendarView({ bootstrap, onOpenItem, reloadKey }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('semana')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [personId, setPersonId] = useState(bootstrap.currentUserId)
  const [items, setItems] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)

  const range = useMemo(() => {
    if (viewMode === 'mes') {
      const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const gridStart = startOfWeek(firstOfMonth)
      return { start: gridStart, end: addDays(gridStart, 42) }
    }
    if (viewMode === 'semana') {
      const weekStart = startOfWeek(anchor)
      return { start: weekStart, end: addDays(weekStart, 7) }
    }
    return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) }
  }, [viewMode, anchor])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAgendaItems({
        kind: 'agenda',
        scope: 'todas',
        rangeStart: range.start.toISOString(),
        rangeEnd: range.end.toISOString(),
        personId,
      })
      setItems(data)
    } finally {
      setLoading(false)
    }
  }, [range.start, range.end, personId])

  useEffect(() => {
    reload()
  }, [reload, reloadKey])

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of items) {
      const key = itemDayKey(item)
      if (!key) continue
      const list = map.get(key) || []
      list.push(item)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || '')))
    }
    return map
  }, [items])

  function navigate(direction: -1 | 1) {
    if (viewMode === 'mes') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
    else if (viewMode === 'semana') setAnchor(addDays(anchor, direction * 7))
    else setAnchor(addDays(anchor, direction))
  }

  function headerLabel() {
    if (viewMode === 'mes') return monthLabel(anchor)
    if (viewMode === 'dia') {
      const label = anchor.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      return label.charAt(0).toUpperCase() + label.slice(1)
    }
    const weekStart = startOfWeek(anchor)
    const weekEnd = addDays(weekStart, 6)
    return `${weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} – ${weekEnd.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
  }

  function ItemChip({ item, showTime }: { item: AgendaItem; showTime?: boolean }) {
    const meta = itemTypeMeta(item.item_type)
    const time = item.start_at
      ? new Date(item.start_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : ''
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!item.masked) onOpenItem(item)
        }}
        title={item.title}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          border: 'none',
          borderLeft: `3px solid ${meta.color}`,
          background: `${meta.color}16`,
          color: 'var(--brs-gray-800)',
          borderRadius: 6,
          padding: '0.15rem 0.4rem',
          fontSize: '0.7rem',
          fontWeight: 700,
          cursor: item.masked ? 'default' : 'pointer',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.masked && <Lock size={9} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />}
        {showTime && time ? `${time} ` : ''}
        {item.title}
      </button>
    )
  }

  function renderMonth() {
    const gridStart = range.start
    const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)))
    const todayKey = dateKey(new Date())
    return (
      <div style={{ display: 'grid', gap: 1, background: 'var(--brs-gray-100)', border: '1px solid var(--brs-gray-100)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
            <div key={day} style={{ background: 'var(--brs-gray-50)', padding: '0.4rem', textAlign: 'center', fontSize: '0.7rem', fontWeight: 800, color: 'var(--brs-gray-400)', textTransform: 'uppercase' }}>
              {day}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {week.map((day) => {
              const key = dateKey(day)
              const dayItems = itemsByDay.get(key) || []
              const isCurrentMonth = day.getMonth() === anchor.getMonth()
              const isToday = key === todayKey
              return (
                <div
                  key={key}
                  onClick={() => {
                    setAnchor(day)
                    setViewMode('dia')
                  }}
                  style={{
                    background: 'var(--brs-surface)',
                    minHeight: 92,
                    padding: '0.3rem',
                    cursor: 'pointer',
                    opacity: isCurrentMonth ? 1 : 0.45,
                    display: 'grid',
                    gap: 2,
                    alignContent: 'start',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: isToday ? '#fff' : 'var(--brs-gray-600)',
                      background: isToday ? 'var(--brs-navy)' : 'transparent',
                      borderRadius: '50%',
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {day.getDate()}
                  </span>
                  {dayItems.slice(0, 3).map((item) => (
                    <ItemChip key={item.id} item={item} />
                  ))}
                  {dayItems.length > 3 && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--brs-gray-400)' }}>
                      +{dayItems.length - 3} mais
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  function renderTimeGrid() {
    const days =
      viewMode === 'dia'
        ? [startOfDay(anchor)]
        : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))
    const todayKey = dateKey(new Date())
    const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, index) => HOUR_START + index)

    return (
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: viewMode === 'dia' ? 320 : 760 }}>
          {/* Linha de itens do dia inteiro / tarefas */}
          <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, gap: 1, marginBottom: 4 }}>
            <div />
            {days.map((day) => {
              const key = dateKey(day)
              const allDayItems = (itemsByDay.get(key) || []).filter((item) => !item.start_at || item.item_type === 'tarefa')
              return (
                <div key={key} style={{ display: 'grid', gap: 2 }}>
                  <div style={{ textAlign: 'center', fontSize: '0.72rem', fontWeight: 800, color: key === todayKey ? 'var(--brs-navy)' : 'var(--brs-gray-400)' }}>
                    {day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}
                  </div>
                  {allDayItems.map((item) => (
                    <ItemChip key={item.id} item={item} />
                  ))}
                </div>
              )
            })}
          </div>

          {/* Grade de horários */}
          <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, gap: 1, background: 'var(--brs-gray-100)', border: '1px solid var(--brs-gray-100)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ background: 'var(--brs-surface)' }}>
              {hours.map((hour) => (
                <div key={hour} style={{ height: HOUR_HEIGHT, fontSize: '0.65rem', color: 'var(--brs-gray-400)', textAlign: 'right', paddingRight: 4, paddingTop: 2 }}>
                  {String(hour).padStart(2, '0')}h
                </div>
              ))}
            </div>
            {days.map((day) => {
              const key = dateKey(day)
              const timedItems = (itemsByDay.get(key) || []).filter((item) => item.start_at && item.item_type !== 'tarefa')
              return (
                <div key={key} style={{ position: 'relative', background: 'var(--brs-surface)', height: hours.length * HOUR_HEIGHT }}>
                  {hours.map((hour) => (
                    <div key={hour} style={{ position: 'absolute', top: (hour - HOUR_START) * HOUR_HEIGHT, left: 0, right: 0, borderTop: '1px solid var(--brs-gray-50)' }} />
                  ))}
                  {timedItems.map((item, index) => {
                    const start = new Date(String(item.start_at))
                    const end = item.end_at ? new Date(item.end_at) : new Date(start.getTime() + 60 * 60 * 1000)
                    const startHour = Math.max(HOUR_START, start.getHours() + start.getMinutes() / 60)
                    const endHour = Math.min(HOUR_END, Math.max(startHour + 0.5, end.getHours() + end.getMinutes() / 60))
                    const meta = itemTypeMeta(item.item_type)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => !item.masked && onOpenItem(item)}
                        title={item.title}
                        style={{
                          position: 'absolute',
                          top: (startHour - HOUR_START) * HOUR_HEIGHT + 1,
                          height: (endHour - startHour) * HOUR_HEIGHT - 2,
                          left: `${4 + index * 6}px`,
                          right: 4,
                          border: 'none',
                          borderLeft: `3px solid ${meta.color}`,
                          background: `${meta.color}22`,
                          color: 'var(--brs-gray-800)',
                          borderRadius: 8,
                          padding: '0.2rem 0.4rem',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          textAlign: 'left',
                          cursor: item.masked ? 'default' : 'pointer',
                          overflow: 'hidden',
                        }}
                      >
                        {item.masked && <Lock size={9} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />}
                        {start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} {item.title}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button type="button" className="icon-button" style={{ width: 30, height: 30 }} onClick={() => navigate(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="btn btn-ghost" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setAnchor(startOfDay(new Date()))}>
            Hoje
          </button>
          <button type="button" className="icon-button" style={{ width: 30, height: 30 }} onClick={() => navigate(1)}>
            <ChevronRight size={16} />
          </button>
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--brs-gray-800)', marginLeft: '0.3rem' }}>
            {headerLabel()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="form-control"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            style={{ width: 'auto', fontSize: '0.82rem' }}
          >
            <option value={bootstrap.currentUserId}>Minha agenda</option>
            {bootstrap.users
              .filter((u) => u.id !== bootstrap.currentUserId)
              .map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
          </select>
          <div style={{ display: 'flex', border: '1px solid var(--brs-gray-200)', borderRadius: 999, overflow: 'hidden' }}>
            {(
              [
                { value: 'dia', label: 'Dia' },
                { value: 'semana', label: 'Semana' },
                { value: 'mes', label: 'Mês' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setViewMode(option.value)}
                style={{
                  border: 'none',
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: viewMode === option.value ? 'var(--brs-navy)' : 'transparent',
                  color: viewMode === option.value ? '#fff' : 'var(--brs-gray-600)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--brs-gray-400)', padding: '2rem 0', textAlign: 'center' }}>Carregando…</div>
      ) : viewMode === 'mes' ? (
        renderMonth()
      ) : (
        renderTimeGrid()
      )}

      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
        {['tarefa', 'reuniao_virtual', 'reuniao_presencial', 'evento_externo'].map((type) => {
          const meta = itemTypeMeta(type as AgendaItem['item_type'])
          return (
            <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)', fontWeight: 700 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: meta.color, display: 'inline-block' }} />
              {meta.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
