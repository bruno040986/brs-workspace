'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Clock, Download, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'
import { gerarCsvPrazosCadastrados } from '@/lib/comissionamento-import'
import {
  FORMAS_PAGAMENTO_PRAZO,
  calcularGradeComissionamento,
  formaPagamentoEmPercentual,
  type ContextoTabela,
  type LinhaGrade,
  type SpreadRow,
} from '@/lib/comissionamento'
import { CAMPOS_DATA_PRAZO, FILTROS_PRAZOS_PADRAO, ORDENS_PRAZOS, type FiltrosPrazos } from '@/lib/comissionamento-filtros'
import ScrollSyncTable from '@/components/forms/ScrollSyncTable'
import { excluirPrazoComissao, getComissionamentoLookups, getPrazosComissao, getSpreads, type PrazoComissaoPayload } from '../actions'
import { CampoFiltro, ComboboxFiltro, OPCOES_BLOQUEIO, OPCOES_SEGURO, PainelFiltros, SelectFiltro, TextoFiltro } from '../_components/PainelFiltros'

type Instituicao = { id: string; name: string; logo_url?: string | null; imposto_comissao_percent: number | null }
type TipoAgente = { id: string; name: string; codigo_arw: number | null; percentual_repasse: number | null }
type TabelaLookup = {
  id: string
  codigo: number | null
  nome: string
  codigo_tabela_banco: string | null
  institution_id: string
  forma_contrato_id: string
  convenio_id: string | null
  tipo_formalizacao_id: string | null
  promotora_id: string | null
  com_seguro: boolean | null
  is_active: boolean
  taxa_juros_tipo?: 'fixa' | 'faixa' | null
  taxa_juros?: number | null
  taxa_juros_min?: number | null
  taxa_juros_max?: number | null
  observacao?: string | null
  financial_institutions: Instituicao | null
  formas_contrato: { id: string; nome: string } | null
  convenios: { id: string; nome: string } | null
  tipos_formalizacao?: { id: string; nome: string } | null
  promotoras: { id: string; razao_social: string | null; nome_fantasia: string | null } | null
}
type Prazo = PrazoComissaoPayload & {
  id: string
  codigo: number | null
  valor_inicial: number | null
  valor_final: number | null
  data_base: string | null
  data_bloqueio: string | null
  comissao: number | null
  emissao: number | null
  seguro: number | null
  forma_pagamento_seguro: string | null
  id_arw: string | null
  lote_importacao: string | null
  tabelas_comissao: TabelaLookup | null
}
type OpcaoLookup = { id: string; nome: string }
type Lookups = {
  instituicoes: Instituicao[]
  tabelasComissao: TabelaLookup[]
  tiposAgente: TipoAgente[]
  convenios: OpcaoLookup[]
  formasContrato: OpcaoLookup[]
  promotoras: OpcaoLookup[]
}
type FeedbackMessage = { type: 'success' | 'error'; text: string }

const agenteColumns = ['Prata', 'Ouro', 'Bronze', 'Diamante', 'Rubi', 'Adamantium', 'Latão', 'Lojista/Empresa'] as const

function formatDate(value: string | null | undefined) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '-'
}

