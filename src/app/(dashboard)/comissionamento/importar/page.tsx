'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import {
  gerarModeloCsv,
  chaveResolucao,
  type CampoReferencia,
  type DiffCampo,
  type LinhaAnalisada,
  type PendenciaLinha,
  type Resolucoes,
  type ResumoAnalise,
} from '@/lib/comissionamento-import'
import { getComissionamentoLookups } from '../actions'

type AnaliseResponse = { linhas: LinhaAnalisada[]; resumo: ResumoAnalise }
type FeedbackMessage = { type: 'success' | 'error'; text: string }
type LookupItem = { id: string; nome: string; name?: string; codigo?: string | null; codigo_arw?: string | null }
type Lookups = {
  instituicoes: Array<{ id: string; name: string }>
  convenios: LookupItem[]
  formasContrato: LookupItem[]
  tiposFormalizacao: LookupItem[]
}

const emptyLookups: Lookups = { instituicoes: [], convenios: [], formasContrato: [], tiposFormalizacao: [] }

const campoLabels: Record<CampoReferencia, string> = {
  financeira: 'Financeira',
  convenio: 'Convênio',
  forma_contrato: 'Forma de Contrato',
  tipo_formalizacao: 'Formalização',
}

function uniquePendencias(linhas: LinhaAnalisada[]) {
  const map = new Map<string, PendenciaLinha>()
  for (const linha of linhas) {
    for (const pendencia of linha.pendencias || []) {
      const key = chaveResolucao(pendencia.campo, pendencia.textoNormalizado)
      if (!map.has(key)) map.set(key, pendencia)
    }
  }
  return Array.from(map.values())
}

function lookupOptions(campo: CampoReferencia, lookups: Lookups) {
  if (campo === 'financeira') return lookups.instituicoes.map((item) => ({ id: item.id, label: item.name }))
  if (campo === 'convenio') return lookups.convenios.map((item) => ({ id: item.id, label: `${item.nome}${item.codigo ? ` (${item.codigo})` : ''}` }))
  if (campo === 'forma_contrato') return lookups.formasContrato.map((item) => ({ id: item.id, label: `${item.nome}${item.codigo_arw ? ` (${item.codigo_arw})` : ''}` }))
  return lookups.tiposFormalizacao.map((item) => ({ id: item.id, label: `${item.nome}${item.codigo_arw ? ` (${item.codigo_arw})` : ''}` }))
}

function summaryCard(label: string, value: number, color: string) {
  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', fontWeight: 700 }}>{label}</div>
      <div style={{ color, fontSize: '1.5rem', fontWeight: 900, marginTop: '0.25rem' }}>{value.toLocaleString('pt-BR')}</div>
    </div>
  )
}

