'use client'

/**
 * Respostas rápidas do BRS Messenger (Fase B §d) — canned response próprio
 * (categoria, escopo por departamento, anexo), diferente do nativo do
 * Chatwoot (só texto). Cadastro: permissão central-conversas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Paperclip, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import {
  assinarArquivoResposta,
  excluirCategoriaResposta,
  excluirRespostaRapida,
  listarCategoriasResposta,
  listarRespostasRapidasAdmin,
  salvarCategoriaResposta,
  salvarRespostaRapida,
  uploadArquivoResposta,
  type CategoriaResposta,
  type RespostaRapidaRow,
} from '@/lib/central-conversas/respostas-rapidas-actions'
import { listarDepartamentos, type DepartamentoRow } from '@/lib/central-conversas/departamentos-actions'

type Aba = 'respostas' | 'categorias'

type EditandoResposta = {
  id?: string
  nome: string
  atalho: string
  texto: string
  categoriaId: string | null
  arquivoPath: string | null
  ativo: boolean
  departamentoIds: string[]
}

type EditandoCategoria = { id?: string; nome: string; ordem: number }

export default function RespostasRapidasClient() {
  const [aba, setAba] = useState<Aba>('respostas')
  const [carregando, setCarregando] = useState(true)
  const [respostas, setRespostas] = useState<RespostaRapidaRow[]>([])
  const [categorias, setCategorias] = useState<CategoriaResposta[]>([])
  const [departamentos, setDepartamentos] = useState<DepartamentoRow[]>([])
  const [erro, setErro] = useState('')

  const [editandoResposta, setEditandoResposta] = useState<EditandoResposta | null>(null)
  const [salvandoResposta, setSalvandoResposta] = useState(false)
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  const [urlArquivoAtual, setUrlArquivoAtual] = useState('')

  const [editandoCategoria, setEditandoCategoria] = useState<EditandoCategoria | null>(null)
  const [salvandoCategoria, setSalvandoCategoria] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const [r, c, d] = await Promise.all([listarRespostasRapidasAdmin(), listarCategoriasResposta(), listarDepartamentos()])
      setRespostas(r)
      setCategorias(c)
      if (d.success) setDepartamentos(d.data || [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao carregar respostas rápidas.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  function novaResposta() {
    setUrlArquivoAtual('')
    setEditandoResposta({ nome: '', atalho: '', texto: '', categoriaId: null, arquivoPath: null, ativo: true, departamentoIds: [] })
  }

  async function editarResposta(r: RespostaRapidaRow) {
    setEditandoResposta({ id: r.id, nome: r.nome, atalho: r.atalho, texto: r.texto, categoriaId: r.categoriaId, arquivoPath: r.arquivoPath, ativo: r.ativo, departamentoIds: r.departamentoIds })
    setUrlArquivoAtual('')
    if (r.arquivoPath) {
      try {
        setUrlArquivoAtual(await assinarArquivoResposta(r.arquivoPath))
      } catch {
        // link do anexo é auxiliar — segue exibindo o formulário sem ele
      }
    }
  }

  async function onEscolherArquivo(files: FileList | null) {
    const file = files?.[0]
    if (!file || !editandoResposta) return
    setEnviandoArquivo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await uploadArquivoResposta(form)
      setEditandoResposta({ ...editandoResposta, arquivoPath: r.path })
      setUrlArquivoAtual(await assinarArquivoResposta(r.path))
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar arquivo.')
    } finally {
      setEnviandoArquivo(false)
    }
  }

  function toggleDepartamento(id: string) {
    if (!editandoResposta) return
    const tem = editandoResposta.departamentoIds.includes(id)
    setEditandoResposta({ ...editandoResposta, departamentoIds: tem ? editandoResposta.departamentoIds.filter((d) => d !== id) : [...editandoResposta.departamentoIds, id] })
  }

  async function salvarResposta() {
    if (!editandoResposta || salvandoResposta) return
    setSalvandoResposta(true)
    setErro('')
    try {
      await salvarRespostaRapida(editandoResposta)
      setEditandoResposta(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar resposta rápida.')
    } finally {
      setSalvandoResposta(false)
    }
  }

  async function excluirResposta(r: RespostaRapidaRow) {
    if (!confirm(`Excluir a resposta "${r.nome}"?`)) return
    setErro('')
    try {
      await excluirRespostaRapida(r.id)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao excluir resposta rápida.')
    }
  }

  function novaCategoria() {
    setEditandoCategoria({ nome: '', ordem: (categorias.at(-1)?.ordem || 0) + 1 })
  }

  async function salvarCategoria() {
    if (!editandoCategoria || salvandoCategoria) return
    setSalvandoCategoria(true)
    setErro('')
    try {
      await salvarCategoriaResposta(editandoCategoria)
      setEditandoCategoria(null)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar categoria.')
    } finally {
      setSalvandoCategoria(false)
    }
  }

  async function excluirCategoria(c: CategoriaResposta) {
    if (!confirm(`Excluir a categoria "${c.nome}"? As respostas nela ficam sem categoria.`)) return
    setErro('')
    try {
      await excluirCategoriaResposta(c.id)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao excluir categoria.')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={22} /> Respostas rápidas
        </h1>
        <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.85rem' }}>Atalhos de texto do composer do Atendimento, com categoria, anexo e escopo por departamento.</span>
        <button
          className="btn btn-primary"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={aba === 'respostas' ? novaResposta : novaCategoria}
        >
          <Plus size={16} /> {aba === 'respostas' ? 'Nova Resposta' : 'Nova Categoria'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
        {(['respostas', 'categorias'] as Aba[]).map((id) => (
          <button
            key={id}
            className={`btn ${aba === id ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '0.4rem 1rem' }}
            onClick={() => setAba(id)}
          >
            {id === 'respostas' ? 'Respostas' : 'Categorias'}
          </button>
        ))}
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : aba === 'respostas' ? (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Atalho</th>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Departamentos</th>
                <th>Anexo</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {respostas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>Nenhuma resposta rápida cadastrada.</td>
                </tr>
              ) : (
                respostas.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.atalho}</td>
                    <td>{r.nome}</td>
                    <td>{r.categoriaNome || '—'}</td>
                    <td>{r.departamentoIds.length === 0 ? 'Todos' : r.departamentoIds.length}</td>
                    <td>{r.arquivoPath ? <Paperclip size={13} /> : '—'}</td>
                    <td>
                      <span className={`badge ${r.ativo ? 'badge-success' : 'badge-gray'}`}>{r.ativo ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => void editarResposta(r)}>
                        <Pencil size={15} />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => excluirResposta(r)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ordem</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {categorias.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>Nenhuma categoria cadastrada.</td>
                </tr>
              ) : (
                categorias.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.nome}</td>
                    <td>{c.ordem}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-icon" title="Editar" onClick={() => setEditandoCategoria({ id: c.id, nome: c.nome, ordem: c.ordem })}>
                        <Pencil size={15} />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Excluir" onClick={() => excluirCategoria(c)}>
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

      {editandoResposta && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(560px, 100%)', maxHeight: '86dvh', overflow: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editandoResposta.id ? 'Editar Resposta' : 'Nova Resposta'}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditandoResposta(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Nome</label>
                <input
                  className="form-control"
                  value={editandoResposta.nome}
                  onChange={(e) => setEditandoResposta({ ...editandoResposta, nome: e.target.value.slice(0, 80) })}
                  style={{ margin: '0.3rem 0 0.9rem' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Atalho</label>
                <input
                  className="form-control"
                  value={editandoResposta.atalho}
                  onChange={(e) => setEditandoResposta({ ...editandoResposta, atalho: e.target.value.slice(0, 40) })}
                  placeholder="/nome (auto)"
                  style={{ margin: '0.3rem 0 0.9rem' }}
                />
              </div>
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Texto</label>
            <textarea
              className="form-control"
              value={editandoResposta.texto}
              onChange={(e) => setEditandoResposta({ ...editandoResposta, texto: e.target.value })}
              style={{ margin: '0.3rem 0 0.9rem', minHeight: 90 }}
            />

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Categoria</label>
            <select
              className="form-control"
              value={editandoResposta.categoriaId || ''}
              onChange={(e) => setEditandoResposta({ ...editandoResposta, categoriaId: e.target.value || null })}
              style={{ margin: '0.3rem 0 0.9rem' }}
            >
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Anexo (opcional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0.3rem 0 0.9rem' }}>
              <label className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <Paperclip size={14} /> {enviandoArquivo ? 'Enviando…' : 'Escolher arquivo'}
                <input type="file" className="hidden" style={{ display: 'none' }} onChange={(e) => void onEscolherArquivo(e.target.files)} />
              </label>
              {urlArquivoAtual && (
                <a href={urlArquivoAtual} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  Ver anexo atual
                </a>
              )}
              {editandoResposta.arquivoPath && (
                <button type="button" className="btn btn-ghost btn-icon" title="Remover anexo" onClick={() => { setEditandoResposta({ ...editandoResposta, arquivoPath: null }); setUrlArquivoAtual('') }}>
                  <X size={14} />
                </button>
              )}
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>
              Departamentos ({editandoResposta.departamentoIds.length === 0 ? 'todos' : editandoResposta.departamentoIds.length})
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0.3rem 0 0.9rem' }}>
              {departamentos.map((d) => {
                const marcado = editandoResposta.departamentoIds.includes(d.id)
                return (
                  <label
                    key={d.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0.3rem 0.6rem', borderRadius: 99, border: '1px solid var(--brs-gray-200)', background: marcado ? 'var(--brs-gray-100)' : 'transparent', fontSize: '0.78rem', cursor: 'pointer' }}
                  >
                    <input type="checkbox" checked={marcado} onChange={() => toggleDepartamento(d.id)} />
                    {d.nome}
                  </label>
                )
              })}
              {departamentos.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Nenhum departamento cadastrado.</span>}
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0 0 0.9rem' }}>Nenhum departamento marcado = visível a todos os atendentes.</p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.9rem' }}>
              <input type="checkbox" checked={editandoResposta.ativo} onChange={(e) => setEditandoResposta({ ...editandoResposta, ativo: e.target.checked })} /> Ativo
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditandoResposta(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarResposta} disabled={salvandoResposta || !editandoResposta.nome.trim() || !editandoResposta.texto.trim()}>
                {salvandoResposta ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editandoCategoria && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(360px, 100%)', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong style={{ fontSize: '1rem' }}>{editandoCategoria.id ? 'Editar Categoria' : 'Nova Categoria'}</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditandoCategoria(null)}>
                <X size={16} />
              </button>
            </div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Nome</label>
            <input
              className="form-control"
              value={editandoCategoria.nome}
              onChange={(e) => setEditandoCategoria({ ...editandoCategoria, nome: e.target.value.slice(0, 40) })}
              style={{ margin: '0.3rem 0 0.9rem' }}
            />
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Ordem</label>
            <input
              type="number"
              className="form-control"
              value={editandoCategoria.ordem}
              onChange={(e) => setEditandoCategoria({ ...editandoCategoria, ordem: Number(e.target.value) || 0 })}
              style={{ margin: '0.3rem 0 0.9rem' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditandoCategoria(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarCategoria} disabled={salvandoCategoria || !editandoCategoria.nome.trim()}>
                {salvandoCategoria ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