function formatValor(value: number | null | undefined, emPercentual: boolean) {
  if (value === null || value === undefined) return '-'
  if (!emPercentual) return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function seguroBadge(value: boolean | null | undefined) {
  if (value === true) return <span className="badge badge-success">Com</span>
  if (value === false) return <span className="badge badge-gray">Sem</span>
  return '-'
}

function promotoraLabel(item: TabelaLookup | null) {
  return item?.promotoras?.nome_fantasia || item?.promotoras?.razao_social || 'Direto'
}

function normalize(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function matchesAgente(label: string, tipoAgenteNome: string) {
  const nome = normalize(tipoAgenteNome)
  if (label === 'Latão') return nome.includes('latao')
  if (label === 'Lojista/Empresa') return nome.includes('lojista')
  return nome.includes(normalize(label))
}

export default function PrazosComissaoPage() {
  const [items, setItems] = useState<Prazo[]>([])
  const [lookups, setLookups] = useState<Lookups>({ instituicoes: [], tabelasComissao: [], tiposAgente: [], convenios: [], formasContrato: [], promotoras: [] })
  const [spreads, setSpreads] = useState<SpreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)
  // `filtros` é o que está nos campos; `aplicados` é o que gerou a lista atual (Listar/Enter).
  const [filtros, setFiltros] = useState<FiltrosPrazos>(FILTROS_PRAZOS_PADRAO)
  const [aplicados, setAplicados] = useState<FiltrosPrazos>(FILTROS_PRAZOS_PADRAO)
  const [totalEncontrado, setTotalEncontrado] = useState(0)
  // Tipos de agente marcados: só escolhem quais colunas de repasse aparecem (vazio = todas).
  const [agentesFiltro, setAgentesFiltro] = useState<string[]>([])

  async function carregarPrazos(proximos: FiltrosPrazos) {
    setLoading(true)
    try {
      const res = await getPrazosComissao(proximos)
      if (res.success) {
        setItems((res.items || []) as unknown as Prazo[])
        setTotalEncontrado(res.total ?? (res.items || []).length)
        setAplicados(proximos)
      } else setMessage({ type: 'error', text: res.error || 'Erro ao carregar prazos comissão.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao carregar prazos comissão.' })
    } finally {
      setLoading(false)
    }
  }

  async function loadData() {
    setLoading(true)
    try {
      const [lookupsRes, spreadsRes] = await Promise.all([getComissionamentoLookups(), getSpreads()])
      if (lookupsRes.success) {
        setLookups({
          instituicoes: (lookupsRes.instituicoes || []) as Instituicao[],
          tabelasComissao: (lookupsRes.tabelasComissao || []) as unknown as TabelaLookup[],
          tiposAgente: (lookupsRes.tiposAgente || []) as TipoAgente[],
          convenios: (lookupsRes.convenios || []) as OpcaoLookup[],
          formasContrato: (lookupsRes.formasContrato || []) as OpcaoLookup[],
          promotoras: (lookupsRes.promotoras || []) as OpcaoLookup[],
        })
      }
      if (spreadsRes.success) setSpreads((spreadsRes.items || []) as unknown as SpreadRow[])
      else setMessage({ type: 'error', text: spreadsRes.error || 'Erro ao carregar spreads.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar prazos comissão.' })
    }
    await carregarPrazos(FILTROS_PRAZOS_PADRAO)
  }

  useEffect(() => {
    loadData()
  }, [])

  function atualizarFiltro<K extends keyof FiltrosPrazos>(campo: K, valor: FiltrosPrazos[K]) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }))
  }

  function limparFiltros() {
    setFiltros(FILTROS_PRAZOS_PADRAO)
    setAgentesFiltro([])
    carregarPrazos(FILTROS_PRAZOS_PADRAO)
  }

  function alternarAgente(coluna: string) {
    setAgentesFiltro((atual) => (atual.includes(coluna) ? atual.filter((item) => item !== coluna) : [...atual, coluna]))
  }

  const colunasAgente = agentesFiltro.length ? agenteColumns.filter((coluna) => agentesFiltro.includes(coluna)) : agenteColumns

  function tabelaLabel(item: TabelaLookup) {
    const inst = lookups.instituicoes.find((instituicao) => instituicao.id === item.institution_id)
    return `${inst?.name || 'Instituição'} - ${item.nome}${item.codigo_tabela_banco ? ` (${item.codigo_tabela_banco})` : ''}`
  }

  const gradesPorPrazo = useMemo(() => {
    const tiposAgente = lookups.tiposAgente.filter((tipo) => tipo.percentual_repasse !== null)
    const map = new Map<string, LinhaGrade[]>()
    for (const item of items) {
      const tabela = item.tabelas_comissao
      const contexto: ContextoTabela | null = tabela ? {
        formaContratoId: tabela.forma_contrato_id,
        institutionId: tabela.institution_id,
        convenioId: tabela.convenio_id || null,
        tipoFormalizacaoId: tabela.tipo_formalizacao_id || null,
      } : null
      map.set(item.id, calcularGradeComissionamento({
        valorBase: item.comissao ?? null,
        impostoPercent: tabela?.financial_institutions?.imposto_comissao_percent ?? null,
        usarSpread: true,
        tiposAgente,
        spreads,
        contexto,
      }))
    }
    return map
  }, [items, lookups.tiposAgente, spreads])

  async function handleDelete(item: Prazo) {
    if (!confirm('Excluir este prazo comissão?')) return
    setBusyId(item.id)
    setMessage(null)
    try {
      const res = await excluirPrazoComissao(item.id)
      if (res.success) {
        setMessage({ type: 'success', text: 'Prazo comissão excluído.' })
        await carregarPrazos(aplicados)
      } else setMessage({ type: 'error', text: res.error || 'Erro ao excluir prazo comissão.' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao excluir prazo comissão.' })
    } finally {
      setBusyId(null)
    }
  }

  function handleExportCsv() {
    if (!items.length) {
      setMessage({ type: 'error', text: 'Nenhum prazo para exportar com o filtro atual.' })
      return
    }
    const csv = gerarCsvPrazosCadastrados(
      items.map((item) => {
        const t = item.tabelas_comissao
        return {
          tabela: {
            codigo_tabela_banco: t?.codigo_tabela_banco ?? null,
            nome: t?.nome || '',
            financeira: t?.financial_institutions?.name || '',
            promotora: t?.promotoras?.nome_fantasia || t?.promotoras?.razao_social || '',
            forma_contrato: t?.formas_contrato?.nome || '',
            convenio: t?.convenios?.nome || '',
            tipo_formalizacao: t?.tipos_formalizacao?.nome || '',
            com_seguro: t?.com_seguro ?? null,
            taxa_juros_tipo: t?.taxa_juros_tipo ?? null,
            taxa_juros: t?.taxa_juros ?? null,
            taxa_juros_min: t?.taxa_juros_min ?? null,
            taxa_juros_max: t?.taxa_juros_max ?? null,
            observacao: t?.observacao ?? null,
          },
          forma_pagamento: item.forma_pagamento,
          valor_inicial: item.valor_inicial,
          valor_final: item.valor_final,
          prazo_inicial: item.prazo_inicial,
          prazo_final: item.prazo_final,
          data_base: item.data_base,
          manter_enquadramento: item.manter_enquadramento ?? null,
          comissao: item.comissao,
          emissao: item.emissao,
          seguro: item.seguro,
          forma_pagamento_seguro: item.forma_pagamento_seguro,
          data_bloqueio: item.data_bloqueio,
        }
      }),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prazos-comissao-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    const truncado = totalEncontrado > items.length
    setMessage({ type: 'success', text: truncado ? `${items.length} de ${totalEncontrado} prazo(s) exportado(s) — a lista é limitada; refine os filtros para exportar o restante. Layout completo, reimportável no Passo 2.` : `${items.length} prazo(s) exportado(s) — layout completo, reimportável no Passo 2.` })
  }

  function repasseAgente(item: Prazo, label: string) {
    const linha = (gradesPorPrazo.get(item.id) || []).find((grade) => matchesAgente(label, grade.tipoAgenteNome))
    return formatValor(linha?.repasse ?? null, formaPagamentoEmPercentual(item.forma_pagamento))
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} />
            Prazos Comissão
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Espelho dos prazos e comissões configurados no ARW.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={handleExportCsv} disabled={loading} title="Exporta os prazos filtrados com as 25 colunas preenchidas — reimportável no Passo 2 para atualização em lote">
            <Download size={16} />
            Exportar CSV
          </button>
          <Link href="/comissionamento/prazos/novo" className="btn btn-primary">
            <Plus size={16} />
            Novo Prazo
          </Link>
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <PainelFiltros
        onListar={() => carregarPrazos(filtros)}
        onLimpar={limparFiltros}
        carregando={loading}
        resumo={
          loading ? 'Carregando…' : (
            <>
              Mostrando <strong>{items.length.toLocaleString('pt-BR')}</strong> de <strong>{totalEncontrado.toLocaleString('pt-BR')}</strong> prazo(s)
              {aplicados.prazoBloqueado === 'nao' ? ' — bloqueados ocultos' : ''}
              {totalEncontrado > items.length && <span style={{ color: 'var(--brs-danger)', fontWeight: 600 }}> — a lista mostra só os primeiros {items.length.toLocaleString('pt-BR')}; refine os filtros para ver os demais</span>}
            </>
          )
        }
      >
        <TextoFiltro label="Descrição" valor={filtros.descricao} onChange={(v) => atualizarFiltro('descricao', v)} placeholder="Nome da tabela" />
        <ComboboxFiltro label="Financeira" valor={filtros.financeira} onChange={(v) => atualizarFiltro('financeira', v)} vazio="Todas" opcoes={lookups.instituicoes.map((item) => ({ valor: item.id, label: item.name }))} />
        <ComboboxFiltro label="Convênio" valor={filtros.convenio} onChange={(v) => atualizarFiltro('convenio', v)} vazio="Todos" opcoes={lookups.convenios.map((item) => ({ valor: item.id, label: item.nome }))} />
        <ComboboxFiltro label="Forma do contrato" valor={filtros.forma} onChange={(v) => atualizarFiltro('forma', v)} vazio="Todas" opcoes={lookups.formasContrato.map((item) => ({ valor: item.id, label: item.nome }))} />
        <SelectFiltro label="Prazo comissão bloqueado" valor={filtros.prazoBloqueado} onChange={(v) => atualizarFiltro('prazoBloqueado', v as FiltrosPrazos['prazoBloqueado'])} opcoes={OPCOES_BLOQUEIO} />
        <SelectFiltro label="Tabela comissão bloqueada" valor={filtros.tabelaBloqueada} onChange={(v) => atualizarFiltro('tabelaBloqueada', v as FiltrosPrazos['tabelaBloqueada'])} opcoes={OPCOES_BLOQUEIO} />
        <ComboboxFiltro label="Promotora" valor={filtros.promotora} onChange={(v) => atualizarFiltro('promotora', v)} vazio="Todas" opcoes={[{ valor: 'direto', label: 'Direto' }, ...lookups.promotoras.map((item) => ({ valor: item.id, label: item.nome }))]} />
        <SelectFiltro label="Forma de pagamento" valor={filtros.formaPagamento} onChange={(v) => atualizarFiltro('formaPagamento', v)} vazio="Todas" opcoes={FORMAS_PAGAMENTO_PRAZO.map((item) => ({ valor: item.value, label: item.label }))} />
        <SelectFiltro label="Forma de pagamento seguro" valor={filtros.formaPagamentoSeguro} onChange={(v) => atualizarFiltro('formaPagamentoSeguro', v)} vazio="Todas" opcoes={[{ valor: 'percentual', label: 'Percentual' }, { valor: 'fixo', label: 'Valor fixo' }]} />
        <SelectFiltro label="Tipo de seguro" valor={filtros.seguro} onChange={(v) => atualizarFiltro('seguro', v as FiltrosPrazos['seguro'])} vazio="Todos" opcoes={OPCOES_SEGURO} />
        <TextoFiltro label="Código da tabela" valor={filtros.codigoTabela} onChange={(v) => atualizarFiltro('codigoTabela', v)} placeholder="Banco ou nº do sistema" />
        <ComboboxFiltro label="Tabela de comissão" valor={filtros.tabela} onChange={(v) => atualizarFiltro('tabela', v)} vazio="Todas" opcoes={lookups.tabelasComissao.map((item) => ({ valor: item.id, label: tabelaLabel(item) }))} />
        <CampoFiltro label="Prazo (de – até)">
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input type="number" min={1} className="form-control" placeholder="1" value={filtros.prazoDe} onChange={(e) => atualizarFiltro('prazoDe', e.target.value)} />
            <input type="number" min={1} className="form-control" placeholder="240" value={filtros.prazoAte} onChange={(e) => atualizarFiltro('prazoAte', e.target.value)} />
          </div>
        </CampoFiltro>
        <TextoFiltro label="Lote de importação" valor={filtros.lote} onChange={(v) => atualizarFiltro('lote', v)} />
        <SelectFiltro label="Ordenar por" valor={filtros.ordenar} onChange={(v) => atualizarFiltro('ordenar', v as FiltrosPrazos['ordenar'])} opcoes={ORDENS_PRAZOS.map((o) => ({ valor: o.valor, label: o.label }))} />
        <CampoFiltro label="Data" linhaInteira>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', maxWidth: 680 }}>
            <select className="form-control" style={{ flex: '1 1 180px' }} value={filtros.dataCampo} onChange={(e) => atualizarFiltro('dataCampo', e.target.value as FiltrosPrazos['dataCampo'])}>
              {CAMPOS_DATA_PRAZO.map((campo) => <option key={campo.valor} value={campo.valor}>{campo.label}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: '1 1 190px', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>de
              <input type="date" className="form-control" value={filtros.dataDe} onChange={(e) => atualizarFiltro('dataDe', e.target.value)} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: '1 1 190px', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>até
              <input type="date" className="form-control" value={filtros.dataAte} onChange={(e) => atualizarFiltro('dataAte', e.target.value)} />
            </label>
          </div>
        </CampoFiltro>
        <CampoFiltro label="Tipo de agente — colunas de repasse exibidas (aplica na hora)" linhaInteira>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            {agenteColumns.map((coluna) => {
              const ativo = agentesFiltro.includes(coluna)
              return <button key={coluna} type="button" aria-pressed={ativo} className={`btn btn-sm ${ativo ? 'btn-primary' : 'btn-outline'}`} onClick={() => alternarAgente(coluna)}>{coluna}</button>
            })}
            {agentesFiltro.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>Nenhum marcado = todos os tipos</span>}
          </div>
        </CampoFiltro>
      </PainelFiltros>

      <div className="card">
        <ScrollSyncTable maxHeight="calc(100vh - 260px)">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Data Base</th>
                <th>Tabela de Comissão</th>
                <th>Prazo</th>
                <th>IF</th>
                <th>Promotora</th>
                <th>Forma Contrato</th>
                <th>Convênio</th>
                <th>Seguro</th>
                <th>Data Bloqueio</th>
                <th>Comissão Empresa</th>
                {colunasAgente.map((column) => <th key={column}>{column}</th>)}
                <th>Lote Importação</th>
                <th>Código ARW</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14 + colunasAgente.length} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={14 + colunasAgente.length} style={{ textAlign: 'center', padding: '3rem' }}><div className="empty-state"><Clock size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} /><h3>Nenhum prazo encontrado</h3><p>Ajuste os filtros ou cadastre um prazo comissão.</p></div></td></tr>
              ) : items.map((item) => {
                const tabela = item.tabelas_comissao
                const emPercentual = formaPagamentoEmPercentual(item.forma_pagamento)
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.codigo ?? '-'}</td>
                    <td>{formatDate(item.data_base)}</td>
                    <td style={{ fontWeight: 600 }}>{tabela?.nome || '-'}{tabela?.codigo_tabela_banco ? ` (${tabela.codigo_tabela_banco})` : ''}</td>
                    <td>{item.prazo_inicial} a {item.prazo_final}</td>
                    <td>{tabela?.financial_institutions?.name || '-'}</td>
                    <td>{promotoraLabel(tabela)}</td>
                    <td>{tabela?.formas_contrato?.nome || '-'}</td>
                    <td>{tabela?.convenios?.nome || '-'}</td>
                    <td>{seguroBadge(tabela?.com_seguro)}</td>
                    <td>{formatDate(item.data_bloqueio)}</td>
                    <td>{formatValor(item.comissao, emPercentual)}</td>
                    {colunasAgente.map((column) => <td key={column}>{repasseAgente(item, column)}</td>)}
                    <td>{item.lote_importacao || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.id_arw || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'nowrap', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                        <Link href={`/comissionamento/prazos/${item.id}`} className="btn btn-ghost btn-sm btn-acao" title="Editar" aria-label="Editar">
                          <Edit2 size={15} />
                        </Link>
                        <button type="button" className="btn btn-outline btn-sm btn-acao" onClick={() => handleDelete(item)} disabled={busyId === item.id} title="Excluir" aria-label="Excluir">
                          {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollSyncTable>
      </div>
    </div>
  )
}