export default function ImportarComissionamentoPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [analise, setAnalise] = useState<AnaliseResponse | null>(null)
  const [lookups, setLookups] = useState<Lookups>(emptyLookups)
  const [resolucoes, setResolucoes] = useState<Resolucoes>({})
  const [atualizacoesAprovadas, setAtualizacoesAprovadas] = useState<number[]>([])
  const [mostrarNovas, setMostrarNovas] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loadingLookups, setLoadingLookups] = useState(true)
  const [processando, setProcessando] = useState(false)

  async function loadLookups() {
    setLoadingLookups(true)
    try {
      const res = await getComissionamentoLookups()
      if (res.success) {
        setLookups({
          instituicoes: (res.instituicoes || []) as Array<{ id: string; name: string }>,
          convenios: (res.convenios || []) as LookupItem[],
          formasContrato: (res.formasContrato || []) as LookupItem[],
          tiposFormalizacao: (res.tiposFormalizacao || []) as LookupItem[],
        })
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar cadastros para resolução.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar cadastros para resolução.' })
    } finally {
      setLoadingLookups(false)
    }
  }

  useEffect(() => {
    loadLookups()
  }, [])

  const pendencias = useMemo(() => uniquePendencias(analise?.linhas || []), [analise])
  const invalidas = useMemo(() => (analise?.linhas || []).filter((linha) => linha.status === 'invalida'), [analise])
  const atualizacoes = useMemo(() => (analise?.linhas || []).filter((linha) => linha.status === 'atualizacao'), [analise])
  const novas = useMemo(() => (analise?.linhas || []).filter((linha) => linha.status === 'nova'), [analise])
  const podeAplicar = Boolean(arquivo && analise && analise.resumo.pendencias === 0 && analise.resumo.invalidas === 0)

  function resetWizard() {
    setArquivo(null)
    setAnalise(null)
    setResolucoes({})
    setAtualizacoesAprovadas([])
    setMostrarNovas(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function baixarModelo() {
    const blob = new Blob([`\uFEFF${gerarModeloCsv()}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-tabelas-comissao.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function postar(fase: 'analisar' | 'aplicar', file: File, currentResolucoes: Resolucoes, aprovadas?: number[]) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('fase', fase)
    formData.append('resolucoes', JSON.stringify(currentResolucoes))
    if (fase === 'aplicar') formData.append('aprovadas', JSON.stringify(aprovadas || []))
    const res = await fetch('/api/comissionamento/import-tabelas', { method: 'POST', body: formData })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Erro na importação.')
    return json
  }

  async function analisar(file: File, currentResolucoes = resolucoes) {
    setProcessando(true)
    setMessage(null)
    try {
      const json = (await postar('analisar', file, currentResolucoes)) as AnaliseResponse
      setAnalise(json)
      setAtualizacoesAprovadas(json.linhas.filter((linha) => linha.status === 'atualizacao').map((linha) => linha.n))
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao analisar o arquivo.' })
      setAnalise(null)
    } finally {
      setProcessando(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    setArquivo(file)
    setAnalise(null)
    setResolucoes({})
    setAtualizacoesAprovadas([])
    if (file) analisar(file, {})
  }

  async function reanalisar() {
    if (!arquivo) return
    await analisar(arquivo, resolucoes)
  }

  async function aplicar() {
    if (!arquivo || !analise || !podeAplicar) return
    setProcessando(true)
    setMessage(null)
    try {
      const json = (await postar('aplicar', arquivo, resolucoes, atualizacoesAprovadas)) as { criadas: number; atualizadas: number; semMudanca: number }
      setMessage({ type: 'success', text: `${json.criadas} criadas, ${json.atualizadas} atualizadas, ${json.semMudanca} sem mudança.` })
      resetWizard()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao aplicar importação.' })
    } finally {
      setProcessando(false)
    }
  }

  function setResolucao(pendencia: PendenciaLinha, value: string) {
    const key = chaveResolucao(pendencia.campo, pendencia.textoNormalizado)
    const next = { ...resolucoes }
    if (value) next[key] = value
    else delete next[key]
    setResolucoes(next)
  }

  function toggleAtualizacao(n: number) {
    setAtualizacoesAprovadas((current) => current.includes(n) ? current.filter((item) => item !== n) : [...current, n])
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Upload size={18} />
            Importar Planilhas
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Importação de Tabelas de Comissão pelo modelo padronizado. Prazos Comissão e Coeficientes entram em seguida no mesmo fluxo.
          </div>
        </div>
        <button type="button" className="btn btn-outline" onClick={baixarModelo}>
          <Download size={16} />
          Baixar modelo CSV
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group">
            <label className="form-label">Arquivo (.csv, .xlsx, .xls)</label>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="form-control" onChange={handleFile} />
          </div>
          {processando ? <Loader2 size={20} className="spinner" style={{ marginBottom: '0.6rem' }} /> : null}
          {arquivo ? (
            <button type="button" className="btn btn-outline" onClick={resetWizard} disabled={processando}>
              <X size={16} />
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      {analise && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {summaryCard('Total', analise.resumo.total, 'var(--brs-gray-900)')}
            {summaryCard('Novas', analise.resumo.novas, '#065F46')}
            {summaryCard('Atualizações', analise.resumo.atualizacoes, '#92400E')}
            {summaryCard('Sem mudança', analise.resumo.semMudanca, 'var(--brs-gray-500)')}
            {summaryCard('Pendências', analise.resumo.pendencias, '#991B1B')}
            {summaryCard('Inválidas', analise.resumo.invalidas, '#991B1B')}
          </div>

          {pendencias.length > 0 && (
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Pendências</div>
                  <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Aponte o cadastro correto para cada texto não reconhecido.</div>
                </div>
                <button type="button" className="btn btn-primary" onClick={reanalisar} disabled={processando || loadingLookups}>
                  {processando ? <Loader2 size={16} className="spinner" /> : null}
                  Reanalisar
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                {pendencias.map((pendencia) => {
                  const key = chaveResolucao(pendencia.campo, pendencia.textoNormalizado)
                  return (
                    <div key={key} className="form-group">
                      <label className="form-label">{campoLabels[pendencia.campo]}: {pendencia.texto}</label>
                      <select className="form-control" value={resolucoes[key] || ''} onChange={(e) => setResolucao(pendencia, e.target.value)}>
                        <option value="">Selecione</option>
                        {lookupOptions(pendencia.campo, lookups).map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {invalidas.length > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--brs-gray-200)', fontWeight: 800 }}>Linhas inválidas</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Linha</th><th>Erro</th></tr></thead>
                  <tbody>{invalidas.map((linha) => <tr key={linha.n}><td>{linha.n}</td><td>{linha.erro || '-'}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {atualizacoes.length > 0 && (
            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
              {atualizacoes.map((linha) => (
                <div key={linha.n} className="card" style={{ padding: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.75rem' }}>
                    <input type="checkbox" checked={atualizacoesAprovadas.includes(linha.n)} onChange={() => toggleAtualizacao(linha.n)} />
                    Linha {linha.n} - {linha.dados.nome}
                    <span style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', fontWeight: 600 }}>Aprovar esta atualização</span>
                  </label>
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead><tr><th>Campo</th><th>Atual</th><th>Novo</th></tr></thead>
                      <tbody>{linha.diff.map((diff: DiffCampo) => <tr key={diff.campo}><td>{diff.label}</td><td>{diff.atual}</td><td style={{ color: '#065F46', fontWeight: 700 }}>{diff.novo}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {novas.length > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <button type="button" className="btn btn-ghost" style={{ margin: '1rem' }} onClick={() => setMostrarNovas(!mostrarNovas)}>
                <FileSpreadsheet size={16} />
                Novas tabelas: {novas.length.toLocaleString('pt-BR')}
              </button>
              {mostrarNovas && (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Linha</th><th>Nome</th><th>Financeira</th><th>Convênio</th></tr></thead>
                    <tbody>{novas.map((linha) => <tr key={linha.n}><td>{linha.n}</td><td style={{ fontWeight: 600 }}>{linha.dados.nome}</td><td>{linha.dados.financeira_texto}</td><td>{linha.dados.convenio_texto || '-'}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>
              {podeAplicar ? 'Pronto para aplicar a importação.' : 'Resolva pendências e linhas inválidas antes de aplicar.'}
            </div>
            <button type="button" className="btn btn-primary" onClick={aplicar} disabled={!podeAplicar || processando}>
              {processando ? <Loader2 size={16} className="spinner" /> : <Upload size={16} />}
              Aplicar importação
            </button>
          </div>
        </>
      )}
    </div>
  )
}
