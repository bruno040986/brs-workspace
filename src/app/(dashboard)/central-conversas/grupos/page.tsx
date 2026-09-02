'use client'

/**
 * Grupos Internos do BRS Messenger — CRUD (Central de Atendimento).
 * Criar/editar grupo: nome + membros; o grupo aparece na hora no Messenger
 * de cada membro, com o nome de exibição precedendo as mensagens (padrão
 * grupo de WhatsApp).
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import {
  excluirGrupoInterno,
  listarGruposInternos,
  salvarGrupoInterno,
  type GrupoInternoRow,
  type UsuarioParaGrupo,
} from '@/lib/interno-chat/grupos-actions'

export default function GruposInternosPage() {
  const [carregando, setCarregando] = useState(true)
  const [grupos, setGrupos] = useState<GrupoInternoRow[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioParaGrupo[]>([])
  const [erro, setErro] = useState('')

  const [editando, setEditando] = useState<{ id?: string; nome: string; membros: string[] } | null>(null)
  const [buscaMembro, setBuscaMembro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const res = await listarGruposInternos()
      if (!res.success) throw new Error(res.error)
      setGrupos(res.data || [])
      setUsuarios(res.usuarios || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar grupos.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function salvar() {
    if (!editando || salvando) return
    setSalvando(true)
    setErro('')
    try {
      const res = await salvarGrupoInterno(editando)
      if (!res.success) throw new Error(res.error)
      setEditando(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar grupo.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(grupo: GrupoInternoRow) {
    if (!confirm(`Desativar o grupo "${grupo.nome}"? Ele some do Messenger de todos (o histórico fica preservado no banco).`)) return
    const res = await excluirGrupoInterno(grupo.id)
    if (!res.success) {
      alert(res.error || 'Erro ao excluir grupo.')
      return
    }
    await carregar()
  }

  const usuariosFiltrados = useMemo(() => {
    const q = buscaMembro.trim().toLowerCase()
    if (!q) return usuarios
    return usuarios.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q))
  }, [usuarios, buscaMembro])

  function toggleMembro(id: string) {
    if (!editando) return
    const tem = editando.membros.includes(id)
    setEditando({ ...editando, membros: tem ? editando.membros.filter((m) => m !== id) : [...editando.membros, id] })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={22} /> Grupos Internos
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>
          Grupos do chat Interno do BRS Messenger — aparecem para os membros na hora.
        </span>
        <button
          className="btn btn-primary"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setEditando({ nome: '', membros: [] })}
        >
          <Plus size={16} /> Novo Grupo
        </button>
      </div>

      {erro && (
        <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>
          {erro}
        </div>
      )}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : grupos.length === 0 && !editando ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>
          Nenhum grupo interno ainda. Crie o primeiro — ele aparece no Messenger dos membros imediatamente.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.9rem' }}>
          {grupos.map((g) => (
            <div key={g.id} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: '0.95rem' }}>{g.nome}</strong>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Editar grupo"
                    onClick={() => setEditando({ id: g.id, nome: g.nome, membros: g.membros.map((m) => m.user_id) })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button className="btn btn-ghost btn-icon" title="Desativar grupo" onClick={() => excluir(g)}>
                    <Trash2 size={15} style={{ color: 'var(--brs-danger)' }} />
                  </button>
                </span>
              </div>
              <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.membros.map((m) => (
                  <span
                    key={m.user_id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--brs-gray-100)', borderRadius: 999, padding: '0.2rem 0.6rem 0.2rem 0.25rem', fontSize: '0.72rem', fontWeight: 600 }}
                  >
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--brs-navy-light)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', overflow: 'hidden' }}>
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        (m.name || m.email).charAt(0).toUpperCase()
                      )}
                    </span>
                    {m.name || m.email}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: '0.5rem', color: 'var(--brs-gray-400)', fontSize: '0.72rem' }}>{g.membros.length} membros</div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(560px, 100%)', maxHeight: '86dvh', display: 'flex', flexDirection: 'column', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editando.id ? 'Editar Grupo' : 'Novo Grupo'}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditando(null)}>
                <X size={16} />
              </button>
            </div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Nome do grupo</label>
            <input
              className="form-control"
              value={editando.nome}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value.slice(0, 60) })}
              placeholder="Ex.: Equipe Comercial, Diretoria…"
              style={{ margin: '0.3rem 0 0.9rem' }}
            />
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>
              Membros ({editando.membros.length} selecionados)
            </label>
            <input
              className="form-control"
              value={buscaMembro}
              onChange={(e) => setBuscaMembro(e.target.value)}
              placeholder="Buscar usuário…"
              style={{ margin: '0.3rem 0 0.5rem' }}
            />
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--brs-gray-200)', borderRadius: 10, minHeight: 180, maxHeight: 280 }}>
              {usuariosFiltrados.map((u) => {
                const marcado = editando.membros.includes(u.id)
                return (
                  <label
                    key={u.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0.7rem', cursor: 'pointer', borderBottom: '1px solid var(--brs-gray-100)', background: marcado ? 'var(--brs-gray-100)' : 'transparent', fontSize: '0.82rem' }}
                  >
                    <input type="checkbox" checked={marcado} onChange={() => toggleMembro(u.id)} />
                    <span style={{ fontWeight: 600 }}>{u.name || u.email}</span>
                    <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.72rem', marginLeft: 'auto' }}>{u.email}</span>
                  </label>
                )
              })}
              {usuariosFiltrados.length === 0 && (
                <div style={{ padding: '1rem', color: 'var(--brs-gray-400)', fontSize: '0.8rem' }}>Nenhum usuário encontrado.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar Grupo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
