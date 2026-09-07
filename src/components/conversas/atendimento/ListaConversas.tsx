'use client'

import { useMemo, useState } from 'react'
import { Circle, Contact, Inbox, Loader2, MessageCircle, Plus, Search, Users, UsersRound } from 'lucide-react'
import type { AbaAtendimento } from './useAtendimento'
import { VINCULO_COR, VINCULO_LABEL, ehGrupo, horaCurta, iniciais, previaConversa, type ConversaAtendimento, type InboxAtendimento, type InstanciaAtendimento } from './types'
import type { ContatoBusca, DepartamentoResumo, ResultadoNovaConversa } from '@/lib/central-conversas/actions'
import { resolverIntencao, type IntencaoEnvio } from '@/lib/central-conversas/envio-intencao'

type Presenca = 'online' | 'busy' | 'offline' | null

type Props = {
  aba: AbaAtendimento
  onAbaChange: (aba: AbaAtendimento) => void
  filaCount: number
  contadores: { mine: number; unassigned: number; all: number }
  busca: string
  onBuscaChange: (v: string) => void
  canais: { inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[] }
  canalId: number | null
  onCanalChange: (id: number | null) => void
  departamentos: DepartamentoResumo[]
  departamentoId: string | null
  onDepartamentoChange: (id: string | null) => void
  ehSupervisor: boolean
  presenca: Presenca
  onPresencaChange: (status: 'online' | 'busy' | 'offline') => void
  contatos: ContatoBusca[]
  carregandoContatos: boolean
  conversas: ConversaAtendimento[]
  carregando: boolean
  disponivel: boolean
  selecionadaId: number | null
  onSelecionar: (c: ConversaAtendimento) => void
  onNovaConversa: (input: { instanciaId: string; telefone: string; texto: string; operationId: string }) => Promise<ResultadoNovaConversa>
}

const PRESENCA_INFO: Record<NonNullable<Presenca>, { cor: string; rotulo: string }> = {
  online: { cor: '#22c55e', rotulo: 'Online' },
  busy: { cor: '#eab308', rotulo: 'Ausente' },
  offline: { cor: '#94a3b8', rotulo: 'Offline' },
}

