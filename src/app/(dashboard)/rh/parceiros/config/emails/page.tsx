'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getTemplates,
  saveEmailTemplate,
  toggleEmailTemplateActive,
  deleteEmailTemplate,
} from '../../actions'
import {
  Mail, Plus, Edit2, Save, Loader2, CheckCircle, AlertCircle,
  ArrowLeft, Trash2, Power, PowerOff,
} from 'lucide-react'
import RichTextEditor, { type RichTextHandle } from './_components/RichTextEditor'
import TemplateTokenPanel, { type GlobalTag } from '../_components/TemplateTokenPanel'

interface TemplateItem {
  id: string
  name: string
  subject: string
  body: string
  is_active?: boolean
}

const GLOBAL_TAGS: GlobalTag[] = [
  { tag: '{{assinatura.link}}', label: 'Link de assinatura (Assinafy)' },
  { tag: '{{processo.id}}', label: 'ID do processo (instância)' },
  { tag: '{{campo.email_destino}}', label: 'E-mail destino (tag mapeada no processo)' },
]

const FAKE: Record<string, string> = {
  '{{assinatura.link}}': 'https://assinafy.exemplo/link/abc123',
  '{{processo.id}}': 'PROC-000123',
  '{{campo.email_destino}}': 'parceiro@exemplo.com',
}

