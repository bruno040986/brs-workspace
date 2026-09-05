'use client'

/**
 * Painel de Operações — visão única das Propostas de Crédito de todas as IFs
 * integradas (a 1ª é a FyDigital), consolidando status da proposta + status
 * Nuvidio numa linha só. Fatia 3 (esqueleto, só leitura — ver
 * docs/ROTEIRO-PROPOSTAS-CREDITO-FATIAS-2-3.md). Ações de criar/cancelar de
 * verdade dependem do adaptador por IF (Fatia 4) e ficam desabilitadas aqui.
 * Permissão: operacional-painel-operacoes.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import {
  getProposta,
  listarFormasContratoAtivas,
  listarPropostas,
  type FormaContratoOpcao,
  type PropostaCredito,
  type PropostaDetalhe,
} from '@/lib/if-credito/painel-actions'

// ---------------------------------------------------------------------------
// Mapas de apresentação (status canônico → rótulo + cor; ver roteiro)
// ---------------------------------------------------------------------------
const STATUS_MAP: Record<string, { label: string; bg: string; fg: string; destaque?: boolean }> = {
  simulando: { label: 'Simulando', bg: 'var(--brs-gray-100)', fg: 'var(--brs-gray-600)' },
  criada: { label: 'Criada', bg: 'rgba(2,132,199,0.12)', fg: '#0369a1' },
  aguardando_assinatura: { label: 'Aguardando assinatura', bg: 'rgba(217,119,6,0.12)', fg: '#b45309' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', bg: 'rgba(124,58,237,0.12)', fg: '#6d28d9' },
  aguardando_liberacao_interna: { label: 'Aguardando liberação interna', bg: 'rgba(234,88,12,0.16)', fg: '#c2410c', destaque: true },
  pendente: { label: 'Pendente', bg: 'rgba(234,179,8,0.18)', fg: '#a16207' },
  aguardando_pagamento: { label: 'Aguardando pagamento', bg: 'rgba(13,148,136,0.14)', fg: '#0f766e' },
  paga: { label: 'Paga', bg: 'rgba(22,163,74,0.12)', fg: '#15803d' },
  cancelada: { label: 'Cancelada', bg: 'var(--brs-gray-200)', fg: '#374151' },
  erro: { label: 'Erro', bg: 'rgba(220,38,38,0.12)', fg: '#b91c1c' },
}

function statusInfo(status: string) {
  return STATUS_MAP[status] || { label: status, bg: 'var(--brs-gray-100)', fg: 'var(--brs-gray-600)' }
}

function nuvidioInfo(status: string | null) {
  if (!status) return { label: '—', bg: 'var(--brs-gray-100)', fg: 'var(--brs-gray-400)' }
  if (status === 'aprovado') return { label: 'Aprovado', bg: 'rgba(22,163,74,0.12)', fg: '#15803d' }
  if (status === 'reprovado') return { label: 'Reprovado', bg: 'rgba(220,38,38,0.12)', fg: '#b91c1c' }
  if (status === 'cancelado' || status === 'expirado') return { label: status === 'cancelado' ? 'Cancelado' : 'Expirado', bg: 'var(--brs-gray-100)', fg: 'var(--brs-gray-500)' }
  return { label: 'Enviado', bg: 'rgba(2,132,199,0.12)', fg: '#0369a1' } // aguardando_chamada / em_curso / realizada / aguardando_refazer
}

const WEBHOOK_LABELS: Record<string, string> = {
  identificador: 'Identificador gerado',
  simular_operacao: 'Simulação concluída',
  erro_simulacao: 'Erro na simulação',
  documento: 'Documento recebido',
  criar_proposta: 'Proposta criada',
  erro_proposta: 'Erro ao criar proposta',
  error: 'Erro',
  acompanhamento: 'Atualização de status',
  proposta_pendente: 'Proposta pendente — dados a corrigir',
  proposta_aprovada: 'Proposta aprovada',
  operacao_cancelada: 'Operação cancelada',
}

function tabKind(nomeForma: string): 'cartao' | 'portabilidade' | 'padrao' {
  const n = nomeForma.toLowerCase()
  if (n.includes('cart')) return 'cartao'
  if (n.includes('portab') || n.includes('refin')) return 'portabilidade'
  return 'padrao'
}

function maskCpf(cpf: string) {
  const d = String(cpf || '').replace(/\D/g, '')
  if (d.length !== 11) return cpf || '-'
  return `${d.slice(0, 3)}.•••.•••-${d.slice(9)}`
}

function fmtMoeda(v: number | null) {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function extrairObservacao(payload: Record<string, unknown> | undefined): string {
  if (!payload) return ''
  const p: any = payload
  return p?.proposta?.observacao || p?.simulacao?.observacao || p?.observacao || ''
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function OperacoesPage() {
  const [formas, setFormas] = useState<FormaContratoOpcao[]>([])
  const [abaId, setAbaId] = useState('')
  const [propostas, setPropostas] = useState<PropostaCredito[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [busca, setBusca] = useState('')
  const [instituicaoFiltro, setInstituicaoFiltro] = useState('')
  const [convenioFiltro, setConvenioFiltro] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')

  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [detalhes, setDetalhes] = useState<Record<string, PropostaDetalhe>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<Set<string>>(new Set())
  const [drawerId, setDrawerId] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const [resFormas, resPropostas] = await Promise.all([listarFormasContratoAtivas(), listarPropostas()])
      if (!resFormas.success) throw new Error(resFormas.error || 'Erro ao carregar formas de contrato.')
      if (!resPropostas.success) throw new Error(resPropostas.error || 'Erro ao carregar propostas.')

      const ordem = ['novo', 'refin', 'portabilidade', 'cartão', 'cartao', 'clt', 'fgts']
      const lista = [...(resFormas.data || [])].sort((a, b) => {
        const ia = ordem.findIndex((o) => a.nome.toLowerCase().includes(o))
        const ib = ordem.findIndex((o) => b.nome.toLowerCase().includes(o))
        if (ia === -1 && ib === -1) return a.nome.localeCompare(b.nome)
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      })
      setFormas(lista)
      setAbaId((atual) => atual || lista[0]?.id || '')
      setPropostas(resPropostas.data || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar o painel.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const opcoesInstituicoes = useMemo(() => {
    const mapa = new Map<string, string>()
    propostas.forEach((p) => p.instituicao_financeira_id && mapa.set(p.instituicao_financeira_id, p.instituicao_nome))
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [propostas])

  const opcoesConvenios = useMemo(() => {
    const mapa = new Map<string, string>()
    propostas.forEach((p) => p.convenio_id && mapa.set(p.convenio_id, p.convenio_nome))
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [propostas])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const de = dataDe ? new Date(`${dataDe}T00:00:00`).getTime() : null
    const ate = dataAte ? new Date(`${dataAte}T23:59:59`).getTime() : null
    return propostas.filter((p) => {
      if (abaId && p.forma_contrato_id !== abaId) return false
      if (instituicaoFiltro && p.instituicao_financeira_id !== instituicaoFiltro) return false
      if (convenioFiltro && p.convenio_id !== convenioFiltro) return false
      if (q) {
        const matchNome = p.nome_cliente.toLowerCase().includes(q)
        const matchCpf = qDigits && p.cpf.replace(/\D/g, '').includes(qDigits)
        if (!matchNome && !matchCpf) return false
      }
      const t = new Date(p.updated_at).getTime()
      if (de !== null && t < de) return false
      if (ate !== null && t > ate) return false
      return true
    })
  }, [propostas, abaId, instituicaoFiltro, convenioFiltro, busca, dataDe, dataAte])

  const abaAtual = formas.find((f) => f.id === abaId)
  const kind = abaAtual ? tabKind(abaAtual.nome) : 'padrao'

  async function garantirDetalhe(id: string) {
    if (detalhes[id] || carregandoDetalhe.has(id)) return
    setCarregandoDetalhe((prev) => new Set(prev).add(id))
    try {
      const res = await getProposta(id)
      if (res.success && res.data) setDetalhes((prev) => ({ ...prev, [id]: res.data as PropostaDetalhe }))
    } finally {
      setCarregandoDetalhe((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
    }
  }

  function toggleExpandir(id: string) {
    setExpandidos((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    garantirDetalhe(id)
  }

  function abrirDrawer(id: string) {
    setDrawerId(id)
    garantirDetalhe(id)
  }

  const rotulo: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.25rem' }
  const drawerData = drawerId ? detalhes[drawerId] : null

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ClipboardList size={18} />
            Painel de Operações
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Propostas de crédito de todas as Instituições Financeiras integradas — status da proposta + Nuvidio numa
            linha só.
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={carregar} disabled={carregando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {carregando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar
        </button>
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--brs-danger)', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {/* filtros */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <label style={rotulo}>Buscar por CPF ou nome</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}><Search size={14} /></span>
            <input className="form-control" style={{ paddingLeft: '2rem' }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CPF…" />
          </div>
        </div>
        <div style={{ minWidth: 170 }}>
          <label style={rotulo}>Instituição Financeira</label>
          <select className="form-control" value={instituicaoFiltro} onChange={(e) => setInstituicaoFiltro(e.target.value)}>
            <option value="">Todas</option>
            {opcoesInstituicoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 170 }}>
          <label style={rotulo}>Convênio</label>
          <select className="form-control" value={convenioFiltro} onChange={(e) => setConvenioFiltro(e.target.value)}>
            <option value="">Todos</option>
            {opcoesConvenios.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </div>
        <div>
          <label style={rotulo}>De</label>
          <input type="date" className="form-control" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        </div>
        <div>
          <label style={rotulo}>Até</label>
          <input type="date" className="form-control" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        </div>
      </div>

      {/* abas por forma de contrato */}
      {formas.length > 0 && (
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--brs-gray-200)', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {formas.map((f) => (
            <button
              key={f.id}
              type="button"
              className="tab-btn"
              onClick={() => setAbaId(f.id)}
              style={{
                padding: '0.55rem 1rem',
                background: 'none',
                border: 'none',
                borderBottom: f.id === abaId ? '2px solid var(--brs-navy)' : '2px solid transparent',
                color: f.id === abaId ? 'var(--brs-navy)' : 'var(--brs-gray-500)',
                fontWeight: f.id === abaId ? 700 : 500,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {f.nome}
            </button>
          ))}
        </div>
      )}

      {/* tabela */}
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Convênio</th>
                <th>IF</th>
                <th>Valor solicitado</th>
                <th>Parcela</th>
                <th>Nº parc.</th>
                <th>Status da proposta</th>
                <th>Nuvidio</th>
                <th>Atualizado</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : formas.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}>
                  <div className="empty-state">
                    <Banknote size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                    <h3>Nenhuma forma de contrato ativa</h3>
                    <p>Cadastre formas de contrato em Comissionamento para começar.</p>
                  </div>
                </td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}>
                  <div className="empty-state">
                    <ClipboardList size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                    <h3>Nenhuma proposta encontrada</h3>
                    <p>Assim que uma IF integrada criar propostas, elas aparecem aqui.</p>
                  </div>
                </td></tr>
              ) : (
                filtradas.map((p) => {
                  const st = statusInfo(p.status)
                  const nv = nuvidioInfo(p.nuvidio_status)
                  const expandivel = kind !== 'padrao'
                  const aberto = expandidos.has(p.id)
                  const det = detalhes[p.id]
                  return (
                    <>
                      <tr key={p.id} style={st.destaque ? { background: 'rgba(234,88,12,0.06)' } : undefined}>
                        <td>
                          {expandivel && (
                            <button type="button" className="btn btn-ghost btn-icon" style={{ marginRight: 4, verticalAlign: 'middle' }} onClick={() => toggleExpandir(p.id)} title="Expandir">
                              {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                          <span style={{ fontWeight: 600 }}>{p.nome_cliente || '-'}</span>
                          <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', fontFamily: 'monospace' }}>{maskCpf(p.cpf)}</div>
                        </td>
                        <td>{p.convenio_nome || '-'}</td>
                        <td><span className="badge badge-navy">{p.instituicao_nome || '-'}</span></td>
                        <td>{fmtMoeda(p.valor_solicitado)}</td>
                        <td>{fmtMoeda(p.valor_parcela)}</td>
                        <td>{p.num_parcelas ?? '-'}</td>
                        <td>
                          <span className="badge" style={{ background: st.bg, color: st.fg, fontWeight: 700 }}>{st.label}</span>
                          {st.destaque && (
                            <div style={{ marginTop: 4, fontSize: '0.68rem', fontWeight: 700, color: '#c2410c' }}>Ação: enviar/checar Nuvidio</div>
                          )}
                        </td>
                        <td><span className="badge" style={{ background: nv.bg, color: nv.fg }}>{nv.label}</span></td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>{fmtData(p.updated_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                            <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={() => abrirDrawer(p.id)} title="Ver detalhe" aria-label="Ver detalhe">
                              <Eye size={15} />
                            </button>
                            <button type="button" className="btn btn-outline btn-sm" disabled title="Disponível após ativar a integração desta IF">
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandivel && aberto && (
                        <tr key={`${p.id}-exp`}>
                          <td colSpan={10} style={{ background: 'var(--brs-gray-50, #f9fafb)', padding: '0.75rem 1.25rem' }}>
                            {!det ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--brs-gray-400)', fontSize: '0.8rem' }}><Loader2 size={14} className="animate-spin" /> Carregando…</span>
                            ) : kind === 'cartao' ? (
                              det.cartao.length === 0 ? (
                                <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Sem detalhamento de saque/margem.</span>
                              ) : (
                                <table style={{ width: '100%', fontSize: '0.8rem' }}>
                                  <thead><tr style={{ color: 'var(--brs-gray-500)' }}><th style={{ textAlign: 'left' }}>Operação</th><th style={{ textAlign: 'left' }}>Valor</th><th style={{ textAlign: 'left' }}>%</th><th style={{ textAlign: 'left' }}>Parcelas</th><th style={{ textAlign: 'left' }}>Valor parcela</th></tr></thead>
                                  <tbody>
                                    {det.cartao.map((c) => (
                                      <tr key={c.id}>
                                        <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{c.tipo}</td>
                                        <td>{fmtMoeda(c.valor)}</td>
                                        <td>{c.percentual != null ? `${c.percentual}%` : '-'}</td>
                                        <td>{c.num_parcelas ?? '-'}</td>
                                        <td>{fmtMoeda(c.valor_parcela)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )
                            ) : det.contratosOrigem.length === 0 ? (
                              <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Sem contratos de origem vinculados.</span>
                            ) : (
                              <table style={{ width: '100%', fontSize: '0.8rem' }}>
                                <thead><tr style={{ color: 'var(--brs-gray-500)' }}><th style={{ textAlign: 'left' }}>Banco origem</th><th style={{ textAlign: 'left' }}>Contrato</th><th style={{ textAlign: 'left' }}>Saldo devedor</th><th style={{ textAlign: 'left' }}>Parcela</th><th style={{ textAlign: 'left' }}>Parc. restantes</th></tr></thead>
                                <tbody>
                                  {det.contratosOrigem.map((c) => (
                                    <tr key={c.id}>
                                      <td>{c.banco_origem || '-'}</td>
                                      <td>{c.contrato_origem || '-'}</td>
                                      <td>{fmtMoeda(c.saldo_devedor)}</td>
                                      <td>{fmtMoeda(c.parcela)}</td>
                                      <td>{c.num_parcelas_restantes ?? '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* drawer de detalhe */}
      {drawerId && (
        <div className="modal-backdrop" onClick={() => setDrawerId(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(480px, 92vw)',
              background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.15)', overflowY: 'auto', zIndex: 60,
              padding: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>Detalhe da proposta</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDrawerId(null)}><X size={18} /></button>
            </div>

            {!drawerData ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
            ) : (
              <>
                <div className="card" style={{ padding: '0.9rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{drawerData.nome_cliente}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', fontFamily: 'monospace' }}>{maskCpf(drawerData.cpf)}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <span className="badge" style={{ background: statusInfo(drawerData.status).bg, color: statusInfo(drawerData.status).fg, fontWeight: 700 }}>{statusInfo(drawerData.status).label}</span>
                    <span className="badge badge-navy">{drawerData.instituicao_nome}</span>
                    {drawerData.convenio_nome && <span className="badge badge-gray">{drawerData.convenio_nome}</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
                    <div><span style={{ color: 'var(--brs-gray-400)' }}>Valor:</span> {fmtMoeda(drawerData.valor_solicitado)}</div>
                    <div><span style={{ color: 'var(--brs-gray-400)' }}>Parcela:</span> {fmtMoeda(drawerData.valor_parcela)} × {drawerData.num_parcelas ?? '-'}</div>
                    {drawerData.id_externo_if && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--brs-gray-400)' }}>Id. na IF:</span> <code>{drawerData.id_externo_if}</code></div>}
                  </div>
                </div>

                <div className="card" style={{ padding: '0.9rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Nuvidio
                    <span className="badge" style={{ background: nuvidioInfo(drawerData.nuvidio_status).bg, color: nuvidioInfo(drawerData.nuvidio_status).fg }}>{nuvidioInfo(drawerData.nuvidio_status).label}</span>
                  </div>
                  {drawerData.nuvidio ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>
                      {drawerData.nuvidio.department_nome && <div>Fila: {drawerData.nuvidio.department_nome}</div>}
                      {drawerData.nuvidio.link && (
                        <a href={drawerData.nuvidio.link} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--brs-navy)', marginTop: 4 }}>
                          Ver link <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Sem convite Nuvidio vinculado ainda.</span>
                  )}
                </div>

                <div className="card" style={{ padding: '0.9rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>Linha do tempo</div>
                  {drawerData.timeline.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhum evento registrado ainda.</span>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                      {drawerData.timeline.map((ev) => (
                        <div key={ev.id} style={{ borderLeft: '2px solid var(--brs-gray-200)', paddingLeft: '0.6rem' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{ev.webhook ? WEBHOOK_LABELS[ev.webhook] || ev.webhook : 'Evento'}</div>
                          {extrairObservacao(ev.payload) && <div style={{ fontSize: '0.76rem', color: 'var(--brs-gray-500)' }}>{extrairObservacao(ev.payload)}</div>}
                          <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)' }}>{fmtData(ev.recebido_em)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled title="Disponível após ativar a integração desta IF">Reenviar Nuvidio</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled title="Disponível após ativar a integração desta IF">Gerar link de correção</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled title="Disponível após ativar a integração desta IF">Cancelar proposta</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
