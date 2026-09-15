'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, CalendarClock, Check, ChevronDown, Copy, History, Images, LogOut, MailOpen, Plus, Search, Shield, ShieldOff, Trash2, UserMinus, X } from 'lucide-react'
import type { DepartamentoResumo } from '@/lib/central-conversas/actions'
import { alterarParticipantes, buscarContatosConexao, getGrupo, linkConvite, sairDoGrupo, type GrupoDetalhado } from '@/lib/central-conversas/grupos-actions'
import type { ContatoConexao } from '@/lib/central-conversas/engine'
import AvatarContato from './AvatarContato'
import {
  VINCULO_COR,
  VINCULO_LABEL,
  ehGrupo,
  type AcaoAgendada,
  type AgenteChat,
  type ChatwootMensagem,
  type ConversaAtendimento,
  type ContatoMeta,
  type EntidadeBusca,
  type EntidadeTipo,
  type GaleriaItem,
  type HistoricoChamado,
  type TagConta,
} from './types'

type Aba = 'geral' | 'membros'

type BuscarEntidadesFn = (q: string) => Promise<{ parceiros: EntidadeBusca[]; instituicoes: EntidadeBusca[]; promotoras: EntidadeBusca[] }>

type Props = {
  conversa: ConversaAtendimento
  mensagens: ChatwootMensagem[]
  agentes: AgenteChat[]
  departamentos: DepartamentoResumo[]
  tagsConta: TagConta[]
  tagsConversa: string[]
  departamento: string | null
  contatoMeta: ContatoMeta | null
  tagsContato: string[]
  historico: HistoricoChamado[] | null
  carregandoHistorico: boolean
  onCarregarHistorico: () => void
  galeria: GaleriaItem[] | null
  carregandoGaleria: boolean
  onCarregarGaleria: () => void
  agendamentos: AcaoAgendada[]
  onFechar?: () => void
  onSilenciar: (v: boolean) => Promise<void>
  onMarcarNaoLida: () => Promise<void>
  onVincular: (tipo: EntidadeTipo | null, id: string | null) => Promise<void>
  onVincularContato: (tipo: EntidadeTipo | null, id: string | null) => Promise<void>
  onDefinirDepartamentoPadraoContato: (departamentoId: string | null) => Promise<void>
  onDefinirAtendentePadraoContato: (chatwootAgentId: number | null) => Promise<void>
  onSalvarObservacoes: (texto: string) => Promise<void>
  onSalvarTags: (tags: string[]) => Promise<void>
  onSalvarTagsContato: (tags: string[]) => Promise<void>
  onAtribuirAgente: (agenteId: number | null) => Promise<void>
  onCriarAgendamento: (input: { acao: 'mensagem' | 'lembrete_interno'; texto: string; agendadoPara: string }) => Promise<void>
  onCancelarAgendamento: (id: string) => Promise<void>
  onReagendarAcao: (id: string, novaData: string) => Promise<void>
  buscarEntidades: BuscarEntidadesFn
}

const TIPOS: EntidadeTipo[] = ['parceiro', 'instituicao', 'promotora']

