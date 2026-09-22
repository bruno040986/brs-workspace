'use client'

import { useEffect, useState } from 'react'
import {
  Briefcase,
  Building,
  Building2,
  Handshake,
  Loader2,
  MessageSquare,
  Search,
  User,
  X,
} from 'lucide-react'
import {
  getAgendaWorkspace,
  SUBSISTEMAS_AGENDA,
  type ItemAgendaWorkspace,
  type SubsistemaAgenda,
} from '@/lib/central-conversas/workspace-agenda-actions'

const ICONES_SUBSISTEMA: Record<SubsistemaAgenda, typeof User> = {
  colaborador: User,
  if: Building2,
  corban: Handshake,
  promotora: Building,
  comercial: Briefcase,
}

type Props = {
  onFechar: () => void
  onSelecionarContato: (item: ItemAgendaWorkspace) => void
  onErro: (msg: string) => void
}

export default function AgendaWorkspaceModal({
  onFechar,
  onSelecionarContato,
  onErro,
}: Props) {
  const [subAba, setSubAba] = useState<SubsistemaAgenda | 'todos'>('todos')
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<ItemAgendaWorkspace[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    getAgendaWorkspace({ subsistema: subAba, busca }).then((r) => {
      if (!ativo) return
      if (r.success) setItens(r.itens)
      else onErro(r.error)
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [subAba, busca, onErro])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 400,
      }}
      data-brs-messenger-ignore-close="true"
    >
      <div
        className="brs-messenger"
        style={{
          width: 520,
          maxWidth: '94vw',
          maxHeight: '90vh',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--msn-surface, #ffffff)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
        }}
        data-brs-messenger-ignore-close="true"
      >
        <div
          className="brs-messenger-titlebar"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid var(--msn-soft-border, #e2e8f0)',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          <span>Agenda B2B do Workspace</span>
          <button
            type="button"
            onClick={onFechar}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--msn-muted, #64748b)',
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
          {/* Busca */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--msn-muted, #64748b)' }} />
            <input
              className="brs-messenger-search-input"
              style={{ width: '100%', paddingLeft: 30, fontSize: 12.5 }}
              placeholder="Buscar por nome, cargo, empresa ou WhatsApp..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca('')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: 9,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--msn-muted, #64748b)',
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Abas */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--msn-soft-border, #e2e8f0)', paddingBottom: 8 }}>
            <button
              type="button"
              onClick={() => setSubAba('todos')}
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 99,
                border: 'none',
                cursor: 'pointer',
                background: subAba === 'todos' ? 'var(--msn-accent, #2563eb)' : 'var(--msn-surface-alt, #f1f5f9)',
                color: subAba === 'todos' ? '#ffffff' : 'var(--msn-text, #1e293b)',
              }}
            >
              Todos
            </button>
            {SUBSISTEMAS_AGENDA.map((s) => {
              const Icone = ICONES_SUBSISTEMA[s.id]
              const ativo = subAba === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubAba(s.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 99,
                    border: 'none',
                    cursor: 'pointer',
                    background: ativo ? 'var(--msn-accent, #2563eb)' : 'var(--msn-surface-alt, #f1f5f9)',
                    color: ativo ? '#ffffff' : 'var(--msn-text, #1e293b)',
                  }}
                >
                  <Icone size={12} />
                  {s.rotulo}
                </button>
              )
            })}
          </div>

          {/* Lista */}
          <div style={{ flex: 1, minHeight: 240, maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {carregando ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <Loader2 size={20} className="spinner" style={{ margin: '0 auto', color: 'var(--msn-muted, #64748b)' }} />
              </div>
            ) : itens.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', fontSize: 13, color: 'var(--msn-muted, #64748b)' }}>
                Nenhum contato encontrado na Agenda B2B.
              </div>
            ) : (
              itens.map((item) => {
                const IconeSub = ICONES_SUBSISTEMA[item.subsistema]
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onFechar()
                      onSelecionarContato(item)
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'var(--msn-surface-alt, #f8fafc)',
                      border: '1px solid var(--msn-soft-border, #e2e8f0)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: 'rgba(37,99,235,0.1)',
                          color: 'var(--msn-accent, #2563eb)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <IconeSub size={16} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--msn-text, #1e293b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.nome}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 99,
                              background: 'rgba(37,99,235,0.12)',
                              color: 'var(--msn-accent, #2563eb)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.rotuloSubsistema}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--msn-muted, #64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.cargoOuEmpresa}
                          {item.whatsapp ? ` · WA: ${item.whatsapp}` : ''}
                        </div>
                      </div>
                    </div>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'var(--msn-accent, #2563eb)',
                        color: '#ffffff',
                        flexShrink: 0,
                      }}
                    >
                      <MessageSquare size={13} /> Conversar
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
