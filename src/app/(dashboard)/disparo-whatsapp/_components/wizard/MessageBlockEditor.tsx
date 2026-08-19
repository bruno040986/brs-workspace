'use client'

import { useMemo, useRef, useState } from 'react'
import { Bold, Italic, Strikethrough, Code, Underline, Trash2, Copy, FileDown, User } from 'lucide-react'
import EmojiPicker from '@/app/(dashboard)/rh/parceiros/config/_components/EmojiPicker'
import VariablePanel from '@/components/whatsapp/VariablePanel'
import WhatsappPreview from '@/components/whatsapp/WhatsappPreview'
import { extractUsedTags, fillPreviewVariables, insertAtSelection, wrapSelectionWith } from '@/components/whatsapp/whatsapp-format'
import { formatBrPhone, normalizeBrPhone } from '@/lib/zapi/phone'
import MediaAttach from './MediaAttach'
import type { WizardBlock } from './wizard-types'

const MAX_CAPTION = 1024

export default function MessageBlockEditor({
  index, block, variables, sampleVars, scpTemplates, canRemove, onChange, onRemove, onDuplicate,
}: {
  index: number
  block: WizardBlock
  variables: string[]
  sampleVars: Record<string, string>
  scpTemplates: Array<{ id: string; name: string; body: string }>
  canRemove: boolean
  onChange: (p: Partial<WizardBlock>) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [contactOpen, setContactOpen] = useState(!!block.contact)
  const usedTags = useMemo(() => extractUsedTags(block.body), [block.body])
  const preview = useMemo(() => fillPreviewVariables(block.body, sampleVars), [block.body, sampleVars])

  function focusAt(pos: number, end?: number) {
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(pos, end ?? pos)
    }, 30)
  }
  function insert(text: string) {
    const r = insertAtSelection(textareaRef.current, block.body, text)
    onChange({ body: r.value })
    focusAt(r.caret)
  }
  function wrap(marker: string) {
    const r = wrapSelectionWith(textareaRef.current, block.body, marker)
    onChange({ body: r.value })
    focusAt(r.selStart, r.selEnd)
  }

  const captionTooLong = !!block.media && block.media.type !== 'audio' && block.body.length > MAX_CAPTION

  return (
    <div className="card" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)' }}>Bloco {index + 1}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {scpTemplates.length > 0 && (
            <select className="form-control" style={{ width: 220, padding: '4px 8px', fontSize: '0.8rem' }} defaultValue="" onChange={(e) => { const t = scpTemplates.find((x) => x.id === e.target.value); if (t) onChange({ body: t.body }); e.target.value = '' }}>
              <option value="">Importar modelo do SCP…</option>
              {scpTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate} title="Duplicar bloco"><Copy size={14} /></button>
          {canRemove && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} title="Remover bloco" style={{ color: '#b91c1c' }}><Trash2 size={14} /></button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(280px, 1fr)', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.6rem', alignContent: 'start' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => wrap('*')} title="Negrito (*texto*)"><Bold size={14} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => wrap('_')} title="Itálico (_texto_)"><Italic size={14} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => wrap('~')} title="Tachado (~texto~)"><Strikethrough size={14} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => wrap('```')} title="Monoespaçado (```texto```)"><Code size={14} /></button>
            <span title="O WhatsApp não suporta sublinhado" style={{ display: 'inline-flex' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}><Underline size={14} /></button>
            </span>
            <EmojiPicker onPick={insert} />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '0.72rem', color: captionTooLong ? '#b91c1c' : 'var(--brs-gray-400)' }}>{block.body.length} caracteres{block.media && block.media.type !== 'audio' ? ` (legenda máx. ${MAX_CAPTION})` : ''}</span>
          </div>

          <textarea
            ref={textareaRef}
            className="form-control"
            rows={9}
            value={block.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={'Olá *{{nome}}*, tudo bem? 👋\n\nDigite aqui a mensagem deste bloco…'}
            style={{ fontFamily: 'inherit', resize: 'vertical', minHeight: 160 }}
          />

          <VariablePanel variables={variables} usedTokens={usedTags} onInsert={insert} />

          <MediaAttach media={block.media} onChange={(media) => onChange({ media })} />

          <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={contactOpen} onChange={(e) => { setContactOpen(e.target.checked); if (!e.target.checked) onChange({ contact: null }) }} />
              <User size={14} /> Enviar cartão de contato (o destinatário pode salvar com um toque)
            </label>
            {contactOpen && (
              <div className="form-grid form-grid-3" style={{ marginTop: 8 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Nome do contato</label>
                  <input className="form-control" value={block.contact?.name || ''} onChange={(e) => onChange({ contact: { name: e.target.value, phone: block.contact?.phone || '', description: block.contact?.description } })} placeholder="BRS Promotora – Comercial" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Telefone</label>
                  <input className="form-control" value={block.contact?.phone || ''} onChange={(e) => onChange({ contact: { name: block.contact?.name || '', phone: e.target.value, description: block.contact?.description } })} placeholder="(11) 99999-9999" />
                  {block.contact?.phone && !normalizeBrPhone(block.contact.phone) && <div className="form-hint" style={{ color: '#b91c1c' }}>Telefone inválido</div>}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Descrição (opcional)</label>
                  <input className="form-control" value={block.contact?.description || ''} onChange={(e) => onChange({ contact: { name: block.contact?.name || '', phone: block.contact?.phone || '', description: e.target.value } })} placeholder="Atendimento ao parceiro" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileDown size={12} /> Preview (dados do 1º destinatário)
          </div>
          <div style={{ position: 'sticky', top: 12 }}>
            <WhatsappPreview
              body={preview}
              media={block.media ? { type: block.media.type, url: block.media.preview_url, file_name: block.media.file_name, size: block.media.size } : null}
              contact={block.contact?.name ? { name: block.contact.name, phone: formatBrPhone(normalizeBrPhone(block.contact.phone) || '') || block.contact.phone, description: block.contact.description } : null}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