/** Bloco de vínculo reutilizado pra conversa E pro contato (Fase B §a) — mesma busca/debounce, alvo diferente. */
function VinculoSecao({
  titulo,
  entidade,
  onVincular,
  buscarEntidades,
  nota,
}: {
  titulo: string
  entidade: { tipo: EntidadeTipo; id: string; nome: string } | null | undefined
  onVincular: (tipo: EntidadeTipo | null, id: string | null) => Promise<void>
  buscarEntidades: BuscarEntidadesFn
  nota?: string
}) {
  const [buscaEntidade, setBuscaEntidade] = useState('')
  const [tipoBusca, setTipoBusca] = useState<EntidadeTipo>('parceiro')
  const [resultados, setResultados] = useState<EntidadeBusca[]>([])
  const [buscandoEntidade, setBuscandoEntidade] = useState(false)

  const buscarRef = useRef(buscarEntidades)
  useEffect(() => {
    buscarRef.current = buscarEntidades
  })

  useEffect(() => {
    const termo = buscaEntidade.trim()
    if (!termo) return
    let vivo = true
    const t = setTimeout(() => {
      setBuscandoEntidade(true)
      void buscarRef.current(termo).then((r) => {
        if (!vivo) return
        const chave = tipoBusca === 'parceiro' ? 'parceiros' : tipoBusca === 'instituicao' ? 'instituicoes' : 'promotoras'
        setResultados(r[chave])
        setBuscandoEntidade(false)
      })
    }, 350)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [buscaEntidade, tipoBusca])

  const resultadosVisiveis = buscaEntidade.trim() ? resultados : []

  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>{titulo}</div>
      {entidade ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 9px', borderRadius: 6, background: VINCULO_COR[entidade.tipo].bg }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: VINCULO_COR[entidade.tipo].text }}>
            {VINCULO_LABEL[entidade.tipo]}: {entidade.nome}
          </span>
          <button type="button" onClick={() => void onVincular(null, null)} className="brs-messenger-toolbar-btn" style={{ padding: 3 }}>
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoBusca(t)}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 99,
                  border: `1px solid ${tipoBusca === t ? VINCULO_COR[t].text : 'var(--msn-soft-border)'}`,
                  background: tipoBusca === t ? VINCULO_COR[t].bg : 'transparent',
                  color: tipoBusca === t ? VINCULO_COR[t].text : 'var(--msn-muted)',
                  cursor: 'pointer',
                }}
              >
                {VINCULO_LABEL[t]}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--msn-muted)' }} />
            <input
              className="brs-messenger-search-input"
              style={{ paddingLeft: 24 }}
              placeholder={`Buscar ${VINCULO_LABEL[tipoBusca].toLowerCase()}…`}
              value={buscaEntidade}
              onChange={(e) => setBuscaEntidade(e.target.value)}
            />
          </div>
          {buscandoEntidade && <div style={{ fontSize: 11, color: 'var(--msn-muted)', marginTop: 4 }}>Buscando…</div>}
          {resultadosVisiveis.length > 0 && (
            <div style={{ marginTop: 4, border: '1px solid var(--msn-soft-border)', borderRadius: 6, maxHeight: 160, overflowY: 'auto' }}>
              {resultadosVisiveis.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void onVincular(r.tipo, r.id)}
                  style={{ width: '100%', textAlign: 'left', padding: '7px 9px', fontSize: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--msn-soft-border)', cursor: 'pointer', color: 'var(--msn-text)' }}
                >
                  <div style={{ fontWeight: 600 }}>{r.nome}</div>
                  {r.detalhe && <div style={{ fontSize: 10.5, color: 'var(--msn-muted)' }}>{r.detalhe}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {nota && <div style={{ fontSize: 10.5, color: 'var(--msn-muted)', marginTop: 4 }}>{nota}</div>}
    </section>
  )
}

export default function PainelContato({
  conversa,
  mensagens,
  agentes,
  departamentos,
  tagsConta,
  tagsConversa,
  departamento,
  contatoMeta,
  tagsContato,
  historico,
  carregandoHistorico,
  onCarregarHistorico,
  galeria,
  carregandoGaleria,
  onCarregarGaleria,
  agendamentos,
  onFechar,
  onSilenciar,
  onMarcarNaoLida,
  onVincular,
  onVincularContato,
  onDefinirDepartamentoPadraoContato,
  onDefinirAtendentePadraoContato,
  onSalvarObservacoes,
  onSalvarTags,
  onSalvarTagsContato,
  onAtribuirAgente,
  onCriarAgendamento,
  onCancelarAgendamento,
  onReagendarAcao,
  buscarEntidades,
}: Props) {
  const [aba, setAba] = useState<Aba>('geral')
  const [silenciada, setSilenciada] = useState(false)
  const [novaTag, setNovaTag] = useState('')
  const [novaTagContato, setNovaTagContato] = useState('')
  const [observacoes, setObservacoes] = useState(conversa.atendimentoMeta?.observacoes || '')
  const [copiado, setCopiado] = useState(false)
  const [modalHistorico, setModalHistorico] = useState(false)
  const [modalGaleria, setModalGaleria] = useState(false)
  const [modalAgendar, setModalAgendar] = useState(false)
  const [agendarAcaoTipo, setAgendarAcaoTipo] = useState<'mensagem' | 'lembrete_interno'>('mensagem')
  const [agendarTexto, setAgendarTexto] = useState('')
  const [agendarData, setAgendarData] = useState('')

  // Reseta o textarea ao trocar de conversa (ou quando o meta chega, async,
  // após a troca) — ajuste de estado durante o render, não num efeito com
  // setState direto no corpo (padrão oficial do React pra "resetar estado
  // quando uma prop muda").
  const chaveObservacoes = `${conversa.id}:${conversa.atendimentoMeta ? '1' : '0'}`
  const [ultimaChaveObservacoes, setUltimaChaveObservacoes] = useState(chaveObservacoes)
  if (chaveObservacoes !== ultimaChaveObservacoes) {
    setUltimaChaveObservacoes(chaveObservacoes)
    setObservacoes(conversa.atendimentoMeta?.observacoes || '')
  }

  const midias = useMemo(() => {
    const itens: Array<{ id: number; url: string; tipo: string }> = []
    for (const m of mensagens) {
      for (const a of m.attachments || []) {
        itens.push({ id: a.id, url: a.data_url, tipo: a.file_type })
      }
    }
    return itens
  }, [mensagens])

  const grupo = ehGrupo(conversa)
  const entidade = conversa.atendimentoMeta?.entidade
  const entidadeContato = contatoMeta?.entidade
  const vinculoConversaIgualAoContato =
    !!entidade && !!entidadeContato && entidade.tipo === entidadeContato.tipo && entidade.id === entidadeContato.id

  function copiarProtocolo() {
    const protocolo = conversa.atendimentoMeta?.protocolo
    if (!protocolo) return
    void navigator.clipboard.writeText(protocolo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
  }

  function abrirHistorico() {
    setModalHistorico(true)
    if (!historico) onCarregarHistorico()
  }

  function abrirGaleria() {
    setModalGaleria(true)
    if (!galeria) onCarregarGaleria()
  }

  function exportarHistoricoCsv() {
    if (!historico?.length) return
    const linhas = [
      ['Conexão', 'Departamento', 'Atendente', 'Último atendimento', 'Protocolo'].join(';'),
      ...historico.map((h) =>
        [h.conexaoNome, h.departamento || '', h.atendente || '', h.ultimoAtendimento ? new Date(h.ultimoAtendimento).toLocaleString('pt-BR') : '', h.protocolo || ''].join(';'),
      ),
    ]
    const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `historico-${conversa.meta.sender?.name || 'contato'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function confirmarAgendamento() {
    if (!agendarTexto.trim() || !agendarData) return
    await onCriarAgendamento({ acao: agendarAcaoTipo, texto: agendarTexto.trim(), agendadoPara: new Date(agendarData).toISOString() })
    setAgendarTexto('')
    setAgendarData('')
    setModalAgendar(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--msn-surface)' }}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--msn-border)', textAlign: 'center', position: 'relative' }}>
        {onFechar && (
          <button type="button" onClick={onFechar} className="brs-messenger-toolbar-btn" style={{ position: 'absolute', top: 8, right: 8, padding: 5 }}>
            <X size={13} />
          </button>
        )}
        <AvatarContato
          thumbnail={conversa.meta.sender?.thumbnail}
          nome={conversa.meta.sender?.name}
          tamanho={64}
          fontSize={24}
          raio={grupo ? 14 : 99}
          estilo={{ margin: '0 auto 8px' }}
        />
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--msn-text)' }}>{conversa.meta.sender?.name || 'Sem nome'}</div>
        <div style={{ fontSize: 12, color: 'var(--msn-muted)', marginTop: 2 }}>{conversa.meta.sender?.phone_number || conversa.meta.channel || ''}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
          <button
            type="button"
            onClick={async () => {
              await onSilenciar(!silenciada)
              setSilenciada((v) => !v)
            }}
            className="brs-messenger-pill-btn"
          >
            {silenciada ? <BellOff size={13} /> : <Bell size={13} />} {silenciada ? 'Silenciada' : 'Silenciar'}
          </button>
          <button type="button" onClick={() => void onMarcarNaoLida()} className="brs-messenger-pill-btn">
            <MailOpen size={13} /> Não lida
          </button>
        </div>
      </div>

      <div style={{ padding: 12, borderBottom: '1px solid var(--msn-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', textTransform: 'uppercase' }}>Mídias e documentos</div>
          <button type="button" onClick={abrirGaleria} className="brs-messenger-toolbar-btn" style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700 }}>
            <Images size={11} /> Ver todos
          </button>
        </div>
        {midias.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--msn-muted)' }}>Nenhum arquivo nesta conversa ainda.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {midias.slice(0, 4).map((m, idx) => (
              <a
                key={m.id}
                href={m.url}
                target="_blank"
                rel="noreferrer"
                style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', display: 'grid', placeItems: 'center' }}
              >
                {m.tipo === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--msn-muted)' }}>arquivo</span>
                )}
                {idx === 3 && midias.length > 4 && (
                  <span style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>+{midias.length - 4}</span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--msn-border)' }}>
        {(['geral', 'membros'] as Aba[]).map((id) =>
          id === 'membros' && !grupo ? null : (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, background: 'none', border: 'none', borderBottom: `2px solid ${aba === id ? 'var(--msn-accent)' : 'transparent'}`, color: aba === id ? 'var(--msn-accent)' : 'var(--msn-muted)', cursor: 'pointer' }}
            >
              {id === 'geral' ? 'Geral' : 'Membros'}
            </button>
          ),
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {aba === 'geral' ? (
          <>
            <VinculoSecao titulo="Vincular a (esta conversa)" entidade={entidade} onVincular={onVincular} buscarEntidades={buscarEntidades} />

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Pessoa (contato) — configuração padrão</div>
              <VinculoSecao
                titulo="Vínculo padrão do contato"
                entidade={entidadeContato}
                onVincular={onVincularContato}
                buscarEntidades={buscarEntidades}
                nota={vinculoConversaIgualAoContato ? 'Igual ao vínculo desta conversa.' : undefined}
              />
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 4 }}>Departamento padrão</div>
                <select
                  className="brs-messenger-select"
                  style={{ width: '100%' }}
                  value={contatoMeta?.departamentoPadraoId || ''}
                  onChange={(e) => void onDefinirDepartamentoPadraoContato(e.target.value || null)}
                >
                  <option value="">Sem padrão (usa o padrão da conexão)</option>
                  {departamentos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 4 }}>Atendente padrão</div>
                <select
                  className="brs-messenger-select"
                  style={{ width: '100%' }}
                  value={contatoMeta?.atendentePadraoChatwootId || ''}
                  onChange={(e) => void onDefinirAtendentePadraoContato(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sem padrão</option>
                  {agentes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Tags do contato</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                {tagsContato.map((t) => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', color: 'var(--msn-text)' }}>
                    {t}
                    <button type="button" onClick={() => void onSalvarTagsContato(tagsContato.filter((x) => x !== t))} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--msn-muted)' }}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {tagsContato.length === 0 && <span style={{ fontSize: 11, color: 'var(--msn-muted)' }}>Nenhuma tag.</span>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  list="tags-conta-lista"
                  className="brs-messenger-search-input"
                  placeholder="Adicionar tag…"
                  value={novaTagContato}
                  onChange={(e) => setNovaTagContato(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && novaTagContato.trim()) {
                      e.preventDefault()
                      const v = novaTagContato.trim()
                      setNovaTagContato('')
                      if (!tagsContato.includes(v)) void onSalvarTagsContato([...tagsContato, v])
                    }
                  }}
                />
                <button
                  type="button"
                  className="brs-messenger-toolbar-btn"
                  onClick={() => {
                    const v = novaTagContato.trim()
                    if (!v) return
                    setNovaTagContato('')
                    if (!tagsContato.includes(v)) void onSalvarTagsContato([...tagsContato, v])
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
            </section>

            <section>
              <button type="button" onClick={abrirHistorico} className="brs-messenger-pill-btn" style={{ width: '100%', justifyContent: 'center' }}>
                <History size={13} /> Histórico de chamados
              </button>
            </section>

            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', textTransform: 'uppercase' }}>Agendamentos</div>
                <button type="button" onClick={() => setModalAgendar(true)} className="brs-messenger-toolbar-btn" style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700 }}>
                  <CalendarClock size={11} /> Agendar
                </button>
              </div>
              {agendamentos.filter((a) => a.status === 'pendente').length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--msn-muted)' }}>Nenhum agendamento pendente.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {agendamentos
                    .filter((a) => a.status === 'pendente')
                    .map((a) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--msn-soft-border)', background: 'var(--msn-surface-alt)' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-text)' }}>{a.acao === 'mensagem' ? 'Mensagem' : 'Lembrete interno'}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--msn-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.texto}</div>
                          <div style={{ fontSize: 10, color: 'var(--msn-muted)' }}>{new Date(a.agendadoPara).toLocaleString('pt-BR')}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <input
                            type="datetime-local"
                            className="brs-messenger-search-input"
                            style={{ fontSize: 10, padding: '3px 4px', width: 130 }}
                            title="Reagendar"
                            onChange={(e) => {
                              if (e.target.value) void onReagendarAcao(a.id, new Date(e.target.value).toISOString())
                            }}
                          />
                          <button type="button" onClick={() => void onCancelarAgendamento(a.id)} className="brs-messenger-toolbar-btn" style={{ padding: 4 }} title="Cancelar">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Tags</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                {tagsConversa.map((t) => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', color: 'var(--msn-text)' }}>
                    {t}
                    <button type="button" onClick={() => void onSalvarTags(tagsConversa.filter((x) => x !== t))} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--msn-muted)' }}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {tagsConversa.length === 0 && <span style={{ fontSize: 11, color: 'var(--msn-muted)' }}>Nenhuma tag.</span>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  list="tags-conta-lista"
                  className="brs-messenger-search-input"
                  placeholder="Adicionar tag…"
                  value={novaTag}
                  onChange={(e) => setNovaTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && novaTag.trim()) {
                      e.preventDefault()
                      const v = novaTag.trim()
                      setNovaTag('')
                      if (!tagsConversa.includes(v)) void onSalvarTags([...tagsConversa, v])
                    }
                  }}
                />
                <datalist id="tags-conta-lista">
                  {tagsConta.map((t) => (
                    <option key={t.titulo} value={t.titulo} />
                  ))}
                </datalist>
                <button
                  type="button"
                  className="brs-messenger-toolbar-btn"
                  onClick={() => {
                    const v = novaTag.trim()
                    if (!v) return
                    setNovaTag('')
                    if (!tagsConversa.includes(v)) void onSalvarTags([...tagsConversa, v])
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Protocolo</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--msn-text)' }}>{conversa.atendimentoMeta?.protocolo || '—'}</code>
                {conversa.atendimentoMeta?.protocolo && (
                  <button type="button" onClick={copiarProtocolo} className="brs-messenger-toolbar-btn" style={{ padding: 4 }} title="Copiar">
                    {copiado ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Departamento</div>
              <div style={{ fontSize: 12.5, color: 'var(--msn-text)' }}>{departamento || '—'}</div>
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Atendente</div>
              <select
                className="brs-messenger-select"
                style={{ width: '100%' }}
                value={conversa.meta.assignee?.id || ''}
                onChange={(e) => void onAtribuirAgente(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sem atendente</option>
                {agentes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </section>

            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Observações</div>
              <textarea
                className="brs-messenger-composer-input"
                style={{ width: '100%', minHeight: 70 }}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                onBlur={() => {
                  if (observacoes !== (conversa.atendimentoMeta?.observacoes || '')) void onSalvarObservacoes(observacoes)
                }}
                placeholder="Anotações internas sobre este contato…"
              />
            </section>
          </>
        ) : (
          <AbaMembros conversationId={conversa.id} onSaiu={onFechar} />
        )}
      </div>

      {modalHistorico && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={() => setModalHistorico(false)}>
          <div
            style={{ background: 'var(--msn-surface)', borderRadius: 10, padding: 16, width: 'min(680px, 92vw)', maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--msn-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--msn-text)' }}>Histórico de chamados</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={exportarHistoricoCsv} className="brs-messenger-pill-btn" disabled={!historico?.length}>
                  Exportar CSV
                </button>
                <button type="button" onClick={() => setModalHistorico(false)} className="brs-messenger-toolbar-btn" style={{ padding: 5 }}>
                  <X size={13} />
                </button>
              </div>
            </div>
            {carregandoHistorico ? (
              <div style={{ fontSize: 12, color: 'var(--msn-muted)', padding: 12 }}>Carregando…</div>
            ) : !historico?.length ? (
              <div style={{ fontSize: 12, color: 'var(--msn-muted)', padding: 12 }}>Nenhum chamado anterior encontrado.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--msn-muted)', borderBottom: '1px solid var(--msn-soft-border)' }}>
                      <th style={{ padding: '6px 8px' }}>Conexão</th>
                      <th style={{ padding: '6px 8px' }}>Departamento</th>
                      <th style={{ padding: '6px 8px' }}>Atendente</th>
                      <th style={{ padding: '6px 8px' }}>Último atendimento</th>
                      <th style={{ padding: '6px 8px' }}>Protocolo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((h) => (
                      <tr key={h.conversationId} style={{ borderBottom: '1px solid var(--msn-soft-border)' }}>
                        <td style={{ padding: '6px 8px' }}>{h.conexaoNome}</td>
                        <td style={{ padding: '6px 8px' }}>{h.departamento || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{h.atendente || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{h.ultimoAtendimento ? new Date(h.ultimoAtendimento).toLocaleString('pt-BR') : '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{h.protocolo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {modalGaleria && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={() => setModalGaleria(false)}>
          <div
            style={{ background: 'var(--msn-surface)', borderRadius: 10, padding: 16, width: 'min(680px, 92vw)', maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--msn-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--msn-text)' }}>Mídias e documentos</div>
              <button type="button" onClick={() => setModalGaleria(false)} className="brs-messenger-toolbar-btn" style={{ padding: 5 }}>
                <X size={13} />
              </button>
            </div>
            {carregandoGaleria ? (
              <div style={{ fontSize: 12, color: 'var(--msn-muted)', padding: 12 }}>Carregando…</div>
            ) : !galeria?.length ? (
              <div style={{ fontSize: 12, color: 'var(--msn-muted)', padding: 12 }}>Nenhum arquivo nesta conversa.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {galeria.map((g) => (
                  <a
                    key={g.id}
                    href={g.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', display: 'grid', placeItems: 'center' }}
                  >
                    {g.tipo === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--msn-muted)' }}>arquivo</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {modalAgendar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={() => setModalAgendar(false)}>
          <div style={{ background: 'var(--msn-surface)', borderRadius: 10, padding: 16, width: 'min(420px, 92vw)', border: '1px solid var(--msn-border)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--msn-text)' }}>Agendar ação</div>
              <button type="button" onClick={() => setModalAgendar(false)} className="brs-messenger-toolbar-btn" style={{ padding: 5 }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {(['mensagem', 'lembrete_interno'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAgendarAcaoTipo(t)}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '6px 0',
                    borderRadius: 6,
                    border: `1px solid ${agendarAcaoTipo === t ? 'var(--msn-accent)' : 'var(--msn-soft-border)'}`,
                    background: agendarAcaoTipo === t ? 'var(--msn-accent)' : 'transparent',
                    color: agendarAcaoTipo === t ? '#fff' : 'var(--msn-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {t === 'mensagem' ? 'Enviar mensagem' : 'Lembrete interno'}
                </button>
              ))}
            </div>
            <textarea
              className="brs-messenger-composer-input"
              style={{ width: '100%', minHeight: 70, marginBottom: 8 }}
              value={agendarTexto}
              onChange={(e) => setAgendarTexto(e.target.value)}
              placeholder={agendarAcaoTipo === 'mensagem' ? 'Texto da mensagem a enviar…' : 'Texto do lembrete…'}
            />
            <input type="datetime-local" className="brs-messenger-search-input" style={{ width: '100%', marginBottom: 12 }} value={agendarData} onChange={(e) => setAgendarData(e.target.value)} />
            <button
              type="button"
              onClick={() => void confirmarAgendamento()}
              disabled={!agendarTexto.trim() || !agendarData}
              className="brs-messenger-pill-btn"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Agendar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Aba Membros do painel de grupo (Fase C) — busca sob demanda, com "Atualizar". */
function AbaMembros({ conversationId, onSaiu }: { conversationId: number; onSaiu?: () => void }) {
  const [grupo, setGrupo] = useState<GrupoDetalhado | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [modalAdicionar, setModalAdicionar] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState(false)
  const [confirmarSaida, setConfirmarSaida] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const r = await getGrupo(conversationId)
      if (!r.ok) {
        setErro(r.error)
        return
      }
      setGrupo(r.grupo)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar o grupo.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  async function acaoParticipante(jid: string, acao: 'remove' | 'promote' | 'demote') {
    setOcupado(jid)
    try {
      const r = await alterarParticipantes(conversationId, acao, [jid])
      if (!r.ok) {
        setErro(r.error)
        return
      }
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha na ação.')
    } finally {
      setOcupado(null)
    }
  }

  async function copiarLink() {
    try {
      const r = await linkConvite(conversationId)
      if (!r.ok) {
        setErro(r.error)
        return
      }
      await navigator.clipboard.writeText(r.link)
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 1500)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao obter o link.')
    }
  }

  async function confirmarSairGrupo() {
    setOcupado('__sair__')
    try {
      const r = await sairDoGrupo(conversationId)
      if (!r.ok) {
        setErro(r.error)
        setOcupado(null)
        return
      }
      setConfirmarSaida(false)
      onSaiu?.()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao sair do grupo.')
      setOcupado(null)
    }
  }

  if (carregando) return <div style={{ fontSize: 12, color: 'var(--msn-muted)' }}>Carregando…</div>

  if (erro && !grupo) return <div style={{ fontSize: 12, color: '#b91c1c' }}>{erro}</div>

  if (!grupo) return null

  if (grupo.provedor !== 'baileys') {
    return <div style={{ fontSize: 12, color: 'var(--msn-muted)' }}>Gestão de grupo só em conexões Baileys.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {erro && <div style={{ fontSize: 11.5, color: '#b91c1c' }}>{erro}</div>}
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--msn-text)' }}>{grupo.nome}</div>
        {grupo.descricao && <div style={{ fontSize: 11.5, color: 'var(--msn-muted)', marginTop: 2 }}>{grupo.descricao}</div>}
        <div style={{ fontSize: 11, color: 'var(--msn-muted)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
          {grupo.membros.length} membros
          {grupo.souAdmin && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(0,120,215,0.14)', color: '#0f4c81' }}>Você é admin</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {grupo.souAdmin && (
          <button type="button" onClick={() => setModalAdicionar(true)} className="brs-messenger-pill-btn">
            <Plus size={12} /> Adicionar membros
          </button>
        )}
        <button type="button" onClick={() => void copiarLink()} className="brs-messenger-pill-btn">
          <Copy size={12} /> {linkCopiado ? 'Copiado!' : 'Copiar link de convite'}
        </button>
        <button type="button" onClick={() => setConfirmarSaida(true)} className="brs-messenger-pill-btn" style={{ color: '#b91c1c' }}>
          <LogOut size={12} /> Sair do grupo
        </button>
        <button type="button" onClick={() => void carregar()} className="brs-messenger-toolbar-btn" style={{ padding: '4px 8px', fontSize: 10.5 }}>
          Atualizar
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {grupo.membros.map((m) => (
          <div key={m.jid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, color: 'var(--msn-text)' }}>
            <AvatarContato nome={m.nome || m.numero} tamanho={26} fontSize={11} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nome || m.numero}</div>
            </div>
            {m.admin && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'rgba(22,163,74,0.14)', color: '#15803d' }}>Admin</span>
            )}
            {m.eu && <span style={{ fontSize: 9.5, color: 'var(--msn-muted)' }}>você</span>}
            {grupo.souAdmin && !m.eu && (
              <MenuMembro ocupado={ocupado === m.jid} admin={m.admin} onAcao={(acao) => void acaoParticipante(m.jid, acao)} />
            )}
          </div>
        ))}
      </div>

      {modalAdicionar && (
        <ModalAdicionarMembros
          instanciaId={grupo.instanciaId}
          conversationId={conversationId}
          onFechar={() => setModalAdicionar(false)}
          onAdicionado={async () => {
            setModalAdicionar(false)
            await carregar()
          }}
        />
      )}

      {confirmarSaida && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 210 }} onClick={() => setConfirmarSaida(false)}>
          <div style={{ background: 'var(--msn-surface)', borderRadius: 10, padding: 16, width: 'min(360px, 92vw)', border: '1px solid var(--msn-border)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--msn-text)', marginBottom: 8 }}>Sair do grupo?</div>
            <div style={{ fontSize: 12, color: 'var(--msn-muted)', marginBottom: 14 }}>Esta conexão sai do grupo e a conversa é encerrada. Continuar?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setConfirmarSaida(false)} className="brs-messenger-toolbar-btn" style={{ flex: 1, padding: '7px 0' }}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarSairGrupo()}
                disabled={ocupado === '__sair__'}
                className="brs-messenger-pill-btn"
                style={{ flex: 1, justifyContent: 'center', background: '#b91c1c', color: '#fff' }}
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuMembro({ admin, ocupado, onAcao }: { admin: boolean; ocupado: boolean; onAcao: (acao: 'remove' | 'promote' | 'demote') => void }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" disabled={ocupado} onClick={() => setAberto((v) => !v)} className="brs-messenger-toolbar-btn" style={{ padding: 4 }}>
        <ChevronDown size={12} />
      </button>
      {aberto && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: 'var(--msn-surface)', border: '1px solid var(--msn-border)', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,.15)', minWidth: 160, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => {
              setAberto(false)
              onAcao(admin ? 'demote' : 'promote')
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', fontSize: 11.5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--msn-text)' }}
          >
            {admin ? <ShieldOff size={12} /> : <Shield size={12} />} {admin ? 'Rebaixar de admin' : 'Promover a admin'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAberto(false)
              if (confirm('Remover este membro do grupo?')) onAcao('remove')
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', fontSize: 11.5, background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}
          >
            <UserMinus size={12} /> Remover do grupo
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Modal "Adicionar membros" — busca em buscarContatosConexao (paginada,
 * multi-seleção) + campo de número avulso E.164. Reusa a resolução de
 * instância pela conversa (a action deriva jid/instancia do lado do
 * servidor); aqui só precisamos do conversationId.
 */
function ModalAdicionarMembros({
  instanciaId,
  conversationId,
  onFechar,
  onAdicionado,
}: {
  instanciaId: string
  conversationId: number
  onFechar: () => void
  onAdicionado: () => Promise<void>
}) {
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<ContatoConexao[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [numeroAvulso, setNumeroAvulso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
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
    const jids = [...selecionados]
    const avulso = numeroAvulso.trim()
    if (avulso) jids.push(avulso)
    if (!jids.length) return
    setSalvando(true)
    try {
      const r = await alterarParticipantes(conversationId, 'add', jids)
      if (!r.ok) {
        setErro(r.error)
        return
      }
      await onAdicionado()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao adicionar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 210 }} onClick={onFechar}>
      <div style={{ background: 'var(--msn-surface)', borderRadius: 10, padding: 16, width: 'min(420px, 92vw)', maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--msn-border)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--msn-text)' }}>Adicionar membros</div>
          <button type="button" onClick={onFechar} className="brs-messenger-toolbar-btn" style={{ padding: 5 }}>
            <X size={13} />
          </button>
        </div>
        {erro && <div style={{ fontSize: 11.5, color: '#b91c1c', marginBottom: 8 }}>{erro}</div>}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--msn-muted)' }} />
          <input className="brs-messenger-search-input" style={{ width: '100%', paddingLeft: 26 }} placeholder="Buscar contato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
          {itens.map((c) => (
            <label key={c.jid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={selecionados.has(c.jid)} onChange={() => alternar(c.jid)} />
              <AvatarContato nome={c.nome || c.numero} tamanho={22} fontSize={10} />
              {c.nome || c.numero}
            </label>
          ))}
          {!itens.length && <div style={{ fontSize: 11, color: 'var(--msn-muted)' }}>Digite pra buscar contatos da conexão.</div>}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 4 }}>Número avulso (DDI+DDD+número)</div>
        <input className="brs-messenger-search-input" style={{ width: '100%', marginBottom: 12 }} placeholder="Ex.: 5511999999999" value={numeroAvulso} onChange={(e) => setNumeroAvulso(e.target.value)} />
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={salvando || (!selecionados.size && !numeroAvulso.trim())}
          className="brs-messenger-pill-btn"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {salvando ? 'Adicionando…' : 'Adicionar'}
        </button>
      </div>
    </div>
  )
}
