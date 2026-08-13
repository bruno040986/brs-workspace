'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface CreateEventModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  attendeeEmails?: string[]
}

export function CreateEventModal({ isOpen, onClose, onSuccess, attendeeEmails = [] }: CreateEventModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess(false)

    try {
      const response = await fetch('/api/calendar/create-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          startTime,
          endTime,
          location,
          attendeeEmails: selectedAttendees,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Falha ao criar evento')
      }

      setSuccess(true)
      setTitle('')
      setDescription('')
      setStartTime('')
      setEndTime('')
      setLocation('')
      setSelectedAttendees([])

      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar evento')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-96 overflow-y-auto">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">Novo Compromisso</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={isLoading}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-700">
              ✓ Compromisso criado com sucesso!
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Reunião com time"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes do compromisso..."
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1">Início *</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fim *</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Local</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sala 1 ou Google Meet"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {attendeeEmails.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">Convidados</label>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {attendeeEmails.map((email) => (
                  <label key={email} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedAttendees.includes(email)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAttendees([...selectedAttendees, email])
                        } else {
                          setSelectedAttendees(selectedAttendees.filter((e) => e !== email))
                        }
                      }}
                      className="rounded"
                    />
                    {email}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 disabled:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || !title || !startTime || !endTime}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
            >
              {isLoading ? '⏳ Criando...' : '✓ Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
