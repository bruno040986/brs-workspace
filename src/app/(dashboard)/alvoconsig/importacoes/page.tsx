'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { getConveniosAtivos, getImports, getInstituicoesAtivas } from '../actions'

type ImportItem = {
  id: string
  tipo: string
  arquivo_nome: string
  total_linhas: number
  importadas: number
  descartadas: number
  status: string
  erro: string | null
  created_at: string
  convenios?: { id: string; nome: string } | null
}

type Convenio = { id: string; nome: string; codigo: string | null }
type Instituicao = { id: string; name: string }

type CampoImport = { key: string; label: string; obrigatorio?: boolean }

type Analise = {
  headers: string[]
  totalLinhas: number
  amostra: unknown[][]
  sugestao: Record<string, number>
  campos: CampoImport[]
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function ImportacoesPage() {
  const [items, setItems] = useState<ImportItem[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([])
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loading, setLoading] = useState(true)

  // wizard
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [tipo, setTipo] = useState<'refin' | 'margem'>('margem')
  const [convenioId, setConvenioId] = useState('')
  const [instituicaoId, setInstituicaoId] = useState('')
  const [baseTag, setBaseTag] = useState('')
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [mapeamento, setMapeamento] = useState<Record<string, number | ''>>({})
  const [processando, setProcessando] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [importsRes, conveniosRes, instituicoesRes] = await Promise.all([getImports(), getConveniosAtivos(), getInstituicoesAtivas()])
      if (importsRes.success) setItems((importsRes.items || []) as unknown as ImportItem[])
      if (conveniosRes.success) setConvenios((conveniosRes.items || []) as Convenio[])
      if (instituicoesRes.success) setInstituicoes((instituicoesRes.items || []) as Instituicao[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function resetWizard() {
    setArquivo(null)
    setAnalise(null)
    setMapeamento({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function analisar(file: File, tipoSelecionado: 'refin' | 'margem') {
    setProcessando(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fase', 'analisar')
      formData.append('tipo', tipoSelecionado)
      const res = await fetch('/api/alvoconsig/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao analisar o arquivo.' })
        resetWizard()
        return
      }
      setAnalise(json as Analise)
      setMapeamento(json.sugestao || {})
    } catch {
      setMessage({ type: 'error', text: 'Erro ao enviar o arquivo.' })
      resetWizard()
    } finally {
      setProcessando(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    setArquivo(file)
    setAnalise(null)
    if (file) analisar(file, tipo)
  }

  function handleTipoChange(novoTipo: 'refin' | 'margem') {
    setTipo(novoTipo)
    if (arquivo) analisar(arquivo, novoTipo)
  }

  async function importar() {
    if (!arquivo || !analise) return
    if (!baseTag.trim()) {
      setMessage({ type: 'error', text: 'Informe a base (tag) que os leads vão receber no WeSales.' })
      return
    }
    if (tipo === 'refin' && !instituicaoId) {
      setMessage({ type: 'error', text: 'Importação de REFIN exige a Instituição Financeira — a planilha é sempre de um banco só.' })
      return
    }
    setProcessando(true)
    setMessage(null)
    try {
      const mapeamentoFinal: Record<string, number> = {}
      for (const [key, value] of Object.entries(mapeamento)) {
        if (value !== '' && value !== undefined && value !== null) mapeamentoFinal[key] = Number(value)
      }
      const formData = new FormData()
      formData.append('file', arquivo)
      formData.append('fase', 'importar')
      formData.append('tipo', tipo)
      formData.append('mapeamento', JSON.stringify(mapeamentoFinal))
      formData.append('base_tag', baseTag)
      if (convenioId) formData.append('convenio_id', convenioId)
      if (tipo === 'refin' && instituicaoId) formData.append('instituicao_id', instituicaoId)
      const res = await fetch('/api/alvoconsig/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao importar.' })
        return
      }
      setMessage({
        type: 'success',
        text: `Importação concluída direto no WeSales: ${Number(json.importadas).toLocaleString('pt-BR')} contato(s) com a tag "${json.baseTag}", ${Number(json.descartadas).toLocaleString('pt-BR')} linha(s) descartada(s). Agora é só criar a campanha em Campanhas.`,
      })
      resetWizard()
      setBaseTag('')
      setInstituicaoId('')
      await loadData()
    } catch {
      setMessage({ type: 'error', text: 'Erro ao importar o mailing.' })
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Upload size={18} />
          Importar Mailing
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Grava direto no WeSales (nunca se descarta lead) — até 2.000 linhas por vez. Para volume maior, use o CSV nativo na interface do WeSales. REFIN pré-calculado (só troco &gt; 0) ou margens (Novo / Cartão RMC / Cartão RCC).
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

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label className="form-label">Tipo de mailing</label>
            <select className="form-control" value={tipo} onChange={(e) => handleTipoChange(e.target.value as 'refin' | 'margem')}>
              <option value="margem">Margens (calcular por coeficiente)</option>
              <option value="refin">REFIN pré-calculado</option>
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label className="form-label">Convênio padrão (fallback)</label>
            <select className="form-control" value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">Detectar pela coluna de código</option>
              {convenios.map((conv) => (
                <option key={conv.id} value={conv.id}>{conv.nome}{conv.codigo ? ` (${conv.codigo})` : ''}</option>
              ))}
            </select>
          </div>
          {tipo === 'refin' && (
            <div className="form-group" style={{ minWidth: 220 }}>
              <label className="form-label">Instituição Financeira <span className="required">*</span></label>
              <select className="form-control" required value={instituicaoId} onChange={(e) => setInstituicaoId(e.target.value)}>
                <option value="">Selecione...</option>
                {instituicoes.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>
                A planilha REFIN é sempre de um banco só — vale para o arquivo inteiro.
              </div>
            </div>
          )}
          <div className="form-group" style={{ minWidth: 220 }}>
            <label className="form-label">Base (tag no WeSales) <span className="required">*</span></label>
            <input type="text" className="form-control" required placeholder="Ex.: mesquita-refin-2026-08" value={baseTag} onChange={(e) => setBaseTag(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Arquivo (CSV/XLSX, até 20MB, até 2.000 linhas)</label>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="form-control" onChange={handleFile} />
          </div>
          {processando && <Loader2 size={20} className="spinner" style={{ marginBottom: '0.6rem' }} />}
        </div>

        {analise && (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--brs-gray-200)', paddingTop: '1rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.5rem' }}>
              Mapeamento de colunas — {analise.totalLinhas.toLocaleString('pt-BR')} linha(s) detectada(s)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
              {analise.campos.map((campo) => (
                <div key={campo.key} className="form-group">
                  <label className="form-label">
                    {campo.label} {campo.obrigatorio ? <span className="required">*</span> : null}
                  </label>
                  <select
                    className="form-control"
                    value={mapeamento[campo.key] ?? ''}
                    onChange={(e) => setMapeamento({ ...mapeamento, [campo.key]: e.target.value === '' ? '' : Number(e.target.value) })}
                  >
                    <option value="">— não importar —</option>
                    {analise.headers.map((header, idx) => (
                      <option key={idx} value={idx}>{header || `(coluna ${idx + 1})`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-primary" onClick={importar} disabled={processando || !baseTag.trim() || (tipo === 'refin' && !instituicaoId)}>
                {processando ? <Loader2 size={16} className="spinner" /> : <Upload size={16} />}
                Confirmar importação
              </button>
              <button type="button" className="btn btn-outline" onClick={resetWizard} disabled={processando}>
                <X size={16} />
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tipo</th>
                <th>Convênio</th>
                <th>Importadas / Total</th>
                <th>Descartadas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <FileSpreadsheet size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhuma importação ainda</h3>
                      <p>Envie o primeiro mailing acima.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((imp) => (
                  <tr key={imp.id}>
                    <td style={{ fontWeight: 600 }}>{imp.arquivo_nome}</td>
                    <td>{imp.tipo === 'refin' ? 'REFIN' : 'Margem'}</td>
                    <td>{imp.convenios?.nome || '-'}</td>
                    <td>{imp.importadas.toLocaleString('pt-BR')} / {imp.total_linhas.toLocaleString('pt-BR')}</td>
                    <td>{imp.descartadas.toLocaleString('pt-BR')}</td>
                    <td>
                      <span className={`badge ${imp.status === 'concluido' ? 'badge-success' : imp.status === 'erro' ? 'badge-danger' : 'badge-gray'}`} title={imp.erro || ''}>
                        {imp.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
