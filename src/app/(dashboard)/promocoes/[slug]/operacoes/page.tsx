'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Ban, Calculator, CheckCircle2, Edit2, Loader2, Plus, ReceiptText, Trash2, X } from 'lucide-react'
import {
  calcularCpf,
  confirmarOperacao,
  excluirOperacao,
  invalidarOperacao,
  listarInstituicoes,
  listarOperacoes,
  salvarOperacao,
} from '@/lib/promocoes/actions'
import { formatarReais } from '@/lib/promocoes/mascara'
import { Aviso, Busca, Selo, TIPOS_OP, Titulo, Vazio, brData, reaisParaCentavos, useCarga, useDebounce, type Feedback } from '../../_components/ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Form = {
  id?: string
  cpf: string
  tipo: string
  valor: string
  dataDigitacao: string
  dataPagamento: string
  instituicaoId: string
  instituicaoTexto: string
  numeroProposta: string
  observacao: string
}
const VAZIO: Form = { cpf: '', tipo: 'novo', valor: '', dataDigitacao: '', dataPagamento: '', instituicaoId: '', instituicaoTexto: '', numeroProposta: '', observacao: '' }

function Calculo({ titulo, e }: { titulo: string; e: any }) {
  if (!e) return null
  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.75rem', flex: 1, minWidth: 230 }}>
      <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>{titulo}</div>
      <div style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
        Acumulado válido: <b>{formatarReais(e.totalCentavos)}</b> {e.atingiuMinimo ? '' : '(abaixo do mínimo)'}
        <br />
        Cartão: <b>{formatarReais(e.cartaoCentavos)}</b> · exigido {e.pct}% · {e.proporcaoOk ? <span style={{ color: '#047857' }}>proporção OK</span> : <span style={{ color: '#B91C1C' }}>faltam {formatarReais(e.cartaoFaltanteCentavos)} em cartão</span>}
        <br />
        Saldo p/ próxima faixa: <b>{formatarReais(e.saldoCentavos)}</b>
        <br />
        Números: devidos <b>{e.numerosDevidos}</b> · a emitir <b>{e.numerosAEmitir}</b>
      </div>
    </div>
  )
}

