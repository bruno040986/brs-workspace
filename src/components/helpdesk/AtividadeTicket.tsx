'use client'

/**
 * Linha do tempo do ticket no modal de detalhe: mudanças de status, de
 * responsável e de etapa (helpdesk_historico, gravado por trigger) e
 * comentários (com imagens) intercalados por data, campo de comentário e o
 * "Reabrir" (solicitante ou aprovador).
 */
import { useCallback, useEffect, useState } from 'react'
import { Bot, ImagePlus, Loader2, RotateCcw, Send, X } from 'lucide-react'
import { comentarHelpdeskTicket, listarHelpdeskAtividade, reabrirHelpdeskTicket } from '@/lib/helpdesk/actions'
import type { HelpdeskComentario, HelpdeskHistorico, HelpdeskStatus, HelpdeskTicket } from '@/lib/helpdesk/tipos'
import { useAnexosImagem } from '@/lib/helpdesk/useAnexosImagem'
import { HELPDESK_MAX_COMENTARIO, HELPDESK_MAX_MOTIVO, podeReabrir } from '@/lib/helpdesk/validacao'

const STATUS_LABEL: Record<HelpdeskStatus, string> = {
  aberto: 'Aberto',
  plano_proposto: 'Plano proposto',
  aprovado: 'Aprovado',
  em_execucao: 'Em execução',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado',
}

type Item = { at: string; h?: HelpdeskHistorico; c?: HelpdeskComentario }

const dataFmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function textoEvento(h: HelpdeskHistorico): string {
  if (h.evento) return h.detalhe || h.evento
  if (!h.de) return h.para === 'aberto' ? 'Ticket aberto' : `Status: ${STATUS_LABEL[h.para] || h.para}`
  if (h.para === 'aberto' && (h.de === 'concluido' || h.de === 'rejeitado')) return 'Ticket reaberto'
  return `${STATUS_LABEL[h.de] || h.de} → ${STATUS_LABEL[h.para] || h.para}`
}

