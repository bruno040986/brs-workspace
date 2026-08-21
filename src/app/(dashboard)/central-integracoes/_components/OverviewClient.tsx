'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, CheckCircle, Droplets, RefreshCw, Workflow, XCircle,
} from 'lucide-react'
import { getCentralOverview, type CentralOverview, type OrchestratorSummary } from '../actions'

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = ok ? '#16a34a' : warn ? '#d97706' : '#dc2626'
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color }} />
}

function OrchestratorCard({ orch }: { orch: OrchestratorSummary }) {
  const counters = orch.health?.counters
  const envs = orch.health?.env ?? {}
  const envLabels: Record<string, string> = {
    wesales: 'WeSales',
    vendeai: 'Vende.AI',
    vendeaiInbox: 'Inbox WABA',
    callface: 'CallFace',
    nvti: 'NVTI (rota interna)',
    cron: 'Cron',
  }

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Workflow size={20} style={{ color: 'var(--brs-navy)' }} />
          <div>
            <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{orch.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>{orch.product}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <StatusDot ok={orch.online} warn={!orch.configured} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: orch.online ? '#16a34a' : '#dc2626' }}>
            {orch.online ? 'Online' : orch.configured ? 'Offline' : 'Não configurado'}
          </span>
        </div>
      </div>

      {orch.error ? (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#991B1B', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <AlertTriangle size={15} /> {orch.error}
        </div>
      ) : null}

      {counters ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginTop: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: counters.failedEvents ? '#dc2626' : 'var(--brs-gray-900)' }}>
              {counters.failedEvents}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>eventos falhos</div>
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{counters.retryingEvents}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>em retry</div>
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{counters.activeJobs}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>jobs ativos</div>
          </div>
        </div>
      ) : null}

      {orch.health ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
          {Object.entries(envLabels).map(([key, label]) => (
            <span key={key} className={`badge ${envs[key] ? 'badge-success' : 'badge-gray'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {envs[key] ? <CheckCircle size={11} /> : <XCircle size={11} />} {label}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
        <Link href={`/central-integracoes/orquestradores/${orch.slug}`} className="btn btn-outline" style={{ fontSize: '0.8rem' }}>
          Eventos e erros
        </Link>
        <Link href="/central-integracoes/acoes" className="btn btn-outline" style={{ fontSize: '0.8rem' }}>
          Ações manuais
        </Link>
      </div>
    </div>
  )
}

export default function OverviewClient({ initial }: { initial: CentralOverview }) {
  const [overview, setOverview] = useState(initial)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setOverview(await getCentralOverview())
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  }, [refresh])

  const nvti = overview.nvti

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn btn-outline" onClick={refresh} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={15} className={refreshing ? 'spinner' : undefined} /> Atualizar
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        {overview.orchestrators.map((orch) => (
          <OrchestratorCard key={orch.slug} orch={orch} />
        ))}

        {nvti ? (
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Droplets size={20} style={{ color: 'var(--brs-navy)' }} />
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>Higienização NVTI</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Roda dentro do Workspace</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <StatusDot ok={nvti.configured && nvti.active} warn={nvti.configured && !nvti.active} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: nvti.configured && nvti.active ? '#16a34a' : '#d97706' }}>
                  {!nvti.configured ? 'Sem credenciais' : nvti.active ? 'Ativa' : 'Inativa'}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{nvti.queries30d.total}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>consultas no mês</div>
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{nvti.queries30d.cached}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>via cache (sem custo)</div>
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{nvti.activeBatches}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>lotes ativos</div>
              </div>
            </div>

            <div style={{ marginTop: '0.9rem', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
              Gasto do mês: <strong>{brl(nvti.monthSpend)}</strong> de {brl(nvti.monthCap)} (teto global)
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <Link href="/higienizacao-nvti" className="btn btn-outline" style={{ fontSize: '0.8rem' }}>
                Abrir Higienização NVTI
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
