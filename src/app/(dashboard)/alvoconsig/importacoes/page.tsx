'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileSpreadsheet, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
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

type Convenio = { id: string; nome: string; nome_reduzido: string; codigo_sistema: string }
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

type TipoImportacao = '' | 'refin' | 'margem' | 'elegibilidade'

type GrupoElegibilidade = { instituicaoId: string; colElegibilidade: number | ''; colTipoConsulta: number | '' }
const GRUPO_VAZIO: GrupoElegibilidade = { instituicaoId: '', colElegibilidade: '', colTipoConsulta: '' }

export default function ImportacoesPage() {
  const [items, setItems] = useState<ImportItem[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([])
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [loading, setLoading] = useState(true)

  // wizard
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [tipo, setTipo] = useState<TipoImportacao>('')
  const [convenioId, setConvenioId] = useState('')
  const [instituicaoId, setInstituicaoId] = useState('')
  const [gruposElegibilidade, setGruposElegibilidade] = useState<GrupoElegibilidade[]>([{ ...GRUPO_VAZIO }])
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
    setGruposElegibilidade([{ ...GRUPO_VAZIO }])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function analisar(file: File, tipoSelecionado: 'refin' | 'margem' | 'elegibilidade') {
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
    if (file && tipo) analisar(file, tipo)
  }

  function handleTipoChange(novoTipo: TipoImportacao) {
    setTipo(novoTipo)
    setAnalise(null)
    if (arquivo && novoTipo) analisar(arquivo, novoTipo)
  }

  const gruposCompletos = gruposElegibilidade.every((g) => g.instituicaoId && g.colElegibilidade !== '' && g.colTipoConsulta !== '')

  async function importar() {
    if (!arquivo || !analise || !tipo) return
    if (!convenioId) {
      setMessage({ type: 'error', text: 'Selecione o convênio.' })
      return
    }
    if (tipo === 'refin' && !instituicaoId) {
      setMessage({ type: 'error', text: 'Importação de REFIN exige a Instituição Financeira — a planilha é sempre de um banco só.' })
      return
    }
    if (tipo === 'elegibilidade' && !gruposCompletos) {
      setMessage({ type: 'error', text: 'Mapeie a instituição, a coluna de elegibilidade e a coluna de tipo de consulta para cada instituição da lista.' })
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
      if (convenioId) formData.append('convenio_id', convenioId)
      if (tipo === 'refin' && instituicaoId) formData.append('instituicao_id', instituicaoId)
      if (tipo === 'elegibilidade') {
        formData.append(
          'instituicoes',
          JSON.stringify(
            gruposElegibilidade.map((g) => ({
              instituicaoId: g.instituicaoId,
              instituicaoNome: instituicoes.find((i) => i.id === g.instituicaoId)?.name || '',
              colElegibilidade: Number(g.colElegibilidade),
              colTipoConsulta: Number(g.colTipoConsulta),
            })),
          ),
        )
      }
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
          Importações
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Grava direto no WeSales (nunca se descarta lead) — até 2.000 linhas por vez. Para volume maior, use o CSV nativo na interface do WeSales. REFIN pré-calculado (só troco &gt; 0), margens (Novo / Cartão RMC / Cartão RCC) ou elegibilidade de crédito (sem margem/oferta calculada). A tag do WeSales é sempre gerada automaticamente.
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
            <label className="form-label">Tipo de Importação <span className="required">*</span></label>
            <select className="form-control" required value={tipo} onChange={(e) => handleTipoChange(e.target.value as TipoImportacao)}>
              <option value="">Selecione...</option>
              <option value="margem">Margens (calcular por coeficiente)</option>
              <option value="refin">REFIN pré-calculado</option>
              <option value="elegibilidade">Elegibilidade (confirmação de crédito, sem margem)</option>
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 220 }}>
            <label className="form-label">Convênio <span className="required">*</span></label>
            <select className="form-control" required value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">Selecione...</option>
              {convenios.map((conv) => (
                <option key={conv.id} value={conv.id}>{conv.nome} ({conv.codigo_sistema})</option>
              ))}
            </select>
          </div>
          {tipo === 'refin' && (
            <div className="form-group" style={{ minWidth: 220, position: 'relative' }}>
              <label className="form-label">Instituição Financeira <span className="required">*</span></label>
              <select className="form-control" required value={instituicaoId} onChange={(e) => setInstituicaoId(e.target.value)}>
                <option value="">Selecione...</option>
                {instituicoes.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem', whiteSpace: 'nowrap' }}>
                A planilha REFIN é sempre de um banco só.
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Arquivo (CSV/XLSX, até 20MB, até 2.000 linhas)</label>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="form-control" onChange={handleFile} disabled={!tipo} />
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

            {tipo === 'elegibilidade' && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.5rem' }}>
                  Instituições financeiras desta importação
                </div>
                {gruposElegibilidade.map((grupo, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                    <div className="form-group" style={{ minWidth: 220, marginBottom: 0 }}>
                      <label className="form-label">Instituição Financeira <span className="required">*</span></label>
                      <select
                        className="form-control"
                        value={grupo.instituicaoId}
                        onChange={(e) => setGruposElegibilidade((prev) => prev.map((g, i) => (i === idx ? { ...g, instituicaoId: e.target.value } : g)))}
                      >
                        <option value="">Selecione...</option>
                        {instituicoes.map((inst) => (
                          <option key={inst.id} value={inst.id}>{inst.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ minWidth: 200, marginBottom: 0 }}>
                      <label className="form-label">Coluna Elegibilidade <span className="required">*</span></label>
                      <select
                        className="form-control"
                        value={grupo.colElegibilidade}
                        onChange={(e) => setGruposElegibilidade((prev) => prev.map((g, i) => (i === idx ? { ...g, colElegibilidade: e.target.value === '' ? '' : Number(e.target.value) } : g)))}
                      >
                        <option value="">— selecione a coluna —</option>
                        {analise.headers.map((header, hIdx) => (
                          <option key={hIdx} value={hIdx}>{header || `(coluna ${hIdx + 1})`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ minWidth: 200, marginBottom: 0 }}>
                      <label className="form-label">Coluna Tipo de Consulta <span className="required">*</span></label>
                      <select
                        className="form-control"
                        value={grupo.colTipoConsulta}
                        onChange={(e) => setGruposElegibilidade((prev) => prev.map((g, i) => (i === idx ? { ...g, colTipoConsulta: e.target.value === '' ? '' : Number(e.target.value) } : g)))}
                      >
                        <option value="">— selecione a coluna —</option>
                        {analise.headers.map((header, hIdx) => (
                          <option key={hIdx} value={hIdx}>{header || `(coluna ${hIdx + 1})`}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setGruposElegibilidade((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={gruposElegibilidade.length <= 1}
                      title="Remover instituição"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setGruposElegibilidade((prev) => [...prev, { ...GRUPO_VAZIO }])}>
                  <Plus size={14} /> Adicionar instituição
                </button>
                <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.4rem' }}>
                  Elegível só conta quando a coluna de elegibilidade diz &ldquo;Elegível&rdquo; E a coluna de tipo de consulta diz &ldquo;Online&rdquo; — elegibilidade offline nunca sozinha.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-primary" onClick={importar} disabled={processando || !convenioId || (tipo === 'refin' && !instituicaoId) || (tipo === 'elegibilidade' && !gruposCompletos)}>
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
                    <td>{imp.tipo === 'refin' ? 'REFIN' : imp.tipo === 'elegibilidade' ? 'Elegibilidade' : 'Margem'}</td>
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
