'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { AlertCircle, Archive, CheckCircle, Pencil, Plus, X } from 'lucide-react'
import { analisarVariaveis, previaCorpo, VARIAVEIS_BIBLIOTECA, LIMITES } from '@/lib/alvoconsig/templates-biblioteca'
import {
  arquivarTemplateSistema, criarTemplateSistema, listarTemplatesSistema, novaVersaoTemplateSistema,
  type TemplateSistema,
} from './actions'

type Msg = { type: 'success' | 'error'; text: string } | null
type Form = { id: string | null; nome: string; categoria: string; corpo: string; arquivo: File | null; removerMidia: boolean; midiaAtual: TemplateSistema | null }
const VAZIO: Form = { id: null, nome: '', categoria: '', corpo: '', arquivo: null, removerMidia: false, midiaAtual: null }

function Balao({ corpo, midia }: { corpo: string; midia?: { tipo: 'imagem' | 'audio' | null; url: string | null } }) {
  return (
    <div style={{ background: '#E5DDD5', padding: 12, borderRadius: 10 }}>
      <div style={{ background: '#DCF8C6', padding: '8px 10px', borderRadius: 8, maxWidth: 320, marginLeft: 'auto', fontSize: '0.88rem', whiteSpace: 'pre-wrap', color: '#111' }}>
        {midia?.url && midia.tipo === 'imagem' && <img src={midia.url} alt="" style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />}
        {midia?.url && midia.tipo === 'audio' && <audio controls src={midia.url} style={{ width: '100%', marginBottom: 6 }} />}
        {previaCorpo(corpo) || <span style={{ color: '#777' }}>A prévia aparece aqui.</span>}
      </div>
    </div>
  )
}

