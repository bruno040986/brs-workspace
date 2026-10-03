'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, Users } from 'lucide-react'
import { listarInscritos, reenviarWesales } from '@/lib/promocoes/actions'
import { formatarReais } from '@/lib/promocoes/mascara'
import { Aviso, Busca, Selo, Titulo, Vazio, brDataHora, useCarga, useDebounce, type Feedback } from '../../_components/ui'

export default function InscritosPage() {
  const { slug } = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const qd = useDebounce(q)
  const [fb, setFb] = useState<Feedback>(null)
  const loader = useCallback(() => listarInscritos(slug, qd), [slug, qd])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  async function resync(id: string) {
    const r = await reenviarWesales(slug, id)
    setFb(r.ok ? { type: 'success', text: 'Sincronização com o WeSales enfileirada.' } : { type: 'error', text: r.error })
    if (r.ok) setTimeout(recarregar, 1500)
  }

  return (
    <div className="page-content">
      <Titulo icon={<Users size={18} />} titulo="Inscritos" sub="Servidores inscritos (cadastro direto ou por indicação). CPF e telefone mascarados." />
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      <Busca valor={q} onChange={setQ} placeholder="Buscar por nome, código, CPF ou telefone..." />
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>CPF</th>
                <th>Telefone</th>
                <th>Origem</th>
                <th>Indicador</th>
                <th>WhatsApp</th>
                <th>WeSales</th>
                <th>Total elegível</th>
                <th>Números</th>
                <th>Saldo</th>
                <th>Inscrição</th>
              </tr>
            </thead>
            <tbody>
              {!data?.items?.length ? (
                <Vazio colSpan={12} carregando={carregando} texto="Nenhum inscrito." />
              ) : (
                data.items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.codigo}</td>
                    <td>
                      {i.nome} {i.status === 'cancelada' && <Selo valor="cancelada" />}
                    </td>
                    <td>{i.cpf}</td>
                    <td>{i.telefone}</td>
                    <td>{i.origem === 'indicacao' ? 'Indicação' : 'Direta'}</td>
                    <td>{i.indicador ? `${i.indicador} (${i.numeroIndicacao})` : '—'}</td>
                    <td>{i.verificado ? 'Verificado' : 'Não verificado'}</td>
                    <td title={i.wesalesErro || ''}>
                      <Selo valor={i.wesales === 'pendente' ? 'pendente' : i.wesales} />{' '}
                      {i.wesales !== 'ok' && (
                        <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Resync WeSales" aria-label="Resync WeSales" onClick={() => resync(i.id)}>
                          <RefreshCw size={14} />
                        </button>
                      )}
                    </td>
                    <td>{formatarReais(i.totalCentavos)}</td>
                    <td>{i.numeros}</td>
                    <td>{formatarReais(i.saldoCentavos)}</td>
                    <td>{brDataHora(i.criadoEm)}</td>
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
