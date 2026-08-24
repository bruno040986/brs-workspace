'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Contact, Search } from 'lucide-react'
import { getCampanhas, getContatosGlobal, getConveniosAtivos } from '../actions'

type ContatoItem = {
  id: string
  cpf: string | null
  nome: string
  telefone: string | null
  margem_novo: number | null
  margem_cartao_rmc: number | null
  margem_cartao_rcc: number | null
  refin_troco: number | null
  funil_estagio: string | null
  agente_parceiro_id: string | null
  convenios?: { id: string; nome: string } | null
  agentes_parceiros?: { id: string; name: string; fantasy_name: string | null } | null
}

type Convenio = { id: string; nome: string; codigo: string | null }
type Campanha = { id: string; descricao: string; base_tag: string }

function formatMoney(value: number | null) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function maskCpf(value: string | null) {
  if (!value) return '-'
  return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

export default function ContatosPage() {
  const [items, setItems] = useState<ContatoItem[]>([])
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [porPagina] = useState(50)
  const [loading, setLoading] = useState(true)

  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [convenioId, setConvenioId] = useState('')
  const [campanhaId, setCampanhaId] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getContatosGlobal({
        busca: buscaAplicada,
        convenioId: convenioId || undefined,
        campanhaId: campanhaId || undefined,
        pagina,
      })
      if (res.success) {
        setItems((res.items || []) as unknown as ContatoItem[])
        setTotal(res.total || 0)
      }
    } finally {
      setLoading(false)
    }
  }, [buscaAplicada, convenioId, campanhaId, pagina])

  useEffect(() => {
    getConveniosAtivos().then((res) => {
      if (res.success) setConvenios((res.items || []) as Convenio[])
    })
    getCampanhas().then((res) => {
      if (res.success) setCampanhas((res.items || []) as unknown as Campanha[])
    })
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Contact size={18} />
          Contatos — Campanhas Ativas
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Cópias de trabalho de campanhas em andamento ({total.toLocaleString('pt-BR')} contato(s)) — a base completa mora no WeSales.
        </div>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setPagina(1)
            setBuscaAplicada(busca)
          }}
          style={{ position: 'relative', flex: 1, minWidth: 240 }}
        >
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
            <Search size={16} />
          </span>
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nome, CPF ou telefone (Enter)..."
            style={{ paddingLeft: '2.25rem', width: '100%' }}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </form>
        <select className="form-control" style={{ width: 220 }} value={convenioId} onChange={(e) => { setPagina(1); setConvenioId(e.target.value) }}>
          <option value="">Todos os convênios</option>
          {convenios.map((conv) => (
            <option key={conv.id} value={conv.id}>{conv.nome}</option>
          ))}
        </select>
        <select className="form-control" style={{ width: 220 }} value={campanhaId} onChange={(e) => { setPagina(1); setCampanhaId(e.target.value) }}>
          <option value="">Todas as campanhas</option>
          {campanhas.map((campanha) => (
            <option key={campanha.id} value={campanha.id}>{campanha.descricao || campanha.base_tag}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Telefone</th>
                <th>Convênio</th>
                <th>Margem Novo</th>
                <th>Troco REFIN</th>
                <th>Dono</th>
                <th>Estágio</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /></td></tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div className="empty-state">
                      <Contact size={48} style={{ color: 'var(--brs-gray-300)', marginBottom: '1rem' }} />
                      <h3>Nenhum contato encontrado</h3>
                      <p>Importe um mailing ou ajuste os filtros.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.nome || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{maskCpf(item.cpf)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{item.telefone || '-'}</td>
                    <td>{item.convenios?.nome || '-'}</td>
                    <td>{formatMoney(item.margem_novo)}</td>
                    <td>{formatMoney(item.refin_troco)}</td>
                    <td>
                      {item.agente_parceiro_id ? (
                        <span className="badge badge-success">
                          {item.agentes_parceiros?.fantasy_name || item.agentes_parceiros?.name || 'Parceiro'}
                        </span>
                      ) : (
                        <span className="badge badge-gray">Disponível</span>
                      )}
                    </td>
                    <td>{item.funil_estagio || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid var(--brs-gray-200)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
            Página {pagina} de {totalPaginas}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={pagina <= 1 || loading} onClick={() => setPagina(pagina - 1)}>
              <ChevronLeft size={16} />
              Anterior
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={pagina >= totalPaginas || loading} onClick={() => setPagina(pagina + 1)}>
              Próxima
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
