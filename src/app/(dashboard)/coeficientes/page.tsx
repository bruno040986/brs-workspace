'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarOff, Calculator, CheckCircle, FileUp, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { createCoeficientes, encerrarCoeficiente, excluirCoeficiente, getCoeficientes, getCoeficientesLookups, getInstituicoesFinanceiras } from './actions'

type Tabela = {
  id: string
  nome: string
  codigo_tabela_banco: string | null
  com_seguro: boolean | null
  convenio_id: string | null
  financial_institutions: { id: string; name: string } | null
  formas_contrato: { id: string; nome: string } | null
  convenios: { id: string; nome: string; codigo?: string | null } | null
  prazos_comissao: Array<{ prazo_inicial: number; prazo_final: number }>
}
type Convenio = { id: string; nome: string; codigo: string | null }
type Instituicao = { id: string; name: string }
type ResultadoImportacao = { arquivo: string; ok: boolean; mensagem: string; gravados?: number }
type Coeficiente = {
  id: string
  tabela_comissao_id: string
  prazo: number
  coeficiente: number
  vigencia_inicio: string
  vigencia_fim: string | null
  tabelas_comissao: Tabela | null
}
type Linha = { prazo: string; coeficiente: string }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const today = () => new Date().toISOString().slice(0, 10)
const formatDate = (value: string | null | undefined) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'aberta')
const seguroText = (value: boolean | null | undefined) => (value === true ? 'c/ seguro' : value === false ? 's/ seguro' : 'seguro n/i')
const formatCoef = (value: number) => value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')

