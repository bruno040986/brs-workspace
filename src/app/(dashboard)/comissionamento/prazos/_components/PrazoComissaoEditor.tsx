'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Loader2, Save } from 'lucide-react'
import {
  calcularGradeComissionamento,
  formaPagamentoEmPercentual,
  formaPagamentoUsaFaixa,
  FORMAS_PAGAMENTO_PRAZO,
  type ContextoTabela,
  type LinhaGrade,
  type SpreadRow,
} from '@/lib/comissionamento'
import { getComissionamentoLookups, getPrazoComissao, getSpreads, savePrazoComissao } from '../../actions'

type Instituicao = { id: string; name: string; imposto_comissao_percent: number | null }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }
type TabelaLookup = {
  id: string
  nome: string
  codigo_tabela_banco: string | null
  institution_id: string
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id?: string | null
  com_seguro: boolean | null
  is_active: boolean
}
type Lookups = { instituicoes: Instituicao[]; tabelasComissao: TabelaLookup[]; tiposAgente: TipoAgente[] }
type FeedbackMessage = { type: 'success' | 'error'; text: string }

type FormState = {
  id?: string
  tabela_comissao_id: string
  forma_pagamento: string
  valor_inicial: string
  valor_final: string
  prazo_inicial: string
  prazo_final: string
  data_base: string
  manter_enquadramento: boolean
  comissao: string
  emissao: string
  seguro: string
  forma_pagamento_seguro: string
  id_arw: string
}

const emptyForm: FormState = {
  tabela_comissao_id: '',
  forma_pagamento: 'percentual',
  valor_inicial: '',
  valor_final: '',
  prazo_inicial: '',
  prazo_final: '',
  data_base: '',
  manter_enquadramento: true,
  comissao: '',
  emissao: '',
  seguro: '',
  forma_pagamento_seguro: '',
  id_arw: '',
}

