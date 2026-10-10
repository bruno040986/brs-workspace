'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, Users } from 'lucide-react'
import { listarConveniosAtivos, listarInscritos, reenviarWesales, vincularConvenio } from '@/lib/promocoes/actions'
import { formatarReais } from '@/lib/promocoes/mascara'
import { Aviso, Busca, Selo, Titulo, Vazio, brDataHora, useCarga, useDebounce, type Feedback } from '../../_components/ui'

export default function InscritosPage() {
  const { slug } = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const qd = useDebounce(q)
  const [fb, setFb] = useState<Feedback>(null)
  const loader = useCallback(() => listarInscritos(slug, qd), [slug, qd])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  const [convenios, setConvenios] = useState<Array<{ id: string; nome: string }> | null>(null)
  const [vinculando, setVinculando] = useState<string | null>(null)

  async function abrirVinculo(id: string) {
    setVinculando(id)
    if (convenios) return
    const r = await listarConveniosAtivos(slug)
    if (r.ok) setConvenios(r.items)
    else setFb({ type: 'error', text: r.error })
  }

  async function vincular(inscricaoId: string, convenioId: string) {
    if (!convenioId) return
    const r = await vincularConvenio(slug, inscricaoId, convenioId)
    setFb(r.ok ? { type: 'success', text: 'Convênio vinculado; WeSales será atualizado.' } : { type: 'error', text: r.error })
    if (r.ok) {
      setVinculando(null)
      recarregar()
    }
  }

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
                <th>Convênio</th>
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
                <Vazio colSpan={13} carregando={carregando} texto="Nenhum inscrito." />
              ) : (
                data.items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.codigo}</td>
                    <td>
                      {i.nome} {i.status === 'cancelada' && <Selo valor="cancelada" />}
                    </td>
                    <td>
                      {i.convenio ||
                        (i.convenioTexto ? (
                          <span className="badge badge-warning" title="Informado como texto livre no cadastro">(texto livre) {i.convenioTexto}</span>
                        ) : (
                          '—'
                        ))}
                      {!i.convenio && i.convenioTexto && (
                        <div style={{ marginTop: 4 }}>
                          {vinculando === i.id ? (
                            <select className="form-control" defaultValue="" disabled={!convenios} onChange={(e) => vincular(i.id, e.target.value)} aria-label="Vincular convênio">
                              <option value="">{convenios ? 'Selecione o convênio…' : 'Carregando…'}</option>
                              {convenios?.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => abrirVinculo(i.id)}>
                              Vincular convênio
                            </button>
                          )}
                        </div>
                      )}
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
