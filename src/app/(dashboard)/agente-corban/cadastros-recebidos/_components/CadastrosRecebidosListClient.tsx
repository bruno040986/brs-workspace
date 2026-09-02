'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ClipboardCheck, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { formatCpfOrCnpjDisplay, normalizeText } from '@/lib/agente-corban'
import {
  CORBAN_ONBOARDING_ETAPA_LABELS,
  CORBAN_ONBOARDING_STATUS_BADGE,
  CORBAN_ONBOARDING_STATUS_LABELS,
  diasEmAberto,
  type CorbanOnboardingEtapa,
  type CorbanOnboardingProcessoStatus,
} from '@/lib/agente-corban-onboarding'
import { criarProcesso, type CadastroRecebidoListItem, type CadastroRecebidoSemProcesso } from '../actions'

type Row =
  | (CadastroRecebidoListItem & { key: string })
  | (CadastroRecebidoSemProcesso & { key: string })

const ETAPA_OPTIONS = [
  { value: 'all', label: 'Todas as etapas' },
  ...(Object.entries(CORBAN_ONBOARDING_ETAPA_LABELS).map(([value, label]) => ({ value, label })) as Array<{
    value: CorbanOnboardingEtapa
    label: string
  }>),
] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'sem_processo', label: 'Sem processo' },
  ...(Object.entries(CORBAN_ONBOARDING_STATUS_LABELS).map(([value, label]) => ({ value, label })) as Array<{
    value: CorbanOnboardingProcessoStatus
    label: string
  }>),
] as const

export default function CadastrosRecebidosListClient({
  initialItems,
  initialSemProcesso,
}: {
  initialItems: CadastroRecebidoListItem[]
  initialSemProcesso: CadastroRecebidoSemProcesso[]
}) {
  const router = useRouter()
  const [items] = useState<CadastroRecebidoListItem[]>(initialItems || [])
  const [semProcesso] = useState<CadastroRecebidoSemProcesso[]>(initialSemProcesso || [])
  const [query, setQuery] = useState('')
  const [etapa, setEtapa] = useState<'all' | CorbanOnboardingEtapa>('all')
  const [status, setStatus] = useState<'all' | 'sem_processo' | CorbanOnboardingProcessoStatus>('all')
  const [criandoId, setCriandoId] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const rows: Row[] = useMemo(
    () => [
      ...items.map((item) => ({ ...item, key: item.processoId })),
      ...semProcesso.map((item) => ({ ...item, key: item.agenteParceiroId })),
    ],
    [items, semProcesso],
  )

  const filteredRows = useMemo(() => {
    const search = normalizeText(query).toLowerCase()
    return rows.filter((row) => {
      const searchText = `${row.nome} ${row.cpfCnpj}`.toLowerCase()
      const queryMatch = !search || searchText.includes(search)
      const etapaMatch = etapa === 'all' || (row.hasProcesso && row.etapaAtual === etapa)
      const statusMatch =
        status === 'all' ||
        (status === 'sem_processo' && !row.hasProcesso) ||
        (row.hasProcesso && row.status === status)
      return queryMatch && etapaMatch && statusMatch
    })
  }, [rows, query, etapa, status])

  function handleCriarProcesso(agenteParceiroId: string) {
    setCriandoId(agenteParceiroId)
    setErro(null)
    startTransition(async () => {
      const result = await criarProcesso(agenteParceiroId)
      setCriandoId(null)
      if (result.success) {
        router.push(`/agente-corban/cadastros-recebidos/${result.processoId}`)
      } else {
        setErro(result.error || 'Erro ao criar processo.')
      }
    })
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
            <ClipboardCheck size={18} />
            Cadastros Recebidos
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Pipeline de aprovação de novos parceiros vindos do Portal Parceiro.
          </div>
        </div>

        <button type="button" className="btn btn-outline" onClick={() => router.refresh()}>
          <RefreshCw size={16} />
          Recarregar
        </button>
      </div>

      {erro && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.875rem 1rem',
            borderRadius: 10,
            border: '1px solid #FECACA',
            background: '#FEF2F2',
            color: '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <AlertCircle size={18} />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{erro}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.75rem' }}>
          <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 6' }}>
            <label className="form-label">Buscar</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
              <input
                className="form-control"
                style={{ paddingLeft: '2.2rem' }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome ou CPF/CNPJ..."
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
            <label className="form-label">Etapa</label>
            <select className="form-control" value={etapa} onChange={(e) => setEtapa(e.target.value as 'all' | CorbanOnboardingEtapa)}>
              {ETAPA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 3' }}>
            <label className="form-label">Status</label>
            <select
              className="form-control"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'all' | 'sem_processo' | CorbanOnboardingProcessoStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parceiro</th>
                <th>CPF/CNPJ</th>
                <th>Etapa atual</th>
                <th>Status</th>
                <th>Dias em aberto</th>
                <th>Responsável</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--brs-gray-500)' }}>
                    Nenhum cadastro encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)' }}>{row.nome}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{formatCpfOrCnpjDisplay(row.cpfCnpj) || '—'}</td>
                    <td>
                      {row.hasProcesso ? (
                        <span className="badge badge-navy">{CORBAN_ONBOARDING_ETAPA_LABELS[row.etapaAtual as CorbanOnboardingEtapa]}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.hasProcesso ? (
                        <span className={`badge ${CORBAN_ONBOARDING_STATUS_BADGE[row.status as CorbanOnboardingProcessoStatus]}`}>
                          {CORBAN_ONBOARDING_STATUS_LABELS[row.status as CorbanOnboardingProcessoStatus]}
                        </span>
                      ) : (
                        <span className="badge badge-gray">Sem processo</span>
                      )}
                    </td>
                    <td>{diasEmAberto(row.createdAt)}</td>
                    <td>{row.hasProcesso ? row.responsavelNome || '—' : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.hasProcesso ? (
                        <Link href={`/agente-corban/cadastros-recebidos/${row.processoId}`} className="btn btn-ghost btn-sm">
                          Abrir
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={isPending && criandoId === row.agenteParceiroId}
                          onClick={() => handleCriarProcesso(row.agenteParceiroId)}
                        >
                          {isPending && criandoId === row.agenteParceiroId ? (
                            <Loader2 size={15} className="spinner" />
                          ) : (
                            <Plus size={15} />
                          )}
                          Criar processo
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
