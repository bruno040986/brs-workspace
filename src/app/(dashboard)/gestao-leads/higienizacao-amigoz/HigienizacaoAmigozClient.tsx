'use client'

/**
 * Higienização Amigoz — 3 modos (consulta unitária, upload CSV/XLSX em lote,
 * seleção de leads/clientes do WeSales), mais o vínculo de convênio BRS ↔
 * VARIANTES do Amigoz e o histórico de lotes. Ver
 * docs/ROTEIRO-AMIGOZ-FATIA-2-HIGIENIZACAO.md.
 *
 * Um convênio BRS pode ter mais de uma variante no Amigoz (achado do Bruno,
 * 15/09: "INSS" e "INSS - Aposentadoria por Invalidez" são o mesmo INSS pra
 * nós, ids diferentes lá) — o worker tenta todas em sequência por CPF, então
 * a tela deixa vincular quantas forem precisas, sem duplicar convênio.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Landmark,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import {
  adicionarVarianteAction,
  atualizarWesalesAction,
  buscarOfertasDoLoteAction,
  buscarOfertasUnitariaAction,
  cancelarLoteAction,
  consultarUnitariaAction,
  contarWesalesPorFiltroAction,
  criarLoteWesalesAction,
  enviarOfertasParaWesalesAction,
  enviarParaNvtiAction,
  listarConveniosAmigozAction,
  listarConveniosBrsAction,
  listarItensLoteAction,
  listarLotesAction,
  listarVariantesAction,
  obterLoteAction,
  pausarLoteAction,
  removerVarianteAction,
  retomarLoteAction,
  type ConvenioBrs,
  type ResultadoUnitario,
} from './actions'
import type { ConvenioAmigoz, VarianteConvenio } from '@/lib/if-credito/amigoz/convenios'
import type { ItemResumo, LoteResumo } from '@/lib/if-credito/amigoz/lote'
import type { OfertaNormalizada } from '@/lib/if-credito/ofertas'

type Aba = 'unitaria' | 'csv' | 'wesales' | 'historico'

function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const STATUS_LABEL: Record<string, { label: string; badge: string }> = {
  pendente: { label: 'Pendente', badge: 'badge-gray' },
  rodando: { label: 'Rodando', badge: 'badge-info' },
  pausado: { label: 'Pausado', badge: 'badge-warning' },
  concluido: { label: 'Concluído', badge: 'badge-success' },
  erro: { label: 'Erro', badge: 'badge-danger' },
  cancelado: { label: 'Cancelado', badge: 'badge-gray' },
}

// ---------------------------------------------------------------------------
// Vínculo de convênio (compartilhado pelas 3 abas) — 1 convênio BRS pode ter
// N variantes no Amigoz; o worker tenta todas em sequência por CPF.
// ---------------------------------------------------------------------------

function VinculoConvenio({
  convenios,
  variantes,
  onAtualizado,
  convenioId,
  onSelecionarConvenio,
}: {
  convenios: ConvenioBrs[]
  variantes: VarianteConvenio[]
  onAtualizado: () => void
  convenioId: string
  onSelecionarConvenio: (id: string) => void
}) {
  const [adicionando, setAdicionando] = useState(false)
  const [conveniosAmigoz, setConveniosAmigoz] = useState<ConvenioAmigoz[]>([])
  const [carregandoAmigoz, setCarregandoAmigoz] = useState(false)
  const [convenioExternoId, setConvenioExternoId] = useState('')
  const [exigeMatricula, setExigeMatricula] = useState(false)
  const [exigeSenhaServidor, setExigeSenhaServidor] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [removendoId, setRemovendoId] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  const variantesDoConvenio = useMemo(() => variantes.filter((v) => v.convenioId === convenioId), [variantes, convenioId])
  const idsJaVinculados = useMemo(() => new Set(variantes.map((v) => v.convenioExternoId)), [variantes])

  async function abrirAdicao() {
    setErro('')
    setAdicionando(true)
    setConvenioExternoId('')
    setExigeMatricula(false)
    setExigeSenhaServidor(false)
    if (conveniosAmigoz.length === 0) {
      setCarregandoAmigoz(true)
      const res = await listarConveniosAmigozAction()
      setCarregandoAmigoz(false)
      if (!res.success) {
        setErro(res.error)
        return
      }
      setConveniosAmigoz(res.data)
    }
  }

  function aoEscolherConvenioAmigoz(id: string) {
    setConvenioExternoId(id)
    const conv = conveniosAmigoz.find((c) => c.id === id)
    if (conv) {
      setExigeMatricula(conv.matriculaObrigatoria)
      setExigeSenhaServidor(conv.senhaServidor)
    }
  }

  async function salvar() {
    if (!convenioExternoId) {
      setErro('Selecione o convênio do Amigoz.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      const convAmigoz = conveniosAmigoz.find((c) => c.id === convenioExternoId)
      const res = await adicionarVarianteAction({
        convenioId,
        convenioExternoId,
        convenioExternoNome: convAmigoz?.nome ?? null,
        averbadoraExterna: convAmigoz?.averbadora ?? null,
        exigeMatricula,
        exigeSenhaServidor,
      })
      if (!res.success) throw new Error(res.error)
      setAdicionando(false)
      onAtualizado()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover(varianteId: string) {
    setRemovendoId(varianteId)
    setErro('')
    try {
      const res = await removerVarianteAction(varianteId)
      if (!res.success) throw new Error(res.error)
      onAtualizado()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao remover.')
    } finally {
      setRemovendoId(null)
    }
  }

  return (
    <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.8rem', alignItems: 'end' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Convênio (BRS)</label>
          <select className="form-control" value={convenioId} onChange={(e) => onSelecionarConvenio(e.target.value)}>
            <option value="">Selecione…</option>
            {convenios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nomeReduzido || c.nome}
              </option>
            ))}
          </select>
        </div>
        {convenioId && (
          <button className="btn btn-outline btn-sm" onClick={abrirAdicao} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Vincular variante do Amigoz
          </button>
        )}
      </div>

      {convenioId && (
        <div style={{ marginTop: '0.7rem' }}>
          {variantesDoConvenio.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', margin: 0 }}>Ainda não vinculado a nenhum convênio do Amigoz.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {variantesDoConvenio.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '0.4rem 0.6rem', borderRadius: 6, background: 'var(--brs-gray-50, #f8fafc)' }}>
                  <strong>{v.rotulo || v.convenioExternoNome || v.convenioExternoId}</strong>
                  {v.averbadoraExterna === null && <span style={{ color: 'var(--brs-danger)' }}>sem averbadora</span>}
                  {v.exigeMatricula && <span style={{ color: 'var(--brs-gray-400)' }}>exige matrícula</span>}
                  {v.exigeSenhaServidor && <span style={{ color: 'var(--brs-gray-400)' }}>exige senha do servidor</span>}
                  <button
                    onClick={() => remover(v.id)}
                    disabled={removendoId === v.id}
                    style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: 'var(--brs-danger)', display: 'inline-flex', alignItems: 'center' }}
                    title="Remover vínculo"
                  >
                    {removendoId === v.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              ))}
              {variantesDoConvenio.length > 1 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0.2rem 0 0' }}>
                  Mais de uma variante vinculada: a consulta tenta todas em sequência por CPF até achar margem.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {adicionando && (
        <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid var(--brs-gray-200)' }}>
          {erro && <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.7rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontSize: '0.78rem', fontWeight: 600 }}>{erro}</div>}
          {carregandoAmigoz ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)' }}>
              <Loader2 size={16} className="animate-spin" /> Carregando convênios do Amigoz…
            </div>
          ) : (
            <>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Convênio no Amigoz</label>
              <select className="form-control" value={convenioExternoId} onChange={(e) => aoEscolherConvenioAmigoz(e.target.value)}>
                <option value="">Selecione…</option>
                {conveniosAmigoz.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} {c.averbadora === null ? '(sem averbadora)' : ''} {idsJaVinculados.has(c.id) ? '— já vinculado (mover)' : ''}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: '1.2rem', marginTop: '0.7rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={exigeMatricula} onChange={(e) => setExigeMatricula(e.target.checked)} /> Exige matrícula
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={exigeSenhaServidor} onChange={(e) => setExigeSenhaServidor(e.target.checked)} /> Exige senha do servidor
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem' }}>
                <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>
                  {salvando ? <Loader2 size={14} className="animate-spin" /> : 'Salvar vínculo'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setAdicionando(false)}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ofertas (Fatia 3 — simulação em tempo real) — cards no estilo da tela do Amigoz
// ---------------------------------------------------------------------------

const PRODUTO_OFERTA_LABEL: Record<string, string> = {
  cartao_rmc: 'Cartão RMC',
  cartao_rcc: 'Cartão RCC',
  saque_complementar: 'Saque Complementar',
  novo: 'Novo',
  refin: 'REFIN',
}

function CardsOfertas({ ofertas }: { ofertas: OfertaNormalizada[] }) {
  if (ofertas.length === 0) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
      {ofertas.map((o, i) => (
        <div key={`${o.produto}-${o.tabelaCodigo ?? i}`} className="card" style={{ padding: '0.7rem 0.9rem', fontSize: '0.78rem' }}>
          <p style={{ fontWeight: 700, margin: '0 0 0.4rem' }}>
            {PRODUTO_OFERTA_LABEL[o.produto] || o.produto} — {o.instituicaoNome}
          </p>
          {o.limitePreAprovado !== null && (
            <p style={{ margin: '0.15rem 0' }}>
              Limite pré-aprovado: <strong>{formatMoney(o.limitePreAprovado)}</strong>
            </p>
          )}
          {o.valorSaque !== null && (
            <p style={{ margin: '0.15rem 0' }}>
              Saque: <strong>{formatMoney(o.valorSaque)}</strong>
              {o.numParcelas !== null && o.valorParcela !== null ? ` em ${o.numParcelas}x de ${formatMoney(o.valorParcela)}` : ''}
            </p>
          )}
          {(o.taxaMes !== null || o.cetMes !== null) && (
            <p style={{ margin: '0.15rem 0', color: 'var(--brs-gray-500)' }}>
              {o.taxaMes !== null ? `Taxa ${o.taxaMes.toLocaleString('pt-BR')}% a.m.` : ''}
              {o.taxaMes !== null && o.cetMes !== null ? ' · ' : ''}
              {o.cetMes !== null ? `CET ${o.cetMes.toLocaleString('pt-BR')}% a.m.` : ''}
            </p>
          )}
          {o.primeiroVencimento && (
            <p style={{ margin: '0.15rem 0', color: 'var(--brs-gray-400)' }}>1º vencimento: {new Date(`${o.primeiroVencimento}T00:00:00`).toLocaleDateString('pt-BR')}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progresso do lote (compartilhado por CSV/WeSales/histórico)
// ---------------------------------------------------------------------------

function LoteProgress({ loteId, onFechar }: { loteId: string; onFechar?: () => void }) {
  const [lote, setLote] = useState<LoteResumo | null>(null)
  const [itens, setItens] = useState<ItemResumo[]>([])
  const [mostrarItens, setMostrarItens] = useState(false)
  const [itemExpandido, setItemExpandido] = useState<string | null>(null)
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const carregar = useCallback(async () => {
    const res = await obterLoteAction(loteId)
    if (res.success) setLote(res.data)
  }, [loteId])

  useEffect(() => {
    let cancelado = false
    obterLoteAction(loteId).then((res) => {
      if (!cancelado && res.success) setLote(res.data)
    })
    intervalRef.current = setInterval(() => {
      carregar()
    }, 5000)
    return () => {
      cancelado = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loteId, carregar])

  useEffect(() => {
    if (lote && (lote.status === 'concluido' || lote.status === 'erro' || lote.status === 'cancelado')) {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [lote])

  async function carregarItens() {
    setMostrarItens((v) => !v)
    if (!mostrarItens) {
      const res = await listarItensLoteAction(loteId)
      if (res.success) setItens(res.data)
    }
  }

  async function executar(nome: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setAcaoEmCurso(nome)
    setMensagem('')
    try {
      const res = await fn()
      if (!res.success) throw new Error(res.error)
      await carregar()
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : 'Erro.')
    } finally {
      setAcaoEmCurso(null)
    }
  }

  if (!lote) {
    return (
      <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)' }}>
        <Loader2 size={16} className="animate-spin" /> Carregando lote…
      </div>
    )
  }

  const emAndamento = lote.status === 'pendente' || lote.status === 'rodando'
  const pct = lote.totalItens > 0 ? Math.round((lote.itensProcessados / lote.totalItens) * 100) : 0
  const statusInfo = STATUS_LABEL[lote.status] || { label: lote.status, badge: 'badge-gray' }

  return (
    <div className="card" style={{ padding: '1rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.6rem' }}>
        <span className={`badge ${statusInfo.badge}`}>{statusInfo.label}</span>
        <strong style={{ fontSize: '0.85rem' }}>
          {lote.itensProcessados}/{lote.totalItens} processados
        </strong>
        <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>
          {lote.itensComMargem} com margem · {lote.itensErro} erro
        </span>
        {onFechar && (
          <button onClick={onFechar} style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: 'var(--brs-gray-400)' }}>
            <X size={16} />
          </button>
        )}
      </div>

      {lote.totalItens > 0 && (
        <div style={{ height: 8, borderRadius: 4, background: 'var(--brs-gray-100, #f1f5f9)', overflow: 'hidden', marginBottom: '0.7rem' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--brs-navy)', transition: 'width 0.4s' }} />
        </div>
      )}

      {lote.lastError && <p style={{ fontSize: '0.78rem', color: 'var(--brs-danger)', margin: '0 0 0.6rem' }}>{lote.lastError}</p>}
      {mensagem && <p style={{ fontSize: '0.78rem', color: 'var(--brs-danger)', margin: '0 0 0.6rem' }}>{mensagem}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {emAndamento && lote.status === 'rodando' && (
          <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'pausar'} onClick={() => executar('pausar', () => pausarLoteAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {acaoEmCurso === 'pausar' ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />} Pausar
          </button>
        )}
        {lote.status === 'pausado' && (
          <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'retomar'} onClick={() => executar('retomar', () => retomarLoteAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {acaoEmCurso === 'retomar' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Retomar
          </button>
        )}
        {emAndamento && (
          <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'cancelar'} onClick={() => executar('cancelar', () => cancelarLoteAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--brs-danger)' }}>
            {acaoEmCurso === 'cancelar' ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Cancelar
          </button>
        )}

        <a href={`/api/if-higienizacao/lotes/${loteId}/export`} className="btn btn-outline btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <Download size={13} /> Baixar planilha
        </a>
        <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'nvti' || lote.itensComMargem === 0} onClick={() => executar('nvti', () => enviarParaNvtiAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={lote.itensComMargem === 0 ? 'Nenhum item com margem ainda' : ''}>
          {acaoEmCurso === 'nvti' ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Higienizar na NVTI
        </button>
        <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'wesales'} onClick={() => executar('wesales', () => atualizarWesalesAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {acaoEmCurso === 'wesales' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Atualizar WeSales
        </button>
        {lote.status === 'concluido' && !lote.buscarOfertas && lote.itensComMargem > 0 && (
          <button className="btn btn-outline btn-sm" disabled={acaoEmCurso === 'buscar-ofertas'} onClick={() => executar('buscar-ofertas', () => buscarOfertasDoLoteAction(loteId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {acaoEmCurso === 'buscar-ofertas' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Buscar ofertas
          </button>
        )}
        <button
          className="btn btn-outline btn-sm"
          disabled={acaoEmCurso === 'enviar-ofertas' || lote.itensComOferta === 0}
          onClick={() => executar('enviar-ofertas', () => enviarOfertasParaWesalesAction(loteId))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title={lote.itensComOferta === 0 ? 'Nenhuma oferta encontrada ainda' : ''}
        >
          {acaoEmCurso === 'enviar-ofertas' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Enviar ofertas ao WeSales
        </button>
        <button className="btn btn-outline btn-sm" onClick={carregarItens}>{mostrarItens ? 'Ocultar itens' : 'Ver itens'}</button>
      </div>

      {mostrarItens && (
        <div style={{ marginTop: '0.8rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
                <th style={{ padding: '0.3rem 0.4rem' }}>CPF</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Status</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>RMC</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>RCC</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Novo</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Variante</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Ofertas</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Erro</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const temOfertas = Boolean(it.ofertas && it.ofertas.length > 0)
                const ofertasBadge =
                  it.ofertasStatus === 'ok' ? `${it.ofertas?.length ?? 0} oferta(s)` : it.ofertasStatus === 'sem_oferta' ? 'sem oferta' : it.ofertasStatus === 'erro' ? 'erro' : ''
                return (
                  <Fragment key={it.id}>
                    <tr style={{ borderTop: '1px solid var(--brs-gray-100, #f1f5f9)' }}>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{it.cpf}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{it.status}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{formatMoney(it.margemConsignado)}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{formatMoney(it.margemBeneficio)}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{formatMoney(it.margemEmprestimo)}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>{it.convenioExternoUsado || ''}</td>
                      <td style={{ padding: '0.3rem 0.4rem' }}>
                        {ofertasBadge ? (
                          <button
                            onClick={() => setItemExpandido(itemExpandido === it.id ? null : it.id)}
                            disabled={!temOfertas}
                            style={{ border: 0, background: 'none', cursor: temOfertas ? 'pointer' : 'default', padding: 0, fontSize: '0.74rem', fontWeight: 700, color: temOfertas ? 'var(--brs-navy)' : 'var(--brs-gray-400)' }}
                          >
                            {ofertasBadge}
                          </button>
                        ) : (
                          ''
                        )}
                      </td>
                      <td style={{ padding: '0.3rem 0.4rem', color: 'var(--brs-danger)' }}>{it.erro || it.ofertasErro || ''}</td>
                    </tr>
                    {itemExpandido === it.id && temOfertas && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0.5rem 0.4rem 0.8rem', background: 'var(--brs-gray-50, #f8fafc)' }}>
                          <CardsOfertas ofertas={it.ofertas || []} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aba 1 — consulta unitária
// ---------------------------------------------------------------------------

function AbaUnitaria({ convenioId, variantes }: { convenioId: string; variantes: VarianteConvenio[] }) {
  const [cpf, setCpf] = useState('')
  const [matricula, setMatricula] = useState('')
  const [senhaServidor, setSenhaServidor] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoUnitario | null>(null)
  const [erro, setErro] = useState('')
  const [buscandoOfertas, setBuscandoOfertas] = useState(false)
  const [ofertasResultado, setOfertasResultado] = useState<{ ofertas: OfertaNormalizada[]; status: string; mensagem: string | null } | null>(null)

  const exigeMatricula = variantes.some((v) => v.exigeMatricula)
  const exigeSenhaServidor = variantes.some((v) => v.exigeSenhaServidor)

  async function consultar() {
    if (!convenioId) {
      setErro('Selecione o convênio.')
      return
    }
    setConsultando(true)
    setErro('')
    setResultado(null)
    setOfertasResultado(null)
    try {
      const res = await consultarUnitariaAction({ convenioId, cpf, matricula: matricula || undefined, senhaServidor: senhaServidor || undefined })
      if (!res.success) throw new Error(res.error)
      setResultado(res.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro na consulta.')
    } finally {
      setConsultando(false)
    }
  }

  async function buscarOfertas() {
    if (!resultado) return
    setBuscandoOfertas(true)
    setOfertasResultado(null)
    try {
      const res = await buscarOfertasUnitariaAction(resultado.itemId)
      if (!res.success) throw new Error(res.error)
      setOfertasResultado(res.data)
    } catch (err) {
      setOfertasResultado({ ofertas: [], status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao buscar ofertas.' })
    } finally {
      setBuscandoOfertas(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>CPF</label>
          <input className="form-control" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" />
        </div>
        {exigeMatricula && (
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Matrícula</label>
            <input className="form-control" value={matricula} onChange={(e) => setMatricula(e.target.value)} />
          </div>
        )}
        {exigeSenhaServidor && (
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Senha do servidor</label>
            <input className="form-control" type="password" value={senhaServidor} onChange={(e) => setSenhaServidor(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>
      <button className="btn btn-primary btn-sm" onClick={consultar} disabled={consultando || !cpf.trim()} style={{ marginTop: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {consultando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Consultar margem
      </button>

      {erro && <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontSize: '0.8rem', fontWeight: 600 }}>{erro}</div>}

      {resultado && !resultado.ok && (
        <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontSize: '0.8rem' }}>{resultado.mensagem}</div>
      )}

      {resultado?.ok && resultado.margem && (
        <div style={{ marginTop: '0.9rem' }}>
          {resultado.margem.nomeIf && <p style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 0.5rem' }}>{resultado.margem.nomeIf} {resultado.margem.matriculaIf ? `— matrícula ${resultado.margem.matriculaIf}` : ''}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
                  <th style={{ padding: '0.3rem 0.5rem' }}>Produto</th>
                  <th style={{ padding: '0.3rem 0.5rem' }}>Margem</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={{ padding: '0.3rem 0.5rem' }}>Cartão Consignado (RMC)</td><td style={{ padding: '0.3rem 0.5rem' }}>{formatMoney(resultado.margem.margemConsignado)}</td></tr>
                <tr><td style={{ padding: '0.3rem 0.5rem' }}>Cartão Benefício — compra (30%)</td><td style={{ padding: '0.3rem 0.5rem' }}>{formatMoney(resultado.margem.margemBeneficioCompra)}</td></tr>
                <tr><td style={{ padding: '0.3rem 0.5rem' }}>Cartão Benefício — saque (70%)</td><td style={{ padding: '0.3rem 0.5rem' }}>{formatMoney(resultado.margem.margemBeneficioSaque)}</td></tr>
                <tr style={{ fontWeight: 700 }}><td style={{ padding: '0.3rem 0.5rem' }}>Cartão Benefício (RCC) — total</td><td style={{ padding: '0.3rem 0.5rem' }}>{formatMoney(resultado.margem.margemBeneficio)}</td></tr>
                <tr><td style={{ padding: '0.3rem 0.5rem' }}>Empréstimo (Novo)</td><td style={{ padding: '0.3rem 0.5rem' }}>{formatMoney(resultado.margem.margemEmprestimo)}</td></tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.78rem', color: resultado.margem.temOportunidade ? 'var(--brs-success)' : 'var(--brs-gray-400)', fontWeight: 600, margin: '0.6rem 0 0' }}>
            {resultado.margem.temOportunidade ? 'Tem oportunidade.' : 'Sem oportunidade nesta consulta.'}
          </p>

          {resultado.margem.temOportunidade && (
            <div style={{ marginTop: '0.7rem' }}>
              <button className="btn btn-outline btn-sm" onClick={buscarOfertas} disabled={buscandoOfertas} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {buscandoOfertas ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Buscar ofertas
              </button>
              {ofertasResultado?.status === 'erro' && <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--brs-danger)' }}>{ofertasResultado.mensagem}</p>}
              {ofertasResultado?.status === 'sem_oferta' && <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Nenhuma oferta encontrada.</p>}
              {ofertasResultado && ofertasResultado.ofertas.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <CardsOfertas ofertas={ofertasResultado.ofertas} />
                </div>
              )}
            </div>
          )}

          <LoteProgress loteId={resultado.loteId} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aba 2 — upload CSV/XLSX
// ---------------------------------------------------------------------------

function AbaCsv({ convenioId, variantes }: { convenioId: string; variantes: VarianteConvenio[] }) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [pausaMs, setPausaMs] = useState(1500)
  const [buscarOfertas, setBuscarOfertas] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [loteId, setLoteId] = useState<string | null>(null)
  const [resumo, setResumo] = useState('')

  async function enviar() {
    if (!convenioId) {
      setErro('Selecione o convênio.')
      return
    }
    if (!arquivo) {
      setErro('Escolha um arquivo.')
      return
    }
    if (variantes.length === 0) {
      setErro('Vincule este convênio a um convênio do Amigoz antes de subir o arquivo.')
      return
    }
    setEnviando(true)
    setErro('')
    setResumo('')
    setLoteId(null)
    try {
      const formData = new FormData()
      formData.append('file', arquivo)
      formData.append('convenio_id', convenioId)
      formData.append('pausa_ms', String(pausaMs))
      if (buscarOfertas) formData.append('buscar_ofertas', '1')
      const res = await fetch('/api/if-higienizacao/upload', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Falha no upload.')
      setLoteId(json.loteId)
      setResumo(`${json.inseridos} CPF(s) na fila · ${json.invalidos} inválido(s)/sem CPF · ${json.duplicados} duplicado(s).`)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no upload.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', margin: '0 0 0.8rem' }}>
        Colunas reconhecidas pelo cabeçalho: <code>cpf</code> (obrigatória), <code>nome</code>, <code>telefone</code>, <code>matricula</code>, <code>senha_servidor</code>. Sem cabeçalho, o sistema procura um CPF válido em qualquer célula da linha.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Arquivo (CSV/XLSX)</label>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Pausa entre consultas (ms)</label>
          <input className="form-control" type="number" min={500} max={60000} value={pausaMs} onChange={(e) => setPausaMs(Number(e.target.value) || 1500)} />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginTop: '0.8rem' }}>
        <input type="checkbox" checked={buscarOfertas} onChange={(e) => setBuscarOfertas(e.target.checked)} /> Buscar ofertas após a margem
      </label>
      <button className="btn btn-primary btn-sm" onClick={enviar} disabled={enviando || !arquivo} style={{ marginTop: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Iniciar lote
      </button>

      {erro && <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontSize: '0.8rem', fontWeight: 600 }}>{erro}</div>}
      {resumo && <p style={{ marginTop: '0.7rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>{resumo}</p>}
      {loteId && <LoteProgress loteId={loteId} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aba 3 — seleção no WeSales
// ---------------------------------------------------------------------------

function AbaWesales({ convenioId, variantes }: { convenioId: string; variantes: VarianteConvenio[] }) {
  const [tagsTexto, setTagsTexto] = useState('')
  const [limite, setLimite] = useState(500)
  const [pausaMs, setPausaMs] = useState(1500)
  const [buscarOfertas, setBuscarOfertas] = useState(false)
  const [contando, setContando] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [loteId, setLoteId] = useState<string | null>(null)

  const tagsExtras = useMemo(() => tagsTexto.split(',').map((t) => t.trim()).filter(Boolean), [tagsTexto])

  async function contar() {
    if (!convenioId) {
      setErro('Selecione o convênio.')
      return
    }
    setContando(true)
    setErro('')
    setTotal(null)
    try {
      const res = await contarWesalesPorFiltroAction({ convenioId, tagsExtras })
      if (!res.success) throw new Error(res.error)
      setTotal(res.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao contar.')
    } finally {
      setContando(false)
    }
  }

  async function gerar() {
    if (variantes.length === 0) {
      setErro('Vincule este convênio a um convênio do Amigoz antes de gerar o lote.')
      return
    }
    setGerando(true)
    setErro('')
    setLoteId(null)
    try {
      const res = await criarLoteWesalesAction({ convenioId, tagsExtras, limite, pausaMs, buscarOfertas })
      if (!res.success) throw new Error(res.error)
      setLoteId(res.data.loteId)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao gerar o lote.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', margin: '0 0 0.8rem' }}>
        Filtra os contatos do convênio selecionado no WeSales (pelo campo &quot;Convênio (Código Workspace)&quot;). As tags abaixo, se
        informadas, são exigidas TODAS (não é &quot;qualquer uma&quot;).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.8rem' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Tags obrigatórias (separadas por vírgula)</label>
          <input className="form-control" value={tagsTexto} onChange={(e) => setTagsTexto(e.target.value)} placeholder="ex.: disponivel" />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Limite (máx. 5.000)</label>
          <input className="form-control" type="number" min={1} max={5000} value={limite} onChange={(e) => setLimite(Number(e.target.value) || 500)} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }}>Pausa entre consultas (ms)</label>
          <input className="form-control" type="number" min={500} max={60000} value={pausaMs} onChange={(e) => setPausaMs(Number(e.target.value) || 1500)} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginTop: '0.8rem' }}>
        <input type="checkbox" checked={buscarOfertas} onChange={(e) => setBuscarOfertas(e.target.checked)} /> Buscar ofertas após a margem
      </label>

      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', alignItems: 'center' }}>
        <button className="btn btn-outline btn-sm" onClick={contar} disabled={contando || !convenioId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {contando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Contar
        </button>
        {total !== null && <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{total} contato(s) encontrados</span>}
      </div>

      <button className="btn btn-primary btn-sm" onClick={gerar} disabled={gerando || !convenioId} style={{ marginTop: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {gerando ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Gerar lote
      </button>

      {erro && <div style={{ marginTop: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontSize: '0.8rem', fontWeight: 600 }}>{erro}</div>}
      {loteId && <LoteProgress loteId={loteId} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aba histórico
// ---------------------------------------------------------------------------

function AbaHistorico() {
  const [lotes, setLotes] = useState<LoteResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionado, setSelecionado] = useState<string | null>(null)

  useEffect(() => {
    listarLotesAction().then((res) => {
      if (res.success) setLotes(res.data)
      setCarregando(false)
    })
  }, [])

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '1rem' }}>
        <Loader2 size={16} className="animate-spin" /> Carregando…
      </div>
    )
  }

  if (lotes.length === 0) {
    return <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Nenhum lote ainda.</p>
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
              <th style={{ padding: '0.4rem 0.5rem' }}>Quando</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Origem</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Total</th>
              <th style={{ padding: '0.4rem 0.5rem' }}>Com margem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => {
              const info = STATUS_LABEL[l.status] || { label: l.status, badge: 'badge-gray' }
              return (
                <tr key={l.id} style={{ borderTop: '1px solid var(--brs-gray-100, #f1f5f9)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{l.origem}{l.arquivoNome ? ` — ${l.arquivoNome}` : ''}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}><span className={`badge ${info.badge}`}>{info.label}</span></td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{l.totalItens}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{l.itensComMargem}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setSelecionado(selecionado === l.id ? null : l.id)}>
                      {selecionado === l.id ? 'Fechar' : 'Ver'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {selecionado && <LoteProgress loteId={selecionado} onFechar={() => setSelecionado(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function HigienizacaoAmigozClient() {
  const [aba, setAba] = useState<Aba>('unitaria')
  const [convenios, setConvenios] = useState<ConvenioBrs[]>([])
  const [variantes, setVariantes] = useState<VarianteConvenio[]>([])
  const [convenioId, setConvenioId] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregarVariantes = useCallback(async () => {
    const res = await listarVariantesAction()
    if (res.success) setVariantes(res.data)
  }, [])

  useEffect(() => {
    Promise.all([listarConveniosBrsAction(), listarVariantesAction()])
      .then(([resConv, resVar]) => {
        if (!resConv.success) {
          setErro(resConv.error)
          return
        }
        setConvenios(resConv.data)
        if (resVar.success) setVariantes(resVar.data)
      })
      .finally(() => setCarregando(false))
  }, [])

  const variantesDoConvenio = useMemo(() => variantes.filter((v) => v.convenioId === convenioId), [variantes, convenioId])

  const abas: Array<{ id: Aba; label: string }> = [
    { id: 'unitaria', label: 'Consulta unitária' },
    { id: 'csv', label: 'Upload CSV/XLSX' },
    { id: 'wesales', label: 'Selecionar no WeSales' },
    { id: 'historico', label: 'Histórico de lotes' },
  ]

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Landmark size={24} /> Higienização Amigoz
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Consulta de margem de crédito via API do Amigoz — unitária, por planilha ou selecionando contatos do WeSales.
        Margem encontrada pode virar lote de higienização NVTI (cadastra no WeSales) ou atualizar a margem direto no
        contato.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--brs-danger)', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {aba !== 'historico' && (
            <VinculoConvenio convenios={convenios} variantes={variantes} onAtualizado={carregarVariantes} convenioId={convenioId} onSelecionarConvenio={setConvenioId} />
          )}

          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', borderBottom: '1px solid var(--brs-gray-200)' }}>
            {abas.map((a) => (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                style={{
                  padding: '0.6rem 0.9rem',
                  border: 0,
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: aba === a.id ? 'var(--brs-navy)' : 'var(--brs-gray-400)',
                  borderBottom: aba === a.id ? '2px solid var(--brs-navy)' : '2px solid transparent',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {aba === 'unitaria' && <AbaUnitaria convenioId={convenioId} variantes={variantesDoConvenio} />}
          {aba === 'csv' && <AbaCsv convenioId={convenioId} variantes={variantesDoConvenio} />}
          {aba === 'wesales' && <AbaWesales convenioId={convenioId} variantes={variantesDoConvenio} />}
          {aba === 'historico' && <AbaHistorico />}
        </>
      )}
    </div>
  )
}