export default function AtividadeTicket({
  ticket,
  meuId,
  podeAprovar,
  onReaberto,
}: {
  ticket: HelpdeskTicket
  meuId: string
  podeAprovar: boolean
  onReaberto: () => void
}) {
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [reabrindo, setReabrindo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const imagens = useAnexosImagem()

  const carregar = useCallback(async () => {
    const res = await listarHelpdeskAtividade(ticket.id)
    if (!res.success) {
      setErro(res.error || 'Erro ao carregar a atividade.')
    } else {
      const lista: Item[] = [
        ...(res.historico || []).map((h) => ({ at: h.created_at, h })),
        ...(res.comentarios || []).map((c) => ({ at: c.created_at, c })),
      ]
      lista.sort((a, b) => a.at.localeCompare(b.at))
      setItens(lista)
    }
    setCarregando(false)
  }, [ticket.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga ao abrir o detalhe
    void carregar()
  }, [carregar])

  async function comentar() {
    if (enviando || !texto.trim()) return
    if (imagens.enviando) return setErro('Aguarde o envio das imagens.')
    if (imagens.comErro) return setErro('Remova as imagens que falharam.')
    setEnviando(true)
    setErro('')
    const res = await comentarHelpdeskTicket(ticket.id, texto, imagens.prontos)
    if (res.success) {
      setTexto('')
      imagens.limpar()
      await carregar()
    } else setErro(res.error || 'Erro ao comentar.')
    setEnviando(false)
  }

  async function reabrir() {
    if (enviando) return
    setEnviando(true)
    setErro('')
    const res = await reabrirHelpdeskTicket(ticket.id, motivo)
    setEnviando(false)
    if (res.success) onReaberto()
    else setErro(res.error || 'Erro ao reabrir.')
  }

  return (
    <div style={{ borderTop: '1px solid var(--brs-gray-200)', marginTop: '1rem', paddingTop: '0.8rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brs-gray-400)', marginBottom: '0.5rem' }}>
        Atividade
      </div>

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>
          <Loader2 size={14} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {itens.map((it) =>
            it.h ? (
              <li key={`h-${it.h.id}`} style={{ fontSize: '0.74rem', color: 'var(--brs-gray-400)' }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--brs-gray-300, #cbd5e1)', marginRight: 6 }} />
                <strong>{textoEvento(it.h)}</strong> · {it.h.por_nome || (it.h.evento ? '' : 'Claude/sistema')}{it.h.por_nome || !it.h.evento ? ' · ' : ''}{dataFmt(it.at)}
                {(it.h.plano_anterior || it.h.solucao_anterior) && (
                  <details style={{ marginTop: 4, marginLeft: 13 }}>
                    <summary style={{ cursor: 'pointer' }}>Plano/solução do ciclo anterior</summary>
                    {it.h.plano_anterior && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}><strong>Plano:</strong> {it.h.plano_anterior}</div>}
                    {it.h.solucao_anterior && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}><strong>Solução:</strong> {it.h.solucao_anterior}</div>}
                  </details>
                )}
              </li>
            ) : it.c ? (
              <li key={`c-${it.c.id}`} className="card" style={{ padding: '0.55rem 0.7rem', background: it.c.autor_tipo === 'claude' ? 'var(--brs-gray-50)' : undefined }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {it.c.autor_tipo === 'claude' && <Bot size={12} aria-hidden />}
                  <strong style={{ color: 'inherit' }}>{it.c.autor_id === meuId ? 'Você' : it.c.autor_nome}</strong> · {dataFmt(it.at)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', lineHeight: 1.45 }}>{it.c.texto}</div>
                {it.c.anexos.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {it.c.anexos.map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${a.nome || 'imagem'}`} style={{ width: 72, height: 72, border: '1px solid var(--brs-gray-200)', borderRadius: 6, overflow: 'hidden', display: 'block' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado */}
                        <img src={a.url} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ) : null,
          )}
          {itens.length === 0 && <li style={{ fontSize: '0.74rem', color: 'var(--brs-gray-400)' }}>Sem atividade registrada.</li>}
        </ol>
      )}

      {erro && <div style={{ color: 'var(--brs-danger)', fontSize: '0.78rem', fontWeight: 600, marginTop: '0.6rem' }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: '0.7rem', alignItems: 'flex-end' }}>
        <textarea
          className="form-control"
          aria-label="Novo comentário"
          placeholder="Escreva um comentário…"
          rows={2}
          maxLength={HELPDESK_MAX_COMENTARIO}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={imagens.onPaste}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <label className="btn btn-outline" style={{ cursor: 'pointer' }} aria-label="Anexar imagem ao comentário" title="Anexar imagem (ou cole com Ctrl+V)">
          <ImagePlus size={14} />
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { imagens.adicionar(e.target.files); e.target.value = '' }} />
        </label>
        <button className="btn btn-primary" onClick={() => void comentar()} disabled={enviando || imagens.enviando || !texto.trim()} aria-label="Enviar comentário">
          <Send size={14} />
        </button>
      </div>
      {(imagens.anexos.length > 0 || imagens.aviso) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
          {imagens.anexos.map((a) => (
            <div key={a.id} title={a.erro || a.nome} style={{ position: 'relative', width: 56, height: 56, borderRadius: 6, overflow: 'hidden', border: `2px solid ${a.status === 'erro' ? 'var(--brs-danger)' : 'var(--brs-gray-200)'}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- object URL local */}
              <img src={a.preview} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: a.status === 'ok' ? 1 : 0.5 }} />
              {a.status === 'enviando' && <Loader2 size={14} className="animate-spin" aria-label="Enviando" style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}
              <button type="button" onClick={() => imagens.remover(a.id)} aria-label={`Remover ${a.nome}`} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.65)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <X size={11} />
              </button>
            </div>
          ))}
          {imagens.aviso && <span role="status" style={{ fontSize: '0.72rem', color: 'var(--brs-danger)' }}>{imagens.aviso}</span>}
        </div>
      )}

      {podeReabrir(ticket, meuId, podeAprovar) && (
        <div style={{ marginTop: '0.7rem' }}>
          {!reabrindo ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setReabrindo(true)}>
                <RotateCcw size={14} /> Reabrir
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                className="form-control"
                aria-label="Motivo da reabertura"
                placeholder="Por que o ticket deve ser reaberto? (obrigatório)"
                rows={2}
                maxLength={HELPDESK_MAX_MOTIVO}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setReabrindo(false)} disabled={enviando}>Cancelar</button>
                <button className="btn btn-primary" onClick={() => void reabrir()} disabled={enviando || !motivo.trim()}>
                  <RotateCcw size={14} /> Confirmar reabertura
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
