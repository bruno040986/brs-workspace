'use client'

import { useState } from 'react'
import { publicarStatusWhatsapp } from '@/lib/central-conversas/actions'

/** Publicar status (B6): só número de disparo aquecido, até 3/dia — o servidor confere tudo; aqui só mostra o resultado real. */
export default function PublicarStatus({ instanciaId, nome, onFechar }: { instanciaId: string; nome: string; onFechar: () => void }) {
  const [texto, setTexto] = useState('')
  const [imagem, setImagem] = useState<File | null>(null)
  const [legenda, setLegenda] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function publicar() {
    setMsg(null)
    if (!window.confirm(`Publicar este status pelo número "${nome}"? Ele fica visível para quem já conversou com esse número. Máximo de 3 por dia.`)) return
    setEnviando(true)
    try {
      const imagemBase64 = imagem ? await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Não foi possível ler a imagem.')); r.readAsDataURL(imagem) }) : undefined
      const r = await publicarStatusWhatsapp(instanciaId, imagemBase64 ? { imagemBase64, legenda } : { texto })
      setMsg(r.ok ? { ok: true, texto: `Publicado para ${r.destinatarios} contatos. Restam ${r.restantesHoje} hoje.` } : { ok: false, texto: r.error })
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : 'Falha ao publicar.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 500 }}>
      <div className="card" style={{ width: 420, maxWidth: '92vw', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Publicar status — {nome}</div>
        <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
          Só número de disparo já aquecido (48 h), no máximo 3 por dia, sem agendamento. Cada publicação fica registrada no histórico do número.
        </div>
        <textarea className="input" rows={4} maxLength={700} placeholder="Texto do status" value={texto} disabled={Boolean(imagem)} onChange={(e) => setTexto(e.target.value)} />
        <div style={{ fontSize: 12 }}>ou uma imagem:</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImagem(e.target.files?.[0] ?? null)} />
        {imagem && <input className="input" maxLength={700} placeholder="Legenda (opcional)" value={legenda} onChange={(e) => setLegenda(e.target.value)} />}
        {msg && <div style={{ fontSize: 12.5, color: msg.ok ? 'var(--color-success, #16a34a)' : 'var(--color-danger)' }}>{msg.texto}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onFechar} disabled={enviando}>Fechar</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void publicar()} disabled={enviando || (!texto.trim() && !imagem)}>{enviando ? 'Publicando…' : 'Publicar'}</button>
        </div>
      </div>
    </div>
  )
}
