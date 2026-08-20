'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import { addRecordComment, listRecordComments, removeRecordComment, type RecordComment } from './actions'

type CommentsTimelineProps = {
  entityType: string
  entityId: string
  currentUserId: string
  // Título da seção; some quando vazio.
  title?: string
}

function formatWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function CommentsTimeline({ entityType, entityId, currentUserId, title = 'Comentários' }: CommentsTimelineProps) {
  const [comments, setComments] = useState<RecordComment[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const res = await listRecordComments(entityType, entityId)
    if (res.success) setComments(res.comments)
    setLoading(false)
  }, [entityType, entityId])

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    const res = await addRecordComment(entityType, entityId, text)
    if (res.success) {
      setDraft('')
      await reload()
    } else {
      setError(res.error || 'Não foi possível enviar o comentário.')
    }
    setSending(false)
  }

  async function handleRemove(commentId: string) {
    if (!window.confirm('Excluir este comentário?')) return
    const res = await removeRecordComment(commentId)
    if (res.success) await reload()
    else setError(res.error || 'Não foi possível excluir o comentário.')
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {title && (
        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {title}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Carregando comentários…</div>
      ) : comments.length === 0 ? (
        <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Nenhum comentário ainda.</div>
      ) : (
        <div style={{ display: 'grid', gap: '0.65rem' }}>
          {comments.map((comment) => (
            <div key={comment.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  flexShrink: 0,
                  background: 'var(--brs-navy)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                {comment.user_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comment.user_avatar_url} alt={comment.user_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  comment.user_name.charAt(0)
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  background: 'var(--brs-gray-50)',
                  border: '1px solid var(--brs-gray-100)',
                  borderRadius: 12,
                  padding: '0.55rem 0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>{comment.user_name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', whiteSpace: 'nowrap' }}>
                    {formatWhen(comment.created_at)}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)', whiteSpace: 'pre-wrap', marginTop: 2 }}>{comment.body}</div>
              </div>
              {comment.user_id === currentUserId && (
                <button
                  type="button"
                  className="icon-button"
                  style={{ width: 28, height: 28, flexShrink: 0 }}
                  title="Excluir comentário"
                  onClick={() => handleRemove(comment.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: 'var(--brs-danger)', fontSize: '0.8rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <textarea
          className="form-control"
          rows={2}
          placeholder="Escreva um comentário…"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleSend()
            }
          }}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button type="button" className="btn btn-primary" onClick={handleSend} disabled={sending || !draft.trim()} title="Enviar (Ctrl+Enter)">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