function numberOrNull(value: string) {
  if (!String(value || '').trim()) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function intOrZero(value: string) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatValor(value: number | null, emPercentual: boolean) {
  if (value === null) return '-'
  if (!emPercentual) return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function formatPercent(value: number | null) {
  return value === null ? '-' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function taxaLabel(emPercentual: boolean) {
  return emPercentual ? '%' : 'R$'
}

function inputValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function avisoAmbar(text: string) {
  return (
    <div style={{ padding: '0.7rem 0.9rem', borderRadius: 10, border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
      {text}
    </div>
  )
}

function GradeComissionamento({
  titulo,
  valorBase,
  impostoPercent,
  emPercentual,
  linhas,
  mostrarSpread,
  impostoAusente,
}: {
  titulo: string
  valorBase: number | null
  impostoPercent: number | null
  emPercentual: boolean
  linhas: LinhaGrade[]
  mostrarSpread: boolean
  impostoAusente: boolean
}) {
  const imposto = impostoPercent ?? 0
  const liquida = valorBase === null ? null : Math.round(valorBase * (1 - imposto / 100) * 100) / 100

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.35rem' }}>{titulo}</div>
      {impostoAusente ? avisoAmbar('Imposto não configurado na instituição — cálculo considerando 0%.') : null}
      <div style={{ color: 'var(--brs-gray-600)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        Valor recebido: {formatValor(valorBase, emPercentual)} · Imposto IF: {imposto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% · Líquida de imposto: {formatValor(liquida, emPercentual)}
      </div>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tipo de Agente</th>
              <th>Comissão Líquida de Imposto</th>
              {mostrarSpread ? <th>Spread Mínimo</th> : null}
              {mostrarSpread ? <th>Comissão Líquida Total</th> : null}
              <th>% Repasse</th>
              <th>Repasse ao Agente</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr><td colSpan={mostrarSpread ? 6 : 4} style={{ textAlign: 'center', padding: '1rem' }}>Nenhum tipo de agente com percentual de repasse cadastrado.</td></tr>
            ) : (
              linhas.map((linha) => (
                <tr key={linha.tipoAgenteId}>
                  <td>{linha.codigoArw ?? '-'} - {linha.tipoAgenteNome}</td>
                  <td>{formatValor(linha.liquidaImposto, emPercentual)}</td>
                  {mostrarSpread ? (
                    <td>
                      {linha.spreadAusente ? (
                        <span title="sem spread cadastrado" style={{ borderRadius: 999, padding: '0.2rem 0.5rem', background: '#FEF3C7', color: '#92400E', fontWeight: 700, fontSize: '0.75rem' }}>
                          0,0000
                        </span>
                      ) : `${(linha.spread ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`}
                    </td>
                  ) : null}
                  {mostrarSpread ? <td>{formatValor(linha.liquidaTotal, emPercentual)}</td> : null}
                  <td>{formatPercent(linha.percentualRepasse)}</td>
                  <td style={{ color: '#065F46', fontWeight: 800 }}>{formatValor(linha.repasse, emPercentual)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PrazoComissaoEditor({ prazoId }: { prazoId?: string }) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], tabelasComissao: [], tiposAgente: [] })
  const [spreads, setSpreads] = useState<SpreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const [lookupsRes, spreadsRes, prazoRes] = await Promise.all([
        getComissionamentoLookups(),
        getSpreads(),
        prazoId ? getPrazoComissao(prazoId) : Promise.resolve(null),
      ])
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          tabelasComissao: (lookupsRes.tabelasComissao || []) as TabelaLookup[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
        })
      } else {
        setMessage({ type: 'error', text: lookupsRes.error || 'Erro ao carregar cadastros.' })
      }
      if (spreadsRes.success) setSpreads((spreadsRes.items || []) as unknown as SpreadRow[])
      else setMessage({ type: 'error', text: spreadsRes.error || 'Erro ao carregar spreads.' })

      if (prazoRes && prazoRes.success && prazoRes.item) {
        const item = prazoRes.item as Record<string, any>
        setForm({
          id: String(item.id),
          tabela_comissao_id: String(item.tabela_comissao_id || ''),
          forma_pagamento: String(item.forma_pagamento || 'percentual'),
          valor_inicial: inputValue(item.valor_inicial),
          valor_final: inputValue(item.valor_final),
          prazo_inicial: inputValue(item.prazo_inicial),
          prazo_final: inputValue(item.prazo_final),
          data_base: String(item.data_base || ''),
          manter_enquadramento: item.manter_enquadramento !== false,
          comissao: inputValue(item.comissao),
          emissao: inputValue(item.emissao),
          seguro: inputValue(item.seguro),
          forma_pagamento_seguro: String(item.forma_pagamento_seguro || ''),
          id_arw: String(item.id_arw || ''),
        })
      } else if (prazoRes && !prazoRes.success) {
        setMessage({ type: 'error', text: prazoRes.error || 'Prazo comissão não encontrado.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar dados.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [prazoId])

  const selectedTabela = useMemo(() => lookups.tabelasComissao.find((item) => item.id === form.tabela_comissao_id) || null, [form.tabela_comissao_id, lookups.tabelasComissao])
  const selectedInstitution = useMemo(() => lookups.instituicoes.find((item) => item.id === selectedTabela?.institution_id) || null, [lookups.instituicoes, selectedTabela])
  const contexto = useMemo<ContextoTabela | null>(() => selectedTabela ? {
    formaContratoId: selectedTabela.forma_contrato_id,
    institutionId: selectedTabela.institution_id,
    convenioId: selectedTabela.convenio_id || null,
    tipoFormalizacaoId: selectedTabela.tipo_formalizacao_id || null,
  } : null, [selectedTabela])

  const tiposComRepasse = useMemo(() => lookups.tiposAgente.filter((tipo) => tipo.percentual_repasse !== null), [lookups.tiposAgente])
  const hasTiposSemRepasse = lookups.tiposAgente.some((tipo) => tipo.percentual_repasse === null)
  const impostoPercent = selectedInstitution?.imposto_comissao_percent ?? null
  const impostoAusente = Boolean(selectedTabela && selectedInstitution?.imposto_comissao_percent === null)
  const usaFaixa = formaPagamentoUsaFaixa(form.forma_pagamento)
  const comissaoPercentual = formaPagamentoEmPercentual(form.forma_pagamento)
  const seguroPercentual = form.forma_pagamento_seguro !== 'fixo'

  const gradeComissao = useMemo(() => calcularGradeComissionamento({
    valorBase: numberOrNull(form.comissao),
    impostoPercent,
    usarSpread: true,
    tiposAgente: tiposComRepasse,
    spreads,
    contexto,
  }), [contexto, form.comissao, impostoPercent, spreads, tiposComRepasse])
  const gradeEmissao = useMemo(() => calcularGradeComissionamento({
    valorBase: numberOrNull(form.emissao),
    impostoPercent,
    usarSpread: false,
    tiposAgente: tiposComRepasse,
    spreads,
    contexto,
  }), [contexto, form.emissao, impostoPercent, spreads, tiposComRepasse])
  const gradeSeguro = useMemo(() => calcularGradeComissionamento({
    valorBase: numberOrNull(form.seguro),
    impostoPercent,
    usarSpread: false,
    tiposAgente: tiposComRepasse,
    spreads,
    contexto,
  }), [contexto, form.seguro, impostoPercent, spreads, tiposComRepasse])

  function tabelaLabel(item: TabelaLookup) {
    const inst = lookups.instituicoes.find((instituicao) => instituicao.id === item.institution_id)
    return `${inst?.name || 'Instituição'} - ${item.nome}${item.codigo_tabela_banco ? ` (${item.codigo_tabela_banco})` : ''}`
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await savePrazoComissao({
        id: form.id,
        tabela_comissao_id: form.tabela_comissao_id,
        forma_pagamento: form.forma_pagamento,
        valor_inicial: numberOrNull(form.valor_inicial),
        valor_final: numberOrNull(form.valor_final),
        prazo_inicial: intOrZero(form.prazo_inicial),
        prazo_final: intOrZero(form.prazo_final),
        data_base: form.data_base || null,
        manter_enquadramento: form.manter_enquadramento,
        comissao: numberOrNull(form.comissao),
        emissao: numberOrNull(form.emissao),
        seguro: numberOrNull(form.seguro),
        forma_pagamento_seguro: form.forma_pagamento_seguro || null,
        id_arw: form.id_arw || null,
      })
      if (res.success) router.push('/comissionamento/prazos')
      else setMessage({ type: 'error', text: res.error || 'Erro ao salvar prazo comissão.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar prazo comissão.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} />
            Prazo Comissão
          </div>
          <Link href="/comissionamento/prazos" style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem', display: 'inline-block' }}>
            ← Voltar aos prazos
          </Link>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></div>
      ) : (
        <form onSubmit={handleSave}>
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '1rem' }}>Configurações para Comissão</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '1rem' }}>
              <div className="form-group" style={{ gridColumn: 'span 6' }}>
                <label className="form-label">Tabela de Comissão <span className="required">*</span></label>
                <select className="form-control" required value={form.tabela_comissao_id} onChange={(e) => setField('tabela_comissao_id', e.target.value)}>
                  <option value="">Selecione</option>
                  {lookups.tabelasComissao.map((item) => <option key={item.id} value={item.id}>{tabelaLabel(item)}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 6' }}>
                <label className="form-label">Forma de Pagamento Comissão</label>
                <select className="form-control" value={form.forma_pagamento} onChange={(e) => setField('forma_pagamento', e.target.value)}>
                  {FORMAS_PAGAMENTO_PRAZO.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              {usaFaixa ? (
                <>
                  <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Valor Inicial</label><input type="number" step="0.01" className="form-control" value={form.valor_inicial} onChange={(e) => setField('valor_inicial', e.target.value)} /></div>
                  <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Valor Final</label><input type="number" step="0.01" className="form-control" value={form.valor_final} onChange={(e) => setField('valor_final', e.target.value)} /></div>
                </>
              ) : null}
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Prazo Inicial <span className="required">*</span></label><input type="number" required className="form-control" value={form.prazo_inicial} onChange={(e) => setField('prazo_inicial', e.target.value)} /></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Prazo Final <span className="required">*</span></label><input type="number" required className="form-control" value={form.prazo_final} onChange={(e) => setField('prazo_final', e.target.value)} /></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Data Base</label><input type="date" className="form-control" value={form.data_base} onChange={(e) => setField('data_base', e.target.value)} /></div>
              <label style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginTop: '1.65rem' }}><input type="checkbox" checked={form.manter_enquadramento} onChange={(e) => setField('manter_enquadramento', e.target.checked)} />Manter Enquadramento Individual</label>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Comissão ({taxaLabel(comissaoPercentual)})</label><input type="number" step="0.01" className="form-control" value={form.comissao} onChange={(e) => setField('comissao', e.target.value)} /></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Emissão (Valor Fixo)</label><input type="number" step="0.01" className="form-control" value={form.emissao} onChange={(e) => setField('emissao', e.target.value)} /></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Seguro ({taxaLabel(seguroPercentual)})</label><input type="number" step="0.01" className="form-control" value={form.seguro} onChange={(e) => setField('seguro', e.target.value)} /></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">Forma de Pagamento - Seguro</label><select className="form-control" value={form.forma_pagamento_seguro} onChange={(e) => setField('forma_pagamento_seguro', e.target.value)}><option value="">Percentual</option><option value="percentual">Percentual</option><option value="fixo">Fixo</option></select></div>
              <div className="form-group" style={{ gridColumn: 'span 3' }}><label className="form-label">ID no ARW</label><input type="text" className="form-control" value={form.id_arw} onChange={(e) => setField('id_arw', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <Link href="/comissionamento/prazos" className="btn btn-outline">Cancelar</Link>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                Salvar
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)', marginBottom: '0.5rem' }}>Comissionamento</div>
            {!selectedTabela ? (
              <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem' }}>Selecione a Tabela de Comissão para calcular o comissionamento.</div>
            ) : (
              <>
                {hasTiposSemRepasse ? avisoAmbar('Tipos de agente sem % de repasse cadastrado ficam fora das grades — configure em Agente Corban → Tipo de Agente.') : null}
                <GradeComissionamento titulo="Comissão" valorBase={numberOrNull(form.comissao)} impostoPercent={impostoPercent} emPercentual={comissaoPercentual} linhas={gradeComissao} mostrarSpread impostoAusente={impostoAusente} />
                <GradeComissionamento titulo="Emissão (Valor Fixo)" valorBase={numberOrNull(form.emissao)} impostoPercent={impostoPercent} emPercentual={false} linhas={gradeEmissao} mostrarSpread={false} impostoAusente={impostoAusente} />
                <GradeComissionamento titulo="Seguro" valorBase={numberOrNull(form.seguro)} impostoPercent={impostoPercent} emPercentual={seguroPercentual} linhas={gradeSeguro} mostrarSpread={false} impostoAusente={impostoAusente} />
              </>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
