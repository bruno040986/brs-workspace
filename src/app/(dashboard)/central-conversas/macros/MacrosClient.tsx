'use client'

/**
 * Macros do Chatwoot (D1): sequência de ações aplicada com 1 clique numa conversa
 * (etiquetar, atribuir, responder, resolver…). Usadas no botão "Macro" do atendimento.
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import { excluirMacro, listarMacros, salvarMacro, type MacroChatwoot } from '@/lib/central-conversas/macros-actions'
import { ACOES_MACRO, macroParaEntrada, type MacroEntrada } from '@/lib/central-conversas/macros'

const VAZIA: MacroEntrada = { nome: '', acoes: [{ nome: 'add_label', valor: '' }] }

export default function MacrosClient() {
  const [carregando, setCarregando] = useState(true)
  const [macros, setMacros] = useState<MacroChatwoot[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<{ id: number | null; dados: MacroEntrada } | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    setCarregando(true)
    const r = await listarMacros().catch(() => ({ ok: false as const, error: 'Falha ao carregar.' }))
    if (r.ok) {
      setMacros(r.macros)
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
    const r = await salvarMacro(editando.id, editando.dados).catch(() => ({ ok: false as const, error: 'Falha ao salvar.' }))
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    setEditando(null)
    await carregar()
  }

  async function excluir(m: MacroChatwoot) {
    if (!window.confirm(`Excluir a macro "${m.name}"?`)) return
    const r = await excluirMacro(m.id)
    if (!r.ok) return setErro(r.error)
    await carregar()
  }

  const d = editando?.dados
  const set = (p: Partial<MacroEntrada>) => setEditando((e) => (e ? { ...e, dados: { ...e.dados, ...p } } : e))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Zap size={22} /> Macros</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-400)' }}>Sequências de ações aplicadas com 1 clique na conversa (botão "Macro" do atendimento). Valem para toda a equipe.</div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditando({ id: null, dados: VAZIA })}>
          <Plus size={14} /> Nova macro
        </button>
      </div>
      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {carregando ? (
        <Loader2 size={18} className="animate-spin" />
      ) : macros.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-400)' }}>Nenhuma macro criada.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Macro</th>
                <th>Ações, na ordem</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {macros.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 700 }}>{m.name}</td>
                  <td style={{ color: 'var(--brs-gray-400)', fontSize: '0.82rem' }}>{m.actions?.map((a) => ACOES_MACRO.find((x) => x.nome === a.action_name)?.rotulo || a.action_name).join(' → ')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => setEditando({ id: m.id, dados: macroParaEntrada(m) })}><Pencil size={15} /></button>
                    <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => void excluir(m)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && d && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}>
          <div className="card" style={{ width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{editando.id ? 'Editar macro' : 'Nova macro'}</strong>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>
            <input className="form-control" placeholder="Nome da macro (ex.: Encerrar com etiqueta)" value={d.nome} onChange={(e) => set({ nome: e.target.value })} />
            <div style={{ fontWeight: 600, fontSize: 13 }}>Ações, na ordem:</div>
            {d.acoes.map((a, i) => {
              const def = ACOES_MACRO.find((x) => x.nome === a.nome)
              return (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <select className="form-control" value={a.nome} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { nome: e.target.value, valor: '' } : x)) })}>
                    {ACOES_MACRO.map((x) => <option key={x.nome} value={x.nome}>{x.rotulo}</option>)}
                  </select>
                  {def?.param !== 'nenhum' && (
                    <input className="form-control" style={{ flex: 1 }} placeholder={def?.param === 'numero' ? 'id (número)' : 'valor'} value={a.valor} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                  )}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ acoes: d.acoes.filter((_, j) => j !== i) })}><X size={12} /></button>
                </div>
              )
            })}
            <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ acoes: [...d.acoes, { nome: 'add_label', valor: '' }] })}><Plus size={12} /> Ação</button>
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
