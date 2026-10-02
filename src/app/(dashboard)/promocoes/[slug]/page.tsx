'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Gift } from 'lucide-react'
import { getPainel } from '@/lib/promocoes/actions'
import { formatarReais } from '@/lib/promocoes/mascara'
import { Aviso, Selo, Titulo, Vazio, brData, brDataHora, useCarga } from '../_components/ui'

export default function PainelPromocaoPage() {
  const { slug } = useParams<{ slug: string }>()
  const loader = useCallback(() => getPainel(slug), [slug])
  const { data, erro, carregando } = useCarga(loader)
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const k = data?.kpis

  return (
    <div className="page-content">
      <Titulo icon={<Gift size={18} />} titulo={data?.campanha?.nome || 'Promoção'} sub={data ? `Status: ${data.campanha.status} · ${brData(data.campanha.inicio_em)} a ${brData(data.campanha.fim_em)} · sorteio ${brData(data.campanha.data_sorteio)}` : undefined} />
      {erro && <Aviso f={{ type: 'error', text: erro }} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          ['Inscritos ativos', k?.inscritos],
          ['Indicações válidas', k?.indicacoes],
          ['Operações a confirmar', k?.opsInformadas],
          ['Operações confirmadas', k?.opsConfirmadas],
          ['Números emitidos', k?.numeros],
          ['Pix de R$ 50 devidos', k?.pixDevidos],
        ].map(([t, v]) => (
          <div key={String(t)} className="card" style={{ padding: '1rem' }}>
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>{t}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{v ?? '—'}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ padding: '1rem 1rem 0', fontWeight: 700 }}>Links de números a enviar / aguardando uso</div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Titular</th>
                <th>CPF</th>
                <th>Tipo</th>
                <th>Números</th>
                <th>Gerado em</th>
                <th>Prazo (3 dias úteis)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!data?.links?.length ? (
                <Vazio colSpan={7} carregando={carregando} texto="Nenhum link pendente." />
              ) : (
                data.links.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.nome}</td>
                    <td>{l.cpf}</td>
                    <td>{l.titular_tipo === 'inscricao' ? 'Servidor' : 'Indicador'}</td>
                    <td>{l.qtd}</td>
                    <td>{brDataHora(l.created_at)}</td>
                    <td style={{ color: l.status === 'pendente' && l.prazo < hoje ? '#B91C1C' : undefined, fontWeight: l.prazo < hoje ? 700 : 400 }}>{brData(l.prazo)}</td>
                    <td>
                      <Selo valor={l.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {data && <div style={{ marginTop: '0.75rem', color: 'var(--brs-gray-500)', fontSize: '0.8rem' }}>Mínimo por CPF: {formatarReais(Number(data.campanha.minimo_centavos))} · Pix ao indicador: {formatarReais(Number(data.campanha.pix_indicador_centavos))}</div>}
    </div>
  )
}
