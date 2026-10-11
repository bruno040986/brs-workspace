'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle, Loader2, Trash2, Upload } from 'lucide-react'
import {
  definirBandeira,
  definirBrasao,
  definirLogotipo,
  editarImagem,
  enviarImagem,
  listarImagens,
  removerImagem,
  reordenarImagens,
  type ImagemConvenio,
} from '../../imagens-actions'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_GALERIA = 12
const TIPOS: { value: ImagemConvenio['tipo']; label: string }[] = [
  { value: 'predio', label: 'Prédio' },
  { value: 'bandeira', label: 'Bandeira' },
  { value: 'cidade', label: 'Cidade' },
  { value: 'outro', label: 'Outro' },
]
// 'bandeira' na galeria só por compatibilidade: a bandeira tem card próprio.
const tiposPara = (atual?: ImagemConvenio['tipo']) => TIPOS.filter((t) => t.value !== 'bandeira' || t.value === atual)
const ACOES_MARCA = { logotipo: definirLogotipo, brasao: definirBrasao, bandeira: definirBandeira }

type Msg = { type: 'success' | 'error'; text: string } | null
type Res = { success: boolean; error?: string }

export default function ImagensTab({ convenioId }: { convenioId: string }) {
  const [logotipo, setLogotipo] = useState<string | null>(null)
  const [brasao, setBrasao] = useState<string | null>(null)
  const [bandeira, setBandeira] = useState<string | null>(null)
  const [items, setItems] = useState<ImagemConvenio[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Msg>(null)
  const [novoTipo, setNovoTipo] = useState<ImagemConvenio['tipo']>('outro')
  const [novaLegenda, setNovaLegenda] = useState('')
  const [novoArquivo, setNovoArquivo] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)

  function aplicar(res: Awaited<ReturnType<typeof listarImagens>>) {
    if (res.success) {
      setLogotipo(res.logotipo_url ?? null)
      setBrasao(res.brasao_url ?? null)
      setBandeira(res.bandeira_url ?? null)
      setItems(res.items || [])
    } else setMessage({ type: 'error', text: res.error || 'Erro ao carregar imagens.' })
    setLoading(false)
  }

  const load = async () => aplicar(await listarImagens(convenioId))

  useEffect(() => {
    listarImagens(convenioId).then(aplicar)
  }, [convenioId])

  async function run(chave: string, fn: () => Promise<Res>, ok?: string) {
    setBusy(chave)
    setMessage(null)
    try {
      const res = await fn()
      if (!res.success) setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      else if (ok) setMessage({ type: 'success', text: ok })
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao salvar.' })
    } finally {
      setBusy(null)
    }
  }

  function marca(campo: keyof typeof ACOES_MARCA, arquivo: File | null) {
    const fd = new FormData()
    fd.append('convenio_id', convenioId)
    if (arquivo) fd.append('arquivo', arquivo)
    else fd.append('remover', '1')
    return run(campo, () => ACOES_MARCA[campo](fd), arquivo ? 'Imagem salva.' : 'Imagem removida.')
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault()
    if (!novoArquivo) {
      setMessage({ type: 'error', text: 'Selecione uma imagem.' })
      return
    }
    const fd = new FormData()
    fd.append('convenio_id', convenioId)
    fd.append('tipo', novoTipo)
    fd.append('legenda', novaLegenda)
    fd.append('arquivo', novoArquivo)
    await run('enviar', () => enviarImagem(fd), 'Imagem adicionada à galeria.')
    setNovaLegenda('')
    setNovoArquivo(null)
    setInputKey((k) => k + 1)
  }

  function mover(idx: number, delta: number) {
    const ids = items.map((i) => i.id)
    ;[ids[idx], ids[idx + delta]] = [ids[idx + delta], ids[idx]]
    return run(items[idx].id, () => reordenarImagens(convenioId, ids))
  }

  function editar(item: ImagemConvenio, patch: Partial<Pick<ImagemConvenio, 'legenda' | 'tipo'>>) {
    const prox = { legenda: item.legenda ?? '', tipo: item.tipo, ...patch }
    if ((prox.legenda ?? '') === (item.legenda ?? '') && prox.tipo === item.tipo) return
    return run(item.id, () => editarImagem(item.id, { legenda: prox.legenda ?? '', tipo: prox.tipo }))
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  const cheia = items.length >= MAX_GALERIA

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>
        PNG, JPEG ou WebP, até 2 MB, 1:1 para logotipo e brasão; bandeira em proporção livre (recomendado 3:2). As imagens entram no site na próxima publicação da aba Landing Page.
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {(
          [
            { campo: 'logotipo', titulo: 'Logotipo (1:1)', url: logotipo, proporcao: '1 / 1' },
            { campo: 'brasao', titulo: 'Brasão (1:1)', url: brasao, proporcao: '1 / 1' },
            { campo: 'bandeira', titulo: 'Bandeira (recomendado 3:2)', url: bandeira, proporcao: '3 / 2' },
          ] as const
        ).map((m) => (
          <div key={m.campo} className="card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem', justifyItems: 'center' }}>
            <div style={{ fontWeight: 800, justifySelf: 'start' }}>{m.titulo}</div>
            <div
              style={{
                height: 140,
                aspectRatio: m.proporcao,
                borderRadius: 10,
                border: '1px dashed var(--brs-gray-200, #E5E7EB)',
                background: 'var(--brs-gray-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.titulo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>Sem imagem</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <label className={`btn btn-outline btn-sm${busy ? ' disabled' : ''}`} style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
                {busy === m.campo ? <Loader2 size={14} className="spinner" /> : <Upload size={14} />}
                {m.url ? 'Trocar' : 'Enviar'}
                <input
                  type="file"
                  accept={ACCEPT}
                  hidden
                  disabled={!!busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) marca(m.campo, f)
                  }}
                />
              </label>
              {m.url && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!!busy}
                  onClick={() => window.confirm(`Remover ${m.titulo.toLowerCase()}?`) && marca(m.campo, null)}
                >
                  <Trash2 size={14} />
                  Remover
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
        <div style={{ fontWeight: 800 }}>
          Galeria ({items.length}/{MAX_GALERIA})
        </div>

        <form onSubmit={handleEnviar} className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
          <div className="form-group">
            <label className="form-label">Tipo</label>
            <select className="form-control" value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as ImagemConvenio['tipo'])}>
              {tiposPara().map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Legenda (opcional)</label>
            <input type="text" className="form-control" maxLength={120} value={novaLegenda} onChange={(e) => setNovaLegenda(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Arquivo</label>
            <input key={inputKey} type="file" className="form-control" accept={ACCEPT} onChange={(e) => setNovoArquivo(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <button type="submit" className="btn btn-primary" disabled={!!busy || cheia} title={cheia ? `Máximo de ${MAX_GALERIA} imagens` : undefined}>
              {busy === 'enviar' ? <Loader2 size={15} className="spinner" /> : <Upload size={15} />}
              Adicionar
            </button>
          </div>
        </form>

        {items.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>Nenhuma imagem na galeria.</div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {items.map((item, idx) => (
              <div key={item.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10, overflow: 'hidden', display: 'grid' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.legenda || 'Imagem do convênio'}
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: 'var(--brs-gray-50)' }}
                />
                <div style={{ padding: '0.5rem', display: 'grid', gap: '0.4rem' }}>
                  <select
                    className="form-control"
                    value={item.tipo}
                    disabled={!!busy}
                    onChange={(e) => editar(item, { tipo: e.target.value as ImagemConvenio['tipo'] })}
                  >
                    {tiposPara(item.tipo).map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    key={`${item.id}-${item.legenda ?? ''}`}
                    type="text"
                    className="form-control"
                    placeholder="Legenda"
                    maxLength={120}
                    defaultValue={item.legenda ?? ''}
                    disabled={!!busy}
                    onBlur={(e) => editar(item, { legenda: e.target.value.trim() })}
                  />
                  <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button type="button" className="btn btn-ghost btn-sm btn-acao" disabled={!!busy || idx === 0} onClick={() => mover(idx, -1)} title="Mover para cima" aria-label="Mover para cima">
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-acao"
                        disabled={!!busy || idx === items.length - 1}
                        onClick={() => mover(idx, 1)}
                        title="Mover para baixo"
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-acao"
                      disabled={!!busy}
                      onClick={() => window.confirm('Remover esta imagem?') && run(item.id, () => removerImagem(item.id), 'Imagem removida.')}
                      title="Remover"
                      aria-label="Remover"
                    >
                      {busy === item.id ? <Loader2 size={14} className="spinner" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
