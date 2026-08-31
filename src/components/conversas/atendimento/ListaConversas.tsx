'use client'

import { useMemo, useState } from 'react'
import { Inbox, Loader2, MessageCircle, Plus, Search, Users, UsersRound } from 'lucide-react'
import type { AbaAtendimento } from './useAtendimento'
import { VINCULO_COR, VINCULO_LABEL, ehGrupo, horaCurta, iniciais, previaConversa, type ConversaAtendimento, type InboxAtendimento, type InstanciaAtendimento } from './types'

type Props = {
  aba: AbaAtendimento
  onAbaChange: (aba: AbaAtendimento) => void
  filaCount: number
  busca: string
  onBuscaChange: (v: string) => void
  canais: { inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[] }
  canalId: number | null
  onCanalChange: (id: number | null) => void
  conversas: ConversaAtendimento[]
  carregando: boolean
  disponivel: boolean
  selecionadaId: number | null
  onSelecionar: (c: ConversaAtendimento) => void
  onNovaConversa: (input: { instanciaId: string; telefone: string; texto: string }) => Promise<{ conversationId: number | null }>
}

const ABAS: Array<{ id: AbaAtendimento; rotulo: string; Icone: typeof MessageCircle }> = [
  { id: 'meus', rotulo: 'Meus', Icone: MessageCircle },
  { id: 'fila', rotulo: 'Fila', Icone: Inbox },
  { id: 'geral', rotulo: 'Geral', Icone: Users },
]

function nomeDoCanal(inboxId: number | undefined, canais: Props['canais']) {
  if (!inboxId) return null
  const instancia = canais.instancias.find((i) => i.inboxId === inboxId)
  if (instancia) return instancia.nome
  const inbox = canais.inboxes.find((i) => i.id === inboxId)
  return inbox?.nome || null
}