export default function CoeficientesPage() {
  const [items, setItems] = useState<Coeficiente[]>([])
  const [tabelas, setTabelas] = useState<Tabela[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  const [convenioFilter, setConvenioFilter] = useState('')
  const [tabelaFilter, setTabelaFilter] = useState('')
  const [apenasVigentes, setApenasVigentes] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [tabelaId, setTabelaId] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState(today())
  const [linhas, setLinhas] = useState<Linha[]>([{ prazo: '', coeficiente: '' }])

  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importInstituicaoId, setImportInstituicaoId] = useState('')
  const [importConvenioId, setImportConvenioId] = useState('')
  const [importTabelaId, setImportTabelaId] = useState('')
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [importando, setImportando] = useState(false)
  const [resultadosImportacao, setResultadosImportacao] = useState<ResultadoImportacao[] | null>(null)

  const importInstituicaoNome = useMemo(
    () => instituicoes.find((item) => item.id === importInstituicaoId)?.name || '',
    [importInstituicaoId, instituicoes],
  )
  const importEhSantander = /santander/i.test(importInstituicaoNome)

  const conveniosDaInstituicao = useMemo(() => {
    if (!importInstituicaoId) return convenios
    const idsComTabela = new Set(
      tabelas.filter((t) => t.financial_institutions?.id === importInstituicaoId).map((t) => t.convenio_id),
    )
    return convenios.filter((c) => idsComTabela.has(c.id))
  }, [convenios, tabelas, importInstituicaoId])

  async function loadData(filters = { convenioId: convenioFilter, tabelaId: tabelaFilter, vigentes: apenasVigentes }) {
    setLoading(true)
    try {
      const [itemsRes, lookupsRes, instituicoesRes] = await Promise.all([
        getCoeficientes({ convenioId: filters.convenioId || undefined, tabelaComissaoId: filters.tabelaId || undefined, apenasVigentes: filters.vigentes }),
        getCoeficientesLookups(),
        getInstituicoesFinanceiras(),
      ])
      if (itemsRes.success) setItems((itemsRes.items || []) as unknown as Coeficiente[])
      else setMessage({ type: 'error', text: itemsRes.error || 'Erro ao carregar coeficientes.' })
      if (lookupsRes.success) {
        setTabelas((lookupsRes.tabelas || []) as unknown as Tabela[])
        setConvenios((lookupsRes.convenios || []) as Convenio[])
      }
      if (instituicoesRes.success) setInstituicoes((instituicoesRes.items || []) as Instituicao[])
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar coeficientes.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData({ convenioId: '', tabelaId: '', vigentes: true })
  }, [])

  async function updateFilters(next: Partial<{ convenioId: string; tabelaId: string; vigentes: boolean }>) {
    const filters = { convenioId: convenioFilter, tabelaId: tabelaFilter, vigentes: apenasVigentes, ...next }
    setConvenioFilter(filters.convenioId)
    setTabelaFilter(filters.tabelaId)
    setApenasVigentes(filters.vigentes)
    await loadData(filters)
  }

  const selectedTabela = useMemo(() => tabelas.find((item) => item.id === tabelaId) || null, [tabelaId, tabelas])

  function tabelaLabel(item: Tabela) {
    return `${item.financial_institutions?.name || 'Instituição'} - ${item.nome} (${item.formas_contrato?.nome || 'forma n/i'}, ${seguroText(item.com_seguro)})`
  }

  function openNew() {
    setTabelaId('')
    setVigenciaInicio(today())
    setLinhas([{ prazo: '', coeficiente: '' }])
    setIsModalOpen(true)
  }

  function suggestFromTabela(id: string) {
    setTabelaId(id)
    const tabela = tabelas.find((item) => item.id === id)
    const prazos = Array.from(new Set((tabela?.prazos_comissao || []).map((item) => item.prazo_final).filter((prazo) => Number.isFinite(prazo)))).sort((a, b) => a - b)
    if (prazos.length > 0) setLinhas(prazos.map((prazo) => ({ prazo: String(prazo), coeficiente: '' })))
  }

  function fillDefaultPrazos() {
    setLinhas([12, 24, 36, 48, 60, 72, 84, 96].map((prazo) => ({ prazo: String(prazo), coeficiente: '' })))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const itens = linhas.map((linha) => ({ prazo: Number.parseInt(linha.prazo, 10), coeficiente: Number(String(linha.coeficiente).replace(',', '.')) }))
      const res = await createCoeficientes({ tabela_comissao_id: tabelaId, vigencia_inicio: vigenciaInicio, itens })
      if (res.success) {
        setIsModalOpen(false)
        setMessage({ type: 'success', text: `${res.inseridos || itens.length} coeficiente(s) lançado(s).` })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao lançar coeficientes.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao lançar coeficientes.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClose(item: Coeficiente) {
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await encerrarCoeficiente(item.id, today())
      if (res.success) {
        setMessage({ type: 'success', text: 'Vigência encerrada.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao encerrar vigência.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao encerrar vigência.' })
    } finally {
      setBusyId(null)
    }
  }

  function openImport() {
    setImportInstituicaoId('')
    setImportConvenioId('')
    setImportTabelaId('')
    setImportFiles([])
    setResultadosImportacao(null)
    setIsImportModalOpen(true)
  }

  async function handleImportar(e: React.FormEvent) {
    e.preventDefault()
    if (!importFiles.length) return
    setImportando(true)
    setResultadosImportacao(null)
    try {
      const body = new FormData()
      body.set('instituicao_id', importInstituicaoId)
      body.set('convenio_id', importConvenioId)
      if (importTabelaId) body.set('tabela_comissao_id', importTabelaId)
      importFiles.forEach((file) => body.append('files', file))

      const res = await fetch('/api/comissionamento/importar-fatores', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: json.error || 'Erro ao importar o(s) PDF(s).' })
        return
      }
      setResultadosImportacao(json.resultados || [])
      const gravados = (json.resultados || []).filter((r: ResultadoImportacao) => r.ok).length
      if (gravados > 0) await loadData()
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao importar o(s) PDF(s).' })
    } finally {
      setImportando(false)
    }
  }

  async function handleDelete(item: Coeficiente) {
    if (!confirm('Excluir coeficiente apenas correção de lançamento errado?')) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirCoeficiente(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Coeficiente excluído.' })
        await loadData()
      } else setMessage({ type: 'error', text: res.error || 'Erro ao excluir coeficiente.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir coeficiente.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calculator size={18} />Coeficientes Financeiros</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Coeficientes por tabela de comissão, prazo e vigência.</div></div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={openImport}><FileUp size={16} />Importar PDF de Fatores</button>
          <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={16} />Lançar Coeficientes</button>
        </div>
      </div>
      {message && <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span></div>}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="form-control" style={{ width: 260 }} value={convenioFilter} onChange={(e) => updateFilters({ convenioId: e.target.value })}><option value="">Todos os convênios</option>{convenios.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
        <select className="form-control" style={{ width: 320 }} value={tabelaFilter} onChange={(e) => updateFilters({ tabelaId: e.target.value })}><option value="">Todas as tabelas</option>{tabelas.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}</select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}><input type="checkbox" checked={apenasVigentes} onChange={(e) => updateFilters({ vigentes: e.target.checked })} />Apenas vigentes</label>
      </div>
      <div className="card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Instituição/Tabela</th><th>Convênio</th><th>Prazo</th><th>Coeficiente</th><th>Vigência</th><th>Status</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr> : items.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Calculator size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum coeficiente encontrado</h3><p>Lance coeficientes para a tabela e prazo desejados.</p></div></td></tr> : items.map((item) => <tr key={item.id}>
          <td><div style={{ fontWeight: 800 }}>{item.tabelas_comissao?.financial_institutions?.name || '-'}</div><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>{item.tabelas_comissao?.nome || '-'} · {item.tabelas_comissao?.formas_contrato?.nome || '-'} · {seguroText(item.tabelas_comissao?.com_seguro)}</div></td>
          <td>{item.tabelas_comissao?.convenios?.nome || '-'}</td>
          <td>{item.prazo}x</td>
          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{formatCoef(Number(item.coeficiente))}</td>
          <td>{formatDate(item.vigencia_inicio)} → {formatDate(item.vigencia_fim)}</td>
          <td><span className={`badge ${item.vigencia_fim ? 'badge-gray' : 'badge-success'}`}>{item.vigencia_fim ? 'Encerrado' : 'Vigente'}</span></td>
          <td style={{ textAlign: 'right' }}><div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{item.vigencia_fim ? null : <button type="button" className="btn btn-outline btn-sm btn-acao" onClick={() => handleClose(item)} disabled={busyId === item.id} title="Encerrar vigência" aria-label="Encerrar vigência">{busyId === item.id ? <Loader2 size={15} className="spinner" /> : <CalendarOff size={15} />}</button>}<button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => handleDelete(item)} disabled={busyId === item.id} title="Excluir" aria-label="Excluir">{busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Trash2 size={15} />}</button></div></td>
        </tr>)}
      </tbody></table></div></div>
      {isModalOpen && <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}><div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}><form onSubmit={handleSave}>
        <div className="modal-header"><h3 className="modal-title">Lançar Coeficientes</h3><button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button></div>
        <div className="modal-body">
          <div className="form-group"><label className="form-label">Tabela de Comissão <span className="required">*</span></label><select className="form-control" required value={tabelaId} onChange={(e) => suggestFromTabela(e.target.value)}><option value="">Selecione</option>{tabelas.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}</select></div>
          <div className="form-group" style={{ marginTop: '1rem' }}><label className="form-label">Vigência Início <span className="required">*</span></label><input type="date" className="form-control" required value={vigenciaInicio} onChange={(e) => setVigenciaInicio(e.target.value)} /><div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '0.35rem' }}>Vigências abertas anteriores (mesma tabela/prazo) são encerradas automaticamente no dia anterior</div></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginTop: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}><div style={{ fontWeight: 800 }}>Prazos e coeficientes</div><div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}><button type="button" className="btn btn-outline btn-sm" onClick={fillDefaultPrazos}>Preencher prazos padrão</button><button type="button" className="btn btn-primary btn-sm" onClick={() => setLinhas([...linhas, { prazo: '', coeficiente: '' }])}><Plus size={16} />Adicionar prazo</button></div></div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>{linhas.map((linha, index) => <div key={index} className="form-grid form-grid-2" style={{ alignItems: 'end' }}>
            <div className="form-group"><label className="form-label">Prazo</label><input type="number" className="form-control" value={linha.prazo} onChange={(e) => setLinhas(linhas.map((item, idx) => idx === index ? { ...item, prazo: e.target.value } : item))} /></div>
            <div className="form-group"><label className="form-label">Coeficiente</label><div style={{ display: 'flex', gap: '0.5rem' }}><input type="text" className="form-control" value={linha.coeficiente} onChange={(e) => setLinhas(linhas.map((item, idx) => idx === index ? { ...item, coeficiente: e.target.value } : item))} /><button type="button" className="btn btn-ghost btn-icon" onClick={() => setLinhas(linhas.length === 1 ? [{ prazo: '', coeficiente: '' }] : linhas.filter((_, idx) => idx !== index))}><Trash2 size={18} /></button></div></div>
          </div>)}</div>
          {selectedTabela && <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '1rem' }}>Tabela selecionada: {selectedTabela.nome}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button></div>
      </form></div></div>}

      {isImportModalOpen && <div className="modal-backdrop" onClick={() => setIsImportModalOpen(false)}><div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}><form onSubmit={handleImportar}>
        <div className="modal-header"><h3 className="modal-title">Importar PDF de Fatores</h3><button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsImportModalOpen(false)}><X size={20} /></button></div>
        <div className="modal-body">
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Sobe o "Relatório de Fatores PRICE" do banco (PDF) e o sistema grava o coeficiente (1/Fator) de cada dia coberto pelo relatório — sem precisar digitar um por um.
          </div>
          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">Instituição Financeira <span className="required">*</span></label>
              <select
                className="form-control"
                required
                value={importInstituicaoId}
                onChange={(e) => { setImportInstituicaoId(e.target.value); setImportConvenioId(''); setImportTabelaId('') }}
              >
                <option value="">Selecione</option>
                {instituicoes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Convênio <span className="required">*</span></label>
              <select
                className="form-control"
                required
                disabled={!importInstituicaoId}
                value={importConvenioId}
                onChange={(e) => setImportConvenioId(e.target.value)}
              >
                <option value="">{importInstituicaoId ? 'Selecione' : 'Selecione a instituição primeiro'}</option>
                {conveniosDaInstituicao.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
              {importInstituicaoId && conveniosDaInstituicao.length === 0 && (
                <div style={{ color: '#B45309', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  Nenhum convênio tem Tabela de Comissão cadastrada para "{importInstituicaoNome}" ainda.
                </div>
              )}
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">Tabela de Comissão {!importEhSantander && <span className="required">*</span>}</label>
            <select
              className="form-control"
              required={!!importInstituicaoId && !importEhSantander}
              disabled={!importInstituicaoId || importEhSantander}
              value={importTabelaId}
              onChange={(e) => setImportTabelaId(e.target.value)}
            >
              <option value="">{importEhSantander ? 'Resolvida automaticamente pela Regra do PDF' : 'Selecione'}</option>
              {tabelas
                .filter((item) => item.financial_institutions?.id === importInstituicaoId)
                .filter((item) => (!importConvenioId || item.convenio_id === importConvenioId))
                .map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}
            </select>
            {!importEhSantander && importInstituicaoId && (
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                Leitor de PDF ainda não implementado para esta instituição — a tabela fica pronta pra quando o leitor for adicionado.
              </div>
            )}
          </div>
          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">Arquivo(s) PDF <span className="required">*</span></label>
            <input
              type="file"
              className="form-control"
              accept="application/pdf"
              multiple
              onChange={(e) => setImportFiles(Array.from(e.target.files || []))}
            />
            {importFiles.length > 0 && <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginTop: '0.35rem' }}>{importFiles.length} arquivo(s) selecionado(s)</div>}
          </div>

          {resultadosImportacao && (
            <div style={{ marginTop: '1.25rem', display: 'grid', gap: '0.6rem' }}>
              {resultadosImportacao.map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '0.9rem 1rem',
                    borderRadius: 10,
                    border: `1.5px solid ${r.ok ? '#6EE7B7' : '#FECACA'}`,
                    background: r.ok ? '#ECFDF5' : '#FEF2F2',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.65rem',
                  }}
                >
                  {r.ok ? (
                    <CheckCircle size={22} color="#059669" style={{ flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <AlertCircle size={22} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: r.ok ? '#065F46' : '#991B1B' }}>
                      {r.ok ? 'Importação realizada com sucesso' : 'Falha na importação'}
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--brs-gray-600)', marginTop: '0.15rem' }}>
                      {r.arquivo}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: r.ok ? '#047857' : '#B91C1C', marginTop: '0.15rem' }}>
                      {r.mensagem}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={() => setIsImportModalOpen(false)}>Fechar</button>
          {resultadosImportacao ? (
            <button type="button" className="btn btn-primary" onClick={openImport}>
              <Plus size={16} />
              Nova Importação
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={importando || !importFiles.length}>
              {importando ? <Loader2 size={16} className="spinner" /> : <Upload size={16} />}
              Importar
            </button>
          )}
        </div>
      </form></div></div>}
    </div>
  )
}
