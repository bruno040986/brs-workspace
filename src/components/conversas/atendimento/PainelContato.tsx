'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, CalendarClock, Check, Copy, History, Images, MailOpen, Plus, Search, Trash2, X } from 'lucide-react'
import type { DepartamentoResumo } from '@/lib/central-conversas/actions'
import {
  VINCULO_COR,
  VINCULO_LABEL,
  ehGrupo,
  iniciais,
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
  /**
   * Participantes do grupo — payload do Chatwoot/engine não expõe isso ainda
   * nesta fase (nenhuma action do contrato retorna participantes de grupo).
   * A aba Membros só aparece quando esta lista existir e não for vazia;
   * enquanto ninguém alimentar essa prop, fica oculta (regra do contrato).
   */
  membros?: Array<{ id: string; nome: string }>
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
  membros,
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
        <div
          style={{
            width: 64,
            height: 64,
            margin: '0 auto 8px',
            borderRadius: grupo ? 14 : 99,
            background: 'var(--msn-avatar-bg)',
            color: 'var(--msn-avatar-text)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 24,
            border: '1px solid var(--msn-border)',
            overflow: 'hidden',
          }}
        >
          {conversa.meta.sender?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conversa.meta.sender.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            iniciais(conversa.meta.sender?.name)
          )}
        </div>
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
          id === 'membros' && !membros?.length ? null : (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(membros || []).map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--msn-text)' }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    background: 'var(--msn-avatar-bg)',
                    color: 'var(--msn-avatar-text)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: 11,
                    flexShrink: 0,
                    border: '1px solid var(--msn-border)',
                  }}
                >
                  {iniciais(m.nome)}
                </span>
                {m.nome}
              </div>
            ))}
          </div>
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
