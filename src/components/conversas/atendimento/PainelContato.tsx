'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BellOff, Check, Copy, MailOpen, Plus, Search, X } from 'lucide-react'
import {
  VINCULO_COR,
  VINCULO_LABEL,
  ehGrupo,
  iniciais,
  type AgenteChat,
  type ChatwootMensagem,
  type ConversaAtendimento,
  type EntidadeBusca,
  type EntidadeTipo,
  type TagConta,
} from './types'

type Aba = 'geral' | 'membros'

type Props = {
  conversa: ConversaAtendimento
  mensagens: ChatwootMensagem[]
  agentes: AgenteChat[]
  tagsConta: TagConta[]
  tagsConversa: string[]
  departamento: string | null
  onFechar?: () => void
  onSilenciar: (v: boolean) => Promise<void>
  onMarcarNaoLida: () => Promise<void>
  onVincular: (tipo: EntidadeTipo | null, id: string | null) => Promise<void>
  onSalvarObservacoes: (texto: string) => Promise<void>
  onSalvarTags: (tags: string[]) => Promise<void>
  onTransferir: (agenteId: number) => Promise<void>
  buscarEntidades: (q: string) => Promise<{ parceiros: EntidadeBusca[]; instituicoes: EntidadeBusca[]; promotoras: EntidadeBusca[] }>
  /**
   * Participantes do grupo — payload do Chatwoot/engine não expõe isso ainda
   * nesta fase (nenhuma action do contrato retorna participantes de grupo).
   * A aba Membros só aparece quando esta lista existir e não for vazia;
   * enquanto ninguém alimentar essa prop, fica oculta (regra do contrato).
   */
  membros?: Array<{ id: string; nome: string }>
}

const TIPOS: EntidadeTipo[] = ['parceiro', 'instituicao', 'promotora']

export default function PainelContato({
  conversa,
  mensagens,
  agentes,
  tagsConta,
  tagsConversa,
  departamento,
  onFechar,
  onSilenciar,
  onMarcarNaoLida,
  onVincular,
  onSalvarObservacoes,
  onSalvarTags,
  onTransferir,
  buscarEntidades,
  membros,
}: Props) {
  const [aba, setAba] = useState<Aba>('geral')
  const [silenciada, setSilenciada] = useState(false)
  const [buscaEntidade, setBuscaEntidade] = useState('')
  const [tipoBusca, setTipoBusca] = useState<EntidadeTipo>('parceiro')
  const [resultados, setResultados] = useState<EntidadeBusca[]>([])
  const [buscandoEntidade, setBuscandoEntidade] = useState(false)
  const [novaTag, setNovaTag] = useState('')
  const [observacoes, setObservacoes] = useState(conversa.atendimentoMeta?.observacoes || '')
  const [copiado, setCopiado] = useState(false)

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

  // A função vem do hook e muda de identidade a cada render — se entrasse nas
  // dependências, o próprio setBuscandoEntidade(true) invalidaria a busca em
  // loop ("Buscando…" eterno). Ref estável resolve.
  const buscarRef = useRef(buscarEntidades)
  useEffect(() => {
    buscarRef.current = buscarEntidades
  })

  useEffect(() => {
    const termo = buscaEntidade.trim()
    if (!termo) return
    let vivo = true
    const t = setTimeout(() => {
      // setState só dentro do callback do debounce (nunca síncrono no corpo
      // do efeito) — é o que mantém essa busca fora do alcance do lint
      // react-hooks/set-state-in-effect.
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

  function copiarProtocolo() {
    const protocolo = conversa.atendimentoMeta?.protocolo
    if (!protocolo) return
    void navigator.clipboard.writeText(protocolo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1500)
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
          }}
        >
          {iniciais(conversa.meta.sender?.name)}
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

      {midias.length > 0 && (
        <div style={{ padding: 12, borderBottom: '1px solid var(--msn-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Mídias e documentos</div>
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
        </div>
      )}

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
            <section>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Vincular a</div>
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
                onChange={(e) => e.target.value && void onTransferir(Number(e.target.value))}
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
    </div>
  )
}
