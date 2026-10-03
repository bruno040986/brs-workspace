'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Power, QrCode, RefreshCw, Send } from 'lucide-react'
import {
  conectarInstanciaPromocao,
  criarInstanciaPromocao,
  desconectarInstanciaPromocao,
  enviarTestePromocao,
  statusInstanciaPromocao,
  type InstanciaPromocaoView,
} from '@/lib/promocoes/instancia-actions'

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null

export default function InstanciaCard({ slug, inicial, podeEditar }: { slug: string; inicial: InstanciaPromocaoView | null; podeEditar: boolean }) {
  const [inst, setInst] = useState<InstanciaPromocaoView | null>(inicial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [telefone, setTelefone] = useState('')

  const conectada = inst?.status === 'conectada'
  const aguardando = inst?.status === 'aguardando_qr' || inst?.status === 'conectando'

  const atualizar = useCallback(async () => {
    const r = await statusInstanciaPromocao(slug)
    if (r.ok) setInst(r.instancia)
  }, [slug])

  useEffect(() => {
    if (!aguardando) return
    const t = setInterval(atualizar, 3000)
    return () => clearInterval(t)
  }, [aguardando, atualizar])

  async function rodar(fn: () => Promise<{ ok: true; instancia: InstanciaPromocaoView | null } | { ok: false; error: string }>) {
    setBusy(true)
    setMsg(null)
    const r = await fn()
    if (r.ok) setInst(r.instancia)
    else setMsg({ tipo: 'erro', texto: r.error })
    setBusy(false)
  }

  async function testar() {
    setBusy(true)
    setMsg(null)
    const r = await enviarTestePromocao(slug, telefone)
    if (!r.ok) setMsg({ tipo: 'erro', texto: r.error })
    else if (r.envio.resultado === 'confirmado') setMsg({ tipo: 'ok', texto: 'Mensagem de teste enviada.' })
    else if (r.envio.resultado === 'incerto') setMsg({ tipo: 'erro', texto: `Envio sem confirmação (pode ter saído): ${r.envio.mensagem}` })
    else setMsg({ tipo: 'erro', texto: `Não enviado: ${r.envio.mensagem}` })
    setBusy(false)
  }

  return (
    <section className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <strong>WhatsApp da promoção (instância exclusiva NuAzul)</strong>
        <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
          Só mensagens transacionais: código de confirmação, comprovantes, link de números e aviso de pagamento. Não interfere nas instâncias dos parceiros.
        </div>
      </div>

      {!inst && podeEditar && (
        <div>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => rodar(() => criarInstanciaPromocao(slug))}>
            {busy ? <Loader2 size={14} className="spinner" /> : <QrCode size={14} />} Criar instância e gerar QR
          </button>
        </div>
      )}
      {!inst && !podeEditar && <div style={{ fontSize: 13 }}>Nenhuma instância criada.</div>}

      {inst && (
        <>
          <div style={{ fontSize: 13 }}>
            Status: <strong>{inst.status}</strong>
            {inst.numero ? ` · número ${inst.numero}` : ''}
          </div>
          {inst.status === 'aguardando_qr' && inst.ultimo_qr && (
            <div style={{ textAlign: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={inst.ultimo_qr} alt="QR Code" style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--color-line)' }} />
              <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)', marginTop: 4 }}>
                WhatsApp → Dispositivos conectados → Conectar dispositivo. O código renova sozinho.
              </div>
            </div>
          )}
          {inst.status === 'conectando' && !inst.ultimo_qr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <Loader2 size={16} className="spinner" /> Iniciando sessão…
            </div>
          )}
          {inst.ultimo_erro && <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)', wordBreak: 'break-all' }}>{inst.ultimo_erro}</div>}

          {podeEditar && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {conectada ? (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => rodar(() => desconectarInstanciaPromocao(slug))}>
                  <Power size={14} /> Desconectar
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => rodar(() => conectarInstanciaPromocao(slug))}>
                  {busy ? <Loader2 size={14} className="spinner" /> : <QrCode size={14} />} {inst.status === 'aguardando_qr' ? 'Novo QR' : 'Conectar'}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={atualizar} title="Atualizar status">
                <RefreshCw size={14} />
              </button>
            </div>
          )}

          {podeEditar && conectada && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Seu WhatsApp com DDD" style={{ maxWidth: 220 }} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy || telefone.replace(/\D/g, '').length < 10} onClick={testar}>
                <Send size={14} /> Enviar teste para meu número
              </button>
            </div>
          )}
        </>
      )}

      {msg && <div style={{ fontSize: 13, color: msg.tipo === 'erro' ? 'var(--color-danger)' : 'var(--color-success, inherit)' }}>{msg.texto}</div>}
    </section>
  )
}
