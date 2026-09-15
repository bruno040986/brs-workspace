'use client'

import { memo, useEffect, useMemo, useReducer, useState } from 'react'
import { ChevronDown, Circle, Contact, Inbox, Loader2, MessageCircle, Plus, Search, Users, UsersRound, X } from 'lucide-react'
import type { AbaAtendimento } from './useAtendimento'
import AvatarContato from './AvatarContato'
import { VINCULO_COR, VINCULO_LABEL, ehGrupo, horaCurta, previaConversa, type ConversaAtendimento, type InboxAtendimento, type InstanciaAtendimento } from './types'
import type { ContatoBusca, DepartamentoResumo, ResultadoNovaConversa } from '@/lib/central-conversas/actions'
import { estadoInicialEnvio, novoOperationId, reduzirEnvio, type AcaoEnvio, type EstadoEnvio } from '@/lib/central-conversas/envio-intencao'
import { buscarContatosConexao, criarGrupo } from '@/lib/central-conversas/grupos-actions'
import type { ContatoConexao } from '@/lib/central-conversas/engine'

type Presenca = 'online' | 'busy' | 'offline' | null

type Props = {
  aba: AbaAtendimento
  onAbaChange: (aba: AbaAtendimento) => void
  onAlternarContatos: () => void
  filaCount: number
  contadores: { mine: number; unassigned: number; all: number }
  busca: string
  onBuscaChange: (v: string) => void
  canais: { inboxes: InboxAtendimento[]; instancias: InstanciaAtendimento[] }
  nomeInstanciaPorInbox: Map<number, string>
  canalIds: Set<number>
  onAlternarCanal: (id: number) => void
  onLimparCanais: () => void
  departamentos: DepartamentoResumo[]
  departamentoIds: Set<string>
  onAlternarDepartamento: (id: string) => void
  onLimparDepartamentos: () => void
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
  onAlternarContatos,
  filaCount,
  contadores,
  busca,
  onBuscaChange,
  canais,
  nomeInstanciaPorInbox,
  canalIds,
  onAlternarCanal,
  onLimparCanais,
  departamentos,
  departamentoIds,
  onAlternarDepartamento,
  onLimparDepartamentos,
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
  const [modalGrupoAberto, setModalGrupoAberto] = useState(false)

  const ABAS = useMemo(() => {
    const base: Array<{ id: AbaAtendimento; rotulo: string; Icone: typeof MessageCircle; badge?: number }> = [
      { id: 'meus', rotulo: 'Chats', Icone: MessageCircle, badge: contadores.mine },
      { id: 'fila', rotulo: 'Fila', Icone: Inbox, badge: contadores.unassigned },
    ]
    if (ehSupervisor) base.push({ id: 'geral', rotulo: 'Geral', Icone: Users })
    return base
  }, [ehSupervisor, contadores])

  const opcoesCanal = useMemo(() => {
    const vistos = new Set<number>()
    const chips: Array<{ id: number; rotulo: string; status?: string }> = []
    for (const i of canais.instancias) {
      if (i.inboxId && !vistos.has(i.inboxId)) {
        vistos.add(i.inboxId)
        chips.push({ id: i.inboxId, rotulo: i.nome, status: i.status })
      }
    }
    for (const i of canais.inboxes) {
      if (!vistos.has(i.id)) {
        vistos.add(i.id)
        chips.push({ id: i.id, rotulo: i.nome })
      }
    }
    return chips
  }, [canais])

  const opcoesDepartamento = useMemo(() => departamentos.map((d) => ({ id: d.id, rotulo: d.nome })), [departamentos])

  const listaOrdenada = useMemo(() => {
    const arr = [...conversas]
    if (aba === 'fila') {
      return arr.sort((a, b) => (a.last_activity_at || 0) - (b.last_activity_at || 0))
    }
    return arr.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0))
  }, [conversas, aba])

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
          <button
            type="button"
            onClick={onAlternarContatos}
            title="Contatos"
            style={{
              display: 'flex',
              alignItems: 'center',
              border: `1px solid ${aba === 'contatos' ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
              borderRadius: 99,
              padding: 6,
              background: aba === 'contatos' ? 'var(--msn-item-active)' : 'transparent',
              color: aba === 'contatos' ? 'var(--msn-accent)' : 'var(--msn-muted)',
              cursor: 'pointer',
            }}
          >
            <Contact size={14} />
          </button>
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
        {aba !== 'contatos' && (opcoesCanal.length > 0 || opcoesDepartamento.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {opcoesCanal.length > 0 && (
              <FiltroMultiSelect rotulo="Instâncias" opcoes={opcoesCanal} selecionados={canalIds} onAlternar={onAlternarCanal} onLimpar={onLimparCanais} comStatus />
            )}
            {opcoesDepartamento.length > 0 && (
              <FiltroMultiSelect rotulo="Departamentos" opcoes={opcoesDepartamento} selecionados={departamentoIds} onAlternar={onAlternarDepartamento} onLimpar={onLimparDepartamentos} />
            )}
          </div>
        )}
      </div>

      <div style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, minWidth: 0 }}>
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
                <AvatarContato thumbnail={c.thumbnail} nome={c.nome} tamanho={32} fontSize={12} />
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
          <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--msn-muted)' }}>
            Não existem conversas abertas{aba === 'meus' ? ' para você' : ''}.
          </div>
        ) : (
          listaOrdenada.map((c, idx) => (
            <ItemConversa
              key={c.id}
              conversa={c}
              selecionada={selecionadaId === c.id}
              onSelecionar={onSelecionar}
              nomeInstancia={nomeInstanciaPorInbox.get(c.inbox_id)}
              aba={aba}
              posicaoFila={aba === 'fila' ? idx + 1 : undefined}
            />
          ))
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
          onClick={() => setModalGrupoAberto(true)}
          disabled={!disponivel}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', fontSize: 12, fontWeight: 700, color: 'var(--msn-accent)', background: 'none', border: 'none', borderLeft: '1px solid var(--msn-border)', cursor: disponivel ? 'pointer' : 'not-allowed' }}
        >
          <UsersRound size={13} /> Novo grupo
        </button>
      </div>

      {modalGrupoAberto && (
        <NovoGrupoModal instancias={canais.instancias} onFechar={() => setModalGrupoAberto(false)} />
      )}

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

const STATUS_COR_INSTANCIA: Record<string, string> = {
  conectada: '#22c55e',
  conectando: '#eab308',
  aguardando_qr: '#eab308',
  desconectada: '#ef4444',
  erro: '#ef4444',
}

/**
 * Filtro de instância/departamento da lista: dropdown com checkboxes
 * (multi-seleção — conjunto vazio = "Todos"). Substituiu os chips de
 * seleção única; `comStatus` liga a bolinha verde/amarela/vermelha de
 * conexão (só faz sentido pras instâncias de WhatsApp).
 */
function FiltroMultiSelect<T extends string | number>({
  rotulo,
  opcoes,
  selecionados,
  onAlternar,
  onLimpar,
  comStatus,
}: {
  rotulo: string
  opcoes: Array<{ id: T; rotulo: string; status?: string }>
  selecionados: Set<T>
  onAlternar: (id: T) => void
  onLimpar: () => void
  comStatus?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const rotuloBotao =
    selecionados.size === 0
      ? `${rotulo}: Todos`
      : selecionados.size === 1
        ? opcoes.find((o) => selecionados.has(o.id))?.rotulo || rotulo
        : `${rotulo} (${selecionados.size})`
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontWeight: 700,
          padding: '3px 9px',
          borderRadius: 99,
          border: `1px solid ${selecionados.size > 0 ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
          background: selecionados.size > 0 ? 'var(--msn-item-active)' : 'transparent',
          color: selecionados.size > 0 ? 'var(--msn-accent)' : 'var(--msn-muted)',
          cursor: 'pointer',
          maxWidth: 180,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotuloBotao}</span>
        <ChevronDown size={11} style={{ flexShrink: 0 }} />
      </button>
      {aberto && (
        <div
          className="brs-messenger"
          style={{ position: 'absolute', left: 0, top: '110%', zIndex: 60, minWidth: 210, maxWidth: 260, borderRadius: 6, background: 'var(--msn-surface)', boxShadow: '0 4px 16px rgba(0,0,0,.18)' }}
          data-brs-messenger-ignore-close="true"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--msn-soft-border)' }}>
            <button
              type="button"
              onClick={onLimpar}
              style={{ fontSize: 11, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', color: selecionados.size === 0 ? 'var(--msn-accent)' : 'var(--msn-muted)' }}
            >
              Marcar todos
            </button>
            <button type="button" onClick={() => setAberto(false)} title="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-muted)', display: 'flex' }}>
              <X size={13} />
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {opcoes.map((o) => (
              <label key={String(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--msn-text)' }}>
                <input type="checkbox" checked={selecionados.has(o.id)} onChange={() => onAlternar(o.id)} />
                {comStatus && <span title={o.status} style={{ width: 8, height: 8, borderRadius: 99, background: STATUS_COR_INSTANCIA[o.status || ''] || '#94a3b8', flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.rotulo}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Linha da lista, memoizada: sem isso a lista inteira remontava a cada poll
 * de 6s e a cada tecla da busca (CRM `d2fd373`). `onSelecionar` já é o
 * `selecionarConversa` do hook (`useCallback` com deps vazias) — estável por
 * natureza, então `memo` aqui de fato evita o re-render.
 */
const ItemConversa = memo(function ItemConversa({
  conversa: c,
  selecionada: ativa,
  onSelecionar,
  nomeInstancia,
  aba,
  posicaoFila,
}: {
  conversa: ConversaAtendimento
  selecionada: boolean
  onSelecionar: (c: ConversaAtendimento) => void
  nomeInstancia?: string
  aba?: AbaAtendimento
  posicaoFila?: number
}) {
  const grupo = ehGrupo(c)
  const departamento = c.meta.team?.name || null
  const entidade = c.atendimentoMeta?.entidade
  const ehEncerrada = c.status === 'resolved'
  return (
    <button
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
      <AvatarContato
        thumbnail={c.meta.sender?.thumbnail}
        nome={c.meta.sender?.name}
        tamanho={36}
        fontSize={13}
        quadrado={grupo}
        iconeAlternativo={grupo ? <UsersRound size={16} /> : undefined}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
          <strong style={{ minWidth: 0, flex: 1, fontSize: 13, color: 'var(--msn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.meta.sender?.name || 'Sem nome'}
          </strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {aba === 'fila' && posicaoFila !== undefined && (
              <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 99, background: '#f59e0b', color: '#fff' }}>
                #{posicaoFila}
              </span>
            )}
            {aba === 'geral' && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 99,
                  background: ehEncerrada ? '#64748b' : '#22c55e',
                  color: '#fff',
                }}
              >
                {ehEncerrada ? 'Encerrada' : 'Aberta'}
              </span>
            )}
            <span style={{ fontSize: 10.5, color: 'var(--msn-meta-text)' }}>{c.last_activity_at ? horaCurta(c.last_activity_at) : ''}</span>
          </span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12, color: 'var(--msn-muted)' }}>
          <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previaConversa(c)}</span>
          {c.unread_count > 0 && (
            <span style={{ background: 'var(--msn-accent)', color: '#fff', borderRadius: 99, padding: '0 6px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
              {c.unread_count}
            </span>
          )}
        </span>
        {(entidade || departamento || nomeInstancia) && (
          <span style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            {nomeInstancia && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(37,99,235,0.12)', color: '#1d4ed8' }}>{nomeInstancia}</span>
            )}
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
  // Máquina de estados de envio-intencao.ts (Lote 02B): a chave nasce uma vez
  // por intenção; em 'enviando' e 'incerto' os campos ficam congelados;
  // "Repetir esta operação" reaproveita chave e payload; "Novo envio" libera
  // os campos com outra chave e registra que o anterior pode ter saído.
  const [estado, dispatch] = useReducer(
    (s: EstadoEnvio, a: AcaoEnvio) => reduzirEnvio(s, a),
    { instanciaId: instancias[0]?.id || '', telefone: prefill?.telefone || '', texto: '' },
    estadoInicialEnvio,
  )
  const { fase, campos, mensagem, incertoAnterior } = estado
  const congelado = fase !== 'editando'
  const enviando = fase === 'enviando'
  const avisoNovoEnvio = fase === 'editando' && incertoAnterior !== null && mensagem !== null && mensagem.startsWith('O envio anterior')

  async function enviar() {
    if (fase === 'editando') {
      if (!campos.instanciaId) return dispatch({ tipo: 'erro', mensagem: 'Escolha uma instância.' })
      if (campos.telefone.replace(/\D/g, '').length < 10) return dispatch({ tipo: 'erro', mensagem: 'Informe um telefone válido com DDD.' })
      if (!campos.texto.trim()) return dispatch({ tipo: 'erro', mensagem: 'Escreva a primeira mensagem.' })
    } else if (fase !== 'incerto') {
      return
    }
    // Reducer puro: calcula o próximo estado com a MESMA ação que vai ser
    // despachada (a chave vai dentro da ação), pra montar o payload sem
    // divergir do estado.
    const acao: AcaoEnvio = fase === 'incerto' ? { tipo: 'repetir' } : { tipo: 'enviar', chave: novoOperationId() }
    const proximo = reduzirEnvio(estado, acao)
    if (proximo.fase !== 'enviando' || !proximo.intencao) return
    dispatch(acao)
    const i = proximo.intencao
    let resultado: ResultadoNovaConversa
    try {
      resultado = await onEnviar({ instanciaId: i.instanciaId, telefone: i.telefone, texto: i.texto, operationId: i.chave })
    } catch {
      // Perda de resposta entre navegador e Server Action (ou erro mascarado):
      // conservador — a intenção fica e a UI trata como incerto.
      resultado = { resultado: 'incerto', mensagem: 'Não foi possível confirmar com o servidor (conexão ou erro inesperado).' }
    }
    dispatch({ tipo: 'resultado', resultado })
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
            <select className="brs-messenger-select" style={{ width: '100%', marginTop: 4 }} value={campos.instanciaId} disabled={congelado} onChange={(e) => dispatch({ tipo: 'editar', campos: { instanciaId: e.target.value } })}>
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
            <input
              className="brs-messenger-profile-input"
              style={{ width: '100%', marginTop: 4 }}
              placeholder="(11) 91234-5678"
              value={campos.telefone}
              disabled={congelado}
              onChange={(e) => dispatch({ tipo: 'editar', campos: { telefone: e.target.value } })}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
            Mensagem
            <textarea
              className="brs-messenger-composer-input"
              style={{ width: '100%', marginTop: 4, minHeight: 70 }}
              value={campos.texto}
              disabled={congelado}
              onChange={(e) => dispatch({ tipo: 'editar', campos: { texto: e.target.value } })}
            />
          </label>

          {fase === 'editando' && mensagem && !avisoNovoEnvio && <div style={{ fontSize: 12, color: '#b91c1c' }}>{mensagem}</div>}
          {avisoNovoEnvio && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 8px' }}>
              <strong>Novo envio.</strong> {mensagem}
            </div>
          )}
          {fase === 'incerto' && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 8px' }}>
              <strong>Envio não confirmado.</strong> {mensagem} Os campos ficam travados até você decidir: confira se a conversa apareceu na lista (ou a mensagem no WhatsApp).
              "Repetir esta operação" reaproveita a mesma chave e o mesmo conteúdo — só evita duplicidade quando o modo durável desta conta estiver ligado no engine. "Novo envio" libera os
              campos e usa outra chave.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" onClick={onFechar} disabled={enviando} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
              {fase === 'incerto' ? 'Fechar' : 'Cancelar'}
            </button>
            {fase === 'incerto' && (
              <button type="button" onClick={() => dispatch({ tipo: 'novoEnvio' })} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
                Novo envio (outra chave)
              </button>
            )}
            <button type="button" onClick={() => void enviar()} disabled={enviando} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
              {enviando ? 'Enviando…' : fase === 'incerto' ? 'Repetir esta operação (mesma chave)' : 'Iniciar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Modal "Novo grupo" (Fase C, frente d) — Conexão (só instâncias
 * `provedor='baileys'` e `status='conectada'`, NUNCA filtrar por `papel`),
 * Nome, Participantes (busca + números avulsos), Mensagem inicial opcional.
 */
function NovoGrupoModal({ instancias, onFechar }: { instancias: InstanciaAtendimento[]; onFechar: () => void }) {
  const conectadasBaileys = useMemo(() => instancias.filter((i) => i.provedor === 'baileys' && i.status === 'conectada'), [instancias])
  const [instanciaId, setInstanciaId] = useState(conectadasBaileys[0]?.id || '')
  const [nome, setNome] = useState('')
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<ContatoConexao[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [numeroAvulso, setNumeroAvulso] = useState('')
  const [mensagemInicial, setMensagemInicial] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [criado, setCriado] = useState(false)

  useEffect(() => {
    if (!instanciaId) return
    const t = setTimeout(() => {
      void buscarContatosConexao(instanciaId, busca || undefined)
        .then((r) => setItens(r.ok ? r.itens : []))
        .catch(() => setItens([]))
    }, 250)
    return () => clearTimeout(t)
  }, [busca, instanciaId])

  function alternar(jid: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev)
      if (novo.has(jid)) novo.delete(jid)
      else novo.add(jid)
      return novo
    })
  }

  async function confirmar() {
    setErro(null)
    if (!instanciaId) return setErro('Escolha uma conexão conectada (Baileys).')
    if (!nome.trim()) return setErro('Dê um nome ao grupo.')
    const participantes = [...selecionados]
    const avulso = numeroAvulso.trim()
    if (avulso) participantes.push(avulso)
    if (!participantes.length) return setErro('Selecione ao menos um participante.')
    setSalvando(true)
    try {
      const r = await criarGrupo({ instanciaId, nome: nome.trim(), participantes, mensagemInicial: mensagemInicial.trim() || undefined })
      if (!r.ok) {
        setErro(r.error)
        return
      }
      setCriado(true)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar o grupo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 400 }} data-brs-messenger-ignore-close="true">
      <div className="brs-messenger" style={{ width: 380, maxWidth: '92vw', borderRadius: 6, overflow: 'hidden' }} data-brs-messenger-ignore-close="true">
        <div className="brs-messenger-titlebar">
          <span>Novo grupo</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--msn-surface)' }}>
          {criado ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--msn-text)' }}>Grupo criado. O grupo aparece na lista quando alguém mandar a primeira mensagem.</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onFechar} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
                  Fechar
                </button>
              </div>
            </>
          ) : (
            <>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Conexão
                <select className="brs-messenger-select" style={{ width: '100%', marginTop: 4 }} value={instanciaId} onChange={(e) => setInstanciaId(e.target.value)}>
                  {conectadasBaileys.length === 0 && <option value="">Nenhuma conexão Baileys conectada</option>}
                  {conectadasBaileys.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Nome do grupo
                <input className="brs-messenger-profile-input" style={{ width: '100%', marginTop: 4 }} value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)', marginBottom: 4 }}>Participantes</div>
                <div style={{ position: 'relative', marginBottom: 6 }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--msn-muted)' }} />
                  <input className="brs-messenger-search-input" style={{ width: '100%', paddingLeft: 26 }} placeholder="Buscar contato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {itens.map((c) => (
                    <label key={c.jid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selecionados.has(c.jid)} onChange={() => alternar(c.jid)} />
                      {c.nome || c.numero}
                    </label>
                  ))}
                  {!itens.length && <div style={{ fontSize: 11, color: 'var(--msn-muted)' }}>Digite pra buscar contatos da conexão.</div>}
                </div>
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Número avulso (DDI+DDD+número)
                <input className="brs-messenger-profile-input" style={{ width: '100%', marginTop: 4 }} placeholder="Ex.: 5511999999999" value={numeroAvulso} onChange={(e) => setNumeroAvulso(e.target.value)} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                Mensagem inicial (opcional)
                <textarea className="brs-messenger-composer-input" style={{ width: '100%', marginTop: 4, minHeight: 60 }} value={mensagemInicial} onChange={(e) => setMensagemInicial(e.target.value)} />
              </label>
              {erro && <div style={{ fontSize: 12, color: '#b91c1c' }}>{erro}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onFechar} disabled={salvando} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
                  Cancelar
                </button>
                <button type="button" onClick={() => void confirmar()} disabled={salvando} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
                  {salvando ? 'Criando…' : 'Criar grupo'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