export default function ListaConversas({
  aba,
  onAbaChange,
  filaCount,
  busca,
  onBuscaChange,
  canais,
  canalId,
  onCanalChange,
  conversas,
  carregando,
  disponivel,
  selecionadaId,
  onSelecionar,
  onNovaConversa,
}: Props) {
  const [modalAberto, setModalAberto] = useState(false)

  const chipsCanal = useMemo(() => {
    const vistos = new Set<number>()
    const chips: Array<{ id: number; nome: string }> = []
    for (const i of canais.instancias) {
      if (i.inboxId && !vistos.has(i.inboxId)) {
        vistos.add(i.inboxId)
        chips.push({ id: i.inboxId, nome: i.nome })
      }
    }
    for (const i of canais.inboxes) {
      if (!vistos.has(i.id)) {
        vistos.add(i.id)
        chips.push({ id: i.id, nome: i.nome })
      }
    }
    return chips
  }, [canais])

  const listaOrdenada = useMemo(() => [...conversas].sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0)), [conversas])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: 'var(--msn-surface)' }}>
      <div style={{ padding: '0.6rem 0.6rem 0.4rem' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--msn-muted)' }} />
          <input
            className="brs-messenger-search-input"
            style={{ paddingLeft: 28 }}
            placeholder="Pesquisar por nome ou número…"
            value={busca}
            onChange={(e) => onBuscaChange(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', marginTop: 8, borderBottom: '1px solid var(--msn-soft-border)' }}>
          {ABAS.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              onClick={() => onAbaChange(id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${aba === id ? 'var(--msn-accent)' : 'transparent'}`,
                color: aba === id ? 'var(--msn-accent)' : 'var(--msn-muted)',
                fontWeight: 700,
                fontSize: 12.5,
                padding: '6px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                cursor: 'pointer',
              }}
            >
              <Icone size={13} /> {rotulo}
              {id === 'fila' && filaCount > 0 && (
                <span
                  style={{
                    background: 'var(--msn-accent)',
                    color: '#fff',
                    borderRadius: 99,
                    padding: '0 5px',
                    fontSize: 10,
                    fontWeight: 800,
                    minWidth: 15,
                    textAlign: 'center',
                  }}
                >
                  {filaCount}
                </span>
              )}
            </button>
          ))}
        </div>
        {chipsCanal.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              onClick={() => onCanalChange(null)}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: 99,
                border: `1px solid ${canalId === null ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
                background: canalId === null ? 'var(--msn-item-active)' : 'transparent',
                color: canalId === null ? 'var(--msn-accent)' : 'var(--msn-muted)',
                cursor: 'pointer',
              }}
            >
              Todos
            </button>
            {chipsCanal.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onCanalChange(canalId === c.id ? null : c.id)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 99,
                  border: `1px solid ${canalId === c.id ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
                  background: canalId === c.id ? 'var(--msn-item-active)' : 'transparent',
                  color: canalId === c.id ? 'var(--msn-accent)' : 'var(--msn-muted)',
                  cursor: 'pointer',
                }}
              >
                {c.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {!disponivel ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--msn-muted)' }}>Chatwoot ainda não provisionado.</div>
        ) : carregando ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loader2 size={18} className="spinner" />
          </div>
        ) : listaOrdenada.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--msn-muted)' }}>Não existem conversas abertas</div>
        ) : (
          listaOrdenada.map((c) => {
            const ativa = selecionadaId === c.id
            const grupo = ehGrupo(c)
            const departamento = nomeDoCanal(c.inbox_id, canais)
            const entidade = c.atendimentoMeta?.entidade
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelecionar(c)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: ativa ? 'var(--msn-item-active)' : 'none',
                  borderLeft: ativa ? '3px solid var(--msn-accent)' : '3px solid transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--msn-soft-border)',
                  padding: '9px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 9,
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: grupo ? 10 : 99,
                    background: 'var(--msn-avatar-bg)',
                    color: 'var(--msn-avatar-text)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    flexShrink: 0,
                    border: '1px solid var(--msn-border)',
                  }}
                >
                  {grupo ? <UsersRound size={16} /> : iniciais(c.meta.sender?.name)}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <strong style={{ fontSize: 13, color: 'var(--msn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.meta.sender?.name || 'Sem nome'}
                    </strong>
                    <span style={{ fontSize: 10.5, color: 'var(--msn-meta-text)', flexShrink: 0 }}>{c.last_activity_at ? horaCurta(c.last_activity_at) : ''}</span>
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, color: 'var(--msn-muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previaConversa(c)}</span>
                    {c.unread_count > 0 && (
                      <span style={{ background: 'var(--msn-accent)', color: '#fff', borderRadius: 99, padding: '0 6px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {c.unread_count}
                      </span>
                    )}
                  </span>
                  {(entidade || departamento) && (
                    <span style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                      {entidade && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 99,
                            background: VINCULO_COR[entidade.tipo].bg,
                            color: VINCULO_COR[entidade.tipo].text,
                          }}
                        >
                          {VINCULO_LABEL[entidade.tipo]}
                        </span>
                      )}
                      {departamento && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--msn-surface-alt)', color: 'var(--msn-muted)', border: '1px solid var(--msn-soft-border)' }}>
                          {departamento}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div style={{ display: 'flex', borderTop: '1px solid var(--msn-border)', background: 'var(--msn-surface-alt)' }}>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          disabled={!disponivel}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', fontSize: 12, fontWeight: 700, color: 'var(--msn-accent)', background: 'none', border: 'none', cursor: disponivel ? 'pointer' : 'not-allowed' }}
        >
          <Plus size={13} /> Nova conversa
        </button>
        <button
          type="button"
          title="Em breve"
          disabled
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', fontSize: 12, fontWeight: 700, color: 'var(--msn-muted)', background: 'none', border: 'none', borderLeft: '1px solid var(--msn-border)', cursor: 'not-allowed', opacity: 0.7 }}
        >
          <UsersRound size={13} /> Criar grupo
        </button>
      </div>

      {modalAberto && (
        <NovaConversaModal
          instancias={canais.instancias}
          onFechar={() => setModalAberto(false)}
          onEnviar={async (input) => {
            await onNovaConversa(input)
            setModalAberto(false)
          }}
        />
      )}
    </div>
  )
}

function NovaConversaModal({
  instancias,
  onFechar,
  onEnviar,
}: {
  instancias: InstanciaAtendimento[]
  onFechar: () => void
  onEnviar: (input: { instanciaId: string; telefone: string; texto: string }) => Promise<void>
}) {
  const [instanciaId, setInstanciaId] = useState(instancias[0]?.id || '')
  const [telefone, setTelefone] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    if (!instanciaId) return setErro('Escolha uma instância.')
    const digitos = telefone.replace(/\D/g, '')
    if (digitos.length < 10) return setErro('Informe um telefone válido com DDD.')
    if (!texto.trim()) return setErro('Escreva a primeira mensagem.')
    setEnviando(true)
    setErro(null)
    try {
      await onEnviar({ instanciaId, telefone: digitos, texto: texto.trim() })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao iniciar conversa.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 400 }} data-brs-messenger-ignore-close="true">
      <div className="brs-messenger" style={{ width: 340, maxWidth: '92vw', borderRadius: 6, overflow: 'hidden' }} data-brs-messenger-ignore-close="true">
        <div className="brs-messenger-titlebar">
          <span>Nova conversa</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--msn-surface)' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
            Instância
            <select className="brs-messenger-select" style={{ width: '100%', marginTop: 4 }} value={instanciaId} onChange={(e) => setInstanciaId(e.target.value)}>
              {instancias.length === 0 && <option value="">Nenhuma instância disponível</option>}
              {instancias.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome} ({i.papel === 'disparo' ? 'disparo' : 'receptiva'})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
            Telefone (com DDD)
            <input className="brs-messenger-profile-input" style={{ width: '100%', marginTop: 4 }} placeholder="(11) 91234-5678" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
            Mensagem
            <textarea className="brs-messenger-composer-input" style={{ width: '100%', marginTop: 4, minHeight: 70 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          {erro && <div style={{ fontSize: 12, color: '#b91c1c' }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onFechar} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
              Cancelar
            </button>
            <button type="button" onClick={enviar} disabled={enviando} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
              {enviando ? 'Enviando…' : 'Iniciar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
