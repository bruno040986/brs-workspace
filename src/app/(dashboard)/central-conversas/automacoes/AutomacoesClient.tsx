'use client'

/**
 * Regras de automação do Chatwoot (D6): "quando X acontecer, se Y, faça Z" — roteamento,
 * etiquetas, mensagens automáticas. As regras rodam no próprio Chatwoot.
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import { ativarRegra, excluirRegra, listarRegras, salvarRegra, type RegraChatwoot } from '@/lib/central-conversas/automacoes-actions'
import { ACOES, CONDICOES, EVENTOS, OPERADORES, regraParaEntrada, type RegraEntrada } from '@/lib/central-conversas/automacoes'

const VAZIA: RegraEntrada = { nome: '', descricao: '', evento: 'message_created', ativa: true, combinador: 'AND', condicoes: [{ chave: 'content', operador: 'contains', valor: '' }], acoes: [{ nome: 'add_label', valor: '' }] }
const rotuloEvento = (v: string) => EVENTOS.find((e) => e.valor === v)?.rotulo || v

export default function AutomacoesClient() {
  const [carregando, setCarregando] = useState(true)
  const [regras, setRegras] = useState<RegraChatwoot[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<{ id: number | null; dados: RegraEntrada } | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    setCarregando(true)
    const r = await listarRegras().catch(() => ({ ok: false as const, error: 'Falha ao carregar.' }))
    if (r.ok) {
      setRegras(r.regras)
      setErro('')
    } else setErro(r.error)
    setCarregando(false)
  }
  useEffect(() => {
    void carregar()
  }, [])

  async function salvar() {
    if (!editando) return
    setSalvando(true)
    setErro('')
    const r = await salvarRegra(editando.id, editando.dados).catch(() => ({ ok: false as const, error: 'Falha ao salvar.' }))
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    setEditando(null)
    await carregar()
  }

  async function alternar(r: RegraChatwoot) {
    const res = await ativarRegra(r.id, !r.active)
    if (!res.ok) return setErro(res.error)
    await carregar()
  }

  async function excluir(r: RegraChatwoot) {
    if (!window.confirm(`Excluir a regra "${r.name}"? Ela deixa de rodar imediatamente.`)) return
    const res = await excluirRegra(r.id)
    if (!res.ok) return setErro(res.error)
    await carregar()
  }

  const d = editando?.dados
  const set = (p: Partial<RegraEntrada>) => setEditando((e) => (e ? { ...e, dados: { ...e.dados, ...p } } : e))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Zap size={22} /> Automações</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-400)' }}>Regras do Chatwoot: quando algo acontece, se as condições baterem, executa as ações (atribuir time, etiquetar, responder…).</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditando({ id: null, dados: VAZIA })}>
          <Plus size={14} /> Nova regra
        </button>
      </div>
      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {carregando ? (
        <Loader2 size={18} className="animate-spin" />
      ) : regras.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-400)' }}>Nenhuma regra criada.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Regra</th>
                <th>Quando</th>
                <th>Ações</th>
                <th>Ativa</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {regras.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700 }}>{r.name}</td>
                  <td style={{ fontSize: '0.82rem' }}>{rotuloEvento(r.event_name)} · {r.conditions?.length || 0} condição(ões)</td>
                  <td style={{ color: 'var(--brs-gray-400)', fontSize: '0.82rem' }}>{r.actions?.map((a) => ACOES.find((x) => x.nome === a.action_name)?.rotulo || a.action_name).join(', ')}</td>
                  <td><input type="checkbox" checked={r.active} onChange={() => void alternar(r)} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => setEditando({ id: r.id, dados: regraParaEntrada(r) })}><Pencil size={15} /></button>
                    <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => void excluir(r)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && d && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
          <div className="card" style={{ width: 640, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{editando.id ? 'Editar regra' : 'Nova regra'}</strong>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>
            <input className="form-control" placeholder="Nome da regra" value={d.nome} onChange={(e) => set({ nome: e.target.value })} />
            <input className="form-control" placeholder="Descrição (opcional)" value={d.descricao} onChange={(e) => set({ descricao: e.target.value })} />
            <label style={{ fontSize: 13 }}>
              Quando:{' '}
              <select className="form-control" value={d.evento} onChange={(e) => set({ evento: e.target.value })}>
                {EVENTOS.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
              </select>
            </label>

            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Se{' '}
              <select className="form-control" value={d.combinador} onChange={(e) => set({ combinador: e.target.value as 'AND' | 'OR' })}>
                <option value="AND">todas as condições</option>
                <option value="OR">qualquer condição</option>
              </select>{' '}
              baterem:
            </div>
            {d.condicoes.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <select className="form-control" value={c.chave} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)) })}>
                  {CONDICOES.map((x) => <option key={x.chave} value={x.chave}>{x.rotulo}</option>)}
                </select>
                <select className="form-control" value={c.operador} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, operador: e.target.value } : x)) })}>
                  {OPERADORES.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
                </select>
                {c.operador !== 'is_present' && c.operador !== 'is_not_present' && (
                  <input className="form-control" style={{ flex: 1 }} placeholder="valor (vários: separe por vírgula)" value={c.valor} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                )}
                <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ condicoes: d.condicoes.filter((_, j) => j !== i) })}><X size={12} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ condicoes: [...d.condicoes, { chave: 'content', operador: 'contains', valor: '' }] })}><Plus size={12} /> Condição</button>

            <div style={{ fontWeight: 600, fontSize: 13 }}>Então faça:</div>
            {d.acoes.map((a, i) => {
              const def = ACOES.find((x) => x.nome === a.nome)
              return (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <select className="form-control" value={a.nome} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { nome: e.target.value, valor: '' } : x)) })}>
                    {ACOES.map((x) => <option key={x.nome} value={x.nome}>{x.rotulo}</option>)}
                  </select>
                  {def?.param !== 'nenhum' && (
                    <input className="form-control" style={{ flex: 1 }} placeholder={def?.param === 'numero' ? 'id (número)' : 'valor'} value={a.valor} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                  )}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ acoes: d.acoes.filter((_, j) => j !== i) })}><X size={12} /></button>
                </div>
              )
            })}
            <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ acoes: [...d.acoes, { nome: 'add_label', valor: '' }] })}><Plus size={12} /> Ação</button>

            <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.ativa} onChange={(e) => set({ ativa: e.target.checked })} /> Regra ativa</label>
            {erro && <div style={{ color: 'var(--brs-danger)', fontSize: 13 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
