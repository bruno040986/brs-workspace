'use client'

import { useEffect, useState } from 'react'
import { getAgendaReport, type AgendaReportRow } from '../actions'

type Totals = Omit<AgendaReportRow, 'user_id' | 'name'>

const cellStyle: React.CSSProperties = { padding: '0.55rem 0.7rem', textAlign: 'center', color: 'var(--brs-gray-600)' }

export default function ReportView({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<AgendaReportRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getAgendaReport()
      .then((report) => {
        setRows(report.rows)
        setTotals(report.totals)
      })
      .finally(() => setLoading(false))
  }, [reloadKey])

  if (loading) {
    return <div style={{ color: 'var(--brs-gray-400)', padding: '2rem 0', textAlign: 'center' }}>Carregando relatório…</div>
  }

  return (
    <div style={{ display: 'grid', gap: '0.9rem' }}>
      {totals && (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {[
            { label: 'Tarefas em aberto', value: totals.total_abertas, color: 'var(--brs-info)' },
            { label: 'Atrasadas', value: totals.atrasadas, color: 'var(--brs-danger)' },
            { label: 'Em andamento', value: totals.em_andamento, color: 'var(--brs-warning)' },
            { label: 'Concluídas', value: totals.feito, color: 'var(--brs-success)' },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                background: 'var(--brs-surface)',
                border: '1px solid var(--brs-gray-100)',
                borderRadius: 12,
                padding: '0.7rem 1.1rem',
                minWidth: 130,
              }}
            >
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: card.color }}>{card.value}</div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {card.label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-100)', borderRadius: 12, overflow: 'hidden' }}>
          <thead>
            <tr style={{ color: 'var(--brs-gray-400)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--brs-gray-50)' }}>
              <th style={{ padding: '0.55rem 0.7rem', textAlign: 'left' }}>Pessoa</th>
              <th style={{ ...cellStyle }}>Pendente</th>
              <th style={{ ...cellStyle }}>Em andamento</th>
              <th style={{ ...cellStyle }}>Aguardando</th>
              <th style={{ ...cellStyle }}>Feito</th>
              <th style={{ ...cellStyle, color: 'var(--brs-danger)' }}>Atrasadas</th>
              <th style={{ ...cellStyle }}>Total em aberto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user_id} style={{ borderTop: '1px solid var(--brs-gray-100)' }}>
                <td style={{ padding: '0.55rem 0.7rem', fontWeight: 700, color: 'var(--brs-gray-800)' }}>{row.name}</td>
                <td style={cellStyle}>{row.pendente}</td>
                <td style={cellStyle}>{row.em_andamento}</td>
                <td style={cellStyle}>{row.aguardando}</td>
                <td style={cellStyle}>{row.feito}</td>
                <td style={{ ...cellStyle, color: row.atrasadas ? 'var(--brs-danger)' : 'var(--brs-gray-400)', fontWeight: row.atrasadas ? 800 : 400 }}>
                  {row.atrasadas}
                </td>
                <td style={{ ...cellStyle, fontWeight: 700 }}>{row.total_abertas}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '2rem 0.7rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>
                  Nenhuma tarefa registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
