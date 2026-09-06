'use client'

/**
 * Departamentos do BRS Messenger (paridade Digisac) — espelho dos Teams do
 * Chatwoot. Filiação de usuário = permissão por departamento (spec §6);
 * distribuição automática é opt-in, padrão desligado; "Recebe grupos" é
 * único por conta. Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Users, X } from 'lucide-react'
import {
  listarDepartamentos,
  listarUsuariosParaDepartamento,
  salvarDepartamento,
  setMembrosDepartamento,
  type DepartamentoRow,
  type UsuarioParaDepartamento,
} from '@/lib/central-conversas/departamentos-actions'

type Editando = { id?: string; nome: string; ordem: number; ativo: boolean; distribuicaoAutomatica: boolean; ehGrupos: boolean; membroIds: string[] }

export default function DepartamentosClient() {
  const [carregando, setCarregando] = useState(true)
  const [departamentos, setDepartamentos] = useState<DepartamentoRow[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioParaDepartamento[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Editando | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [buscaMembro, setBuscaMembro] = useState('')

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const [res, us] = await Promise.all([listarDepartamentos(), listarUsuariosParaDepartamento()])
      if (!res.success) throw new Error(res.error)
      setDepartamentos(res.data || [])
      setUsuarios(us)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar departamentos.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  function novo() {
    setEditando({ nome: '', ordem: (departamentos.at(-1)?.ordem || 0) + 1, ativo: true, distribuicaoAutomatica: false, ehGrupos: false, membroIds: [] })
  }

  function editar(d: DepartamentoRow) {
    setEditando({ id: d.id, nome: d.nome, ordem: d.ordem, ativo: d.ativo, distribuicaoAutomatica: d.distribuicaoAutomatica, ehGrupos: d.ehGrupos, membroIds: d.membroIds })
  }

  async function salvar() {
    if (!editando || salvando) return
    setSalvando(true)
    setErro('')
    try {
      const res = await salvarDepartamento(editando)
      if (!res.success) throw new Error(res.error)
      // resolve o id (novo ou existente) recarregando a lista antes de gravar membros
      const atualizada = await listarDepartamentos()
      if (!atualizada.success) throw new Error(atualizada.error)
      const alvo = editando.id
        ? atualizada.data?.find((d) => d.id === editando.id)
        : atualizada.data?.find((d) => d.nome === editando.nome)
      if (alvo) {
        const membros = await setMembrosDepartamento(alvo.id, editando.membroIds)
        if (!membros.success) throw new Error(membros.error)
      }
      setEditando(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar departamento.')
    } finally {
      setSalvando(false)
    }
  }

  function toggleMembro(id: string) {
    if (!editando) return
    const tem = editando.membroIds.includes(id)
    setEditando({ ...editando, membroIds: tem ? editando.membroIds.filter((m) => m !== id) : [...editando.membroIds, id] })
  }

  const usuariosFiltrados = usuarios.filter((u) => !buscaMembro.trim() || `${u.nome} ${u.email}`.toLowerCase().includes(buscaMembro.trim().toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={22} /> Departamentos
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>
          Filas do Atendimento (BRS Messenger) — quem está no departamento vê as conversas dele.
        </span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={novo}>
          <Plus size={16} /> Novo Departamento
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
                <th>Usuários vinculados</th>
                <th>Distribuição automática</th>
                <th>Recebe grupos</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {departamentos.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>Nenhum departamento cadastrado.</td>
                </tr>
              ) : (
                departamentos.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.nome}</td>
                    <td>{d.membroIds.length}</td>
                    <td>
                      <span className={`badge ${d.distribuicaoAutomatica ? 'badge-success' : 'badge-gray'}`}>{d.distribuicaoAutomatica ? 'Ligada' : 'Manual'}</span>
                    </td>
                    <td>{d.ehGrupos ? <span className="badge badge-navy">Grupos</span> : '—'}</td>
                    <td>
                      <span className={`badge ${d.ativo ? 'badge-success' : 'badge-gray'}`}>{d.ativo ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => editar(d)}>
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(560px, 100%)', maxHeight: '86dvh', display: 'flex', flexDirection: 'column', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editando.id ? 'Editar Departamento' : 'Novo Departamento'}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditando(null)}>
                <X size={16} />
              </button>
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Nome</label>
            <input
              className="form-control"
              value={editando.nome}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value.slice(0, 60) })}
              placeholder="Ex.: Comercial, Suporte…"
              style={{ margin: '0.3rem 0 0.9rem' }}
            />

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
                <input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
                <input type="checkbox" checked={editando.distribuicaoAutomatica} onChange={(e) => setEditando({ ...editando, distribuicaoAutomatica: e.target.checked })} /> Distribuição automática
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
                <input type="checkbox" checked={editando.ehGrupos} onChange={(e) => setEditando({ ...editando, ehGrupos: e.target.checked })} /> Recebe grupos automaticamente
              </label>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0 0 0.9rem' }}>
              Distribuição automática desligada = o atendente assume manualmente da fila (padrão da BRS). Só um departamento pode "receber grupos".
            </p>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>
              Usuários vinculados ({editando.membroIds.length} selecionados)
            </label>
            <input
              className="form-control"
              value={buscaMembro}
              onChange={(e) => setBuscaMembro(e.target.value)}
              placeholder="Buscar usuário…"
              style={{ margin: '0.3rem 0 0.5rem' }}
            />
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--brs-gray-200)', borderRadius: 10, minHeight: 160, maxHeight: 260 }}>
              {usuariosFiltrados.map((u) => {
                const marcado = editando.membroIds.includes(u.id)
                return (
                  <label
                    key={u.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.7rem', cursor: 'pointer', borderBottom: '1px solid var(--brs-gray-100)', background: marcado ? 'var(--brs-gray-100)' : 'transparent', fontSize: '0.82rem' }}
                  >
                    <input type="checkbox" checked={marcado} onChange={() => toggleMembro(u.id)} />
                    <span style={{ fontWeight: 600 }}>{u.nome}</span>
                    <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.72rem', marginLeft: 'auto' }}>{u.email}</span>
                  </label>
                )
              })}
              {usuariosFiltrados.length === 0 && <div style={{ padding: '1rem', color: 'var(--brs-gray-400)', fontSize: '0.8rem' }}>Nenhum usuário encontrado.</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
