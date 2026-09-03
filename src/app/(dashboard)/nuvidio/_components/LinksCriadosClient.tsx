'use client'

/**
 * Nuvidio › Links Criados — tabela de acompanhamento (engine única, duas
 * lentes: origem 'proposta' e 'onboarding'). Copiar, enviar por template
 * (WhatsApp/e-mail, parceiro/cliente), ver gravação, tabular resultado,
 * cancelar/encerrar. Compartilhada com "Nuvidio — Acompanhamento" dos
 * Cadastros Recebidos via prop `origem`.
 */
import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, Copy, Link2, Loader2, Mail, MessageSquare, RefreshCw, Video, X } from 'lucide-react'
import {
  cancelarNuvidioConvite,
  enviarNuvidioConvite,
  listarNuvidioConvites,
  listarNuvidioTemplates,
  tabularNuvidioConvite,
  type NuvidioConviteRow,
  type NuvidioTemplateRow,
} from '@/lib/nuvidio/convites-actions'

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  aguardando_chamada: { label: 'Aguardando chamada', cor: '#0284c7' },
  chamada_em_curso: { label: 'Chamada em curso', cor: '#d97706' },
  chamada_realizada: { label: 'Chamada realizada', cor: '#7c3aed' },
  aprovado: { label: 'Aprovado', cor: '#16a34a' },
  reprovado: { label: 'Reprovado', cor: '#dc2626' },
  aguardando_refazer: { label: 'Aguardando refazer', cor: '#ea580c' },
  cancelado: { label: 'Cancelado', cor: '#6b7280' },
  expirado: { label: 'Expirado', cor: '#6b7280' },
}

