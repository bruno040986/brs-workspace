'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link2, Lock, Mail, Trash2, X } from 'lucide-react'
import CommentsTimeline from '@/components/comments/CommentsTimeline'
import {
  AGENDA_ITEM_TYPES,
  AGENDA_LINK_ENTITY_TYPES,
  AGENDA_PRIORITIES,
  AGENDA_TASK_STATUSES,
  GUEST_EMAIL_REGEX,
  type AgendaGuest,
  type AgendaItem,
  type AgendaItemLink,
  type AgendaItemPayload,
  type AgendaItemType,
  type SuggestedGuest,
} from '@/lib/agenda/types'
import {
  deleteAgendaItem,
  getAvailability,
  getSuggestedGuests,
  saveAgendaItem,
  searchAgendaLinkTargets,
  type AgendaBootstrap,
  type AvailabilityEntry,
} from '../actions'

type ItemEditorModalProps = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  bootstrap: AgendaBootstrap
  item: AgendaItem | null
  defaultType: AgendaItemType
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const fieldLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'var(--brs-gray-400)',
  marginBottom: '0.3rem',
  display: 'block',
}

export default function ItemEditorModal({ open, onClose, onSaved, bootstrap, item, defaultType }: ItemEditorModalProps) {
  const [itemType, setItemType] = useState<AgendaItemType>(defaultType)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [priority, setPriority] = useState('media')
  const [status, setStatus] = useState('pendente')
  const [visibility, setVisibility] = useState('publica')
  const [linkMode, setLinkMode] = useState<'nenhum' | 'externo' | 'gerar_meet'>('nenhum')
  const [recurFreq, setRecurFreq] = useState<'nenhuma' | 'daily' | 'weekly' | 'monthly'>('nenhuma')
  const [recurWeekdays, setRecurWeekdays] = useState<number[]>([])
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
  const [availability, setAvailability] = useState<AvailabilityEntry[] | null>(null)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [meetingLink, setMeetingLink] = useState('')
  const [involvedIds, setInvolvedIds] = useState<string[]>([])
  const [authorizedIds, setAuthorizedIds] = useState<string[]>([])
  const [links, setLinks] = useState<AgendaItemLink[]>([])
  const [guests, setGuests] = useState<AgendaGuest[]>([])
  const [guestInput, setGuestInput] = useState('')
  const [guestSuggestions, setGuestSuggestions] = useState<SuggestedGuest[]>([])
  const [participantFilter, setParticipantFilter] = useState('')
  const [linkEntityType, setLinkEntityType] = useState(AGENDA_LINK_ENTITY_TYPES[0].value)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkResults, setLinkResults] = useState<AgendaItemLink[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isTask = itemType === 'tarefa'
  const isEditing = Boolean(item?.id)
  const isCreator = !item || item.created_by === bootstrap.currentUserId

  useEffect(() => {
    if (!open) return
    fetch('/api/calendar/check-connection')
      .then(async (response) => response.json())
      .then((data) => setGoogleConnected(Boolean(data?.connected)))
      .catch(() => setGoogleConnected(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    setError('')
    setParticipantFilter('')
    setLinkQuery('')
    setLinkResults([])
    setAvailability(null)
    if (item) {
      setItemType(item.item_type)
      setTitle(item.title)
      setDescription(item.description)
      setDueDate(item.due_date || '')
      setStartAt(toDatetimeLocal(item.start_at))
      setEndAt(toDatetimeLocal(item.end_at))
      setPriority(item.priority)
      setStatus(item.status || 'pendente')
      setVisibility(item.visibility)
      setLinkMode(item.meeting_link_mode === 'nenhum' ? 'nenhum' : item.meeting_link_mode)
      setRecurFreq(item.recurrence?.freq || 'nenhuma')
      setRecurWeekdays(item.recurrence?.weekdays || [])
      setMeetingLink(item.meeting_link || '')
      setInvolvedIds(item.participants.filter((p) => p.role === 'envolvido').map((p) => p.user_id))
      setAuthorizedIds(item.participants.filter((p) => p.role === 'autorizado').map((p) => p.user_id))
      setLinks(item.links)
      setGuests(item.guests || [])
    } else {
      setItemType(defaultType)
      setTitle('')
      setDescription('')
      setDueDate('')
      setStartAt('')
      setEndAt('')
      setPriority('media')
      setStatus('pendente')
      setVisibility('publica')
      setLinkMode('nenhum')
      setMeetingLink('')
      setRecurFreq('nenhuma')
      setRecurWeekdays([])
      setInvolvedIds([bootstrap.currentUserId])
      setAuthorizedIds([])
      setLinks([])
      setGuests([])
    }
    setGuestInput('')
    setGuestSuggestions([])
  }, [open, item, defaultType, bootstrap.currentUserId])

  // Sugestões de convidados a partir dos vínculos selecionados.
  useEffect(() => {
    if (!open || itemType === 'tarefa' || !links.length) {
      setGuestSuggestions([])
      return
    }
    let cancelled = false
    getSuggestedGuests(links).then((res) => {
      if (!cancelled && res.success) setGuestSuggestions(res.suggestions)
    })
    return () => {
      cancelled = true
    }
  }, [open, itemType, links])

  useEffect(() => {
    if (!open) return
    const term = linkQuery.trim()
    if (!term) {
      setLinkResults([])
      return
    }
    const timer = window.setTimeout(async () => {
      const res = await searchAgendaLinkTargets(linkEntityType, term)
      if (res.success) setLinkResults(res.results)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [linkQuery, linkEntityType, open])

  const filteredUsers = useMemo(() => {
    const term = participantFilter.trim().toLowerCase()
    if (!term) return bootstrap.users
    return bootstrap.users.filter((u) => u.name.toLowerCase().includes(term))
  }, [bootstrap.users, participantFilter])

  if (!open) return null

  function toggleInvolved(userId: string) {
    setInvolvedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]))
  }

  function toggleAuthorized(userId: string) {
    setAuthorizedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]))
  }

  function addGuestFromInput() {
    const pieces = guestInput.split(/[\s,;]+/).map((piece) => piece.trim().toLowerCase()).filter(Boolean)
    if (!pieces.length) return
    const invalid = pieces.filter((email) => !GUEST_EMAIL_REGEX.test(email))
    if (invalid.length) {
      setError(`E-mail inválido: ${invalid[0]}`)
      return
    }
    setError('')
    setGuests((prev) => {
      const existing = new Set(prev.map((g) => g.email))
      const additions = pieces
        .filter((email) => !existing.has(email))
        .map((email) => ({ email, name: '', source: 'manual' as const }))
      return [...prev, ...additions]
    })
    setGuestInput('')
  }

  function addSuggestedGuest(suggestion: SuggestedGuest) {
    setGuests((prev) =>
      prev.some((g) => g.email === suggestion.email)
        ? prev
        : [...prev, { email: suggestion.email, name: suggestion.name, source: 'vinculo' as const }],
    )
  }

  function removeGuest(email: string) {
    setGuests((prev) => prev.filter((g) => g.email !== email))
  }

  function addLink(link: AgendaItemLink) {
    setLinks((prev) =>
      prev.some((l) => l.entity_type === link.entity_type && l.entity_id === link.entity_id) ? prev : [...prev, link],
    )
    setLinkQuery('')
    setLinkResults([])
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError('')

    const payload: AgendaItemPayload = {
      id: item?.id,
      item_type: itemType,
      title,
      description,
      all_day: isTask ? !startAt : false,
      due_date: isTask ? dueDate || null : null,
      start_at: isTask ? null : fromDatetimeLocal(startAt),
      end_at: isTask ? null : fromDatetimeLocal(endAt),
      priority: priority as AgendaItemPayload['priority'],
      status: isTask ? (status as AgendaItemPayload['status']) : null,
      visibility: visibility as AgendaItemPayload['visibility'],
      meeting_link_mode: itemType === 'reuniao_virtual' ? linkMode : 'nenhum',
      meeting_link: itemType === 'reuniao_virtual' && linkMode === 'externo' ? meetingLink : '',
      recurrence:
        isTask && recurFreq !== 'nenhuma'
          ? {
              freq: recurFreq,
              weekdays: recurFreq === 'weekly' ? recurWeekdays : undefined,
              day: recurFreq === 'monthly' && dueDate ? Number(dueDate.slice(8, 10)) : undefined,
            }
          : null,
      participant_user_ids: involvedIds,
      authorized_user_ids: authorizedIds,
      links,
      guests: guests.map((g) => ({ email: g.email, name: g.name, source: g.source })),
    }

    const res = await saveAgendaItem(payload)
    setSaving(false)
    if (res.success) {
      onSaved()
      onClose()
      if (res.warning) window.alert(res.warning)
    } else {
      setError(res.error || 'Não foi possível salvar.')
    }
  }

  async function handleCheckAvailability() {
    const startIso = fromDatetimeLocal(startAt)
    if (!startIso || !involvedIds.length || checkingAvailability) return
    const endIso = fromDatetimeLocal(endAt) || new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString()
    setCheckingAvailability(true)
    setAvailability(null)
    const res = await getAvailability({ userIds: involvedIds, startAt: startIso, endAt: endIso })
    setCheckingAvailability(false)
    if (res.success) setAvailability(res.entries)
    else setError(res.error || 'Não foi possível consultar a disponibilidade.')
  }

  async function handleDelete() {
    if (!item?.id) return
    if (!window.confirm('Excluir este item? Essa ação não pode ser desfeita.')) return
    const res = await deleteAgendaItem(item.id)
    if (res.success) {
      onSaved()
      onClose()
    } else {
      setError(res.error || 'Não foi possível excluir.')
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal, 1200)' as any,
        background: 'rgba(15, 23, 47, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(680px, 100%)',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--brs-surface)',
          borderRadius: 16,
          border: '1px solid var(--brs-gray-100)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          padding: '1.25rem 1.4rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--brs-gray-800)' }}>
            {isEditing ? 'Editar item' : 'Novo item'}
          </h2>
          <button className="icon-button" onClick={onClose} style={{ width: 32, height: 32 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <div>
            <span style={fieldLabel}>Tipo</span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {AGENDA_ITEM_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setItemType(t.value)}
                  disabled={isEditing}
                  style={{
                    border: `1.5px solid ${itemType === t.value ? t.color : 'var(--brs-gray-200)'}`,
                    background: itemType === t.value ? `${t.color}18` : 'transparent',
                    color: itemType === t.value ? t.color : 'var(--brs-gray-600)',
                    borderRadius: 999,
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: isEditing ? 'default' : 'pointer',
                    opacity: isEditing && itemType !== t.value ? 0.45 : 1,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span style={fieldLabel}>Título *</span>
            <input className="form-control" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <span style={fieldLabel}>Descrição / pauta</span>
            <textarea className="form-control" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isTask ? '1fr 1fr 1fr' : '1fr 1fr', gap: '0.75rem' }}>
            {isTask ? (
              <>
                <div>
                  <span style={fieldLabel}>Data (do dia)</span>
                  <input type="date" className="form-control" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div>
                  <span style={fieldLabel}>Status</span>
                  <select className="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {AGENDA_TASK_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span style={fieldLabel}>Início *</span>
                  <input type="datetime-local" className="form-control" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                </div>
                <div>
                  <span style={fieldLabel}>Fim</span>
                  <input type="datetime-local" className="form-control" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <span style={fieldLabel}>Prioridade</span>
              <select className="form-control" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {AGENDA_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {isTask && (
            <div>
              <span style={fieldLabel}>Recorrência</span>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="form-control"
                  value={recurFreq}
                  onChange={(e) => setRecurFreq(e.target.value as typeof recurFreq)}
                  style={{ width: 'auto' }}
                >
                  <option value="nenhuma">Sem recorrência</option>
                  <option value="daily">Diária</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensal (dia da data inicial)</option>
                </select>
                {recurFreq === 'weekly' && (
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setRecurWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
                        }
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          border: `1.5px solid ${recurWeekdays.includes(day) ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
                          background: recurWeekdays.includes(day) ? 'var(--brs-navy)' : 'transparent',
                          color: recurWeekdays.includes(day) ? '#fff' : 'var(--brs-gray-600)',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {recurFreq !== 'nenhuma' && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
                    ao marcar Feito, a tarefa volta para Pendente na próxima data
                  </span>
                )}
              </div>
            </div>
          )}

          {itemType === 'reuniao_virtual' && (
            <div>
              <span style={fieldLabel}>Link da reunião</span>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                  <input type="radio" checked={linkMode === 'nenhum'} onChange={() => setLinkMode('nenhum')} /> Sem link
                </label>
                <label
                  style={{
                    display: 'flex',
                    gap: '0.35rem',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                    color: googleConnected ? 'var(--brs-gray-600)' : 'var(--brs-gray-400)',
                  }}
                  title={googleConnected ? '' : 'Conecte sua conta Google (na home do Workspace) para gerar o link do Meet.'}
                >
                  <input
                    type="radio"
                    checked={linkMode === 'gerar_meet'}
                    disabled={!googleConnected}
                    onChange={() => setLinkMode('gerar_meet')}
                  />
                  Gerar link do Meet{googleConnected === false ? ' (conecte o Google)' : ''}
                </label>
                <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                  <input type="radio" checked={linkMode === 'externo'} onChange={() => setLinkMode('externo')} /> Link externo (Teams, Zoom, Meet de terceiros)
                </label>
              </div>
              {linkMode === 'externo' && (
                <input
                  className="form-control"
                  placeholder="https://teams.microsoft.com/…"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                />
              )}
              {linkMode === 'gerar_meet' && item?.meeting_link && (
                <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>
                  Link do Meet:{' '}
                  <a href={item.meeting_link} target="_blank" rel="noreferrer" style={{ color: 'var(--brs-info)', fontWeight: 700 }}>
                    {item.meeting_link}
                  </a>
                </div>
              )}
            </div>
          )}

          {!isTask && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}
                  onClick={handleCheckAvailability}
                  disabled={checkingAvailability || !startAt || !involvedIds.length}
                  title={!startAt ? 'Defina o horário primeiro.' : !involvedIds.length ? 'Selecione os envolvidos primeiro.' : ''}
                >
                  {checkingAvailability ? 'Consultando…' : 'Ver disponibilidade dos envolvidos'}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>consulta o Google Agenda de cada um</span>
              </div>
              {availability && (
                <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.45rem' }}>
                  {availability.map((entry) => (
                    <div key={entry.user_id} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background:
                            entry.status === 'livre'
                              ? 'var(--brs-success)'
                              : entry.status === 'ocupado'
                                ? 'var(--brs-danger)'
                                : 'var(--brs-gray-400)',
                        }}
                      />
                      <span style={{ color: 'var(--brs-gray-800)', fontWeight: 600 }}>{entry.name}</span>
                      <span style={{ color: 'var(--brs-gray-400)' }}>
                        {entry.status === 'livre' ? 'livre' : entry.status === 'ocupado' ? 'ocupado neste horário' : 'sem conta Google conectada'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <span style={fieldLabel}>Envolvidos</span>
            <input
              className="form-control"
              placeholder="Filtrar pessoas…"
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              style={{ marginBottom: '0.4rem' }}
            />
            <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 10, padding: '0.4rem 0.6rem' }}>
              {filteredUsers.map((u) => (
                <label key={u.id} style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', padding: '0.2rem 0', fontSize: '0.85rem', color: 'var(--brs-gray-600)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={involvedIds.includes(u.id)} onChange={() => toggleInvolved(u.id)} />
                  {u.name}
                  {u.id === bootstrap.currentUserId && <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>(você)</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span style={fieldLabel}><Link2 size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Vínculo com registros do sistema</span>
            {links.length > 0 && (
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                {links.map((link) => (
                  <span
                    key={`${link.entity_type}-${link.entity_id}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      background: 'var(--brs-gray-50)',
                      border: '1px solid var(--brs-gray-100)',
                      borderRadius: 999,
                      padding: '0.2rem 0.6rem',
                      fontSize: '0.78rem',
                      color: 'var(--brs-gray-600)',
                    }}
                  >
                    {AGENDA_LINK_ENTITY_TYPES.find((t) => t.value === link.entity_type)?.label}: {link.label}
                    <button
                      type="button"
                      onClick={() => setLinks((prev) => prev.filter((l) => !(l.entity_type === link.entity_type && l.entity_id === link.entity_id)))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brs-gray-400)', padding: 0, display: 'flex' }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
              <select className="form-control" value={linkEntityType} onChange={(e) => { setLinkEntityType(e.target.value); setLinkResults([]) }}>
                {AGENDA_LINK_ENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <div style={{ position: 'relative' }}>
                <input className="form-control" placeholder="Buscar pelo nome…" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} />
                {linkResults.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 10,
                      background: 'var(--brs-surface)',
                      border: '1px solid var(--brs-gray-100)',
                      borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      maxHeight: 180,
                      overflowY: 'auto',
                    }}
                  >
                    {linkResults.map((result) => (
                      <button
                        key={result.entity_id}
                        type="button"
                        onClick={() => addLink(result)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.45rem 0.7rem', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}
                      >
                        {result.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {!isTask && (
            <div>
              <span style={fieldLabel}>
                <Mail size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Convidados externos
              </span>
              {guests.length > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                  {guests.map((guest) => (
                    <span
                      key={guest.email}
                      title={
                        guest.source === 'google'
                          ? 'Veio do convite no Google Calendar'
                          : guest.name || guest.email
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        background: guest.source === 'google' ? 'var(--brs-gray-100)' : 'var(--brs-gray-50)',
                        border: '1px solid var(--brs-gray-100)',
                        borderRadius: 999,
                        padding: '0.2rem 0.6rem',
                        fontSize: '0.78rem',
                        color: 'var(--brs-gray-600)',
                      }}
                    >
                      {guest.name ? `${guest.name} — ${guest.email}` : guest.email}
                      {guest.source !== 'google' && (
                        <button
                          type="button"
                          onClick={() => removeGuest(guest.email)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brs-gray-400)', padding: 0, display: 'flex' }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="form-control"
                  type="email"
                  placeholder="email@empresa.com.br (Enter para adicionar)"
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addGuestFromInput()
                    }
                  }}
                  onBlur={() => guestInput.trim() && addGuestFromInput()}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-ghost" onClick={addGuestFromInput} disabled={!guestInput.trim()}>
                  Adicionar
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                Convidados de fora recebem o convite pelo Google Agenda (com o link da reunião).
              </div>
              {guestSuggestions.filter((s) => !guests.some((g) => g.email === s.email)).length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <span style={{ ...fieldLabel, marginBottom: '0.25rem' }}>Sugestões do vínculo</span>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {guestSuggestions
                      .filter((s) => !guests.some((g) => g.email === s.email))
                      .map((suggestion) => (
                        <button
                          key={suggestion.email}
                          type="button"
                          onClick={() => addSuggestedGuest(suggestion)}
                          title={`${suggestion.entity_label} · ${suggestion.role} — clique para adicionar`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            background: 'transparent',
                            border: '1.5px dashed var(--brs-gray-200)',
                            borderRadius: 999,
                            padding: '0.2rem 0.6rem',
                            fontSize: '0.78rem',
                            color: 'var(--brs-gray-600)',
                            cursor: 'pointer',
                          }}
                        >
                          + {suggestion.name ? `${suggestion.name} (${suggestion.role})` : `${suggestion.role}`} — {suggestion.email}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <span style={fieldLabel}><Lock size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> Visibilidade</span>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                <input type="radio" checked={visibility === 'publica'} onChange={() => setVisibility('publica')} /> Pública (toda a empresa)
              </label>
              <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
                <input type="radio" checked={visibility === 'privada'} onChange={() => setVisibility('privada')} /> Privada
              </label>
            </div>
            {visibility === 'privada' && (
              <div style={{ marginTop: '0.5rem' }}>
                <span style={{ ...fieldLabel, marginBottom: '0.25rem' }}>Autorizados a ver o conteúdo (além dos envolvidos)</span>
                <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 10, padding: '0.4rem 0.6rem' }}>
                  {bootstrap.users
                    .filter((u) => !involvedIds.includes(u.id) && u.id !== bootstrap.currentUserId)
                    .map((u) => (
                      <label key={u.id} style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', padding: '0.2rem 0', fontSize: '0.85rem', color: 'var(--brs-gray-600)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={authorizedIds.includes(u.id)} onChange={() => toggleAuthorized(u.id)} />
                        {u.name}
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>

          {error && <div style={{ color: 'var(--brs-danger)', fontSize: '0.85rem' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div>
              {isEditing && isCreator && (
                <button type="button" className="btn btn-ghost" style={{ color: 'var(--brs-danger)' }} onClick={handleDelete}>
                  <Trash2 size={16} /> Excluir
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>

          {isEditing && item && !item.masked && (
            <div style={{ borderTop: '1px solid var(--brs-gray-100)', paddingTop: '0.9rem' }}>
              <CommentsTimeline entityType="agenda_item" entityId={item.id} currentUserId={bootstrap.currentUserId} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