export default function TemplatesClient() {
  const [lista, setLista] = useState<TemplateSistema[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<Msg>(null)
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [pending, start] = useTransition()

  const carregar = useCallback(async () => {
    const r = await listarTemplatesSistema()
    if (r.success) setLista(r.templates)
    else setMsg({ type: 'error', text: r.error })
    setLoading(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const categorias = useMemo(() => Array.from(new Set(lista.map((t) => t.categoria).filter(Boolean) as string[])).sort(), [lista])
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((t) => (!categoria || t.categoria === categoria) && (!q || `${t.nome} ${t.corpo}`.toLowerCase().includes(q)))
  }, [lista, busca, categoria])
  const ativos = filtrados.filter((t) => !t.deleted_at)
  const arquivados = filtrados.filter((t) => t.deleted_at)

  function salvar() {
    if (!form) return
    const fd = new FormData()
    fd.set('nome', form.nome); fd.set('categoria', form.categoria); fd.set('corpo', form.corpo)
    if (form.arquivo) fd.set('midia', form.arquivo)
    if (form.id) { fd.set('id', form.id); if (form.removerMidia) fd.set('removerMidia', '1') }
    start(async () => {
      const r = form.id ? await novaVersaoTemplateSistema(fd) : await criarTemplateSistema(fd)
      if (r.success) {
        setMsg({ type: 'success', text: form.id ? 'Nova versão criada; a anterior foi arquivada.' : 'Template criado.' })
        setForm(null)
        await carregar()
      } else setMsg({ type: 'error', text: r.error })
    })
  }

  function arquivar(t: TemplateSistema) {
    if (!confirm(`Arquivar "${t.nome}"? Campanhas em andamento que já o usam não são afetadas.`)) return
    start(async () => {
      const r = await arquivarTemplateSistema(t.id)
      setMsg(r.success ? { type: 'success', text: 'Template arquivado.' } : { type: 'error', text: r.error })
      await carregar()
    })
  }

  const desconhecidas = form ? analisarVariaveis(form.corpo).desconhecidas : []
  const linha = (t: TemplateSistema, arq: boolean) => (
    <tr key={t.id} style={arq ? { opacity: 0.6 } : undefined}>
      <td><strong>{t.nome}</strong><div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>{t.chave}</div></td>
      <td>{t.categoria || '—'}</td>
      <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>{t.corpo.slice(0, 160)}{t.corpo.length > 160 ? '…' : ''}{t.midia_tipo ? ` [${t.midia_tipo}]` : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {!arq && (
          <>
            <button className="btn btn-secondary" title="Editar cria uma nova versão" onClick={() => setForm({ id: t.id, nome: t.nome, categoria: t.categoria || '', corpo: t.corpo, arquivo: null, removerMidia: false, midiaAtual: t })}><Pencil size={14} /> Editar</button>{' '}
            <button className="btn btn-secondary" onClick={() => arquivar(t)} disabled={pending}><Archive size={14} /> Arquivar</button>
          </>
        )}
      </td>
    </tr>
  )
  const tabela = (itens: TemplateSistema[], arq: boolean) => (
    <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '1rem' }}>
      <table className="data-table" style={{ minWidth: 700 }}>
        <thead><tr><th>Nome</th><th>Categoria</th><th>Mensagem</th><th /></tr></thead>
        <tbody>{itens.length ? itens.map((t) => linha(t, arq)) : <tr><td colSpan={4} style={{ color: 'var(--brs-gray-500)' }}>Nenhum template.</td></tr>}</tbody>
      </table>
    </div>
  )

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>Biblioteca de Templates do Sistema</div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.88rem', maxWidth: 800 }}>
            Modelos padrão que os parceiros copiam. Editar nunca altera o modelo em uso: cria uma nova versão (-v2, -v3…) e arquiva a anterior.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setForm(VAZIO)}><Plus size={14} /> Novo template</button>
      </div>

      {msg && (
        <div style={{ padding: '0.8rem 1rem', borderRadius: 10, marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${msg.type === 'success' ? '#A7F3D0' : '#FECACA'}`, background: msg.type === 'success' ? '#ECFDF5' : '#FEF2F2', color: msg.type === 'success' ? '#065F46' : '#991B1B' }}>
          {msg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}{msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input className="form-input" placeholder="Buscar por nome ou texto" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        <select className="form-input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /> : (
        <>
          {tabela(ativos, false)}
          {arquivados.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', margin: '0.5rem 0' }}>Arquivados ({arquivados.length})</summary>
              {tabela(arquivados, true)}
            </details>
          )}
        </>
      )}

      {form && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" style={{ width: 'min(900px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong>{form.id ? 'Editar (cria nova versão)' : 'Novo template do sistema'}</strong>
              <button className="btn btn-secondary" onClick={() => setForm(null)}><X size={14} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label>Nome ({form.nome.length}/{LIMITES.nome})<input className="form-input" maxLength={LIMITES.nome} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
                <label>Categoria ({form.categoria.length}/{LIMITES.categoria})<input className="form-input" maxLength={LIMITES.categoria} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} list="cats-templates" /></label>
                <datalist id="cats-templates">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
                <label>Mensagem ({form.corpo.length}/{LIMITES.corpo})<textarea className="form-input" rows={8} maxLength={LIMITES.corpo} value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} /></label>
                <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>Variáveis: {Object.keys(VARIAVEIS_BIBLIOTECA).map((k) => `{{${k}}}`).join(' ')}</div>
                {desconhecidas.length > 0 && <div style={{ color: '#991B1B', fontSize: '0.82rem' }}>Variável desconhecida: {desconhecidas.map((v) => `{{${v}}}`).join(', ')} (não vai salvar).</div>}
                <label>Mídia (opcional: PNG/JPG/WebP até 5MB, OGG/MP3/M4A até 16MB)
                  <input type="file" accept="image/png,image/jpeg,image/webp,audio/ogg,audio/mpeg,audio/mp4,.m4a" onChange={(e) => setForm({ ...form, arquivo: e.target.files?.[0] ?? null })} />
                </label>
                {form.id && form.midiaAtual?.midia_tipo && !form.arquivo && (
                  <label><input type="checkbox" checked={form.removerMidia} onChange={(e) => setForm({ ...form, removerMidia: e.target.checked })} /> Remover a mídia atual ({form.midiaAtual.midia_tipo})</label>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', marginBottom: 6 }}>Prévia (variáveis de exemplo)</div>
                <Balao corpo={form.corpo} midia={form.id && !form.arquivo && !form.removerMidia && form.midiaAtual ? { tipo: form.midiaAtual.midia_tipo, url: form.midiaAtual.midiaUrl } : undefined} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={pending || desconhecidas.length > 0}>{pending ? 'Salvando…' : form.id ? 'Salvar nova versão' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
