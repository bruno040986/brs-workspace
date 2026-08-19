'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, CheckSquare, Square, Users } from 'lucide-react'
import { listAgentsForCampaign, type AgentForCampaign } from '../../actions'
import { AGENT_PHONE_FIELDS, AGENT_FIXED_VARIABLES, type RecipientDraft } from '@/lib/disparo-whatsapp'

const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', aguarda_assinatura: 'Aguarda assinatura', assinatura_realizada: 'Assinatura realizada', validacao_final: 'Validação final', ativo: 'Ativo', finalizado: 'Ativo', inativo: 'Inativo',
}

export default function SourceAgents({ onRecipients }: { onRecipients: (r: RecipientDraft[], variables: string[]) => void }) {
  const [agents, setAgents] = useState<AgentForCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('ativos')
  const [tipoFilter, setTipoFilter] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [phoneFields, setPhoneFields] = useState<Set<string>>(new Set(['phone_whatsapp']))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const res = await listAgentsForCampaign()
      if (res.success) setAgents(res.items)
      else setError(res.error || 'Erro ao carregar agentes.')
      setLoading(false)
    })()
  }, [])

  const tipos = useMemo(() => Array.from(new Set(agents.map((a) => a.tipo_agente).filter(Boolean))).sort(), [agents])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return agents.filter((a) => {
      if (statusFilter === 'ativos' && a.status === 'inativo') return false
      if (statusFilter !== 'ativos' && statusFilter !== 'todos' && a.status !== statusFilter) return false
      if (tipoFilter && a.tipo_agente !== tipoFilter) return false
      if (personFilter && a.person_type !== personFilter) return false
      if (term) {
        const hay = `${a.name} ${a.fantasy_name} ${a.cpf_cnpj} ${a.arw_code} ${a.email}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [agents, q, statusFilter, tipoFilter, personFilter])

  // Recalcula destinatários sempre que seleção/campos mudam
  useEffect(() => {
    const seen = new Set<string>()
    const list: RecipientDraft[] = []
    for (const a of agents) {
      if (!selected.has(a.id)) continue
      for (const f of AGENT_PHONE_FIELDS) {
        if (!phoneFields.has(f.key)) continue
        for (const phone of a.phones[f.key] || []) {
          if (seen.has(phone)) continue
          seen.add(phone)
          list.push({
            phone,
            phone_raw: phone,
            name: a.name,
            variables: {
              nome: a.name,
              fantasia: a.fantasy_name,
              cpf_cnpj: a.cpf_cnpj,
              arw_code: a.arw_code,
              email: a.email,
              filial: a.filial,
              tipo_agente: a.tipo_agente,
              nivel_acesso: a.nivel_acesso,
              telefone_origem: f.label,
            },
            source_ref: { agent_id: a.id, phone_field: f.key },
          })
        }
      }
    }
    onRecipients(list, [...AGENT_FIXED_VARIABLES])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, phoneFields, agents])

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function selectAllFiltered() {
    setSelected((prev) => { const n = new Set(prev); filtered.forEach((a) => n.add(a.id)); return n })
  }
  function clearAll() { setSelected(new Set()) }
  function togglePhoneField(key: string) {
    setPhoneFields((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const phoneCountFor = (a: AgentForCampaign) => AGENT_PHONE_FIELDS.filter((f) => phoneFields.has(f.key)).reduce((acc, f) => acc + (a.phones[f.key]?.length || 0), 0)

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.85rem 1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Quais telefones usar</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
          {AGENT_PHONE_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={phoneFields.has(f.key)} onChange={() => togglePhoneField(f.key)} /> {f.label}
            </label>
          ))}
        </div>
        <div className="form-hint">Números repetidos entre campos/agentes são enviados uma vez só.</div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 8, top: 10, color: 'var(--brs-gray-400)' }} />
          <input className="form-control" style={{ paddingLeft: 28 }} placeholder="Buscar nome, CNPJ/CPF, ARW, e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="form-control" style={{ width: 170 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ativos">Ativos (não inativos)</option>
          <option value="todos">Todos os status</option>
          {Object.entries(STATUS_LABEL).filter(([k]) => k !== 'finalizado').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-control" style={{ width: 170 }} value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="form-control" style={{ width: 110 }} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
          <option value="">PF e PJ</option>
          <option value="PF">PF</option>
          <option value="PJ">PJ</option>
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={selectAllFiltered}><CheckSquare size={14} /> Selecionar filtrados ({filtered.length})</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}><Square size={14} /> Limpar</button>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Users size={14} /> <strong>{selected.size}</strong> agente(s) selecionado(s)
      </div>

      <div className="table-wrapper" style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
        <table className="data-table">
          <thead>
            <tr><th style={{ width: 36 }}></th><th>Agente</th><th>CPF/CNPJ</th><th>ARW</th><th>Tipo</th><th>Status</th><th>Telefones</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: '1.5rem' }}><Loader2 className="spinner" size={16} /> Carregando agentes…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-500)', padding: '1.5rem' }}>Nenhum agente encontrado.</td></tr>
            ) : filtered.map((a) => {
              const checked = selected.has(a.id)
              const phones = phoneCountFor(a)
              return (
                <tr key={a.id} onClick={() => toggle(a.id)} style={{ cursor: 'pointer', background: checked ? 'rgba(27,58,107,0.05)' : undefined }}>
                  <td><input type="checkbox" checked={checked} onChange={() => toggle(a.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    {a.fantasy_name && <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>{a.fantasy_name}</div>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{a.cpf_cnpj}</td>
                  <td style={{ fontSize: '0.8rem' }}>{a.arw_code || '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>{a.tipo_agente || '—'}</td>
                  <td><span className={`badge ${a.status === 'inativo' ? 'badge-gray' : 'badge-success'}`}>{STATUS_LABEL[a.status] || a.status}</span></td>
                  <td><span className={`badge ${phones ? 'badge-info' : 'badge-danger'}`}>{phones}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
