'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, ListChecks, Send, Target, Upload, Users } from 'lucide-react'
import { getAlvoconsigResumo } from './actions'

type Resumo = {
  campanhasAtivas: number
  contatosEmAtendimento: number
  parceirosHabilitados: number
  filaPendente: number
  filaErro: number
  importsRecentes: Array<{
    id: string
    tipo: string
    arquivo_nome: string
    total_linhas: number
    importadas: number
    descartadas: number
    status: string
    created_at: string
  }>
}

export default function AlvoconsigHomePage() {
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    getAlvoconsigResumo().then((res) => {
      if (res.success) setResumo(res.resumo as Resumo)
      else setErro(res.error || 'Erro ao carregar o resumo.')
    })
  }, [])

  const cards = [
    { label: 'Campanhas ativas', valor: resumo?.campanhasAtivas, icon: Send },
    { label: 'Contatos em atendimento', valor: resumo?.contatosEmAtendimento, icon: ListChecks },
    { label: 'Parceiros habilitados', valor: resumo?.parceirosHabilitados, icon: Users },
    { label: 'Fila WeSales — pendente', valor: resumo?.filaPendente, icon: Target },
    { label: 'Fila WeSales — com erro', valor: resumo?.filaErro, icon: AlertTriangle },
  ]

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Target size={18} />
          AlvoConsig — Gestão de Leads
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Os leads moram no WeSales — aqui: importação de mailing, campanhas por parceiro e saúde da sincronização.
        </div>
      </div>

      {erro && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: '1px solid #FECACA', background: '#FEF2F2', color: '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AlertCircle size={18} />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{erro}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {cards.map((card) => (
          <div key={card.label} className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--brs-gray-500)', fontSize: '0.82rem', fontWeight: 600 }}>
              <card.icon size={15} />
              {card.label}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: '0.35rem' }}>
              {card.valor === undefined ? '—' : card.valor.toLocaleString('pt-BR')}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Upload size={16} />
            Importações recentes
          </div>
          <Link href="/alvoconsig/importacoes" className="btn btn-outline btn-sm">Ver todas</Link>
        </div>
        {!resumo?.importsRecentes?.length ? (
          <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem' }}>Nenhuma importação ainda. Comece importando um mailing.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Tipo</th>
                <th>Importadas / Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {resumo.importsRecentes.map((imp) => (
                <tr key={imp.id}>
                  <td>{imp.arquivo_nome}</td>
                  <td>{imp.tipo === 'refin' ? 'REFIN' : 'Margem'}</td>
                  <td>{imp.importadas.toLocaleString('pt-BR')} / {imp.total_linhas.toLocaleString('pt-BR')}</td>
                  <td>
                    <span className={`badge ${imp.status === 'concluido' ? 'badge-success' : imp.status === 'erro' ? 'badge-danger' : 'badge-gray'}`}>
                      {imp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
