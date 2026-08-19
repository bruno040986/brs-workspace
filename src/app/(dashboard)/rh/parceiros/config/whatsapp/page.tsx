'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getWhatsappTemplates,
  saveWhatsappTemplate,
  toggleWhatsappTemplateActive,
  deleteWhatsappTemplate,
} from '../../actions'
import {
  MessageSquare, Plus, Edit2, Save, Loader2, CheckCircle, AlertCircle,
  ArrowLeft, Trash2, Power, PowerOff,
} from 'lucide-react'
import TemplateTokenPanel, { type GlobalTag } from '../_components/TemplateTokenPanel'
import EmojiPicker from '../_components/EmojiPicker'
import { renderWhatsappHtml } from '@/components/whatsapp/whatsapp-format'

interface TemplateItem {
  id: string
  name: string
  body: string
  is_active?: boolean
}

const GLOBAL_TAGS: GlobalTag[] = [
  { tag: '{{assinatura.link}}', label: 'Link de assinatura (Assinafy)' },
  { tag: '{{processo.id}}', label: 'ID do processo (instância)' },
]

// Formatação do WhatsApp → HTML seguro: compartilhada com o Disparo de WhatsApp.
const renderWhatsapp = renderWhatsappHtml

export default function WhatsappTemplatesPage() {
  const [items, setItems] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<Partial<TemplateItem> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const usedTags = useMemo(
    () => Array.from(new Set(String(draft?.body || '').match(/\{\{[^}]+\}\}/g) || [])),
    [draft?.body],
  )
  const previewBody = useMemo(() => {
    const fakeData: Record<string, string> = {
      '{{assinatura.link}}': 'https://assinafy.exemplo/link/abc123',
      '{{processo.id}}': 'PROC-000123',
    }
    return String(draft?.body || '').replace(/\{\{[^}]+\}\}/g, (tag) => fakeData[tag] || `[${tag}]`)
  }, [draft?.body])

  async function loadData() {
    setLoading(true)
    const res = await getWhatsappTemplates()
    if (res.success && res.templates) {
      setItems(res.templates as any)
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao carregar os modelos.' })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  function openNew() {
    setDraft({ name: '', body: '' })
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
    setMessage(null)
  }

  async function toggleActive(item: TemplateItem) {
    setBusyId(item.id)
    const next = !(item.is_active ?? true)
    const res = await toggleWhatsappTemplateActive(item.id, next)
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
    const res = await deleteWhatsappTemplate(item.id)
    if (res.success) {
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      setMessage({ type: 'success', text: 'Modelo excluído.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao excluir.' })
    }
    setBusyId(null)
  }

  function insertText(text: string) {
    const textarea = textareaRef.current
    if (!draft) return
    if (!textarea) {
      setDraft({ ...draft, body: (draft.body || '') + text })
      return
    }
    const s = textarea.selectionStart
    const e = textarea.selectionEnd
    const body = draft.body || ''
    const newText = body.substring(0, s) + text + body.substring(e)
    setDraft({ ...draft, body: newText })
    setTimeout(() => {
      textarea.focus()
      const pos = s + text.length
      textarea.setSelectionRange(pos, pos)
    }, 40)
  }

  /** Envolve a seleção com um marcador de formatação do WhatsApp (*, _, ~, ```). */
  function wrapSelection(marker: string) {
    const textarea = textareaRef.current
    if (!textarea || !draft) return
    const s = textarea.selectionStart
    const e = textarea.selectionEnd
    const body = draft.body || ''
    const sel = body.substring(s, e) || 'texto'
    const newText = body.substring(0, s) + marker + sel + marker + body.substring(e)
    setDraft({ ...draft, body: newText })
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(s + marker.length, s + marker.length + sel.length)
    }, 40)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!draft?.name?.trim() || !draft.body?.trim()) {
      setMessage({ type: 'error', text: 'Nome e corpo do modelo são obrigatórios.' })
      return
    }
    setSaving(true)
    setMessage(null)
    const res = await saveWhatsappTemplate({ id: draft.id, name: draft.name.trim(), body: draft.body })
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
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>Modelos de WhatsApp (SCP)</div>
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
              <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', color: 'var(--brs-gray-300)' }} />
              Nenhum modelo cadastrado. Clique em <strong>Novo Modelo</strong> para começar.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--brs-gray-50)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)', fontWeight: 700 }}>Modelo</th>
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
                          <MessageSquare size={16} style={{ color: '#25D366' }} />
                          <span style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>{item.name}</span>
                        </div>
                      </td>
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
              {draft?.id ? 'Editar modelo de WhatsApp' : 'Novo modelo de WhatsApp'}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />} Salvar Modelo
          </button>
        </div>

        {banner}

        <div className="form-group" style={{ marginBottom: '0.75rem' }}>
          <label className="form-label">Nome do Modelo</label>
          <input
            type="text"
            className="form-control"
            value={draft?.name || ''}
            placeholder="Ex.: Envio de link de assinatura"
            onChange={(e) => setDraft((prev) => ({ ...(prev || {}), name: e.target.value }))}
          />
        </div>

        {/* Duas colunas: editor (larga) + painel de tags (alto) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1rem', flex: 1, minHeight: 0 }}>
          {/* Coluna editor */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: '0.75rem' }}>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, marginBottom: 0 }}>
              <label className="form-label">Mensagem</label>
              {/* Barra de formatação em uma linha */}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <button type="button" className="btn btn-outline" title="Negrito (*texto*)" style={{ fontWeight: 800, padding: '2px 10px' }} onClick={() => wrapSelection('*')}>B</button>
                <button type="button" className="btn btn-outline" title="Itálico (_texto_)" style={{ fontStyle: 'italic', padding: '2px 10px' }} onClick={() => wrapSelection('_')}>I</button>
                <button type="button" className="btn btn-outline" title="Tachado (~texto~)" style={{ textDecoration: 'line-through', padding: '2px 10px' }} onClick={() => wrapSelection('~')}>S</button>
                <button type="button" className="btn btn-outline" title="Monoespaçado (```texto```)" style={{ fontFamily: 'monospace', padding: '2px 10px' }} onClick={() => wrapSelection('```')}>{'</>'}</button>
                <span style={{ width: 1, background: 'var(--brs-gray-200)', margin: '0 0.15rem' }} />
                <EmojiPicker onPick={(emo) => insertText(emo)} />
              </div>
              <textarea
                ref={textareaRef}
                className="form-control"
                style={{ flex: 1, minHeight: 180, resize: 'none' }}
                value={draft?.body || ''}
                placeholder="Escreva a mensagem. Use a barra acima para formatar e o painel ao lado para inserir campos do dicionário."
                onChange={(e) => setDraft((prev) => ({ ...(prev || {}), body: e.target.value }))}
              />
              <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
                Formatação do WhatsApp: *negrito*, _itálico_, ~tachado~, ```monoespaçado``` e emojis.
              </div>
            </div>

            {/* Preview em balão (mantém tamanho compacto) */}
            <div className="card" style={{ padding: '0.75rem', border: '1px solid var(--brs-gray-100)', background: '#E5DDD5' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.5rem', color: 'var(--brs-gray-700)' }}>Preview (dados fake)</div>
              <div style={{ display: 'flex' }}>
                <div
                  style={{
                    position: 'relative', background: '#DCF8C6', borderRadius: 8,
                    padding: '0.5rem 0.65rem 1.1rem', maxWidth: '85%', fontSize: '0.85rem',
                    lineHeight: 1.4, color: '#111', boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)', wordBreak: 'break-word',
                  }}
                >
                  <div dangerouslySetInnerHTML={{ __html: renderWhatsapp(previewBody) || '<span style="color:#667781">Mensagem vazia</span>' }} />
                  <span style={{ position: 'absolute', right: 8, bottom: 4, fontSize: '0.65rem', color: '#667781' }}>12:34 ✓✓</span>
                </div>
              </div>
            </div>
          </div>

          {/* Coluna painel de tags (dicionário completo) */}
          <TemplateTokenPanel onInsert={insertText} globalTags={GLOBAL_TAGS} usedTokens={usedTags} />
        </div>
      </form>
    </div>
  )
}
