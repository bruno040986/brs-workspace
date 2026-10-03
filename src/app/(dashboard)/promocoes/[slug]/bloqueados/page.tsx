'use client'

import { useCallback, useState } from 'react'
import { useParams } from 'next/navigation'
import { ShieldBan, Trash2 } from 'lucide-react'
import { adicionarBloqueado, listarBloqueados, removerBloqueado } from '@/lib/promocoes/actions'
import { Aviso, Titulo, Vazio, brDataHora, useCarga, type Feedback } from '../../_components/ui'

export default function BloqueadosPage() {
  const { slug } = useParams<{ slug: string }>()
  const [fb, setFb] = useState<Feedback>(null)
  const [f, setF] = useState({ cpf: '', nome: '', motivo: '', todas: false })
  const loader = useCallback(() => listarBloqueados(slug), [slug])
  const { data, erro, carregando, recarregar } = useCarga(loader)

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    const r = await adicionarBloqueado(slug, f)
    setFb(r.ok ? { type: 'success', text: 'CPF bloqueado.' } : { type: 'error', text: r.error })
    if (r.ok) {
      setF({ cpf: '', nome: '', motivo: '', todas: false })
      recarregar()
    }
  }

  async function remover(id: string) {
    if (!window.confirm('Remover este CPF da lista de impedidos?')) return
    const r = await removerBloqueado(slug, id)
    setFb(r.ok ? { type: 'success', text: 'CPF removido.' } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  return (
    <div className="page-content">
      <Titulo icon={<ShieldBan size={18} />} titulo="CPFs Bloqueados" sub="Impedidos (regulamento §19): sócios e funcionários da Bem Digital e familiares. Valem no cadastro e no sorteio." />
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      <form className="card" onSubmit={adicionar} style={{ padding: '1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group">
          <label className="form-label">CPF *</label>
          <input className="form-control" inputMode="numeric" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} required />
        </div>
        <div className="form-group">
          <label className="form-label">Nome</label>
          <input className="form-control" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 220 }}>
          <label className="form-label">Motivo *</label>
          <input className="form-control" placeholder="Ex.: sócio, funcionário, cônjuge de sócio" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} required />
        </div>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={f.todas} onChange={(e) => setF({ ...f, todas: e.target.checked })} /> Todas as campanhas
        </label>
        <button type="submit" className="btn btn-primary">
          Bloquear
        </button>
      </form>
      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>CPF</th>
                <th>Nome</th>
                <th>Motivo</th>
                <th>Alcance</th>
                <th>Desde</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data?.items?.length ? (
                <Vazio colSpan={6} carregando={carregando} texto="Nenhum CPF bloqueado." />
              ) : (
                data.items.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.cpf}</td>
                    <td>{b.nome || '—'}</td>
                    <td>{b.motivo}</td>
                    <td>{b.todas ? 'Todas as campanhas' : 'Esta campanha'}</td>
                    <td>{brDataHora(b.criadoEm)}</td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm btn-acao" title="Remover" aria-label="Remover" onClick={() => remover(b.id)}>
                        <Trash2 size={15} />
                      </button>
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
