'use client'

/**
 * Tags do BRS Messenger (Fase B §c) — espelho das labels da conta no Chatwoot.
 * Usadas tanto na conversa quanto no contato (painel do atendimento).
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { excluirTagAdmin, listarTagsAdmin, salvarTagAdmin, type TagAdmin } from '@/lib/central-conversas/actions'

type Editando = { id?: number; titulo: string; cor: string; descricao: string }

const COR_PADRAO = '#3b82f6'

export default function TagsClient() {
  const [carregando, setCarregando] = useState(true)
  const [tags, setTags] = useState<TagAdmin[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Editando | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      setTags(await listarTagsAdmin())
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar tags.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  function novo() {
    setEditando({ titulo: '', cor: COR_PADRAO, descricao: '' })
  }

  function editar(t: TagAdmin) {
    setEditando({ id: t.id, titulo: t.titulo, cor: t.cor || COR_PADRAO, descricao: t.descricao || '' })
  }

  async function salvar() {
    if (!editando || salvando) return
    setSalvando(true)
    setErro('')
    try {
      await salvarTagAdmin(editando)
      setEditando(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar tag.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(t: TagAdmin) {
    if (!confirm(`Excluir a tag "${t.titulo}"? Ela some de todas as conversas e contatos que a usam.`)) return
    setErro('')
    try {
      await excluirTagAdmin(t.id)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao excluir tag.')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag size={22} /> Tags
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Tags do BRS Messenger — usadas em conversas e contatos.</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={novo}>
          <Plus size={16} /> Nova Tag
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
                <th>Tag</th>
                <th>Descrição</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tags.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>Nenhuma tag cadastrada.</td>
                </tr>
              ) : (
                tags.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 99, background: `${t.cor || COR_PADRAO}22`, color: t.cor || COR_PADRAO }}>
                        {t.titulo}
                      </span>
                    </td>
                    <td style={{ color: 'var(--brs-gray-400)', fontSize: '0.82rem' }}>{t.descricao || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => editar(t)}>
                        <Pencil size={15} />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => excluir(t)}>
                        <Trash2 size={15} />
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
          <div className="card" style={{ width: 'min(420px, 100%)', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editando.id ? 'Editar Tag' : 'Nova Tag'}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditando(null)}>
                <X size={16} />
              </button>
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Nome</label>
            <input
              className="form-control"
              value={editando.titulo}
              onChange={(e) => setEditando({ ...editando, titulo: e.target.value.slice(0, 40) })}
              placeholder="Ex.: Urgente, VIP…"
              style={{ margin: '0.3rem 0 0.9rem' }}
            />

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Cor</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0.3rem 0 0.9rem' }}>
              <input type="color" value={editando.cor} onChange={(e) => setEditando({ ...editando, cor: e.target.value })} style={{ width: 40, height: 34, padding: 2, border: '1px solid var(--brs-gray-200)', borderRadius: 6 }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 99, background: `${editando.cor}22`, color: editando.cor }}>
                {editando.titulo || 'Pré-visualização'}
              </span>
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Descrição (opcional)</label>
            <input
              className="form-control"
              value={editando.descricao}
              onChange={(e) => setEditando({ ...editando, descricao: e.target.value.slice(0, 120) })}
              style={{ margin: '0.3rem 0 0.9rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando || !editando.titulo.trim()}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
