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

  const lbl = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' } as const

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={22} /> Macros
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Sequências de ações aplicadas com 1 clique na conversa. Valem para toda a equipe.</span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setEditando({ id: null, dados: VAZIA })}>
          <Plus size={16} /> Nova macro
        </button>
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ações</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {macros.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>Nenhuma macro cadastrada.</td>
                </tr>
              ) : (
                macros.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 700 }}>{m.name}</td>
                    <td style={{ color: 'var(--brs-gray-400)', fontSize: '0.82rem' }}>{m.actions?.map((a) => ACOES_MACRO.find((x) => x.nome === a.action_name)?.rotulo || a.action_name).join(' → ')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => setEditando({ id: m.id, dados: macroParaEntrada(m) })}><Pencil size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => void excluir(m)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editando && d && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editando.id ? 'Editar macro' : 'Nova macro'}</strong>
              <button type="button" className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>

            <label style={lbl}>Nome</label>
            <input className="form-control" placeholder="Ex.: Encerrar com etiqueta" value={d.nome} onChange={(e) => set({ nome: e.target.value })} style={{ margin: '0.3rem 0 0.9rem' }} />

            <label style={lbl}>Ações, na ordem</label>
            <div style={{ margin: '0.3rem 0 0.9rem' }}>
              {d.acoes.map((a, i) => {
                const def = ACOES_MACRO.find((x) => x.nome === a.nome)
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <select className="form-control" value={a.nome} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { nome: e.target.value, valor: '' } : x)) })}>
                      {ACOES_MACRO.map((x) => <option key={x.nome} value={x.nome}>{x.rotulo}</option>)}
                    </select>
                    {def?.param !== 'nenhum' && (
                      <input className="form-control" style={{ flex: 1 }} placeholder={def?.param === 'numero' ? 'id (número)' : 'valor'} value={a.valor} onChange={(e) => set({ acoes: d.acoes.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
                    )}
                    <button type="button" className="btn btn-ghost btn-icon" title="Remover" onClick={() => set({ acoes: d.acoes.filter((_, j) => j !== i) })}><X size={14} /></button>
                  </div>
                )
              })}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ acoes: [...d.acoes, { nome: 'add_label', valor: '' }] })}><Plus size={12} /> Ação</button>
            </div>

            {erro && <div style={{ color: 'var(--brs-danger)', fontSize: 13, marginBottom: 8 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
