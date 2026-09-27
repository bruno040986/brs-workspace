'use client'

/**
 * Central de ajuda (D5): portal, categorias e artigos (Markdown) publicados no Chatwoot.
 * Acesso por LINK: a página pública só é conhecida por quem recebe o link (botão "Enviar artigo" no atendimento).
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { Copy, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { criarCategoria, criarPortal, excluirArtigo, listarArtigos, listarCategorias, listarPortais, salvarArtigo, type Artigo, type Categoria, type Portal } from '@/lib/central-conversas/ajuda-actions'
import { linkArtigo, STATUS_ARTIGO, type ArtigoEntrada } from '@/lib/central-conversas/ajuda'

const VAZIO: ArtigoEntrada = { titulo: '', conteudo: '', descricao: '', categoriaId: null, publicado: true }
const ehPublicado = (a: Artigo) => a.status === STATUS_ARTIGO.publicado || a.status === 'published'

export default function AjudaClient() {
  const [carregando, setCarregando] = useState(true)
  const [portais, setPortais] = useState<Portal[]>([])
  const [urlBase, setUrlBase] = useState('')
  const [portal, setPortal] = useState<Portal | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [artigos, setArtigos] = useState<Artigo[]>([])
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [nomePortal, setNomePortal] = useState('')
  const [nomeCategoria, setNomeCategoria] = useState('')
  const [editando, setEditando] = useState<{ id: number | null; dados: ArtigoEntrada } | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregarPortais(manter?: string) {
    setCarregando(true)
    const r = await listarPortais().catch(() => ({ ok: false as const, error: 'Falha ao carregar.' }))
    if (r.ok) {
      setPortais(r.portais)
      setUrlBase(r.urlBase)
      setPortal((atual) => r.portais.find((p) => p.slug === (manter || atual?.slug)) || r.portais[0] || null)
      setErro('')
    } else setErro(r.error)
    setCarregando(false)
  }

  async function carregarConteudo(p: Portal) {
    const [c, a] = await Promise.all([listarCategorias(p.slug), listarArtigos(p.slug)]).catch(() => [null, null] as const)
    if (c?.ok) setCategorias(c.categorias)
    else if (c) setErro(c.error)
    if (a?.ok) setArtigos(a.artigos)
    else if (a) setErro(a.error)
  }

  useEffect(() => {
    void carregarPortais()
  }, [])
  useEffect(() => {
    if (portal) void carregarConteudo(portal)
    else {
      setCategorias([])
      setArtigos([])
    }
  }, [portal?.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  async function novoPortal() {
    setErro('')
    const r = await criarPortal(nomePortal).catch(() => ({ ok: false as const, error: 'Falha ao criar.' }))
    if (!r.ok) return setErro(r.error)
    setNomePortal('')
    await carregarPortais()
  }

  async function novaCategoria() {
    if (!portal) return
    setErro('')
    const r = await criarCategoria(portal.slug, { nome: nomeCategoria }).catch(() => ({ ok: false as const, error: 'Falha ao criar.' }))
    if (!r.ok) return setErro(r.error)
    setNomeCategoria('')
    await carregarConteudo(portal)
  }

  async function salvar() {
    if (!portal || !editando) return
    setSalvando(true)
    setErro('')
    const r = await salvarArtigo(portal.slug, editando.id, editando.dados).catch(() => ({ ok: false as const, error: 'Falha ao salvar.' }))
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    setEditando(null)
    await carregarConteudo(portal)
  }

  async function excluir(a: Artigo) {
    if (!portal || !window.confirm(`Excluir o artigo "${a.title}"?`)) return
    const r = await excluirArtigo(portal.slug, a.id)
    if (!r.ok) return setErro(r.error)
    await carregarConteudo(portal)
  }

  async function copiar(a: Artigo) {
    if (!portal) return
    await navigator.clipboard.writeText(linkArtigo({ base: urlBase, customDomain: portal.custom_domain, portalSlug: portal.slug, slugArtigo: a.slug })).catch(() => undefined)
    setAviso('Link copiado.')
    setTimeout(() => setAviso(''), 1500)
  }

  const d = editando?.dados
  const set = (p: Partial<ArtigoEntrada>) => setEditando((e) => (e ? { ...e, dados: { ...e.dados, ...p } } : e))

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Central de ajuda</h1>
      <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)', marginBottom: 12 }}>
        Artigos publicados no Chatwoot, acessíveis por link (sem listagem pública). No atendimento, use "Enviar artigo" para mandar o link ao cliente. O texto usa Markdown.
      </div>
      {erro && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      {aviso && <div style={{ color: 'var(--color-success, #16a34a)', fontSize: 13, marginBottom: 8 }}>{aviso}</div>}
      {carregando ? (
        <Loader2 className="spinner" />
      ) : !portal ? (
        <div className="card" style={{ padding: '1rem', display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Nome da central de ajuda (ex.: Ajuda BRS)" value={nomePortal} onChange={(e) => setNomePortal(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={() => void novoPortal()} disabled={!nomePortal.trim()}>Criar central de ajuda</button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <strong>{portal.name}</strong> · endereço público: {urlBase}/hc/{portal.slug}
            {portais.length > 1 && (
              <select className="input" style={{ marginLeft: 8 }} value={portal.slug} onChange={(e) => setPortal(portais.find((p) => p.slug === e.target.value) || null)}>
                {portais.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Categorias:</span>
            {categorias.map((c) => <span key={c.id} className="badge">{c.name}</span>)}
            <input className="input" placeholder="Nova categoria" value={nomeCategoria} onChange={(e) => setNomeCategoria(e.target.value)} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void novaCategoria()} disabled={!nomeCategoria.trim()}><Plus size={12} /> Adicionar</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Artigos</h2>
            <button type="button" className="btn btn-primary" onClick={() => setEditando({ id: null, dados: VAZIO })}><Plus size={14} /> Novo artigo</button>
          </div>
          {artigos.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)' }}>Nenhum artigo ainda. O conteúdo é cadastrado aqui, sem pressa.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {artigos.map((a) => (
                <div key={a.id} className="card" style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>{ehPublicado(a) ? 'Publicado' : 'Rascunho'} · {categorias.find((c) => c.id === a.category_id)?.name || 'sem categoria'}</div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" title="Copiar link" onClick={() => void copiar(a)}><Copy size={14} /></button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando({ id: a.id, dados: { titulo: a.title, conteudo: a.content || '', descricao: a.description || '', categoriaId: a.category_id ?? null, publicado: ehPublicado(a) } })}><Pencil size={14} /></button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void excluir(a)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editando && d && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 500 }}>
          <div className="card" style={{ width: 680, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{editando.id ? 'Editar artigo' : 'Novo artigo'}</strong>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>
            <input className="input" maxLength={200} placeholder="Título" value={d.titulo} onChange={(e) => set({ titulo: e.target.value })} />
            <input className="input" placeholder="Resumo (opcional)" value={d.descricao || ''} onChange={(e) => set({ descricao: e.target.value })} />
            <select className="input" value={d.categoriaId ?? ''} onChange={(e) => set({ categoriaId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <textarea className="input" rows={14} placeholder="Conteúdo (Markdown: # título, **negrito**, - lista, [texto](link))" value={d.conteudo} onChange={(e) => set({ conteudo: e.target.value })} />
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.publicado} onChange={(e) => set({ publicado: e.target.checked })} /> Publicado (acessível pelo link)</label>
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
