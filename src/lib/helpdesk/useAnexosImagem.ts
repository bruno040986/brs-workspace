'use client'

/**
 * Anexos de imagem do formulário do HelpDesk: colar (Ctrl+V), escolher
 * arquivo ou arrastar e soltar. Cada imagem sobe na hora para a mesma rota
 * do chat (/api/chat/upload, bucket privado workspace-chat) — o ticket só
 * guarda o path devolvido. Miniatura local via object URL até fechar.
 */
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { HELPDESK_IMAGEM_MIME, HELPDESK_MAX_ANEXOS, type HelpdeskAnexoEntrada } from './tipos'

const MAX_BYTES = 15 * 1024 * 1024

export type AnexoLocal = {
  id: string
  nome: string
  preview: string
  status: 'enviando' | 'ok' | 'erro'
  erro?: string
  enviado?: HelpdeskAnexoEntrada
}

export function useAnexosImagem() {
  const [anexos, setAnexos] = useState<AnexoLocal[]>([])
  const [aviso, setAviso] = useState('')
  const previews = useRef<string[]>([])

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function atualizar(id: string, patch: Partial<AnexoLocal>) {
    setAnexos((lista) => lista.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  async function enviar(id: string, file: File) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/chat/upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.path) throw new Error(json.error || 'Falha no upload.')
      atualizar(id, { status: 'ok', enviado: { path: json.path, name: json.name, size: json.size, type: json.type } })
    } catch (err) {
      atualizar(id, { status: 'erro', erro: err instanceof Error ? err.message : 'Falha no upload.' })
    }
  }

  function adicionar(files: Iterable<File> | null | undefined) {
    setAviso('')
    const imagens = [...(files || [])].filter((f) => HELPDESK_IMAGEM_MIME.includes(f.type))
    const recusadas = [...(files || [])].length - imagens.length
    const vagas = HELPDESK_MAX_ANEXOS - anexos.length
    if (recusadas) setAviso('Só imagens (PNG, JPEG, GIF ou WebP).')
    if (imagens.length > vagas) setAviso(`No máximo ${HELPDESK_MAX_ANEXOS} imagens por ticket.`)
    for (const file of imagens.slice(0, Math.max(0, vagas))) {
      if (file.size > MAX_BYTES) {
        setAviso(`"${file.name}" passa de 15MB.`)
        continue
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const preview = URL.createObjectURL(file)
      previews.current.push(preview)
      setAnexos((lista) => [...lista, { id, nome: file.name || 'imagem colada', preview, status: 'enviando' }])
      void enviar(id, file)
    }
  }

  function remover(id: string) {
    setAnexos((lista) => lista.filter((a) => a.id !== id))
  }

  /** onPaste do formulário: só intercepta quando o clipboard traz imagem (texto cola normal). */
  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files || [])]
    if (!files.some((f) => f.type.startsWith('image/'))) return
    e.preventDefault()
    adicionar(files)
  }

  return {
    anexos,
    aviso,
    adicionar,
    remover,
    onPaste,
    enviando: anexos.some((a) => a.status === 'enviando'),
    comErro: anexos.some((a) => a.status === 'erro'),
    prontos: anexos.flatMap((a) => (a.enviado ? [a.enviado] : [])),
  }
}