export default function ListaConversas({
  aba,
  onAbaChange,
  filaCount,
  contadores,
  busca,
  onBuscaChange,
  canais,
  canalId,
  onCanalChange,
  departamentos,
  departamentoId,
  onDepartamentoChange,
  ehSupervisor,
  presenca,
  onPresencaChange,
  contatos,
  carregandoContatos,
  conversas,
  carregando,
  disponivel,
  selecionadaId,
  onSelecionar,
  onNovaConversa,
}: Props) {
  const [modalAberto, setModalAberto] = useState(false)
  const [prefillModal, setPrefillModal] = useState<{ telefone: string; nome: string } | null>(null)
  const [menuPresencaAberto, setMenuPresencaAberto] = useState(false)

  const ABAS = useMemo(() => {
    const base: Array<{ id: AbaAtendimento; rotulo: string; Icone: typeof MessageCircle; badge?: number }> = [
      { id: 'meus', rotulo: 'Chats', Icone: MessageCircle, badge: contadores.mine },
      { id: 'fila', rotulo: 'Fila', Icone: Inbox, badge: contadores.unassigned },
      { id: 'contatos', rotulo: 'Contatos', Icone: Contact },
    ]
    if (ehSupervisor) base.push({ id: 'geral', rotulo: 'Geral', Icone: Users })
    return base
  }, [ehSupervisor, contadores])

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--msn-muted)' }} />
            <input
              className="brs-messenger-search-input"
              style={{ paddingLeft: 28 }}
              placeholder={aba === 'contatos' ? 'Pesquisar contato…' : 'Pesquisar por nome ou número…'}
              value={busca}
              onChange={(e) => onBuscaChange(e.target.value)}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuPresencaAberto((v) => !v)}
              title="Sua disponibilidade"
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--msn-soft-border)', borderRadius: 99, padding: '4px 8px', background: 'transparent', cursor: 'pointer' }}
            >
              <Circle size={9} fill={presenca ? PRESENCA_INFO[presenca].cor : '#94a3b8'} color={presenca ? PRESENCA_INFO[presenca].cor : '#94a3b8'} />
            </button>
            {menuPresencaAberto && (
              <div className="brs-messenger" style={{ position: 'absolute', right: 0, top: '110%', borderRadius: 6, width: 140, zIndex: 60, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
                {(['online', 'busy', 'offline'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setMenuPresencaAberto(false)
                      onPresencaChange(s)
                    }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)' }}
                  >
                    <Circle size={9} fill={PRESENCA_INFO[s].cor} color={PRESENCA_INFO[s].cor} /> {PRESENCA_INFO[s].rotulo}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ABAS.length}, 1fr)`, marginTop: 8, borderBottom: '1px solid var(--msn-soft-border)' }}>
          {ABAS.map(({ id, rotulo, Icone, badge }) => (
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
              {!!badge && badge > 0 && (
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
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {aba !== 'contatos' && chipsCanal.length > 0 && (
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
        {aba !== 'contatos' && departamentos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <button
              type="button"
              onClick={() => onDepartamentoChange(null)}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: 99,
                border: `1px solid ${departamentoId === null ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
                background: departamentoId === null ? 'var(--msn-item-active)' : 'transparent',
                color: departamentoId === null ? 'var(--msn-accent)' : 'var(--msn-muted)',
                cursor: 'pointer',
              }}
            >
              Todos deptos.
            </button>
            {departamentos.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onDepartamentoChange(departamentoId === d.id ? null : d.id)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 99,
                  border: `1px solid ${departamentoId === d.id ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
                  background: departamentoId === d.id ? 'var(--msn-item-active)' : 'transparent',
                  color: departamentoId === d.id ? 'var(--msn-accent)' : 'var(--msn-muted)',
                  cursor: 'pointer',
                }}
              >
                {d.nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {aba === 'contatos' ? (
          carregandoContatos ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <Loader2 size={18} className="spinner" />
            </div>
          ) : contatos.length === 0 ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--msn-muted)' }}>Nenhum contato encontrado.</div>
          ) : (
            contatos.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setPrefillModal({ telefone: (c.telefone || '').replace(/\D/g, ''), nome: c.nome })
                  setModalAberto(true)
                }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--msn-soft-border)', padding: '9px 10px', cursor: 'pointer', display: 'flex', gap: 9, alignItems: 'center' }}
              >
                <span style={{ width: 32, height: 32, borderRadius: 99, background: 'var(--msn-avatar-bg)', color: 'var(--msn-avatar-text)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0, border: '1px solid var(--msn-border)', overflow: 'hidden' }}>
                  {c.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    iniciais(c.nome)
                  )}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--msn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</div>
                  {c.telefone && <div style={{ fontSize: 11.5, color: 'var(--msn-muted)' }}>{c.telefone}</div>}
                </span>
              </button>
            ))
          )
        ) : !disponivel ? (
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
            const departamento = c.meta.team?.name || null
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
                    overflow: 'hidden',
                  }}
                >
                  {c.meta.sender?.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.meta.sender.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : grupo ? (
                    <UsersRound size={16} />
                  ) : (
                    iniciais(c.meta.sender?.name)
                  )}
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
          onClick={() => {
            setPrefillModal(null)
            setModalAberto(true)
          }}
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
          prefill={prefillModal}
          onFechar={() => {
            setModalAberto(false)
            setPrefillModal(null)
          }}
          onEnviar={async (input) => {
            const r = await onNovaConversa(input)
            if (r.resultado === 'confirmado') {
              setModalAberto(false)
              setPrefillModal(null)
            }
            return r
          }}
        />
      )}
    </div>
  )
}

function NovaConversaModal({
  instancias,
  prefill,
  onFechar,
  onEnviar,
}: {
  instancias: InstanciaAtendimento[]
  prefill?: { telefone: string; nome: string } | null
  onFechar: () => void
  onEnviar: (input: { instanciaId: string; telefone: string; texto: string; operationId: string }) => Promise<ResultadoNovaConversa>
}) {
  const [instanciaId, setInstanciaId] = useState(instancias[0]?.id || '')
  const [telefone, setTelefone] = useState(prefill?.telefone || '')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Intenção de envio corrente (Lote 02B): a chave nasce aqui, uma vez, e é
  // conservada em "tentar de novo" com os MESMOS campos; mudou campo ou deu
  // certo → próxima tentativa é outra intenção, outra chave. Vive só no estado
  // do modal: recarregar a página perde a intenção (e a UI não promete o
  // contrário).
  const [intencao, setIntencao] = useState<IntencaoEnvio | null>(null)
  const [incerto, setIncerto] = useState<string | null>(null)

  async function enviar() {
    if (!instanciaId) return setErro('Escolha uma instância.')
    const digitos = telefone.replace(/\D/g, '')
    if (digitos.length < 10) return setErro('Informe um telefone válido com DDD.')
    if (!texto.trim()) return setErro('Escreva a primeira mensagem.')
    const atual = resolverIntencao(intencao, { instanciaId, telefone: digitos, texto: texto.trim() })
    setIntencao(atual)
    setEnviando(true)
    setErro(null)
    setIncerto(null)
    try {
      const r = await onEnviar({ instanciaId, telefone: digitos, texto: texto.trim(), operationId: atual.chave })
      if (r.resultado === 'incerto') {
        // Mantém a intenção (mesma chave) — quem decide reenviar é a pessoa,
        // depois de conferir. Nada é reenviado automaticamente.
        setIncerto(r.mensagem)
        return
      }
      setIntencao(null)
    } catch (err) {
      // Erro claro (validação, instância, HTTP): intenção continua a mesma pra
      // um "tentar de novo" com a mesma chave.
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
          {incerto && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 8px' }}>
              <strong>Envio não confirmado.</strong> {incerto} Antes de tentar de novo, confira se a conversa apareceu na lista (ou a mensagem no WhatsApp). "Tentar de novo" reaproveita a mesma
              operação — isso só evita duplicidade quando o modo durável desta conta estiver ligado no engine.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onFechar} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
              {incerto ? 'Fechar' : 'Cancelar'}
            </button>
            <button type="button" onClick={enviar} disabled={enviando} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
              {enviando ? 'Enviando…' : incerto ? 'Tentar de novo (mesma operação)' : 'Iniciar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
