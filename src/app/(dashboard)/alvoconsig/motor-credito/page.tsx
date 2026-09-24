'use client'

/**
 * Revisão da API Kaizom (`motor_credito_consultas`, Fase 2 §4 do handoff):
 * lotes (tarefa_id) à esquerda com contadores por status, detalhe do lote
 * selecionado à direita — aprovar/rejeitar linhas, definir o convênio do
 * lote quando a Kaizom não mandou (ou o de-para ainda não casou), enviar as
 * aprovadas ao WeSales. Padrão visual de alvoconsig/importacoes.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, ChevronRight, Loader2, Save, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import { maskCpf } from '@/lib/company-bank-accounts'
import {
  definirConvenioLoteKaizom,
  listarConveniosParaRevisao,
  listarLinhasKaizom,
  listarLotesKaizom,
  revisarLinhasKaizom,
  type ConvenioOpcao,
  type LinhaStaging,
  type LoteKaizom,
  type StatusStaging,
} from '@/lib/motor-credito/staging-actions'

type FeedbackMessage = { type: 'success' | 'error'; text: string }

const STATUS_LABEL: Record<StatusStaging, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  rejeitada: 'Rejeitada',
  falha: 'Falha (Kaizom)',
  enviando: 'Enviando…',
  enviada: 'Enviada',
  erro_envio: 'Erro no envio',
}

const STATUS_BADGE: Record<StatusStaging, string> = {
  pendente: 'badge-gray',
  aprovada: 'badge-info',
  rejeitada: 'badge-warning',
  falha: 'badge-danger',
  enviando: 'badge-gray',
  enviada: 'badge-success',
  erro_envio: 'badge-danger',
}

function fmtMoney(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}

function loteChave(l: LoteKaizom): string {
  return String(l.tarefaId ?? 'sem-tarefa')
}

export default function MotorCreditoRevisaoPage() {
  const [lotes, setLotes] = useState<LoteKaizom[]>([])
  const [convenios, setConvenios] = useState<ConvenioOpcao[]>([])
  const [loadingLotes, setLoadingLotes] = useState(true)
  const [loteAtivo, setLoteAtivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaStaging[]>([])
  const [loadingLinhas, setLoadingLinhas] = useState(false)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [processando, setProcessando] = useState(false)
  const [convenioEscolhido, setConvenioEscolhido] = useState('')
  const [lembrarConvenio, setLembrarConvenio] = useState(true)

  async function carregarLotes() {
    setLoadingLotes(true)
    const [lotesRes, convRes] = await Promise.all([listarLotesKaizom(), listarConveniosParaRevisao()])
    if (lotesRes.success) setLotes(lotesRes.data || [])
    else setMessage({ type: 'error', text: lotesRes.error || 'Erro ao carregar lotes.' })
    if (convRes.success) setConvenios(convRes.data || [])
    setLoadingLotes(false)
  }

  useEffect(() => {
    carregarLotes()
  }, [])

  const lote = useMemo(() => lotes.find((l) => loteChave(l) === loteAtivo) || null, [lotes, loteAtivo])

  async function abrirLote(l: LoteKaizom) {
    const chave = loteChave(l)
    setLoteAtivo(chave)
    setSelecionadas(new Set())
    setMessage(null)
    setConvenioEscolhido(l.convenioId || '')
    setLoadingLinhas(true)
    const res = await listarLinhasKaizom(l.tarefaId)
    if (res.success) setLinhas(res.data || [])
    else setMessage({ type: 'error', text: res.error || 'Erro ao carregar as linhas do lote.' })
    setLoadingLinhas(false)
  }

  async function recarregarLoteAtivo() {
    if (!lote) return
    const [lotesRes, linhasRes] = await Promise.all([listarLotesKaizom(), listarLinhasKaizom(lote.tarefaId)])
    if (lotesRes.success) setLotes(lotesRes.data || [])
    if (linhasRes.success) setLinhas(linhasRes.data || [])
  }

  function toggleSelecao(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelecaoTodas(ids: string[], marcar: boolean) {
    setSelecionadas((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (marcar) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function revisar(decisao: 'aprovada' | 'rejeitada') {
    if (!selecionadas.size) return
    setProcessando(true)
    setMessage(null)
    const res = await revisarLinhasKaizom([...selecionadas], decisao)
    if (res.success) {
      setMessage({ type: 'success', text: `${res.data?.alteradas ?? 0} linha(s) marcada(s) como "${STATUS_LABEL[decisao]}".` })
      setSelecionadas(new Set())
      await recarregarLoteAtivo()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao revisar as linhas.' })
    }
    setProcessando(false)
  }

  async function definirConvenio() {
    if (!lote || lote.tarefaId === null || !convenioEscolhido) return
    setProcessando(true)
    setMessage(null)
    const res = await definirConvenioLoteKaizom(lote.tarefaId, convenioEscolhido, lembrarConvenio)
    if (res.success) {
      setMessage({ type: 'success', text: `Convênio aplicado a ${res.data?.alteradas ?? 0} linha(s) do lote.` })
      await recarregarLoteAtivo()
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao definir o convênio do lote.' })
    }
    setProcessando(false)
  }

  async function enviarLote() {
    if (!lote || lote.tarefaId === null) return
    setProcessando(true)
    setMessage(null)
    try {
      const res = await fetch('/api/motor-credito/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarefaId: lote.tarefaId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao enviar ao WeSales.' })
        return
      }
      setMessage({
        type: 'success',
        text: `Enviadas ${Number(json.enviadas).toLocaleString('pt-BR')} ao WeSales${json.comErro ? `, ${Number(json.comErro).toLocaleString('pt-BR')} com erro` : ''}.`,
      })
      await recarregarLoteAtivo()
    } catch {
      setMessage({ type: 'error', text: 'Erro ao enviar ao WeSales.' })
    } finally {
      setProcessando(false)
    }
  }

  const podeAprovarSelecao = linhas.filter((l) => selecionadas.has(l.id)).every((l) => l.convenio_id)
  const totalAprovadas = lote?.porStatus.aprovada || 0

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ChevronRight size={18} />
          API Kaizom — Revisão de Margens
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Consultas lidas direto do banco da Kaizom, uma por lote (a &ldquo;tarefa&rdquo; do higienizador deles). Aprove ou rejeite,
          confirme o convênio quando não veio casado, e só então envie ao WeSales — nunca vai automático.
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex', gap: '0.5rem', alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Convênio</th>
                  <th>Pendentes</th>
                </tr>
              </thead>
              <tbody>
                {loadingLotes ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
                ) : lotes.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}>
                      <div className="empty-state">
                        <h3>Nenhum lote ainda</h3>
                        <p>O cron lê a cada 5 min. Use &ldquo;Ler agora&rdquo; no card da API Kaizom em Provedores e APIs.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  lotes.map((l) => {
                    const chave = loteChave(l)
                    const ativo = chave === loteAtivo
                    return (
                      <tr
                        key={chave}
                        onClick={() => abrirLote(l)}
                        style={{ cursor: 'pointer', background: ativo ? 'var(--brs-gray-50)' : undefined, fontWeight: ativo ? 700 : 400 }}
                      >
                        <td>
                          {l.tarefaId ?? '—'}
                          <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', fontWeight: 400 }}>{l.total.toLocaleString('pt-BR')} linha(s) · {fmtData(l.consultadoEm)}</div>
                        </td>
                        <td>
                          {l.convenioNome ? (
                            <span className="badge badge-success">{l.convenioNome}</span>
                          ) : (
                            <span className="badge badge-warning" title={l.convenioExterno || ''}>{l.convenioExterno || 'sem convênio'}</span>
                          )}
                        </td>
                        <td>{l.porStatus.pendente || 0}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', minHeight: 200 }}>
          {!lote ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <h3>Selecione um lote</h3>
              <p>Escolha um lote à esquerda pra ver as linhas e revisar.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
                <div className="form-group" style={{ minWidth: 240, marginBottom: 0 }}>
                  <label className="form-label">Convênio do lote {lote.convenioNome ? '' : <span className="required">*</span>}</label>
                  <select className="form-control" value={convenioEscolhido} onChange={(e) => setConvenioEscolhido(e.target.value)}>
                    <option value="">Selecione...</option>
                    {convenios.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome_reduzido || c.nome}</option>
                    ))}
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--brs-gray-600)', marginBottom: '0.6rem' }}>
                  <input type="checkbox" checked={lembrarConvenio} onChange={(e) => setLembrarConvenio(e.target.checked)} />
                  Lembrar para os próximos lotes de &ldquo;{lote.convenioExterno || 'este convênio'}&rdquo;
                </label>
                <button type="button" className="btn btn-outline btn-sm" onClick={definirConvenio} disabled={processando || !convenioEscolhido}>
                  {processando ? <Loader2 size={14} className="spinner" /> : <Save size={14} />} Definir convênio do lote
                </button>
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-primary btn-sm" onClick={enviarLote} disabled={processando || !totalAprovadas}>
                  <Send size={14} /> Enviar {totalAprovadas ? `(${totalAprovadas})` : ''} ao WeSales
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => revisar('aprovada')} disabled={processando || !selecionadas.size || !podeAprovarSelecao} title={!podeAprovarSelecao ? 'Alguma linha selecionada ainda não tem convênio' : ''}>
                  <ThumbsUp size={14} /> Aprovar selecionadas ({selecionadas.size})
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => revisar('rejeitada')} disabled={processando || !selecionadas.size}>
                  <ThumbsDown size={14} /> Rejeitar selecionadas
                </button>
              </div>

              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={linhas.length > 0 && linhas.every((l) => selecionadas.has(l.id))}
                          onChange={(e) => toggleSelecaoTodas(linhas.map((l) => l.id), e.target.checked)}
                        />
                      </th>
                      <th>CPF</th>
                      <th>Nome</th>
                      <th>Órgão / Vínculo</th>
                      <th>Novo</th>
                      <th>Cartão RMC</th>
                      <th>Cartão RCC</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLinhas ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
                    ) : linhas.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma linha neste lote.</td></tr>
                    ) : (
                      linhas.map((l) => (
                        <tr key={l.id}>
                          <td><input type="checkbox" checked={selecionadas.has(l.id)} onChange={() => toggleSelecao(l.id)} /></td>
                          <td style={{ fontFamily: 'monospace' }}>{l.cpf ? maskCpf(l.cpf) : '—'}</td>
                          <td>{l.nome || '—'}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{[l.orgao, l.vinculo].filter(Boolean).join(' · ') || '—'}</td>
                          <td>{fmtMoney(l.margem_novo_disp)}</td>
                          <td>{fmtMoney(l.margem_rmc_disp)}</td>
                          <td>{fmtMoney(l.margem_rcc_disp)}</td>
                          <td>
                            <span className={`badge ${STATUS_BADGE[l.status]}`} title={l.observacao || l.erro_envio || ''}>
                              {STATUS_LABEL[l.status]}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
