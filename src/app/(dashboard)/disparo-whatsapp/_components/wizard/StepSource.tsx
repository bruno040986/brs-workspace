'use client'

import { FileSpreadsheet, Users, Keyboard, MessageSquare, Wifi, WifiOff } from 'lucide-react'
import type { ZapiInstancePublic } from '@/lib/zapi'
import type { CampaignSourceType, RecipientDraft } from '@/lib/disparo-whatsapp'
import type { WizardState } from './wizard-types'
import SourceCsv from './SourceCsv'
import SourceAgents from './SourceAgents'
import SourceManual from './SourceManual'
import { formatBrPhone } from '@/lib/zapi/phone'

const TABS: Array<{ id: CampaignSourceType; label: string; icon: React.ReactNode; hint: string }> = [
  { id: 'csv', label: 'Planilha (CSV/XLSX)', icon: <FileSpreadsheet size={16} />, hint: 'Cada coluna vira uma variável {{coluna}}.' },
  { id: 'agents', label: 'Agentes Corban', icon: <Users size={16} />, hint: 'Selecione parceiros e quais telefones usar.' },
  { id: 'manual', label: 'Inclusão manual', icon: <Keyboard size={16} />, hint: 'Digite ou cole os contatos.' },
]

export default function StepSource({ state, patch, instances }: { state: WizardState; patch: (p: Partial<WizardState>) => void; instances: ZapiInstancePublic[] }) {
  function setRecipients(recipients: RecipientDraft[], variables: string[]) {
    patch({ recipients, variables, recipientsDirty: true })
  }

  const inst = instances.find((i) => i.id === state.instanceId)
  const online = !!(inst?.last_status as any)?.connected && !!(inst?.last_status as any)?.smartphoneConnected

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ padding: '1.25rem' }}>
        <div className="form-grid form-grid-2">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nome da campanha <span className="required">*</span></label>
            <input className="form-control" value={state.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Ex.: Comunicado tabela agosto" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Instância Z-API <span className="required">*</span></label>
            <select className="form-control" value={state.instanceId} onChange={(e) => patch({ instanceId: e.target.value })}>
              <option value="">Selecione…</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name}{(i.last_device as any)?.phone ? ` — ${(i.last_device as any).phone}` : ''}{i.is_default ? ' (padrão)' : ''}</option>
              ))}
            </select>
            {inst && (
              <div className="form-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {inst.last_status ? (online ? <><Wifi size={12} style={{ color: '#16a34a' }} /> Conectada</> : <><WifiOff size={12} style={{ color: '#b91c1c' }} /> Desconectada — reconecte no painel Z-API antes de iniciar</>) : <><MessageSquare size={12} /> Ainda não testada</>}
              </div>
            )}
            {instances.length === 0 && <div className="form-hint" style={{ color: '#b45309' }}>Nenhuma instância ativa. Cadastre em Configurações → API WhatsApp.</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Base de disparo</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {TABS.map((t) => {
            const active = state.sourceType === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (!active) patch({ sourceType: t.id, recipients: [], variables: [], recipientsDirty: true }) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.9rem', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  border: `2px solid ${active ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`, background: active ? 'rgba(27,58,107,0.06)' : 'var(--brs-surface)',
                }}
              >
                <span style={{ color: active ? 'var(--brs-navy)' : 'var(--brs-gray-500)' }}>{t.icon}</span>
                <span>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--brs-gray-800)' }}>{t.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>{t.hint}</div>
                </span>
              </button>
            )
          })}
        </div>

        {state.draftId && !state.recipientsDirty && state.storedRecipientCount > 0 && (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            Este rascunho já tem <strong>{state.storedRecipientCount}</strong> destinatário(s) gravado(s). Se você importar uma nova base abaixo, ela substitui a atual.
          </div>
        )}

        {state.sourceType === 'csv' && <SourceCsv onRecipients={setRecipients} />}
        {state.sourceType === 'agents' && <SourceAgents onRecipients={setRecipients} />}
        {state.sourceType === 'manual' && <SourceManual variables={state.variables} recipients={state.recipients} onRecipients={setRecipients} />}
      </div>

      {state.recipients.length > 0 && (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Prévia dos destinatários ({state.recipients.length})</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>Variáveis: {state.variables.map((v) => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}</div>
          </div>
          <div className="table-wrapper" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>#</th><th>Telefone</th>{state.variables.slice(0, 6).map((v) => <th key={v}>{v}</th>)}</tr></thead>
              <tbody>
                {state.recipients.slice(0, 10).map((r, i) => (
                  <tr key={r.phone}>
                    <td style={{ color: 'var(--brs-gray-400)' }}>{i + 1}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{formatBrPhone(r.phone)}</td>
                    {state.variables.slice(0, 6).map((v) => <td key={v} style={{ fontSize: '0.8rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.variables[v] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.recipients.length > 10 && <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)', marginTop: 4 }}>… e mais {state.recipients.length - 10}.</div>}
        </div>
      )}
    </div>
  )
}
