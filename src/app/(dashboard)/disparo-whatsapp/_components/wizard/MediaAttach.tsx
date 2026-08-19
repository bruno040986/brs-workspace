'use client'

import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, FileText, Mic, Square, Upload, Trash2, Loader2, Music } from 'lucide-react'
import type { CampaignMedia } from '@/lib/disparo-whatsapp'

async function uploadFile(file: File | Blob, name: string): Promise<CampaignMedia> {
  const fd = new FormData()
  fd.append('file', file, name)
  const res = await fetch('/api/disparo-whatsapp/upload', { method: 'POST', body: fd })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Falha no upload.')
  return json as CampaignMedia
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || ''
}

export default function MediaAttach({ media, onChange }: { media: CampaignMedia | null; onChange: (m: CampaignMedia | null) => void }) {
  const imgRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const audRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  async function handle(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      onChange(await uploadFile(file, file.name))
    } catch (err: any) {
      setError(err?.message || 'Falha no upload.')
    }
    setUploading(false)
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickRecorderMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        setRecording(false)
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0]
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunksRef.current, { type })
        if (blob.size < 500) { setError('Gravação vazia.'); return }
        setUploading(true)
        try {
          onChange(await uploadFile(blob, `audio-${Date.now()}.${ext}`))
        } catch (err: any) {
          setError(err?.message || 'Falha no upload do áudio.')
        }
        setUploading(false)
      }
      recorderRef.current = rec
      rec.start(250)
      setSeconds(0)
      setRecording(true)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err: any) {
      setError('Não foi possível acessar o microfone: ' + (err?.message || err))
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.75rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 6 }}>Mídia (opcional)</div>
      {media ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {media.type === 'image' && media.preview_url && <img src={media.preview_url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />}
          {media.type === 'document' && <FileText size={28} style={{ color: '#D14545' }} />}
          {media.type === 'audio' && <Music size={28} style={{ color: '#25D366' }} />}
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.file_name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>{media.type === 'image' ? 'Imagem' : media.type === 'document' ? 'Documento' : 'Áudio'} · {(media.size / 1024).toFixed(0)} KB · {media.mime}</div>
            {media.type === 'audio' && media.preview_url && <audio controls src={media.preview_url} style={{ height: 30, marginTop: 4, maxWidth: '100%' }} />}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => onChange(null)}><Trash2 size={14} /> Remover</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={uploading || recording} onClick={() => imgRef.current?.click()}><ImageIcon size={14} /> Imagem</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={uploading || recording} onClick={() => docRef.current?.click()}><FileText size={14} /> Documento</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={uploading || recording} onClick={() => audRef.current?.click()}><Upload size={14} /> Áudio (arquivo)</button>
          {!recording ? (
            <button type="button" className="btn btn-outline btn-sm" disabled={uploading} onClick={startRecording}><Mic size={14} /> Gravar áudio</button>
          ) : (
            <button type="button" className="btn btn-danger btn-sm" onClick={stopRecording}><Square size={14} /> Parar ({seconds}s)</button>
          )}
          {uploading && <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Loader2 size={12} className="spinner" /> Enviando…</span>}
          <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }} />
          <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" style={{ display: 'none' }} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }} />
          <input ref={audRef} type="file" accept="audio/*,.mp3,.ogg,.m4a,.wav" style={{ display: 'none' }} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
      {error && <div style={{ fontSize: '0.78rem', color: '#b91c1c', marginTop: 6 }}>{error}</div>}
      <div className="form-hint" style={{ marginTop: 6 }}>Imagem/documento: o texto do bloco vai como legenda. Áudio: o texto vai antes, o áudio em seguida (como mensagem de voz). Máx. 15 MB.</div>
    </div>
  )
}
