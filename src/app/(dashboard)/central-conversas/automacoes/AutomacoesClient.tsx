'use client'

/**
 * Regras de automação do Chatwoot (D6): "quando X acontecer, se Y, faça Z" — roteamento,
 * etiquetas, mensagens automáticas. As regras rodam no próprio Chatwoot.
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
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
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Automações</h1>
          <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)' }}>Regras do Chatwoot: quando algo acontece, se as condições baterem, executa as ações (atribuir time, etiquetar, responder…).</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditando({ id: null, dados: VAZIA })}>
          <Plus size={14} /> Nova regra
        </button>
      </div>
      {erro && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      {carregando ? (
        <Loader2 className="spinner" />
      ) : regras.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)' }}>Nenhuma regra criada.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {regras.map((r) => (
            <div key={r.id} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>
                  {rotuloEvento(r.event_name)} · {r.conditions?.length || 0} condição(ões) · {r.actions?.map((a) => ACOES.find((x) => x.nome === a.action_name)?.rotulo || a.action_name).join(', ')}
                </div>
              </div>
              <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={r.active} onChange={() => void alternar(r)} /> Ativa
              </label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando({ id: r.id, dados: regraParaEntrada(r) })}><Pencil size={14} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void excluir(r)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {editando && d && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 500 }}>
          <div className="card" style={{ width: 640, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{editando.id ? 'Editar regra' : 'Nova regra'}</strong>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>
            <input className="input" placeholder="Nome da regra" value={d.nome} onChange={(e) => set({ nome: e.target.value })} />
            <input className="input" placeholder="Descrição (opcional)" value={d.descricao} onChange={(e) => set({ descricao: e.target.value })} />
            <label style={{ fontSize: 13 }}>
              Quando:{' '}
              <select className="input" value={d.evento} onChange={(e) => set({ evento: e.target.value })}>
                {EVENTOS.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
              </select>
            </label>

            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Se{' '}
              <select className="input" value={d.combinador} onChange={(e) => set({ combinador: e.target.value as 'AND' | 'OR' })}>
                <option value="AND">todas as condições</option>
                <option value="OR">qualquer condição</option>
              </select>{' '}
              baterem:
            </div>
            {d.condicoes.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <select className="input" value={c.chave} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, chave: e.target.value } : x)) })}>
                  {CONDICOES.map((x) => <option key={x.chave} value={x.chave}>{x.rotulo}</option>)}
                </select>
                <select className="input" value={c.operador} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, operador: e.target.value } : x)) })}>
                  {OPERADORES.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
                </select>
                {c.operador !== 'is_present' && c.operador !== 'is_not_present' && (
                  <input className="input" style={{ flex: 1 }} placeholder="valor (vários: separe por vírgula)" value={c.valor} onChange={(e) => set({ condicoes: d.condicoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ condicoes: d.condicoes.filter((_, j) => j !== i) })}><X size={12} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ condicoes: [...d.condicoes, { chave: 'content', operador: 'contains', valor: '' }] })}><Plus size={12} /> Condição</button>

            <div style={{ fontWeight: 600, fontSize: 13 }}>Então faça:</div>
            {d.acoes.map((a, i) => {
              const def = ACOES.find((x) => x.nome === a.nome)
              return (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <select className="input" value={a.nome} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { nome: e.target.value, valor: '' } : x)) })}>
                    {ACOES.map((x) => <option key={x.nome} value={x.nome}>{x.rotulo}</option>)}
                  </select>
                  {def?.param !== 'nenhum' && (
                    <input className="input" style={{ flex: 1 }} placeholder={def?.param === 'numero' ? 'id (número)' : 'valor'} value={a.valor} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ acoes: d.acoes.filter((_, j) => j !== i) })}><X size={12} /></button>
                </div>
              )
            })}
            <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ acoes: [...d.acoes, { nome: 'add_label', valor: '' }] })}><Plus size={12} /> Ação</button>

            <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.ativa} onChange={(e) => set({ ativa: e.target.checked })} /> Regra ativa</label>
            {erro && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
