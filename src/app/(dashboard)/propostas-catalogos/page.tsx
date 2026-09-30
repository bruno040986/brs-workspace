'use client'

/**
 * Cadastros › Status e Situações de Proposta — abas Status · Situações ·
 * Configuração (spec esteira §4.2/§6.5). Mesmo padrão de operadoras-telefonia.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Edit2, ListChecks, Loader2, Plus, Power, PowerOff, X } from 'lucide-react'
import { GRUPOS_STATUS, GRUPO_LABEL } from '@/lib/propostas-catalogos'
import {
  getCatalogos, salvarConfigEsteira, salvarSituacao, salvarStatus, setSituacaoAtiva, setStatusAtivo,
  type EsteiraConfig, type PropostaSituacao, type PropostaStatus,
} from './actions'

type Aba = 'status' | 'situacoes' | 'config'
type Feedback = { type: 'success' | 'error'; text: string }
type EdStatus = Omit<PropostaStatus, 'id' | 'ordem' | 'is_active' | 'cor' | 'acao_na_alteracao'> & { id?: string; cor: string; acao_na_alteracao: string }
type EdSit = { id?: string; codigo_arw: string; nome: string; descricao: string; status_sugerido_id: string }

const STATUS_VAZIO: EdStatus = {
  nome: '', grupo: 'em_andamento', cor: '', atualiza_data_atualizacao: true, libera_contratos: false, acao_na_alteracao: '',
  alerta_observacao: false, pendente: false, padrao_cadastro: false, descricao: '',
}
const SIT_VAZIA: EdSit = { codigo_arw: '', nome: '', descricao: '', status_sugerido_id: '' }

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem', marginBottom: '0.4rem' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Modal({ title, onClose, onSubmit, saving, children }: { title: string; onClose: () => void; onSubmit: (e: React.FormEvent) => void; saving: boolean; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={onSubmit}>
          <div className="modal-header">
            <h3 className="modal-title">{title}</h3>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}><X size={20} /></button>
          </div>
          <div className="modal-body">{children}</div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spinner" /> : null}Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Acoes({ ativo, busy, onEdit, onToggle }: { ativo: boolean; busy: boolean; onEdit: () => void; onToggle: () => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
      <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={onEdit} title="Editar" aria-label="Editar"><Edit2 size={15} /></button>
      <button type="button" className="btn btn-ghost btn-sm btn-acao" onClick={onToggle} disabled={busy} title={ativo ? 'Inativar' : 'Reativar'} aria-label={ativo ? 'Inativar' : 'Reativar'}>
        {busy ? <Loader2 size={15} className="spinner" /> : ativo ? <PowerOff size={15} /> : <Power size={15} />}
      </button>
    </div>
  )
}

export default function PropostasCatalogosPage() {
  const [aba, setAba] = useState<Aba>('status')
  const [status, setStatus] = useState<PropostaStatus[]>([])
  const [situacoes, setSituacoes] = useState<PropostaSituacao[]>([])
  const [config, setConfig] = useState<EsteiraConfig>({ cancelamento_automatico_dias: 90, exigir_contato_ao_pendenciar: false })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Feedback | null>(null)
  const [edStatus, setEdStatus] = useState<EdStatus | null>(null)
  const [edSit, setEdSit] = useState<EdSit | null>(null)

  async function load() {
    try {
      const res = await getCatalogos()
      if (!res.success) throw new Error(res.error)
      setStatus(res.status || [])
      setSituacoes(res.situacoes || [])
      if (res.config) setConfig(res.config)
    } catch (e) {
      setMessage({ type: 'error', text: (e instanceof Error && e.message) || 'Erro ao carregar os catálogos.' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void Promise.resolve().then(load)
  }, [])

  // Executa uma action, mostra o retorno e recarrega.
  async function run(fn: () => Promise<{ success: boolean; error?: string }>, ok: string, done?: () => void) {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fn()
      if (!res.success) throw new Error(res.error)
      done?.()
      setMessage({ type: 'success', text: ok })
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: (e instanceof Error && e.message) || 'Erro ao salvar.' })
    } finally {
      setSaving(false)
      setBusyId(null)
    }
  }
  const toggle = (id: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => { setBusyId(id); void run(fn, ok) }

  const nomeStatus = (id: string | null) => status.find((s) => s.id === id)?.nome
  const setS = (p: Partial<EdStatus>) => setEdStatus((prev) => (prev ? { ...prev, ...p } : prev))
  const setSi = (p: Partial<EdSit>) => setEdSit((prev) => (prev ? { ...prev, ...p } : prev))

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ListChecks size={18} /> Status e Situações de Proposta
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Catálogos da esteira de propostas (espelho do ARW). Inativar tira da escolha e mantém as propostas antigas legíveis.
        </div>
      </div>

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: message.type === 'success' ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <div className="tabs-list" style={{ marginBottom: '1rem' }}>
        {([['status', 'Status'], ['situacoes', 'Situações'], ['config', 'Configuração']] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab-btn${aba === k ? ' active' : ''}`} onClick={() => setAba(k)}>{l}</button>
        ))}
      </div>

      {aba === 'status' && (
        <>
          <div style={{ textAlign: 'right', marginBottom: '0.75rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => setEdStatus({ ...STATUS_VAZIO })}><Plus size={16} /> Novo Status</button>
          </div>
          <div className="card"><div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Nome</th><th>Grupo</th><th>Cor</th><th>Flags</th><th>Situação</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
                  : status.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum status cadastrado.</td></tr>
                  : status.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.nome}</td>
                      <td>{GRUPO_LABEL[s.grupo]}</td>
                      <td>{s.cor ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 16, height: 16, borderRadius: 4, background: s.cor, border: '1px solid var(--brs-gray-200)' }} />{s.cor}</span> : <span style={{ color: 'var(--brs-gray-400)' }}>padrão do grupo</span>}</td>
                      <td style={{ fontSize: '0.8rem' }}>{[s.padrao_cadastro && 'Cadastro', s.libera_contratos && 'Libera contratos', s.pendente && 'Pendente', s.alerta_observacao && 'Alerta obs.'].filter(Boolean).join(' · ') || '—'}</td>
                      <td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-gray'}`}>{s.is_active ? 'Ativo' : 'Inativo'}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <Acoes ativo={s.is_active} busy={busyId === s.id}
                          onEdit={() => setEdStatus({ ...s, cor: s.cor || '', acao_na_alteracao: s.acao_na_alteracao || '' })}
                          onToggle={() => toggle(s.id, () => setStatusAtivo(s.id, !s.is_active), s.is_active ? 'Status inativado.' : 'Status reativado.')} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div></div>
        </>
      )}

      {aba === 'situacoes' && (
        <>
          <div style={{ textAlign: 'right', marginBottom: '0.75rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => setEdSit({ ...SIT_VAZIA })}><Plus size={16} /> Nova Situação</button>
          </div>
          <div className="card"><div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Código ARW</th><th>Nome</th><th>Status sugerido</th><th>Situação</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
                  : situacoes.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma situação cadastrada.</td></tr>
                  : situacoes.map((s) => (
                    <tr key={s.id}>
                      <td>{s.codigo_arw}</td>
                      <td style={{ fontWeight: 600 }} title={s.descricao || undefined}>{s.nome}</td>
                      <td>{nomeStatus(s.status_sugerido_id) || <span style={{ color: 'var(--brs-gray-400)' }}>—</span>}</td>
                      <td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-gray'}`}>{s.is_active ? 'Ativo' : 'Inativo'}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <Acoes ativo={s.is_active} busy={busyId === s.id}
                          onEdit={() => setEdSit({ id: s.id, codigo_arw: s.codigo_arw, nome: s.nome, descricao: s.descricao || '', status_sugerido_id: s.status_sugerido_id || '' })}
                          onToggle={() => toggle(s.id, () => setSituacaoAtiva(s.id, !s.is_active), s.is_active ? 'Situação inativada.' : 'Situação reativada.')} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div></div>
        </>
      )}

      {aba === 'config' && (
        <form className="card" style={{ padding: '1.25rem', maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); void run(() => salvarConfigEsteira(config), 'Configuração salva.') }}>
          <div className="form-group">
            <label className="form-label">Cancelamento automático após (dias)</label>
            <input type="number" min={1} step={1} className="form-control" value={config.cancelamento_automatico_dias} onChange={(e) => setConfig((c) => ({ ...c, cancelamento_automatico_dias: Number(e.target.value) }))} />
          </div>
          <Check label="Exigir contato ao pendenciar" checked={config.exigir_contato_ao_pendenciar} onChange={(v) => setConfig((c) => ({ ...c, exigir_contato_ao_pendenciar: v }))} />
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', margin: '0.5rem 0 1rem' }}>Guardado para a migração do ARW; ainda sem efeito na esteira.</div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <Loader2 size={16} className="spinner" /> : null}Salvar</button>
        </form>
      )}

      {edStatus && (
        <Modal title={edStatus.id ? 'Editar Status' : 'Novo Status'} saving={saving} onClose={() => setEdStatus(null)}
          onSubmit={(e) => { e.preventDefault(); void run(() => salvarStatus(edStatus), edStatus.id ? 'Status atualizado.' : 'Status criado.', () => setEdStatus(null)) }}>
          <div className="form-group"><label className="form-label">Nome *</label>
            <input className="form-control" value={edStatus.nome} onChange={(e) => setS({ nome: e.target.value })} autoFocus /></div>
          <div className="form-group"><label className="form-label">Grupo *</label>
            <select className="form-control" value={edStatus.grupo} onChange={(e) => setS({ grupo: e.target.value as EdStatus['grupo'] })}>
              {GRUPOS_STATUS.map((g) => <option key={g} value={g}>{GRUPO_LABEL[g]}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Cor</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="color" value={edStatus.cor || '#888888'} onChange={(e) => setS({ cor: e.target.value })} aria-label="Seletor de cor" />
              <input className="form-control" placeholder="#RRGGBB (vazio = cor do grupo)" value={edStatus.cor} onChange={(e) => setS({ cor: e.target.value })} />
            </div></div>
          <Check label="Atualizar data de última atualização" checked={edStatus.atualiza_data_atualizacao} onChange={(v) => setS({ atualiza_data_atualizacao: v })} />
          <Check label="Status de cadastro (padrão de novas propostas) — só um" checked={edStatus.padrao_cadastro} onChange={(v) => setS({ padrao_cadastro: v })} />
          <div style={{ fontWeight: 700, fontSize: '0.8rem', margin: '0.75rem 0 0.4rem' }}>INTERNO</div>
          <Check label="Liberar contratos" checked={edStatus.libera_contratos} onChange={(v) => setS({ libera_contratos: v })} />
          <div className="form-group"><label className="form-label">Ação na alteração do status</label>
            <input className="form-control" value={edStatus.acao_na_alteracao} onChange={(e) => setS({ acao_na_alteracao: e.target.value })} />
            <small style={{ color: 'var(--brs-gray-500)' }}>Guardado; sem efeito na v1.</small></div>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', margin: '0.75rem 0 0.4rem' }}>PARCEIRO / VENDEDOR</div>
          <Check label="Visualizar alerta de observação" checked={edStatus.alerta_observacao} onChange={(v) => setS({ alerta_observacao: v })} />
          <Check label="Pendente" checked={edStatus.pendente} onChange={(v) => setS({ pendente: v })} />
          <div className="form-group"><label className="form-label">Descrição</label>
            <textarea className="form-control" rows={2} value={edStatus.descricao} onChange={(e) => setS({ descricao: e.target.value })} /></div>
        </Modal>
      )}

      {edSit && (
        <Modal title={edSit.id ? 'Editar Situação' : 'Nova Situação'} saving={saving} onClose={() => setEdSit(null)}
          onSubmit={(e) => { e.preventDefault(); void run(() => salvarSituacao(edSit), edSit.id ? 'Situação atualizada.' : 'Situação criada.', () => setEdSit(null)) }}>
          <div className="form-group"><label className="form-label">Código ARW *</label>
            <input className="form-control" value={edSit.codigo_arw} onChange={(e) => setSi({ codigo_arw: e.target.value })} autoFocus /></div>
          <div className="form-group"><label className="form-label">Nome *</label>
            <input className="form-control" value={edSit.nome} onChange={(e) => setSi({ nome: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Status sugerido</label>
            <select className="form-control" value={edSit.status_sugerido_id} onChange={(e) => setSi({ status_sugerido_id: e.target.value })}>
              <option value="">— nenhum —</option>
              {status.filter((s) => s.is_active || s.id === edSit.status_sugerido_id).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Descrição / explicação</label>
            <textarea className="form-control" rows={3} value={edSit.descricao} onChange={(e) => setSi({ descricao: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  )
}
