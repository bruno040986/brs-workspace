'use client'

import { useState, useEffect } from 'react'
import type { CalendarEvent } from '@/lib/google/calendar'
import { CreateEventModal } from './CreateEventModal'
import { listAgendaItems } from '@/app/(dashboard)/agenda/actions'
import { AGENDA_PRIORITIES, priorityOrder, type AgendaItem } from '@/lib/agenda/types'

type ConnectionState = {
  connected: boolean
  reason?: string
}

export function AgendaComponent() {
  const [activeTab, setActiveTab] = useState<'minha' | 'empresa' | 'tarefas'>('minha')
  const [myTasks, setMyTasks] = useState<AgendaItem[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>({ connected: false })
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [users, setUsers] = useState<Array<{ id: string; email: string; full_name?: string }>>([])
  const [isDarkTheme, setIsDarkTheme] = useState(false)

  useEffect(() => {
    checkGoogleConnection()
    fetchUsers()
  }, [])

  useEffect(() => {
    const updateTheme = () => {
      const current = document.documentElement.getAttribute('data-theme')
      setIsDarkTheme(current === 'dark')
    }
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  async function checkGoogleConnection() {
    try {
      const response = await fetch('/api/calendar/check-connection')
      const data = await response.json()
      setConnection({
        connected: Boolean(data.connected),
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      })
    } catch (error) {
      console.error('Error checking connection:', error)
      setConnection({ connected: false, reason: 'network_error' })
    } finally {
      setIsLoading(false)
    }
  }

  async function fetchUsers() {
    try {
      const response = await fetch('/api/users/list')
      const data = await response.json()
      setUsers(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching users:', error)
      setUsers([])
    }
  }

  async function handleConnectGoogle() {
    try {
      const response = await fetch('/api/auth/google/url')
      const data = await response.json()

      if (!response.ok || !data?.authUrl) {
        alert(`Erro ao conectar Google: ${data?.error || 'Falha desconhecida'}`)
        return
      }

      window.location.href = data.authUrl
    } catch (error) {
      console.error('Error during Google connection:', error)
      alert('Erro ao conectar ao Google. Verifique as credenciais na configuracao.')
    }
  }

  async function fetchMyEvents() {
    setIsLoadingEvents(true)
    try {
      const response = await fetch('/api/calendar/events')
      const data = await response.json()
      setEvents(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching events:', error)
      setEvents([])
    } finally {
      setIsLoadingEvents(false)
    }
  }

  async function fetchUserEvents(userEmail: string) {
    setIsLoadingEvents(true)
    try {
      const response = await fetch(`/api/calendar/events?user=${encodeURIComponent(userEmail)}`)
      const data = await response.json()
      setEvents(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Error fetching user events:', error)
      setEvents([])
    } finally {
      setIsLoadingEvents(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'minha' && connection.connected) fetchMyEvents()
  }, [activeTab, connection.connected])

  useEffect(() => {
    if (activeTab === 'empresa' && selectedUser) fetchUserEvents(selectedUser)
  }, [selectedUser, activeTab])

  useEffect(() => {
    if (activeTab !== 'tarefas') return
    setIsLoadingTasks(true)
    listAgendaItems({ kind: 'tarefas', scope: 'minhas' })
      .then((items) => {
        const pending = items
          .filter((item) => item.status !== 'feito')
          .sort((a, b) => {
            const byPriority = priorityOrder(a.priority) - priorityOrder(b.priority)
            if (byPriority !== 0) return byPriority
            return (a.due_date || '9999').localeCompare(b.due_date || '9999')
          })
        setMyTasks(pending.slice(0, 6))
      })
      .catch(() => setMyTasks([]))
      .finally(() => setIsLoadingTasks(false))
  }, [activeTab])

  const connectionHint =
    connection.reason === 'token_invalid'
      ? 'Conexao expirada. Reconecte sua conta Google.'
      : 'Conecte sua conta Google para visualizar sua agenda.'

  return (
    <div className="w-full space-y-4">
      <div className="flex border-b items-center">
        <button
          onClick={() => setActiveTab('minha')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'minha'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : isDarkTheme
                ? 'text-slate-300 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Minha Agenda
        </button>
        <button
          onClick={() => setActiveTab('empresa')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'empresa'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : isDarkTheme
                ? 'text-slate-300 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Agenda da Empresa
        </button>
        <button
          onClick={() => setActiveTab('tarefas')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'tarefas'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : isDarkTheme
                ? 'text-slate-300 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Minhas Tarefas
        </button>
        <a
          href="/agenda"
          className="ml-auto px-3 py-1 rounded-lg text-sm font-semibold"
          style={{
            background: isDarkTheme ? '#14233b' : '#eff6ff',
            color: isDarkTheme ? '#93c5fd' : '#1d4ed8',
            border: `1px solid ${isDarkTheme ? '#31507c' : '#bfdbfe'}`,
          }}
        >
          Tarefas da equipe →
        </a>
      </div>

      <div
        className="rounded-lg p-6"
        style={{
          background: isDarkTheme ? '#0f1a2e' : '#ffffff',
          border: `1px solid ${isDarkTheme ? '#334155' : '#e2e8f0'}`,
        }}
      >
        {activeTab === 'minha' && (
          <div className="space-y-4">
            {isLoading ? (
              <p className="text-gray-500">Verificando conexao...</p>
            ) : !connection.connected ? (
              <div
                className="rounded-lg p-4 text-center"
                style={{
                  background: isDarkTheme ? '#14233b' : '#eff6ff',
                  border: `1px solid ${isDarkTheme ? '#31507c' : '#bfdbfe'}`,
                }}
              >
                <p style={{ color: isDarkTheme ? '#dbeafe' : '#1e3a8a', marginBottom: '0.75rem' }}>{connectionHint}</p>
                <button onClick={handleConnectGoogle} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Conectar Google
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold">Seus compromissos</h3>
                  <button onClick={() => setIsModalOpen(true)} className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                    Novo Compromisso
                  </button>
                </div>

                {isLoadingEvents ? (
                <p className="text-center py-8" style={{ color: isDarkTheme ? '#cbd5e1' : '#6b7280' }}>Carregando eventos...</p>
              ) : events.length === 0 ? (
                <p className="text-center py-8" style={{ color: isDarkTheme ? '#cbd5e1' : '#6b7280' }}>Nenhum compromisso para hoje.</p>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="border rounded-lg p-3"
                      style={{
                        borderColor: isDarkTheme ? '#334155' : '#e5e7eb',
                        background: isDarkTheme ? '#0b1220' : '#ffffff',
                      }}
                    >
                      <p className="font-medium">{event.title}</p>
                      <p className="text-sm" style={{ color: isDarkTheme ? '#cbd5e1' : '#4b5563' }}>
                        {new Date(event.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(event.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tarefas' && (
          <div className="space-y-2">
            {isLoadingTasks ? (
              <p className="text-center py-8" style={{ color: isDarkTheme ? '#cbd5e1' : '#6b7280' }}>Carregando tarefas…</p>
            ) : myTasks.length === 0 ? (
              <p className="text-center py-8" style={{ color: isDarkTheme ? '#cbd5e1' : '#6b7280' }}>
                Nenhuma tarefa pendente. 🎉
              </p>
            ) : (
              myTasks.map((task) => {
                const priority = AGENDA_PRIORITIES.find((p) => p.value === task.priority) || AGENDA_PRIORITIES[1]
                return (
                  <a
                    key={task.id}
                    href={`/agenda?item=${task.id}`}
                    className="border rounded-lg p-3 flex items-center justify-between gap-3"
                    style={{
                      borderColor: isDarkTheme ? '#334155' : '#e5e7eb',
                      background: isDarkTheme ? '#0b1220' : '#ffffff',
                      borderLeft: `3px solid ${priority.color}`,
                    }}
                  >
                    <span className="font-medium truncate">{task.title}</span>
                    <span className="text-xs whitespace-nowrap" style={{ color: isDarkTheme ? '#94a3b8' : '#6b7280' }}>
                      {task.due_date
                        ? new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                        : priority.label}
                    </span>
                  </a>
                )
              })
            )}
            <a
              href="/agenda"
              className="block text-center text-sm font-semibold pt-2"
              style={{ color: isDarkTheme ? '#93c5fd' : '#1d4ed8' }}
            >
              Abrir painel completo →
            </a>
          </div>
        )}

        {activeTab === 'empresa' && (
          <div className="space-y-4">
            {!connection.connected ? (
              <div
                className="rounded-lg p-4 text-center"
                style={{
                  background: isDarkTheme ? '#14233b' : '#eff6ff',
                  border: `1px solid ${isDarkTheme ? '#31507c' : '#bfdbfe'}`,
                }}
              >
                <p style={{ color: isDarkTheme ? '#dbeafe' : '#1e3a8a' }}>Voce precisa conectar sua conta Google primeiro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Selecione um usuario:</label>
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Escolha um usuario --</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.email}>
                        {user.full_name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <CreateEventModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => fetchMyEvents()}
        attendeeEmails={Array.isArray(users) ? users.map((u) => u.email) : []}
      />
    </div>
  )
}
