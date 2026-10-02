'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { Ban, Download, Ticket } from 'lucide-react'
import { desconsiderarNumero, listarNumeros } from '@/lib/promocoes/actions'
import { Aviso, Busca, Selo, Titulo, Vazio, brDataHora, useCarga, useDebounce, type Feedback } from '../../_components/ui'

export default function NumerosPage() {
  const { slug } = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const qd = useDebounce(q)
  const [fb, setFb] = useState<Feedback>(null)
  const loader = useCallback(() => listarNumeros(slug, qd), [slug, qd])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  async function desconsiderar(id: string, numero: string) {
    const motivo = window.prompt(`Desconsiderar o número ${numero}? Informe o motivo (ex.: operação invalidada):`)
    if (!motivo?.trim()) return
    const r = await desconsiderarNumero(slug, id, motivo)
    setFb(r.ok ? { type: 'success', text: `Número ${numero} desconsiderado.` } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  return (
    <div className="page-content">
      <Titulo icon={<Ticket size={18} />} titulo="Números da Sorte" sub="Atribuídos aleatoriamente pelo sistema; ninguém escolhe número. Só números válidos entram no sorteio.">
        <a className="btn btn-outline" href={`/api/promocoes/interno/${slug}/numeros.csv`}>
          <Download size={16} /> Exportar CSV
        </a>
      </Titulo>
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      <Busca valor={q} onChange={setQ} placeholder="Buscar por número, titular ou código..." />
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Titular</th>
                <th>Origem</th>
                <th>Indicador</th>
                <th>Gerado em</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data?.items?.length ? (
                <Vazio colSpan={7} carregando={carregando} texto="Nenhum número gerado." />
              ) : (
                data.items.map((n) => (
                  <tr key={n.id}>
                    <td style={{ fontWeight: 800, letterSpacing: 1 }}>{n.numero}</td>
                    <td>
                      {n.titular}
                      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
                        {n.cpf} {n.codigo ? `· ${n.codigo}` : ''}
                      </div>
                    </td>
                    <td>{n.origem}</td>
                    <td>{n.indicador || '—'}</td>
                    <td>{brDataHora(n.geradoEm)}</td>
                    <td>
                      <Selo valor={n.status} />
                      {n.motivo && <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-500)' }}>{n.motivo}</div>}
                    </td>
                    <td>
                      {n.status === 'valido' && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => desconsiderar(n.id, n.numero)}>
                          <Ban size={14} /> Desconsiderar
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
