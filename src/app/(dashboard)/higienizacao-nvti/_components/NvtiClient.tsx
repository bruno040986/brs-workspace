'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlertTriangle, Ban, CheckCircle, Download, FileUp, Loader2, MessageCircle,
  Phone, RefreshCw, Search, ShieldCheck, Wallet, XCircle,
} from 'lucide-react'
import type { HigienizacaoOutcome, NvtiResultado } from '@/lib/nvti/types'
import {
  cancelNvtiBatch, consultarCpfNvti, getNvtiConsumo, getNvtiLimites, getNvtiPanorama,
  listNvtiBatches, setNvtiDefaultUserCap, setNvtiGlobalCap, setNvtiUserCap,
  type NvtiBatchListItem, type NvtiConsumo, type NvtiLimitesState, type NvtiPanorama,
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

function SpendMeter({ title, spend, cap, hint }: { title: string; spend: number; cap: number; hint?: string }) {
  const ratio = cap > 0 ? Math.min(1, spend / cap) : 0
  const color = ratio >= 1 ? '#b91c1c' : ratio >= 0.8 ? '#b45309' : 'var(--brs-navy)'
  return (
    <div className="card" style={{ padding: '1rem 1.25rem', flex: 1, minWidth: 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--brs-gray-500)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        <Wallet size={15} />
        {title}
      </div>
      <div style={{ marginTop: '0.4rem', fontSize: '1.35rem', fontWeight: 800, color }}>
        {brl(spend)} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--brs-gray-400)' }}>/ {brl(cap)}</span>
      </div>
      <div style={{ marginTop: '0.5rem', height: 7, borderRadius: 999, background: 'var(--brs-gray-100)', overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', borderRadius: 999, background: color, transition: 'width 0.4s ease' }} />
      </div>
      {hint ? <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>{hint}</div> : null}
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
  const [tab, setTab] = useState<'consulta' | 'lotes' | 'consumo'>('consulta')

  // --- Consulta unitária ---
  const [cpfInput, setCpfInput] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [consultaFeedback, setConsultaFeedback] = useState<Feedback | null>(null)
  const [resultado, setResultado] = useState<{ resultado: NvtiResultado; fromCache: boolean; unitCost: number } | null>(null)

  // --- Lotes ---
  const [uploading, setUploading] = useState(false)
  const [loteFeedback, setLoteFeedback] = useState<Feedback | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // --- Consumo / Limites ---
  const [consumo, setConsumo] = useState<NvtiConsumo | null>(null)
  const [consumoLoading, setConsumoLoading] = useState(false)
  const [consumoMonth, setConsumoMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  })
  const [limites, setLimites] = useState<NvtiLimitesState | null>(null)
  const [limitesFeedback, setLimitesFeedback] = useState<Feedback | null>(null)
  const [globalCapInput, setGlobalCapInput] = useState('')
  const [defaultCapInput, setDefaultCapInput] = useState('')
  const [savingCaps, setSavingCaps] = useState(false)

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

  const loadConsumo = useCallback(async (year: number, month: number) => {
    setConsumoLoading(true)
    try {
      const data = await getNvtiConsumo(year, month)
      setConsumo(data)
      if (panorama.canEditLimites) {
        const limitesData = await getNvtiLimites()
        setLimites(limitesData)
        setGlobalCapInput(String(limitesData.globalCap))
        setDefaultCapInput(String(limitesData.defaultUserCap))
      }
    } catch (error) {
      setLimitesFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao carregar consumo.' })
    } finally {
      setConsumoLoading(false)
    }
  }, [panorama.canEditLimites])

  useEffect(() => {
    if (tab === 'consumo' && panorama.canSeeConsumo && !consumo) {
      void loadConsumo(consumoMonth.year, consumoMonth.month)
    }
  }, [tab, panorama.canSeeConsumo, consumo, consumoMonth, loadConsumo])

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(consumoMonth.year, consumoMonth.month - 1 + delta, 1))
    const nextValue = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }
    setConsumoMonth(nextValue)
    void loadConsumo(nextValue.year, nextValue.month)
  }

  async function handleSaveCaps() {
    setSavingCaps(true)
    setLimitesFeedback(null)
    try {
      const globalCap = Number(globalCapInput.replace(',', '.'))
      const defaultCap = Number(defaultCapInput.replace(',', '.'))
      if (limites && globalCap !== limites.globalCap) await setNvtiGlobalCap(globalCap)
      if (limites && defaultCap !== limites.defaultUserCap) await setNvtiDefaultUserCap(defaultCap)
      setLimitesFeedback({ type: 'success', text: 'Limites atualizados. Lotes pausados por limite retomam sozinhos em até 2 minutos.' })
      await loadConsumo(consumoMonth.year, consumoMonth.month)
      void refreshPanoramaAndBatches()
    } catch (error) {
      setLimitesFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar limites.' })
    } finally {
      setSavingCaps(false)
    }
  }

  async function handleUserCap(userId: string, current: number | null) {
    const raw = window.prompt(
      'Teto mensal (R$) para este usuário. Deixe vazio para voltar ao padrão.',
      current !== null ? String(current) : '',
    )
    if (raw === null) return
    try {
      const trimmed = raw.trim().replace(',', '.')
      await setNvtiUserCap(userId, trimmed === '' ? null : Number(trimmed))
      setLimitesFeedback({ type: 'success', text: 'Teto do usuário atualizado.' })
      await loadConsumo(consumoMonth.year, consumoMonth.month)
    } catch (error) {
      setLimitesFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao salvar teto do usuário.' })
    }
  }

  const notConfigured = !panorama.configured || !panorama.active

  return (
    <div>
      {notConfigured ? (
        <FeedbackBox feedback={{
          type: 'warning',
          text: panorama.configured
            ? 'A integração com a Nova Vida TI está inativa. Ative em Configurações > API Nova Vida TI.'
            : 'A API Nova Vida TI ainda não foi configurada. Cadastre as credenciais em Configurações > API Nova Vida TI.',
        }} />
      ) : null}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <SpendMeter
          title="Gasto do mês (global)"
          spend={panorama.global.spend}
          cap={panorama.global.cap}
          hint={`${panorama.global.billedCount.toLocaleString('pt-BR')} consultas cobradas · próxima a ${brl(panorama.global.nextUnit)} · cache de ${panorama.cacheDays} dias`}
        />
        <SpendMeter title="Meu gasto no mês" spend={panorama.user.spend} cap={panorama.user.cap} />
      </div>

      <div className="tabs-list" style={{ marginBottom: '1.25rem' }}>
        <button type="button" className={`tab-btn ${tab === 'consulta' ? 'active' : ''}`} onClick={() => setTab('consulta')}>
          Consulta unitária
        </button>
        <button type="button" className={`tab-btn ${tab === 'lotes' ? 'active' : ''}`} onClick={() => setTab('lotes')}>
          Lotes (CSV/XLSX)
        </button>
        {panorama.canSeeConsumo ? (
          <button type="button" className={`tab-btn ${tab === 'consumo' ? 'active' : ''}`} onClick={() => setTab('consumo')}>
            Consumo{panorama.canEditLimites ? ' e limites' : ''}
          </button>
        ) : null}
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
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" style={{ display: 'none' }} onChange={handleUpload} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploading || !panorama.canImport || notConfigured}
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
                    <th>Reaproveitadas</th>
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
                          {batch.status === 'paused_limit' && batch.last_error ? (
                            <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 3, maxWidth: 220 }}>{batch.last_error}</div>
                          ) : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {batch.processed.toLocaleString('pt-BR')}/{batch.total.toLocaleString('pt-BR')} ({progress}%)
                        </td>
                        <td>{batch.cached.toLocaleString('pt-BR')}</td>
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
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>
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

      {tab === 'consumo' && panorama.canSeeConsumo ? (
        <div>
          <FeedbackBox feedback={limitesFeedback} />

          <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => shiftMonth(-1)}>← Mês anterior</button>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-800)', minWidth: 130, textAlign: 'center' }}>
              {String(consumoMonth.month).padStart(2, '0')}/{consumoMonth.year}
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => shiftMonth(1)}>Mês seguinte →</button>
            {consumoLoading ? <Loader2 size={16} className="spinner" style={{ color: 'var(--brs-gray-400)' }} /> : null}
          </div>

          {consumo ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
                {[
                  { label: 'Consultas no mês', value: consumo.totalQueries.toLocaleString('pt-BR') },
                  { label: 'Cobradas (NVTI)', value: consumo.billedCount.toLocaleString('pt-BR') },
                  { label: 'Reaproveitadas (grátis)', value: consumo.cachedCount.toLocaleString('pt-BR') },
                  { label: 'Erros', value: consumo.errorCount.toLocaleString('pt-BR') },
                  { label: 'Estimativa da fatura', value: brl(consumo.spendEstimate) },
                ].map((item) => (
                  <div key={item.label} className="card" style={{ padding: '0.9rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brs-gray-400)' }}>{item.label}</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: 2 }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 0, marginTop: '1rem' }}>
                <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--brs-gray-100)', fontWeight: 700, color: 'var(--brs-gray-800)' }}>
                  Consumo por usuário
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Usuário</th>
                        <th>Consultas</th>
                        <th>Cobradas</th>
                        <th>Reaproveitadas</th>
                        <th>Erros</th>
                        <th>Gasto</th>
                        <th>Teto</th>
                        {panorama.canEditLimites ? <th style={{ textAlign: 'right' }}>Ações</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {consumo.byUser.length ? consumo.byUser.map((row) => (
                        <tr key={row.userId}>
                          <td>{row.name}</td>
                          <td>{row.total.toLocaleString('pt-BR')}</td>
                          <td>{row.billed.toLocaleString('pt-BR')}</td>
                          <td>{row.cached.toLocaleString('pt-BR')}</td>
                          <td>{row.errors ? <span className="badge badge-danger">{row.errors}</span> : '0'}</td>
                          <td>{brl(row.spend)}</td>
                          <td>{row.cap === null ? '—' : brl(row.cap)}</td>
                          {panorama.canEditLimites ? (
                            <td style={{ textAlign: 'right' }}>
                              {row.userId !== 'service' ? (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleUserCap(row.userId, row.cap)}>
                                  Ajustar teto
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={panorama.canEditLimites ? 8 : 7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>
                            Sem consultas neste mês.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {consumo.byOrigin.length ? (
                <div style={{ marginTop: '0.75rem', color: 'var(--brs-gray-500)', fontSize: '0.82rem' }}>
                  Por origem: {consumo.byOrigin.map((item) => {
                    const label = item.origin === 'manual' ? 'Consulta manual' : item.origin === 'batch' ? 'Lotes' : 'Orquestradores'
                    return `${label} ${item.total.toLocaleString('pt-BR')} (${brl(item.spend)})`
                  }).join(' · ')}
                </div>
              ) : null}

              {panorama.canEditLimites && limites ? (
                <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem' }}>Limites de gasto</div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="form-label">Teto mensal global (R$)</label>
                      <input type="text" className="form-control" value={globalCapInput} onChange={(e) => setGlobalCapInput(e.target.value)} inputMode="decimal" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Teto mensal padrão por usuário (R$)</label>
                      <input type="text" className="form-control" value={defaultCapInput} onChange={(e) => setDefaultCapInput(e.target.value)} inputMode="decimal" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-primary" disabled={savingCaps} onClick={() => void handleSaveCaps()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {savingCaps ? <Loader2 size={16} className="spinner" /> : <CheckCircle size={16} />}
                      Salvar limites
                    </button>
                  </div>
                  <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', marginTop: '0.5rem' }}>
                    Toda alteração de limite fica registrada em auditoria. O teto individual pode ser ajustado por
                    usuário na tabela acima.
                  </div>
                </div>
              ) : null}
            </>
          ) : consumoLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>
              <Loader2 size={22} className="spinner" />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)', display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
              <XCircle size={16} /> Não foi possível carregar o consumo.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
