'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlertTriangle, Ban, CheckCircle, Download, FileUp, Loader2, MessageCircle,
  Phone, RefreshCw, Search, ShieldCheck, Wallet,
} from 'lucide-react'
import type { HigienizacaoOutcome, NvtiResultado } from '@/lib/nvti/types'
import {
  cancelNvtiBatch, consultarCpfNvti, getConveniosParaLoteNvti, getNvtiPanorama, listNvtiBatches,
  type NvtiBatchListItem, type NvtiPanorama,
} from '../actions'

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatCpf(cpf: string): string {
  const digits = String(cpf || '').replace(/\D/g, '').padStart(11, '0')
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatNasc(value: string): string {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length !== 8) return value || '—'
  return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`
}

const BATCH_STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Na fila', badge: 'badge-gray' },
  processing: { label: 'Processando', badge: 'badge-info' },
  paused_limit: { label: 'Pausado (limite)', badge: 'badge-warning' },
  done: { label: 'Concluído', badge: 'badge-success' },
  canceled: { label: 'Cancelado', badge: 'badge-gray' },
  error: { label: 'Erro', badge: 'badge-danger' },
}

type Feedback = { type: 'success' | 'error' | 'warning'; text: string }

function FeedbackBox({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null
  const palette = {
    success: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
    error: { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
    warning: { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' },
  }[feedback.type]
  const Icon = feedback.type === 'success' ? CheckCircle : feedback.type === 'warning' ? AlertTriangle : AlertCircle
  return (
    <div style={{ padding: '0.875rem 1rem', borderRadius: 10, display: 'flex', alignItems: 'center', gap: '0.6rem', background: palette.bg, color: palette.color, border: `1px solid ${palette.border}`, marginBottom: '1rem' }}>
      <Icon size={18} />
      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{feedback.text}</span>
    </div>
  )
}

function BoolBadge({ value, yes, no }: { value: boolean | null; yes: string; no: string }) {
  if (value === true) return <span className="badge badge-success">{yes}</span>
  if (value === false) return <span className="badge badge-gray">{no}</span>
  return <span className="badge badge-gray">—</span>
}

function ResultadoCard({ resultado, fromCache, unitCost }: { resultado: NvtiResultado; fromCache: boolean; unitCost: number }) {
  const { cadastro, credito, celulares, telefones, emails, enderecos, empresas } = resultado
  const endereco = enderecos[0]
  const obito = credito.obito === true

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{cadastro.nome || 'Nome não retornado'}</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: 2 }}>
            CPF {formatCpf(cadastro.cpf)} · Nasc. {formatNasc(cadastro.nascimento)} {cadastro.idade ? `(${cadastro.idade} anos)` : ''} · {cadastro.sexo || '—'}
          </div>
          <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.8rem', marginTop: 2 }}>
            Mãe: {cadastro.nome_mae || '—'} · Ocupação: {cadastro.descricao_cbo || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {obito ? <span className="badge badge-danger">ÓBITO</span> : null}
          {fromCache
            ? <span className="badge badge-info">Reaproveitada (sem custo)</span>
            : <span className="badge badge-gold">Consulta nova · {brl(unitCost)}</span>}
          {cadastro.classe_economica ? <span className="badge badge-navy">Classe {cadastro.classe_economica}</span> : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginTop: '1.1rem' }}>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            <Phone size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Celulares
          </div>
          {celulares.length ? celulares.map((cel, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.9rem', color: 'var(--brs-gray-800)' }}>
              ({cel.ddd}) {cel.numero}
              {cel.whatsapp ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={11} />WhatsApp</span> : null}
              {cel.procon ? <span className="badge badge-warning">Procon</span> : null}
            </div>
          )) : <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Nenhum celular retornado.</div>}

          {telefones.length ? (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
              Fixos: {telefones.map((tel) => `(${tel.ddd}) ${tel.numero}`).join(' · ')}
            </div>
          ) : null}

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', margin: '0.9rem 0 0.4rem' }}>E-mails</div>
          {emails.length ? emails.map((email) => (
            <div key={email} style={{ fontSize: '0.85rem', color: 'var(--brs-gray-800)' }}>{email.toLowerCase()}</div>
          )) : <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Nenhum e-mail retornado.</div>}
        </div>

        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
            <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Crédito
          </div>
          <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
            <div>Score: <strong>{credito.score || '—'}</strong> {credito.faixa_score ? <span className="badge badge-navy" style={{ marginLeft: 4 }}>{credito.faixa_score}</span> : null}</div>
            <div>Fonte de renda: {credito.fonte_renda || '—'}</div>
            <div>Propensão de pagamento: {credito.propensao_pagamento || '—'} · Digital: {credito.score_digital || '—'}</div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
              <BoolBadge value={credito.possui_veiculo} yes="Tem veículo" no="Sem veículo" />
              <BoolBadge value={credito.possui_imovel} yes="Tem imóvel" no="Sem imóvel" />
              <BoolBadge value={credito.bolsa_familia} yes="Bolsa Família" no="Sem Bolsa Família" />
            </div>
          </div>

          {endereco ? (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', margin: '0.9rem 0 0.4rem' }}>Endereço</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-800)' }}>
                {[endereco.tipo, endereco.titulo, endereco.logradouro].filter(Boolean).join(' ')}, {endereco.numero}
                {endereco.complemento ? ` - ${endereco.complemento}` : ''}<br />
                {endereco.bairro} · {endereco.cidade}/{endereco.uf} · CEP {endereco.cep}
              </div>
            </>
          ) : null}

          {empresas.length ? (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase', margin: '0.9rem 0 0.4rem' }}>Vínculo empregatício / FGTS</div>
              {empresas.map((empresa, index) => (
                <div key={index} style={{ fontSize: '0.85rem', color: 'var(--brs-gray-800)', marginBottom: '0.3rem' }}>
                  {empresa.razao || '—'} {empresa.cnpj ? `(CNPJ ${empresa.cnpj})` : ''}
                  <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
                    FGTS: <BoolBadge value={empresa.possui_fgts} yes="Possui" no="Não possui" />
                    {empresa.fgts_valor_presumido ? ` · valor presumido R$ ${empresa.fgts_valor_presumido}` : ''}
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function NvtiClient({
  initialPanorama,
  initialBatches,
}: {
  initialPanorama: NvtiPanorama
  initialBatches: NvtiBatchListItem[]
}) {
  const [panorama, setPanorama] = useState(initialPanorama)
  const [batches, setBatches] = useState(initialBatches)
  const [tab, setTab] = useState<'consulta' | 'lotes'>('consulta')

  // --- Consulta unitária ---
  const [cpfInput, setCpfInput] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [consultaFeedback, setConsultaFeedback] = useState<Feedback | null>(null)
  const [resultado, setResultado] = useState<{ resultado: NvtiResultado; fromCache: boolean; unitCost: number } | null>(null)

  // --- Lotes ---
  const [convenios, setConvenios] = useState<Array<{ id: string; nome: string }>>([])
  const [convenioLoteId, setConvenioLoteId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loteFeedback, setLoteFeedback] = useState<Feedback | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const hasActiveBatch = useMemo(
    () => batches.some((batch) => ['pending', 'processing'].includes(batch.status)),
    [batches],
  )

  const refreshPanoramaAndBatches = useCallback(async () => {
    try {
      const [nextPanorama, nextBatches] = await Promise.all([getNvtiPanorama(), listNvtiBatches()])
      setPanorama(nextPanorama)
      setBatches(nextBatches)
    } catch {
      // silencioso — próximo polling tenta de novo
    }
  }, [])

  useEffect(() => {
    void getConveniosParaLoteNvti().then(setConvenios)
  }, [])

  useEffect(() => {
    if (!hasActiveBatch) return
    const interval = setInterval(refreshPanoramaAndBatches, 5000)
    return () => clearInterval(interval)
  }, [hasActiveBatch, refreshPanoramaAndBatches])

  async function handleConsultar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setConsultando(true)
    setConsultaFeedback(null)
    setResultado(null)
    try {
      const outcome: HigienizacaoOutcome = await consultarCpfNvti(cpfInput)
      if (outcome.status === 'ok') {
        setResultado({ resultado: outcome.resultado, fromCache: outcome.fromCache, unitCost: outcome.unitCost })
        void refreshPanoramaAndBatches()
      } else if (outcome.status === 'blocked_global' || outcome.status === 'blocked_user') {
        setConsultaFeedback({ type: 'warning', text: outcome.error })
      } else {
        setConsultaFeedback({ type: 'error', text: outcome.error })
      }
    } catch (error) {
      setConsultaFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao consultar.' })
    } finally {
      setConsultando(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setLoteFeedback(null)
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('convenio_id', convenioLoteId)
      const res = await fetch('/api/nvti/upload', { method: 'POST', body: formData })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(body?.error || 'Falha ao importar o arquivo.'))
      setLoteFeedback({
        type: 'success',
        text: `Lote criado com ${Number(body.total).toLocaleString('pt-BR')} CPFs válidos${body.invalid ? ` (${body.invalid} inválidos descartados)` : ''}. O processamento já começou.`,
      })
      void refreshPanoramaAndBatches()
    } catch (error) {
      setLoteFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao importar.' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleCancelBatch(batchId: string) {
    if (!window.confirm('Cancelar este lote? Os CPFs ainda não processados não serão consultados.')) return
    try {
      await cancelNvtiBatch(batchId)
      void refreshPanoramaAndBatches()
    } catch (error) {
      setLoteFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao cancelar.' })
    }
  }

  const notConfigured = !panorama.configured || !panorama.active
  const userRatio = panorama.user.cap > 0 ? Math.min(1, panorama.user.spend / panorama.user.cap) : 0
  const userColor = userRatio >= 1 ? '#b91c1c' : userRatio >= 0.8 ? '#b45309' : 'var(--brs-navy)'

  return (
    <div>
      {notConfigured ? (
        <FeedbackBox feedback={{
          type: 'warning',
          text: panorama.configured
            ? 'A integração com a Nova Vida TI está inativa no momento. Procure o administrador do sistema.'
            : 'A integração com a Nova Vida TI ainda não foi configurada. Procure o administrador do sistema.',
        }} />
      ) : null}

      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--brs-gray-500)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          <Wallet size={15} />
          Meu gasto no mês
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '1.35rem', fontWeight: 800, color: userColor }}>
          {brl(panorama.user.spend)} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--brs-gray-400)' }}>/ {brl(panorama.user.cap)}</span>
        </div>
        <div style={{ marginTop: '0.5rem', height: 7, borderRadius: 999, background: 'var(--brs-gray-100)', overflow: 'hidden' }}>
          <div style={{ width: `${userRatio * 100}%`, height: '100%', borderRadius: 999, background: userColor, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      <div className="tabs-list" style={{ marginBottom: '1.25rem' }}>
        <button type="button" className={`tab-btn ${tab === 'consulta' ? 'active' : ''}`} onClick={() => setTab('consulta')}>
          Consulta unitária
        </button>
        <button type="button" className={`tab-btn ${tab === 'lotes' ? 'active' : ''}`} onClick={() => setTab('lotes')}>
          Lotes (CSV/XLSX)
        </button>
      </div>

      {tab === 'consulta' ? (
        <div>
          <form onSubmit={handleConsultar} className="card" style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label className="form-label">CPF</label>
              <input
                type="text"
                className="form-control"
                placeholder="000.000.000-00"
                value={cpfInput}
                onChange={(e) => setCpfInput(e.target.value)}
                disabled={consultando || !panorama.canImport}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={consultando || !panorama.canImport || notConfigured} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {consultando ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
              Consultar
            </button>
          </form>
          {!panorama.canImport ? (
            <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              Seu perfil permite apenas visualizar — sem permissão para consultar.
            </p>
          ) : null}
          <div style={{ marginTop: '1rem' }}>
            <FeedbackBox feedback={consultaFeedback} />
          </div>
          {resultado ? <ResultadoCard resultado={resultado.resultado} fromCache={resultado.fromCache} unitCost={resultado.unitCost} /> : null}
        </div>
      ) : null}

      {tab === 'lotes' ? (
        <div>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>Importar arquivo</div>
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: 2 }}>
                CSV, XLSX ou TXT — os CPFs são detectados automaticamente em qualquer coluna, com validação de
                dígito e deduplicação. Máximo de 100.000 CPFs por lote.
              </div>
            </div>
            <div className="form-group" style={{ minWidth: 240, marginBottom: 0 }}>
              <label className="form-label">Convênio dos leads deste lote</label>
              <select
                className="form-control"
                value={convenioLoteId}
                onChange={(e) => setConvenioLoteId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {convenios.map((convenio) => (
                  <option key={convenio.id} value={convenio.id}>{convenio.nome}</option>
                ))}
              </select>
              {!convenioLoteId ? (
                <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  Selecione o convênio antes de enviar o arquivo.
                </div>
              ) : null}
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" style={{ display: 'none' }} onChange={handleUpload} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploading || !panorama.canImport || notConfigured || !convenioLoteId}
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
            >
              {uploading ? <Loader2 size={16} className="spinner" /> : <FileUp size={16} />}
              Selecionar arquivo
            </button>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <FeedbackBox feedback={loteFeedback} />
          </div>

          <div className="card" style={{ padding: 0, marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--brs-gray-100)' }}>
              <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>Lotes</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshPanoramaAndBatches()} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <RefreshCw size={14} /> Atualizar
              </button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Status</th>
                    <th>Progresso</th>
                    <th>Erros</th>
                    <th>Criado por</th>
                    <th>Criado em</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.length ? batches.map((batch) => {
                    const statusInfo = BATCH_STATUS_LABEL[batch.status] || BATCH_STATUS_LABEL.pending
                    const progress = batch.total > 0 ? Math.round((batch.processed / batch.total) * 100) : 0
                    return (
                      <tr key={batch.id}>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={batch.file_name}>{batch.file_name}</td>
                        <td>
                          <span className={`badge ${statusInfo.badge}`}>{statusInfo.label}</span>
                          {batch.status === 'paused_limit' ? (
                            <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 3, maxWidth: 220 }}>
                              Aguardando liberação de limite pelo administrador.
                            </div>
                          ) : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {batch.processed.toLocaleString('pt-BR')}/{batch.total.toLocaleString('pt-BR')} ({progress}%)
                        </td>
                        <td>{batch.errors ? <span className="badge badge-danger">{batch.errors.toLocaleString('pt-BR')}</span> : '0'}</td>
                        <td>{batch.created_by_name}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(batch.created_at)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {batch.processed > 0 ? (
                            <a className="btn btn-outline btn-sm" href={`/api/nvti/lotes/${batch.id}/export`} style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', marginRight: 6 }}>
                              <Download size={13} /> CSV
                            </a>
                          ) : null}
                          {['pending', 'processing', 'paused_limit'].includes(batch.status) ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleCancelBatch(batch.id)} title="Cancelar lote" style={{ color: '#b91c1c' }}>
                              <Ban size={13} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>
                        Nenhum lote importado ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