export default function EmailTemplatesPage() {
  const [items, setItems] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<Partial<TemplateItem> | null>(null)
  const editorHandleRef = useRef<RichTextHandle | null>(null)

  const usedTags = useMemo(() => {
    const body = String(draft?.body || '')
    const subject = String(draft?.subject || '')
    return Array.from(new Set(`${subject}\n${body}`.match(/\{\{[^}]+\}\}/g) || []))
  }, [draft?.body, draft?.subject])

  const previewSubject = useMemo(
    () => String(draft?.subject || '').replace(/\{\{[^}]+\}\}/g, (tag) => FAKE[tag] || `[${tag}]`),
    [draft?.subject],
  )
  const previewBody = useMemo(
    () => String(draft?.body || '').replace(/\{\{[^}]+\}\}/g, (tag) => FAKE[tag] || `[${tag}]`),
    [draft?.body],
  )

  async function loadData() {
    setLoading(true)
    const res = await getTemplates()
    if (res.success && res.emails) {
      setItems(res.emails as any)
    } else {
      setMessage({ type: 'error', text: 'Erro ao carregar os modelos.' })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function openNew() {
    setDraft({ name: '', subject: 'Notificação BRS Promotora', body: '' })
    setMessage(null)
    setView('edit')
  }

  function openEdit(item: TemplateItem) {
    setDraft({ ...item })
    setMessage(null)
    setView('edit')
  }

  function backToList() {
    setView('list')
    setDraft(null)
    editorHandleRef.current = null
    setMessage(null)
  }

  async function toggleActive(item: TemplateItem) {
    setBusyId(item.id)
    const next = !(item.is_active ?? true)
    const res = await toggleEmailTemplateActive(item.id, next)
    if (res.success) {
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_active: next } : it)))
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao alterar status.' })
    }
    setBusyId(null)
  }

  async function removeItem(item: TemplateItem) {
    if (!window.confirm(`Excluir o modelo "${item.name}"? Esta ação não pode ser desfeita.`)) return
    setBusyId(item.id)
    const res = await deleteEmailTemplate(item.id)
    if (res.success) {
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      setMessage({ type: 'success', text: 'Modelo excluído.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao excluir.' })
    }
    setBusyId(null)
  }

  function insertTag(tag: string) {
    if (!draft) return
    if (editorHandleRef.current) {
      editorHandleRef.current.insertText(tag)
      return
    }
    setDraft({ ...draft, body: (draft.body || '') + tag })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft?.name?.trim() || !draft.body?.trim()) {
      setMessage({ type: 'error', text: 'Nome e corpo do modelo são obrigatórios.' })
      return
    }
    setSaving(true)
    setMessage(null)
    const res = await saveEmailTemplate({
      id: draft.id,
      name: draft.name.trim(),
      subject: draft.subject?.trim() || 'Notificação BRS Promotora',
      body: draft.body,
    })
    if (res.success) {
      await loadData()
      backToList()
      setMessage({ type: 'success', text: 'Modelo salvo com sucesso.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar o modelo.' })
    }
    setSaving(false)
  }

  const banner = message && (
    <div
      style={{
        marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 10,
        border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
        background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
        color: message.type === 'success' ? '#065F46' : '#991B1B',
        display: 'flex', gap: '0.5rem', alignItems: 'center',
      }}
    >
      {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <span>{message.text}</span>
    </div>
  )

  // ======================= LISTA =======================
  if (view === 'list') {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>Modelos de E-mails (SCP)</div>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>
              Cadastre modelos genéricos. As tags específicas são mapeadas no Construtor de Processo.
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> Novo Modelo
          </button>
        </div>

        {banner}

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--brs-gray-600)', padding: '2rem' }}>
              <Loader2 className="spinner" size={16} /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
              <Mail size={32} style={{ margin: '0 auto 0.75rem', color: 'var(--brs-gray-300)' }} />
              Nenhum modelo cadastrado. Clique em <strong>Novo Modelo</strong> para começar.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--brs-gray-50)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)', fontWeight: 700 }}>Modelo</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)', fontWeight: 700 }}>Assunto</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)', fontWeight: 700, width: 130 }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)', fontWeight: 700, width: 260, textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const active = item.is_active ?? true
                  const busy = busyId === item.id
                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                          <Mail size={16} style={{ color: 'var(--brs-navy)' }} />
                          <span style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>{item.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--brs-gray-600)', fontSize: '0.85rem' }}>{item.subject || '—'}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                          background: active ? '#ECFDF5' : 'var(--brs-gray-100)',
                          color: active ? '#065F46' : 'var(--brs-gray-500)',
                          border: `1px solid ${active ? '#A7F3D0' : 'var(--brs-gray-200)'}`,
                        }}>
                          {active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <button type="button" className="btn btn-outline" onClick={() => openEdit(item)} style={{ padding: '4px 10px' }}>
                            <Edit2 size={14} /> Editar
                          </button>
                          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => toggleActive(item)} style={{ padding: '4px 10px' }} title={active ? 'Inativar' : 'Ativar'}>
                            {busy ? <Loader2 size={14} className="spinner" /> : active ? <PowerOff size={14} /> : <Power size={14} />}
                            {active ? 'Inativar' : 'Ativar'}
                          </button>
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => removeItem(item)} style={{ padding: '4px 8px', color: '#B91C1C' }} title="Excluir">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  // ======================= EDITOR =======================
  return (
    <div style={{ padding: '1.5rem', height: 'calc(100dvh - 90px)', display: 'flex', flexDirection: 'column' }}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button type="button" className="btn btn-ghost" onClick={backToList} style={{ padding: '6px 10px' }}>
              <ArrowLeft size={16} /> Voltar
            </button>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
              {draft?.id ? 'Editar modelo de e-mail' : 'Novo modelo de e-mail'}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />} Salvar Modelo
          </button>
        </div>

        {banner}

        <div className="form-grid form-grid-2" style={{ marginBottom: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Nome do Modelo</label>
            <input
              type="text"
              className="form-control"
              value={draft?.name || ''}
              placeholder="Ex.: Boas-vindas ao parceiro"
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Assunto</label>
            <input
              type="text"
              className="form-control"
              value={draft?.subject || ''}
              onChange={(e) => setDraft((prev) => ({ ...(prev || {}), subject: e.target.value }))}
            />
          </div>
        </div>

        {/* Linha 1: editor (largo) + painel de tags (alto) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1rem', flex: 1.3, minHeight: 0 }}>
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: 0 }}>
            <label className="form-label">Corpo do E-mail</label>
            <RichTextEditor
              value={draft?.body || ''}
              onChange={(html) => setDraft((prev) => ({ ...(prev || {}), body: html }))}
              onReady={(handle) => { editorHandleRef.current = handle }}
            />
          </div>
          <TemplateTokenPanel onInsert={insertTag} globalTags={GLOBAL_TAGS} usedTokens={usedTags} />
        </div>

        {/* Linha 2: preview grande (ocupa a largura toda) */}
        <div className="card" style={{ marginTop: '1rem', padding: 0, border: '1px solid var(--brs-gray-200)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 180, overflow: 'hidden' }}>
          <div style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid var(--brs-gray-100)', background: 'var(--brs-gray-50)' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)' }}>Preview (dados fake)</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--brs-gray-800)', marginTop: 2 }}>
              <strong>Assunto:</strong> {previewSubject || '—'}
            </div>
          </div>
          <div
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', background: '#fff', fontSize: '0.92rem', color: 'var(--brs-gray-800)', lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: previewBody || '<span style="color:#9ca3af">Corpo vazio</span>' }}
          />
        </div>
      </form>
    </div>
  )
}
