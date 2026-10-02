'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { Eye, Link2, UserPlus } from 'lucide-react'
import { listarIndicacoes, revelarPix, vincularManual } from '@/lib/promocoes/actions'
import { formatarReais } from '@/lib/promocoes/mascara'
import { Aviso, Busca, Selo, Titulo, Vazio, brDataHora, useCarga, useDebounce, type Feedback } from '../../_components/ui'

export default function IndicacoesPage() {
  const { slug } = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const qd = useDebounce(q)
  const [fb, setFb] = useState<Feedback>(null)
  const [pixAberto, setPixAberto] = useState<Record<string, string>>({})
  const loader = useCallback(() => listarIndicacoes(slug, qd), [slug, qd])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  async function vincular(inscricaoId: string, indicacaoId: string) {
    const r = await vincularManual(slug, inscricaoId, indicacaoId)
    setFb(r.ok ? { type: 'success', text: 'Indicação vinculada e direitos recalculados.' } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  async function ver(indicadorId: string) {
    const r = await revelarPix(slug, indicadorId)
    if (r.ok) setPixAberto((p) => ({ ...p, [indicadorId]: r.texto }))
    else setFb({ type: 'error', text: r.error })
  }

  return (
    <div className="page-content">
      <Titulo icon={<UserPlus size={18} />} titulo="Indicações" sub="Vale a primeira indicação por CPF. Pix mascarado; o dado completo exige a permissão da remessa e fica auditado." />
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      <Busca valor={q} onChange={setQ} placeholder="Buscar por número, indicador, indicado ou código..." />
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nº indicação</th>
                <th>Indicador</th>
                <th>Pix</th>
                <th>Indicado</th>
                <th>Inscrita em</th>
                <th>Total elegível</th>
                <th>Pix R$ 50</th>
                <th>Número do indicador</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data?.items?.length ? (
                <Vazio colSpan={10} carregando={carregando} texto="Nenhuma indicação." />
              ) : (
                data.items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.numero}</td>
                    <td>
                      {i.indicador}
                      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
                        {i.indicadorCpf} · {i.indicadorTel}
                      </div>
                    </td>
                    <td>
                      {pixAberto[i.indicadorId] || i.pix}{' '}
                      {i.pixAlteradoRecente && <span className="badge badge-warning" title="Pix alterado nos últimos 7 dias">Pix alterado</span>}{' '}
                      {!pixAberto[i.indicadorId] && (
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Ver Pix completo (auditado)" aria-label="Ver Pix completo" onClick={() => ver(i.indicadorId)}>
                          <Eye size={14} />
                        </button>
                      )}
                    </td>
                    <td>
                      {i.indicado}
                      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
                        {i.indicadoCpf} · {i.codigoIndicado}
                      </div>
                    </td>
                    <td>{brDataHora(i.inscritaEm)}</td>
                    <td>{formatarReais(i.totalCentavos)}</td>
                    <td>
                      <Selo valor={i.pixStatus} />
                    </td>
                    <td>
                      <Selo valor={i.numeroStatus} />
                    </td>
                    <td>
                      <Selo valor={i.status} />
                    </td>
                    <td>
                      {!i.vinculada && i.status === 'valida' && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => vincular(i.inscricaoId, i.id)}>
                          <Link2 size={14} /> Vincular
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