export default function LinksCriadosClient({ origem, titulo }: { origem?: 'proposta' | 'onboarding'; titulo: string }) {
  const [rows, setRows] = useState<NuvidioConviteRow[]>([])
  const [templates, setTemplates] = useState<NuvidioTemplateRow[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [enviarDe, setEnviarDe] = useState<NuvidioConviteRow | null>(null)
  const [tabularDe, setTabularDe] = useState<NuvidioConviteRow | null>(null)
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)

  async function carregar() {
    try {
      const [res, tpl] = await Promise.all([
        listarNuvidioConvites({ origem, status: statusFiltro || undefined, busca }),
        listarNuvidioTemplates(),
      ])
      if (!res.success) throw new Error(res.error)
      setRows(res.data || [])
      if (tpl.success) setTemplates((tpl.data || []).filter((t) => t.is_active))
      setErro('')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
    const t = window.setInterval(carregar, 30_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltro, origem])

  const metricas = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10)
    return {
      aguardando: rows.filter((r) => r.status === 'aguardando_chamada').length,
      realizadasHoje: rows.filter((r) => r.chamada_finalizada_em?.startsWith(hoje)).length,
      aprovados: rows.filter((r) => r.status === 'aprovado').length,
      reprovados: rows.filter((r) => r.status === 'reprovado').length,
    }
  }, [rows])

  async function enviar(templateId: string) {
    if (!enviarDe || busy) return
    setBusy(true)
    try {
      const res = await enviarNuvidioConvite({ conviteId: enviarDe.id, templateId })
      if (!res.success) throw new Error(res.error)
      setOkMsg(res.detalhe)
      setEnviarDe(null)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no envio.')
    } finally {
      setBusy(false)
    }
  }

  async function tabular(status: 'aprovado' | 'reprovado' | 'aguardando_refazer') {
    if (!tabularDe || busy) return
    setBusy(true)
    try {
      const res = await tabularNuvidioConvite({ conviteId: tabularDe.id, status, observacao: obs })
      if (!res.success) throw new Error(res.error)
      setTabularDe(null)
      setObs('')
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao tabular.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelar(row: NuvidioConviteRow) {
    if (!window.confirm(`Cancelar/encerrar o link de ${row.nome_cliente}? O convite é desabilitado na Nuvidio.`)) return
    const res = await cancelarNuvidioConvite(row.id)
    if (!res.success) setErro(res.error)
    await carregar()
  }

  const dataFmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Video size={22} /> {titulo}
        </h1>
        <input className="form-control" style={{ width: 260 }} value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && carregar()} placeholder="Buscar cliente, CPF, proposta, parceiro…" />
        <select className="form-control" style={{ width: 'auto' }} value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-icon" title="Atualizar" onClick={carregar}><RefreshCw size={16} /></button>
        {!origem && (
          <a className="btn btn-primary" style={{ marginLeft: 'auto' }} href="/nuvidio/criar"><Link2 size={15} /> Criar Link</a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
        {[
          ['Aguardando', metricas.aguardando, '#0284c7'],
          ['Realizadas hoje', metricas.realizadasHoje, '#7c3aed'],
          ['Aprovados', metricas.aprovados, '#16a34a'],
          ['Reprovados', metricas.reprovados, '#dc2626'],
        ].map(([label, valor, cor]) => (
          <div key={String(label)} className="card" style={{ padding: '0.7rem 0.9rem' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--brs-gray-400)' }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: String(cor) }}>{valor}</div>
          </div>
        ))}
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }} onClick={() => setOkMsg('')}>{okMsg}</div>}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table" style={{ fontSize: '0.8rem', minWidth: 1100 }}>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>CPF</th>
              <th>Proposta</th>
              <th>Valor</th>
              <th>IF / Forma / Convênio</th>
              <th>Parceiro</th>
              <th>Status</th>
              <th>Criado</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem' }}><Loader2 size={18} className="animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--brs-gray-400)' }}>Nenhum link por aqui.</td></tr>
            ) : (
              rows.map((r) => {
                const st = STATUS_LABEL[r.status] || { label: r.status, cor: '#6b7280' }
                const encerrado = ['cancelado', 'expirado', 'aprovado', 'reprovado'].includes(r.status)
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.nome_cliente}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.cpf || '—'}</td>
                    <td>{r.proposta_numero || '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.proposta_valor != null ? Number(r.proposta_valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--brs-gray-600)' }}>
                      {[r.instituicao_nome, r.forma_contrato_nome, r.convenio_nome].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td>{r.parceiro_nome || '—'}</td>
                    <td>
                      <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#fff', background: st.cor, borderRadius: 99, padding: '0.18rem 0.55rem', whiteSpace: 'nowrap' }}>
                        {st.label}
                      </span>
                      {r.resultado_obs && <div style={{ fontSize: '0.66rem', color: 'var(--brs-gray-400)', marginTop: 2 }}>{r.resultado_obs}</div>}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', whiteSpace: 'nowrap' }}>{dataFmt(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-icon" title="Copiar link" onClick={() => { navigator.clipboard.writeText(r.link); setOkMsg('Link copiado!') }}><Copy size={14} /></button>
                        {!encerrado && (
                          <button className="btn btn-ghost btn-icon" title="Enviar (WhatsApp/e-mail)" onClick={() => setEnviarDe(r)}><MessageSquare size={14} /></button>
                        )}
                        {r.gravacao_url && (
                          <a className="btn btn-ghost btn-icon" title="Ver gravação" href={r.gravacao_url} target="_blank" rel="noreferrer"><Video size={14} style={{ color: '#7c3aed' }} /></a>
                        )}
                        {(r.status === 'chamada_realizada' || r.status === 'chamada_em_curso') && (
                          <button className="btn btn-ghost btn-icon" title="Tabular resultado" onClick={() => setTabularDe(r)}><Check size={14} style={{ color: 'var(--brs-success)' }} /></button>
                        )}
                        {!encerrado && (
                          <button className="btn btn-ghost btn-icon" title="Cancelar/encerrar" onClick={() => cancelar(r)}><Ban size={14} style={{ color: 'var(--brs-danger)' }} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* modal envio */}
      {enviarDe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(480px, 100%)', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.8rem' }}>
              <strong>Enviar link — {enviarDe.nome_cliente}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEnviarDe(null)}><X size={16} /></button>
            </div>
            {templates.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--brs-gray-400)' }}>
                Nenhum template ativo. Crie em <a href="/nuvidio/templates" style={{ color: 'var(--brs-navy-light)' }}>Nuvidio › Templates</a>.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {templates.map((t) => (
                  <button key={t.id} className="btn btn-outline" disabled={busy} onClick={() => enviar(t.id)} style={{ justifyContent: 'flex-start', display: 'flex', gap: 8 }}>
                    {t.canal === 'whatsapp' ? <MessageSquare size={15} /> : <Mail size={15} />}
                    {t.nome} <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--brs-gray-400)' }}>{t.canal} → {t.destino}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* modal tabulação */}
      {tabularDe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(480px, 100%)', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.8rem' }}>
              <strong>Resultado — {tabularDe.nome_cliente}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setTabularDe(null)}><X size={16} /></button>
            </div>
            <textarea className="form-control" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" style={{ marginBottom: '0.8rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => tabular('aprovado')}><Check size={15} /> Aprovado</button>
              <button className="btn btn-outline" disabled={busy} onClick={() => tabular('reprovado')} style={{ color: 'var(--brs-danger)' }}><X size={15} /> Reprovado</button>
              <button className="btn btn-outline" disabled={busy} onClick={() => tabular('aguardando_refazer')}>↻ Aguardando refazer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