export default function OperacoesPage() {
  const { slug } = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const qd = useDebounce(q)
  const [fb, setFb] = useState<Feedback>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [calc, setCalc] = useState<any>(null)
  const [elig, setElig] = useState<{ id: string; r?: any } | null>(null)
  const [instituicoes, setInstituicoes] = useState<Array<{ id: string; nome: string }>>([])
  const loader = useCallback(() => listarOperacoes(slug, qd, status), [slug, qd, status])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  useEffect(() => {
    void listarInstituicoes().then((r) => r.ok && setInstituicoes(r.items))
  }, [])

  const cpfDigitos = (form?.cpf || '').replace(/\D/g, '')
  const valorC = form ? reaisParaCentavos(form.valor) : NaN
  const rascunho = form && valorC > 0 && form.dataDigitacao ? { tipo: form.tipo as any, valorCentavos: valorC, dataDigitacao: form.dataDigitacao, dataPagamento: form.dataPagamento || null } : null
  const rascunhoKey = JSON.stringify(rascunho)
  useEffect(() => {
    if (cpfDigitos.length !== 11) {
      void Promise.resolve().then(() => setCalc(null))
      return
    }
    let vivo = true
    const t = setTimeout(async () => {
      const r = await calcularCpf(slug, cpfDigitos, rascunhoKey === 'null' ? null : JSON.parse(rascunhoKey))
      if (vivo) setCalc(r.ok ? r : { erro: r.error })
    }, 350)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [slug, cpfDigitos, rascunhoKey])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!(valorC > 0)) return setFb({ type: 'error', text: 'Informe o valor líquido creditado (ex.: 5.000,00).' })
    setSaving(true)
    const r = await salvarOperacao(slug, {
      id: form.id,
      cpf: form.cpf,
      tipo: form.tipo as any,
      valorCentavos: valorC,
      dataDigitacao: form.dataDigitacao,
      dataPagamento: form.dataPagamento || null,
      instituicaoId: form.instituicaoId || null,
      instituicaoTexto: form.instituicaoTexto || null,
      numeroProposta: form.numeroProposta || null,
      observacao: form.observacao || null,
    })
    setSaving(false)
    if (r.ok) {
      setForm(null)
      setFb({ type: 'success', text: 'Operação salva como "informada". Confirme quando o pagamento estiver validado.' })
      recarregar()
    } else setFb({ type: 'error', text: r.error })
  }

  async function agir(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okTxt: string) {
    setBusy(id)
    const r = await fn()
    setBusy(null)
    setFb(r.ok ? { type: 'success', text: okTxt } : { type: 'error', text: r.error || 'Erro.' })
    if (r.ok) recarregar()
  }

  function invalidar(id: string) {
    const motivo = window.prompt('Motivo da invalidação (obrigatório):')
    if (motivo?.trim()) void agir(id, () => invalidarOperacao(slug, id, motivo), 'Operação invalidada e direitos recalculados.')
  }

  function confirmar(id: string, nome: string, valor: number) {
    if (window.confirm(`Confirmar operação de ${nome} (${formatarReais(valor)})? Isso dispara o link de números por WhatsApp quando houver direito.`)) {
      void agir(id, () => confirmarOperacao(slug, id), 'Operação confirmada; direitos recalculados e link na fila.')
    }
  }

  async function abrirElegibilidade(id: string) {
    setElig({ id })
    const r = await calcularCpf(slug, id)
    setElig({ id, r: r.ok ? r : { erro: r.error } })
  }

  function editar(o: any) {
    setForm({
      id: o.id,
      cpf: '',
      tipo: o.tipo,
      valor: (o.valorCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      dataDigitacao: o.dataDigitacao,
      dataPagamento: o.dataPagamento || '',
      instituicaoId: o.instituicaoId || '',
      instituicaoTexto: o.instituicao || '',
      numeroProposta: o.proposta || '',
      observacao: o.observacao || '',
    })
  }

  return (
    <div className="page-content">
      <Titulo icon={<ReceiptText size={18} />} titulo="Operações" sub="Digitação manual por CPF. Só operação confirmada, digitada e paga no período, conta para números e Pix.">
        <button type="button" className="btn btn-primary" onClick={() => setForm(VAZIO)}>
          <Plus size={16} /> Nova operação
        </button>
      </Titulo>
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      <Busca valor={q} onChange={setQ} placeholder="Buscar por nome, CPF, código ou nº da proposta...">
        <select className="form-control" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="informada">Informada</option>
          <option value="confirmada">Confirmada</option>
          <option value="invalidada">Invalidada</option>
        </select>
      </Busca>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Servidor</th>
                <th>Produto</th>
                <th>Valor líquido</th>
                <th>Digitação</th>
                <th>Pagamento</th>
                <th>Financeira / proposta</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {!data?.items?.length ? (
                <Vazio colSpan={8} carregando={carregando} texto="Nenhuma operação." />
              ) : (
                data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.nome}</b>
                      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
                        {o.cpf} · {o.codigo}
                      </div>
                    </td>
                    <td>{TIPOS_OP[o.tipo]}</td>
                    <td>{formatarReais(o.valorCentavos)}</td>
                    <td>{brData(o.dataDigitacao)}</td>
                    <td>{brData(o.dataPagamento)}</td>
                    <td>
                      {o.instituicao || '—'}
                      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>{o.proposta || ''}</div>
                    </td>
                    <td>
                      <Selo valor={o.status} />
                      {o.foraDoPeriodo && o.status !== 'invalidada' && (
                        <div style={{ fontSize: '0.7rem', color: '#B45309' }}>fora do período</div>
                      )}
                      {o.motivo && <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)' }}>{o.motivo}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Elegibilidade do CPF" aria-label="Elegibilidade do CPF" onClick={() => abrirElegibilidade(o.inscricaoId)}>
                          <Calculator size={15} />
                        </button>
                        {o.status === 'informada' && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Editar" aria-label="Editar" onClick={() => editar(o)}>
                              <Edit2 size={15} />
                            </button>
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy === o.id} onClick={() => confirmar(o.id, o.nome, o.valorCentavos)}>
                              {busy === o.id ? <Loader2 size={14} className="spinner" /> : <CheckCircle2 size={14} />} Confirmar
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Excluir" aria-label="Excluir" onClick={() => window.confirm('Excluir esta operação informada?') && agir(o.id, () => excluirOperacao(slug, o.id), 'Operação excluída.')}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                        {o.status !== 'invalidada' && (
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy === o.id} onClick={() => invalidar(o.id)}>
                            <Ban size={14} /> Invalidar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {elig && (
        <div className="modal-backdrop" onClick={() => setElig(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Elegibilidade do CPF</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setElig(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {!elig.r ? (
                <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
              ) : elig.r.erro ? (
                <Aviso f={{ type: 'error', text: elig.r.erro }} />
              ) : (
                <>
                  <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
                    {elig.r.inscricao.nome} · {elig.r.inscricao.codigo} · números emitidos: {elig.r.inscricao.emitidos}
                  </div>
                  <Calculo titulo="Operações confirmadas no período" e={elig.r.atual} />
                  {elig.r.indicador && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                      Indicador: <b>{elig.r.indicador.nome}</b> — R$ 50: {elig.r.indicador.atual.pixDevido ? <b style={{ color: '#047857' }}>elegível</b> : 'não elegível'} · número do indicador: {elig.r.indicador.atual.numeroDevido ? <b style={{ color: '#047857' }}>elegível</b> : 'não elegível'}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={salvar}>
              <div className="modal-header">
                <h3 className="modal-title">{form.id ? 'Editar operação' : 'Nova operação'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setForm(null)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">CPF do servidor *</label>
                    <input className="form-control" inputMode="numeric" placeholder="Somente números" value={form.cpf} disabled={!!form.id} onChange={(e) => setForm({ ...form, cpf: e.target.value })} required={!form.id} />
                    {form.id && <small>CPF não é editável; exclua e refaça se estiver errado.</small>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Produto *</label>
                    <select className="form-control" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                      {Object.entries(TIPOS_OP).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Valor líquido creditado (R$) *</label>
                    <input className="form-control" inputMode="decimal" placeholder="5.000,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Data de digitação *</label>
                    <input type="date" className="form-control" value={form.dataDigitacao} onChange={(e) => setForm({ ...form, dataDigitacao: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Data de pagamento (crédito)</label>
                    <input type="date" className="form-control" value={form.dataPagamento} onChange={(e) => setForm({ ...form, dataPagamento: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Instituição financeira</label>
                    <select className="form-control" value={form.instituicaoId} onChange={(e) => setForm({ ...form, instituicaoId: e.target.value })}>
                      <option value="">— outra / texto livre —</option>
                      {instituicoes.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!form.instituicaoId && (
                    <div className="form-group">
                      <label className="form-label">Financeira (texto)</label>
                      <input className="form-control" value={form.instituicaoTexto} onChange={(e) => setForm({ ...form, instituicaoTexto: e.target.value })} />
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Nº da proposta</label>
                    <input className="form-control" value={form.numeroProposta} onChange={(e) => setForm({ ...form, numeroProposta: e.target.value })} />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label className="form-label">Observação</label>
                  <input className="form-control" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
                </div>

                {calc && (
                  <div style={{ marginTop: '1rem' }}>
                    {calc.erro ? (
                      <Aviso f={{ type: 'error', text: calc.erro }} />
                    ) : !calc.encontrado ? (
                      <Aviso f={{ type: 'error', text: 'CPF sem inscrição nesta campanha.' }} />
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
                          {calc.inscricao.nome} · {calc.inscricao.codigo} · números já emitidos: {calc.inscricao.emitidos}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <Calculo titulo="Hoje (só confirmadas)" e={calc.atual} />
                          <Calculo titulo="Se esta operação for confirmada" e={calc.comRascunho} />
                        </div>
                        {calc.indicador && (
                          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                            Indicador: <b>{calc.indicador.nome}</b> — R$ 50: {(calc.indicador.comRascunho || calc.indicador.atual).pixDevido ? <b style={{ color: '#047857' }}>elegível</b> : 'não elegível'} · número do indicador:{' '}
                            {(calc.indicador.comRascunho || calc.indicador.atual).numeroDevido ? <b style={{ color: '#047857' }}>elegível</b> : 'não elegível'}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : null} Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
