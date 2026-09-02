'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileSpreadsheet, Loader2, UserPlus, X } from 'lucide-react'
import { getConveniosAtivos, getImports } from '../actions'

type ImportItem = {
  id: string
  arquivo_nome: string
  total_linhas: number
  importadas: number
  descartadas: number
  status: string
  erro: string | null
  created_at: string
  tipo: string
  convenios?: { id: string; nome: string } | null
}

type Convenio = { id: string; nome: string; nome_reduzido: string; codigo_sistema: string }
type CampoCadastro = { key: string; label: string; obrigatorio?: boolean }

type Analise = {
  headers: string[]
  totalLinhas: number
  amostra: unknown[][]
  sugestao: Record<string, number>
  campos: CampoCadastro[]
}

type FeedbackMessage = { type: 'success' | 'error'; text: string }

export default function CadastroLeadsPage() {
  const [items, setItems] = useState<ImportItem[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loading, setLoading] = useState(true)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [convenioId, setConvenioId] = useState('')
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [mapeamento, setMapeamento] = useState<Record<string, number | ''>>({})
  const [processando, setProcessando] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [importsRes, conveniosRes] = await Promise.all([getImports(), getConveniosAtivos()])
      if (importsRes.success) setItems(((importsRes.items || []) as unknown as ImportItem[]).filter((i) => i.tipo === 'cadastro'))
      if (conveniosRes.success) setConvenios((conveniosRes.items || []) as Convenio[])
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

  async function analisar(file: File) {
    setProcessando(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fase', 'analisar')
      const res = await fetch('/api/alvoconsig/cadastro-leads', { method: 'POST', body: formData })
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
    if (file) analisar(file)
  }

  async function cadastrar() {
    if (!arquivo || !analise) return
    if (!convenioId) {
      setMessage({ type: 'error', text: 'Selecione o convênio.' })
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
      formData.append('mapeamento', JSON.stringify(mapeamentoFinal))
      formData.append('convenio_id', convenioId)
      const res = await fetch('/api/alvoconsig/cadastro-leads', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao cadastrar.' })
        return
      }
      setMessage({
        type: 'success',
        text: `${Number(json.cadastrados).toLocaleString('pt-BR')} lead(s) NOVO(s) cadastrado(s) no WeSales com a tag "${json.baseTag}". ${Number(json.ignoradosPorJaExistir).toLocaleString('pt-BR')} já existiam (ignorados, nada foi alterado neles). ${Number(json.descartados).toLocaleString('pt-BR')} linha(s) sem os campos obrigatórios.`,
      })
      resetWizard()
      await loadData()
    } catch {
      setMessage({ type: 'error', text: 'Erro ao cadastrar os leads.' })
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <UserPlus size={18} />
          Cadastro de Leads
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Só CADASTRA — CPF que já existe no WeSales é ignorado, nunca atualizado ou sobrescrito. Para atualizar margem, REFIN ou elegibilidade de quem já é lead, use Importações; para atualizar dados pessoais em lote, use a Higienização NVTI.
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
          <div className="form-group" style={{ minWidth: 220 }}>
            <label className="form-label">Convênio <span className="required">*</span></label>
            <select className="form-control" required value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">Selecione...</option>
              {convenios.map((conv) => (
                <option key={conv.id} value={conv.id}>{conv.nome} ({conv.codigo_sistema})</option>
              ))}
            </select>
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
              <button type="button" className="btn btn-primary" onClick={cadastrar} disabled={processando || !convenioId}>
                {processando ? <Loader2 size={16} className="spinner" /> : <UserPlus size={16} />}
                Cadastrar leads novos
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
                <th>Convênio</th>
                <th>Cadastrados / Total</th>
                <th>Ignorados/Descartados</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <FileSpreadsheet size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum cadastro em lote ainda</h3>
                      <p>Envie o primeiro arquivo acima.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((imp) => (
                  <tr key={imp.id}>
                    <td style={{ fontWeight: 600 }}>{imp.arquivo_nome}</td>
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
