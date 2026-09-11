'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Sparkles,
  ThumbsDown,
} from 'lucide-react'
import type { FormaContratoAtiva, InstituicaoAtiva } from '../../bc-actions'
import type { PublicoAtendido } from '../../cadastros-actions'
import {
  aceitarSugestao,
  aceitarTodasDaFonte,
  cancelarPesquisa,
  confirmarFonte,
  descartarFonte,
  getFonteUrl,
  getHistoricoPesquisas,
  rejeitarSugestao,
  type PesquisaHistoricoItem,
} from '../../pesquisa-actions'

type Pesquisa = {
  id: string
  status: string
  etapa_msg: string | null
  progresso: number
  resumo: string | null
  nao_encontrado: string[]
  erro: string | null
  tentativas: number
}

type Fonte = {
  id: string
  url: string | null
  titulo: string | null
  tipo_norma: string
  numero: string | null
  ano: number | null
  ente_citado: string | null
  ente_detectado: string | null
  uf_detectada: string | null
  status: string
  motivo: string | null
  arquivo_path: string | null
  extraida_em: string | null
  confirmada_em: string | null
  ordem: number
}

type Sugestao = {
  id: string
  fonte_id: string
  secao: 'geral' | 'publicos' | 'formas' | 'faq' | 'observacao'
  campo: string
  valor: any
  valor_atual: any
  citacao: string
  artigo: string | null
  status: string
}

const STATUS_ATIVO = new Set(['pendente', 'buscando', 'baixando', 'extraindo'])

const ETAPA_LABEL: Record<string, string> = {
  pendente: 'Preparando...',
  buscando: 'Pesquisando na web',
  baixando: 'Baixando e conferindo as fontes',
  extraindo: 'Extraindo sugestões',
  concluida: 'Concluída',
  erro: 'Erro',
  cancelada: 'Cancelada',
}

const FONTE_STATUS_INFO: Record<string, { label: string; badge: string }> = {
  candidata: { label: 'Baixando...', badge: 'badge-gray' },
  falha_download: { label: 'Falha no download', badge: 'badge-danger' },
  sem_texto: { label: 'Sem texto (PDF escaneado?)', badge: 'badge-warning' },
  verificada: { label: 'Ente confirmado', badge: 'badge-success' },
  ente_divergente: { label: 'Ente divergente — descartada', badge: 'badge-danger' },
  nao_verificada: { label: 'Não foi possível confirmar o ente', badge: 'badge-warning' },
  descartada: { label: 'Descartada', badge: 'badge-gray' },
  importada: { label: 'Importada como documento', badge: 'badge-success' },
}

const CAMPO_GERAL_LABEL: Record<string, string> = {
  max_comprometimento_salarial: 'Teto de Comprometimento Salarial (%)',
  prazo_minimo_geral: 'Prazo Mínimo Geral (meses)',
  prazo_maximo_geral: 'Prazo Máximo Geral (meses)',
  numero_servidores: 'Número de Servidores',
}

function formatarFonteTitulo(f: Fonte): string {
  const partes = [f.titulo, f.numero ? `nº ${f.numero}` : null, f.ano ? String(f.ano) : null].filter(Boolean)
  return partes.length > 0 ? partes.join(' ') : f.url || 'Fonte sem título'
}

