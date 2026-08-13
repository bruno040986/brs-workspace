'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Heading2,
  Undo2,
  Redo2,
  Unlink,
} from 'lucide-react'

/**
 * Editor de texto rico (TipTap) para modelos de e-mail do SCP.
 *
 * Saída: HTML (persistido em `email_templates.body`). Nativo React 19 — sem
 * `findDOMNode` (o `react-quill` clássico quebraria). `immediatelyRender: false`
 * evita mismatch de hidratação no App Router.
 *
 * `insertToken` é exposto via ref-callback (`onReady`) para o pai inserir
 * placeholders `{{...}}` na posição do cursor.
 */

export type RichTextHandle = {
  insertText: (text: string) => void
}

const btnStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 6,
  border: '1px solid var(--brs-gray-200)',
  background: active ? 'var(--brs-navy)' : '#fff',
  color: active ? '#fff' : 'var(--brs-gray-700)',
  cursor: 'pointer',
})

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL do link:', previous || 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  function addImage() {
    const url = window.prompt('URL da imagem (ex.: logo do cabeçalho/rodapé):', 'https://')
    if (url && url.trim() !== '') {
      editor.chain().focus().setImage({ src: url.trim() }).run()
    }
  }

  const B = ({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} onClick={onClick} style={btnStyle(!!active)}>
      {children}
    </button>
  )

  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', padding: '0.4rem', borderBottom: '1px solid var(--brs-gray-200)', background: 'var(--brs-gray-50)' }}>
      <B title="Negrito" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><BoldIcon size={16} /></B>
      <B title="Itálico" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><ItalicIcon size={16} /></B>
      <B title="Tachado" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></B>
      <B title="Título" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></B>
      <span style={{ width: 1, background: 'var(--brs-gray-200)', margin: '0 0.15rem' }} />
      <B title="Lista com marcadores" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></B>
      <B title="Lista numerada" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></B>
      <span style={{ width: 1, background: 'var(--brs-gray-200)', margin: '0 0.15rem' }} />
      <B title="Inserir/editar link" active={editor.isActive('link')} onClick={setLink}><LinkIcon size={16} /></B>
      <B title="Remover link" onClick={() => editor.chain().focus().unsetLink().run()}><Unlink size={16} /></B>
      <B title="Inserir imagem (URL)" onClick={addImage}><ImageIcon size={16} /></B>
      <span style={{ width: 1, background: 'var(--brs-gray-200)', margin: '0 0.15rem' }} />
      <B title="Desfazer" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></B>
      <B title="Refazer" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></B>
    </div>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  onReady,
}: {
  value: string
  onChange: (html: string) => void
  onReady?: (handle: RichTextHandle) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Expõe a inserção de placeholders ao pai.
  useEffect(() => {
    if (editor && onReady) {
      onReady({
        insertText: (text: string) => editor.chain().focus().insertContent(text).run(),
      })
    }
  }, [editor, onReady])

  // Sincroniza quando o pai troca de modelo selecionado (fonte externa).
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ''
    if (next !== current) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  if (!editor) {
    return (
      <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--brs-gray-200)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brs-gray-400)' }}>
        Carregando editor…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--brs-gray-200)', borderRadius: 8, overflow: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .brs-rte .ProseMirror { padding: 0.75rem 0.9rem; min-height: 100%; outline: none; font-size: 0.9rem; line-height: 1.5; color: var(--brs-gray-800); }
        .brs-rte .ProseMirror p { margin: 0 0 0.6rem; }
        .brs-rte .ProseMirror h2 { font-size: 1.15rem; font-weight: 800; margin: 0.4rem 0 0.6rem; }
        .brs-rte .ProseMirror ul, .brs-rte .ProseMirror ol { padding-left: 1.4rem; margin: 0 0 0.6rem; }
        .brs-rte .ProseMirror a { color: #2563EB; text-decoration: underline; }
        .brs-rte .ProseMirror img { max-width: 100%; height: auto; border-radius: 4px; }
        .brs-rte .ProseMirror:focus { outline: none; }
      ` }} />
      <Toolbar editor={editor} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#fff' }}>
        <EditorContent editor={editor} className="brs-rte" />
      </div>
    </div>
  )
}
