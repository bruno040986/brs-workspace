'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { SolicitacaoListItem } from './actions'

const STATUS_LABEL: Record<SolicitacaoListItem['status'], string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
}
const STATUS_BADGE: Record<SolicitacaoListItem['status'], string> = {
  pendente: 'badge-warning',
  aprovada: 'badge-success',
  reprovada: 'badge-danger',
}
const TIPO_LABEL: Record<SolicitacaoListItem['tipo'], string> = {
  cadastral: 'Dados Cadastrais',
  bancario: 'Dados Bancários',
  contato: 'Dados de Contato',
}

export function SolicitacoesListClient({ initialItems }: { initialItems: SolicitacaoListItem[] }) {
  const [filtroStatus, setFiltroStatus] = useState<'todos' | SolicitacaoListItem['status']>('pendente')

  const itens = useMemo(
    () => (filtroStatus === 'todos' ? initialItems : initialItems.filter((i) => i.status === filtroStatus)),
    [initialItems, filtroStatus]
  )

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Solicitações de Atualização Cadastral</h1>
        <select className="form-control" style={{ maxWidth: 220 }} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}>
          <option value="pendente">Pendentes</option>
          <option value="aprovada">Aprovadas</option>
          <option value="reprovada">Reprovadas</option>
          <option value="todos">Todas</option>
        </select>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Data</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.id}>
              <td>{item.agenteParceiroNome}</td>
              <td>{TIPO_LABEL[item.tipo]}</td>
              <td>
                <span className={`badge ${STATUS_BADGE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
              </td>
              <td>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</td>
              <td>
                <Link href={`/agente-corban/solicitacoes/${item.id}`} className="btn-acao">
                  Ver
                </Link>
              </td>
            </tr>
          ))}
          {itens.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--brs-gray-400)' }}>
                Nenhuma solicitação neste filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