export default function PesquisaTab({
  convenioId,
  formasAtivas,
  publicosAtivos,
  instituicoesAtivas,
  onSaved,
}: {
  convenioId: string
  formasAtivas: FormaContratoAtiva[]
  publicosAtivos: PublicoAtendido[]
  instituicoesAtivas: InstituicaoAtiva[]
  onSaved: () => void
}) {
  void instituicoesAtivas

  const [pesquisa, setPesquisa] = useState<Pesquisa | null>(null)
  const [fontes, setFontes] = useState<Fonte[]>([])
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [loading, setLoading] = useState(true)
  const [iniciando, setIniciando] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [correspondencias, setCorrespondencias] = useState<Record<string, string>>({}) // sugestaoId -> id escolhido
  const [historico, setHistorico] = useState<PesquisaHistoricoItem[] | null>(null)
  const [historicoAberto, setHistoricoAberto] = useState(false)

  const avancandoRef = useRef(false)
  const montadoRef = useRef(true)

  async function carregarEstado() {
    const res = await fetch(`/api/convenios/${convenioId}/pesquisa`, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.success) {
      setMessage({ type: 'error', text: data?.error || 'Erro ao carregar a pesquisa.' })
      return
    }
    setPesquisa(data.pesquisa)
    setFontes(data.fontes || [])
    setSugestoes(data.sugestoes || [])
  }

  useEffect(() => {
    montadoRef.current = true
    setLoading(true)
    carregarEstado().finally(() => setLoading(false))
    return () => {
      montadoRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioId])

  // Laço de "avançar" enquanto a pesquisa estiver ativa.
  useEffect(() => {
    if (!pesquisa || !STATUS_ATIVO.has(pesquisa.status)) return
    if (avancandoRef.current) return
    avancandoRef.current = true

    let cancelado = false
    async function ciclo() {
      while (!cancelado && montadoRef.current) {
        try {
          const res = await fetch(`/api/convenios/${convenioId}/pesquisa/avancar`, { method: 'POST' })
          const data = await res.json().catch(() => null)
          if (cancelado || !montadoRef.current) break
          if (!res.ok || !data?.success) {
            setMessage({ type: 'error', text: data?.error || 'Erro ao processar a pesquisa.' })
            break
          }
          setPesquisa(data.pesquisa)
          if (!STATUS_ATIVO.has(data.pesquisa.status)) {
            await carregarEstado()
            if (data.pesquisa.status === 'concluida') onSaved()
            break
          }
          // recarrega fontes/sugestões a cada rodada pra tela ir enchendo aos poucos
          await carregarEstado()
        } catch {
          break
        }
        await new Promise((r) => setTimeout(r, 1200))
      }
      avancandoRef.current = false
    }
    ciclo()

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pesquisa?.status, convenioId])

  async function iniciarPesquisa() {
    setIniciando(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/convenios/${convenioId}/pesquisa`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setMessage({ type: 'error', text: data?.error || 'Erro ao iniciar a pesquisa.' })
        return
      }
      setPesquisa(data.pesquisa)
      setFontes([])
      setSugestoes([])
    } finally {
      setIniciando(false)
    }
  }

  async function handleCancelar() {
    if (!pesquisa) return
    setBusyId(pesquisa.id)
    try {
      const res = await cancelarPesquisa(pesquisa.id)
      if (res.success) await carregarEstado()
      else setMessage({ type: 'error', text: res.error || 'Erro ao cancelar.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmarFonte(fonteId: string) {
    setBusyId(fonteId)
    try {
      const res = await confirmarFonte(fonteId)
      if (res.success) await carregarEstado()
      else setMessage({ type: 'error', text: res.error || 'Erro ao confirmar a fonte.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDescartarFonte(fonteId: string) {
    setBusyId(fonteId)
    try {
      const res = await descartarFonte(fonteId)
      if (res.success) await carregarEstado()
      else setMessage({ type: 'error', text: res.error || 'Erro ao descartar a fonte.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleAbrirFonte(fonteId: string) {
    const res = await getFonteUrl(fonteId)
    if (res.success && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
    else setMessage({ type: 'error', text: res.error || 'Erro ao abrir a fonte.' })
  }

  async function handleAceitar(sugestao: Sugestao) {
    setBusyId(sugestao.id)
    setMessage(null)
    try {
      let valorEditado: Record<string, unknown> | undefined
      if (sugestao.campo === 'forma:?') {
        const escolhido = correspondencias[sugestao.id]
        if (!escolhido) {
          setMessage({ type: 'error', text: 'Escolha a forma de contrato correspondente antes de aceitar.' })
          return
        }
        valorEditado = { forma_contrato_id: escolhido }
      } else if (sugestao.campo === 'publico:?') {
        const escolhido = correspondencias[sugestao.id]
        if (!escolhido) {
          setMessage({ type: 'error', text: 'Escolha o público correspondente antes de aceitar.' })
          return
        }
        valorEditado = { publico_id: escolhido }
      }
      const res = await aceitarSugestao(sugestao.id, valorEditado)
      if (res.success) {
        await carregarEstado()
        onSaved()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao aceitar a sugestão.' })
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleRejeitar(sugestaoId: string) {
    setBusyId(sugestaoId)
    try {
      const res = await rejeitarSugestao(sugestaoId)
      if (res.success) await carregarEstado()
      else setMessage({ type: 'error', text: res.error || 'Erro ao rejeitar a sugestão.' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleAceitarTodasDaFonte(fonteId: string) {
    setBusyId(fonteId)
    setMessage(null)
    try {
      const res = await aceitarTodasDaFonte(fonteId)
      if (res.success) {
        await carregarEstado()
        onSaved()
        if (res.falhas && res.falhas.length > 0) {
          setMessage({ type: 'error', text: `${res.aplicadas} aceita(s). Pendências: ${res.falhas.join(' ')}` })
        } else {
          setMessage({ type: 'success', text: `${res.aplicadas} sugestão(ões) aceita(s).` })
        }
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao aceitar as sugestões.' })
      }
    } finally {
      setBusyId(null)
    }
  }

  async function toggleHistorico() {
    if (!historicoAberto && historico === null) {
      const res = await getHistoricoPesquisas(convenioId)
      if (res.success) setHistorico(res.items || [])
    }
    setHistoricoAberto((v) => !v)
  }

  function nomeForma(id: string) {
    return formasAtivas.find((f) => f.id === id)?.nome
  }
  function nomePublico(id: string) {
    return publicosAtivos.find((p) => p.id === id)?.nome
  }

  function renderValorSugestao(s: Sugestao) {
    if (s.secao === 'geral') {
      const atual = s.valor_atual?.numero
      return (
        <div>
          <strong>{CAMPO_GERAL_LABEL[s.campo] || s.campo}:</strong> {s.valor?.numero}
          {atual != null && atual !== s.valor?.numero && <span style={{ color: 'var(--brs-gray-500)' }}> (atual: {atual})</span>}
        </div>
      )
    }
    if (s.secao === 'formas') {
      const nome = s.campo !== 'forma:?' ? nomeForma(s.valor?.forma_contrato_id) : null
      return (
        <div>
          <strong>{nome || s.valor?.nome_no_documento || 'Forma não identificada'}:</strong> {s.valor?.percentual_margem}% de margem
          {s.campo === 'forma:?' && (
            <div style={{ marginTop: '0.4rem' }}>
              <select
                className="form-control"
                style={{ maxWidth: 320 }}
                value={correspondencias[s.id] || ''}
                onChange={(e) => setCorrespondencias((prev) => ({ ...prev, [s.id]: e.target.value }))}
              >
                <option value="">Qual forma de contrato é essa?</option>
                {formasAtivas.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )
    }
    if (s.secao === 'publicos') {
      const nome = s.campo !== 'publico:?' ? nomePublico(s.valor?.publico_id) : null
      return (
        <div>
          <strong>{nome || s.valor?.nome_no_documento || 'Público não identificado'}</strong>
          {s.campo === 'publico:?' && (
            <div style={{ marginTop: '0.4rem' }}>
              <select
                className="form-control"
                style={{ maxWidth: 320 }}
                value={correspondencias[s.id] || ''}
                onChange={(e) => setCorrespondencias((prev) => ({ ...prev, [s.id]: e.target.value }))}
              >
                <option value="">Qual público é esse?</option>
                {publicosAtivos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )
    }
    if (s.secao === 'faq') {
      return (
        <div>
          <strong>{s.valor?.pergunta}</strong>
          <div style={{ color: 'var(--brs-gray-600)', marginTop: '0.2rem' }}>{s.valor?.resposta}</div>
        </div>
      )
    }
    return <div>{s.valor?.texto}</div>
  }

  const podeAceitar = (s: Sugestao) => {
    if (s.campo === 'forma:?' || s.campo === 'publico:?') return !!correspondencias[s.id]
    return true
  }

  const fonteTitulo = (id: string) => {
    const f = fontes.find((x) => x.id === id)
    return f ? formatarFonteTitulo(f) : ''
  }

  const sugestoesPendentes = sugestoes.filter((s) => s.status === 'pendente')
  const sugestoesPorFonte = new Map<string, Sugestao[]>()
  for (const s of sugestoesPendentes) {
    const arr = sugestoesPorFonte.get(s.fonte_id) || []
    arr.push(s)
    sugestoesPorFonte.set(s.fonte_id, arr)
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  const pesquisaAtiva = pesquisa && STATUS_ATIVO.has(pesquisa.status)

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800 }}>
            <Sparkles size={16} />
            Pesquisa com o Jarvis
          </div>
          {!pesquisaAtiva && (
            <button type="button" className="btn btn-primary" onClick={iniciarPesquisa} disabled={iniciando}>
              {iniciando ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />}
              {pesquisa ? 'Pesquisar novamente' : 'Pesquisar com o Jarvis'}
            </button>
          )}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)', marginTop: '0.5rem' }}>
          O Jarvis busca decretos e leis oficiais do ente deste convênio na web, confere se o texto é realmente
          deste ente (nunca confia na palavra da IA sozinha) e sugere o preenchimento da Base de Conhecimento —
          você decide o que aceitar. Usa um modelo pago, configurado em <strong>Configurações › IA do Workspace</strong>.
        </div>

        {pesquisa && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{ETAPA_LABEL[pesquisa.status] || pesquisa.status}</span>
              {pesquisaAtiva && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleCancelar} disabled={busyId === pesquisa.id}>
                  {busyId === pesquisa.id ? <Loader2 size={14} className="spinner" /> : 'Cancelar'}
                </button>
              )}
            </div>
            {pesquisaAtiva && (
              <>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--brs-gray-100)', overflow: 'hidden' }}>
                  <div style={{ width: `${pesquisa.progresso}%`, height: '100%', background: 'var(--brs-navy)', transition: 'width 0.3s' }} />
                </div>
                {pesquisa.etapa_msg && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginTop: '0.3rem' }}>{pesquisa.etapa_msg}</div>}
              </>
            )}
            {pesquisa.status === 'erro' && (
              <div style={{ fontSize: '0.85rem', color: '#991B1B', marginTop: '0.3rem' }}>
                Erro após {pesquisa.tentativas} tentativa(s): {pesquisa.erro}
              </div>
            )}
            {pesquisa.status === 'concluida' && pesquisa.resumo && (
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-700)', marginTop: '0.5rem', padding: '0.6rem 0.8rem', background: 'var(--brs-gray-50)', borderRadius: 8 }}>
                {pesquisa.resumo}
              </div>
            )}
            {pesquisa.status === 'concluida' && pesquisa.nao_encontrado && pesquisa.nao_encontrado.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Não encontrado — complete manualmente:</div>
                <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--brs-gray-600)' }}>
                  {pesquisa.nao_encontrado.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {fontes.length > 0 && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontWeight: 800, marginBottom: '0.75rem' }}>Fontes</div>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {fontes.map((f) => {
              const info = FONTE_STATUS_INFO[f.status] || { label: f.status, badge: 'badge-gray' }
              return (
                <div key={f.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{formatarFonteTitulo(f)}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.2rem' }}>
                        <span className={`badge ${info.badge}`}>{info.label}</span>
                        {f.motivo && <span style={{ marginLeft: '0.5rem' }}>{f.motivo}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {f.url && (
                        <a href={f.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Abrir link original">
                          <ExternalLink size={14} />
                        </a>
                      )}
                      {f.arquivo_path && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleAbrirFonte(f.id)} title="Abrir cópia guardada">
                          Cópia guardada
                        </button>
                      )}
                      {f.status === 'nao_verificada' && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => handleConfirmarFonte(f.id)} disabled={busyId === f.id}>
                          {busyId === f.id ? <Loader2 size={14} className="spinner" /> : 'Confirmar fonte'}
                        </button>
                      )}
                      {!['descartada', 'importada'].includes(f.status) && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDescartarFonte(f.id)} disabled={busyId === f.id}>
                          Descartar
                        </button>
                      )}
                    </div>
                  </div>

                  {(sugestoesPorFonte.get(f.id) || []).length > 0 && (
                    <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid var(--brs-gray-100)', display: 'grid', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>
                          {(sugestoesPorFonte.get(f.id) || []).length} sugestão(ões)
                        </span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAceitarTodasDaFonte(f.id)} disabled={busyId === f.id}>
                          {busyId === f.id ? <Loader2 size={13} className="spinner" /> : <Check size={13} />}
                          Aceitar todas desta fonte
                        </button>
                      </div>
                      {(sugestoesPorFonte.get(f.id) || []).map((s) => (
                        <div key={s.id} style={{ background: 'var(--brs-gray-50)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                          <div style={{ fontSize: '0.85rem' }}>{renderValorSugestao(s)}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginTop: '0.4rem', fontStyle: 'italic', borderLeft: '3px solid var(--brs-gray-200)', paddingLeft: '0.5rem' }}>
                            "{s.citacao}"{s.artigo ? ` — ${s.artigo}` : ''}
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAceitar(s)}
                              disabled={busyId === s.id || !podeAceitar(s)}
                            >
                              {busyId === s.id ? <Loader2 size={13} className="spinner" /> : <Check size={13} />}
                              Aceitar
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRejeitar(s.id)} disabled={busyId === s.id}>
                              <ThumbsDown size={13} />
                              Rejeitar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sugestoes.some((s) => s.status !== 'pendente') && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontWeight: 800, marginBottom: '0.5rem', fontSize: '0.85rem' }}>Sugestões já decididas</div>
          <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>
            {sugestoes
              .filter((s) => s.status !== 'pendente')
              .map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span>{fonteTitulo(s.fonte_id)} — {s.secao}/{s.campo}</span>
                  <span
                    className={`badge ${
                      s.status === 'aceita' || s.status === 'editada' ? 'badge-success' : s.status === 'rejeitada' ? 'badge-gray' : 'badge-gray'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleHistorico} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {historicoAberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Histórico de pesquisas
        </button>
        {historicoAberto && (
          <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
            {(historico || []).length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>Nenhuma pesquisa anterior.</div>
            ) : (
              (historico || []).map((h) => (
                <div key={h.id} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.3rem' }}>
                  <span>
                    {new Date(h.created_at).toLocaleString('pt-BR')} — {h.origem === 'documento' ? 'leitura de documento' : 'pesquisa web'} —{' '}
                    {ETAPA_LABEL[h.status] || h.status}
                    {h.resumo ? ` — ${h.resumo}` : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
