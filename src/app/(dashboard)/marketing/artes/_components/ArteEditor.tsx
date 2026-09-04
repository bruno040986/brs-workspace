'use client'

/**
 * Editor visual de arte de marketing — NATIVO (divs em % sobre a imagem, sem
 * canvas lib). Fluxo: sobe a imagem-base → aparece o canvas → arrasta pra
 * desenhar um retângulo = novo elemento → escolhe o tipo (logo/texto/foto/
 * WhatsApp) e as regras → tudo salvo como % do canvas no jsonb `elementos`.
 * Elementos existentes podem ser movidos/redimensionados.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, Loader2, MessageSquare, Save, Trash2, Type, User } from 'lucide-react'
import {
  assinarImagemBase,
  getArteLookups,
  salvarArte,
  uploadImagemBase,
  type ArteElemento,
  type ArteLookups,
  type MarketingArte,
} from '@/lib/marketing/artes-actions'

const LOOKUPS_VAZIO: ArteLookups = { convenios: [], tipos: [], formatos: [], associacoes: [] }

const CORES_TIPO: Record<ArteElemento['tipo'], string> = {
  logo: '#7c3aed',
  texto: '#0284c7',
  foto: '#16a34a',
  whatsapp: '#25D366',
}
const ICONE_TIPO: Record<ArteElemento['tipo'], React.ReactNode> = {
  logo: <ImageIcon size={13} />,
  texto: <Type size={13} />,
  foto: <User size={13} />,
  whatsapp: <MessageSquare size={13} />,
}

function novoId() {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export default function ArteEditor({ arte }: { arte?: MarketingArte }) {
  const router = useRouter()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [nome, setNome] = useState(arte?.nome || '')
  const [descricao, setDescricao] = useState(arte?.descricao || '')
  const [tipoConvenioId, setTipoConvenioId] = useState(arte?.tipo_convenio_id || '')
  const [convenioId, setConvenioId] = useState(arte?.convenio_id || '')
  const [lookups, setLookups] = useState<ArteLookups>(LOOKUPS_VAZIO)
  const [destinos, setDestinos] = useState<string[]>(arte?.associacao_ids || []) // associacao ids marcados

  const [imagemPath, setImagemPath] = useState(arte?.imagem_url || '')
  const [imagemUrl, setImagemUrl] = useState(arte?.imagem_signed_url || '')
  const [dim, setDim] = useState<{ w: number; h: number }>({ w: arte?.largura_px || 0, h: arte?.altura_px || 0 })
  const [elementos, setElementos] = useState<ArteElemento[]>(arte?.elementos || [])
  const [selId, setSelId] = useState<string | null>(null)

  const [subindo, setSubindo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // desenho/drag
  const dragRef = useRef<null | { modo: 'novo' | 'mover' | 'resize'; id: string; startX: number; startY: number; orig: ArteElemento }>(null)

  useEffect(() => {
    getArteLookups().then((l) => setLookups(l || LOOKUPS_VAZIO))
  }, [])

  // Convênios visíveis = Genérico + os do tipo selecionado (ou todos se sem tipo).
  const conveniosFiltrados = useMemo(() => {
    if (!tipoConvenioId) return lookups.convenios
    return lookups.convenios.filter((c) => c.tipo_convenio_id === tipoConvenioId)
  }, [lookups.convenios, tipoConvenioId])

  // Se o tipo mudar e o convênio escolhido não pertencer mais, limpa.
  useEffect(() => {
    if (convenioId && !conveniosFiltrados.some((c) => c.id === convenioId)) setConvenioId('')
  }, [conveniosFiltrados, convenioId])

  // Destinos possíveis = associações cujo formato bate com a DIMENSÃO da imagem.
  const destinosDisponiveis = useMemo(() => {
    if (!dim.w || !dim.h) return []
    return lookups.associacoes.filter((a) => a.largura_px === dim.w && a.altura_px === dim.h)
  }, [lookups.associacoes, dim.w, dim.h])

  // Agrupa por Grupo para o checklist.
  const destinosPorGrupo = useMemo(() => {
    const mapa = new Map<string, typeof destinosDisponiveis>()
    for (const a of destinosDisponiveis) {
      const arr = mapa.get(a.grupo_nome) || []
      arr.push(a)
      mapa.set(a.grupo_nome, arr)
    }
    return [...mapa.entries()].sort((x, y) => x[0].localeCompare(y[0]))
  }, [destinosDisponiveis])

  function toggleDestino(id: string) {
    setDestinos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  useEffect(() => {
    if (imagemPath && !imagemUrl) assinarImagemBase(imagemPath).then(setImagemUrl)
  }, [imagemPath, imagemUrl])

  async function onUpload(files: FileList | null) {
    if (!files?.[0] || subindo) return
    setSubindo(true)
    setErro('')
    try {
      // dimensões reais da imagem
      const dataUrl = await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.readAsDataURL(files[0])
      })
      const dims = await new Promise<{ w: number; h: number }>((res) => {
        const img = new Image()
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
        img.src = dataUrl
      })
      const fd = new FormData()
      fd.append('file', files[0])
      const up = await uploadImagemBase(fd)
      if (!up.success) throw new Error(up.error)
      setImagemPath(up.path)
      setImagemUrl(dataUrl)
      setDim(dims)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no upload.')
    } finally {
      setSubindo(false)
    }
  }

  function pctFromEvent(e: React.MouseEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    }
  }

  function onCanvasDown(e: React.MouseEvent) {
    if (e.target !== canvasRef.current && !(e.target as HTMLElement).dataset.canvasbg) return
    const p = pctFromEvent(e)
    const id = novoId()
    const novo: ArteElemento = { id, tipo: 'logo', x: p.x, y: p.y, w: 0, h: 0, proporcao: '1:1' }
    dragRef.current = { modo: 'novo', id, startX: p.x, startY: p.y, orig: novo }
    setElementos((prev) => [...prev, novo])
    setSelId(id)
  }

  function onCanvasMove(e: React.MouseEvent) {
    const d = dragRef.current
    if (!d) return
    const p = pctFromEvent(e)
    setElementos((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el
        if (d.modo === 'novo') {
          return { ...el, x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY) }
        }
        if (d.modo === 'mover') {
          return { ...el, x: Math.min(100 - el.w, Math.max(0, d.orig.x + (p.x - d.startX))), y: Math.min(100 - el.h, Math.max(0, d.orig.y + (p.y - d.startY))) }
        }
        // resize
        return { ...el, w: Math.min(100 - el.x, Math.max(2, d.orig.w + (p.x - d.startX))), h: Math.min(100 - el.y, Math.max(2, d.orig.h + (p.y - d.startY))) }
      }),
    )
  }

  function onCanvasUp() {
    const d = dragRef.current
    dragRef.current = null
    if (d?.modo === 'novo') {
      // descarta retângulos minúsculos (clique acidental)
      setElementos((prev) => prev.filter((el) => !(el.id === d.id && (el.w < 2 || el.h < 2))))
    }
  }

  function atualizarEl(id: string, patch: Partial<ArteElemento>) {
    setElementos((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)))
  }

  async function salvar() {
    if (salvando) return
    if (!nome.trim()) return setErro('Dê um nome à arte.')
    if (!imagemPath) return setErro('Envie a imagem-base.')
    setSalvando(true)
    setErro('')
    try {
      // Formato da arte = o cadastro cuja dimensão bate com a imagem (se houver).
      const formatoId = lookups.formatos.find((f) => f.largura_px === dim.w && f.altura_px === dim.h)?.id || null
      const res = await salvarArte({
        id: arte?.id,
        nome,
        descricao,
        imagem_url: imagemPath,
        largura_px: dim.w,
        altura_px: dim.h,
        convenio_id: convenioId || null,
        formato_id: formatoId,
        tipo_convenio_id: tipoConvenioId || null,
        associacao_ids: destinos,
        elementos,
      })
      if (!res.success) throw new Error(res.error)
      router.push('/marketing/artes')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const sel = elementos.find((e) => e.id === selId) || null
  const rotulo: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.25rem' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>{arte ? 'Editar Arte' : 'Nova Arte'}</h1>
        <button className="btn btn-outline btn-sm" onClick={() => router.push('/marketing/artes')}>Voltar</button>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={salvar} disabled={salvando}>
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar arte
        </button>
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {/* metadados */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.7rem' }}>
          <div><label style={rotulo}>Nome *</label><input className="form-control" value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div><label style={rotulo}>Tipo de Convênio</label>
            <select className="form-control" value={tipoConvenioId} onChange={(e) => setTipoConvenioId(e.target.value)}>
              <option value="">— Todos —</option>
              {lookups.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.esfera_nome ? ` (${t.esfera_nome})` : ''}</option>)}
            </select>
          </div>
          <div><label style={rotulo}>Convênio</label>
            <select className="form-control" value={convenioId} onChange={(e) => setConvenioId(e.target.value)}>
              <option value="">— Genérico —</option>
              {conveniosFiltrados.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label style={rotulo}>Descrição</label><input className="form-control" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0.6rem 0 0' }}>
          O <strong>Tipo de Convênio</strong> filtra os convênios abaixo: mostra “Genérico” + os convênios daquele tipo.
          Deixe “Genérico” quando a arte não for de um convênio específico.
        </p>
      </div>

      {/* destinos (grupo/categoria/formato) — filtrados pela dimensão da imagem */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>Destinos desta arte</strong>
          {dim.w > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>dimensão {dim.w}×{dim.h}px · {destinos.length} marcado(s)</span>}
        </div>
        {!dim.w ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', margin: 0 }}>Envie a imagem-base para escolher os destinos (as opções são filtradas pela dimensão da imagem).</p>
        ) : destinosDisponiveis.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--brs-danger)', margin: 0 }}>
            Nenhuma combinação cadastrada para {dim.w}×{dim.h}px. Cadastre em <strong>Biblioteca de Artes › Associações</strong> (ou confira o Formato dessa dimensão).
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0 0 0.6rem' }}>
              Marque todos os lugares que esta arte {dim.w}×{dim.h}px atende. Uma mesma arte pode servir vários grupos/categorias com a mesma dimensão.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {destinosPorGrupo.map(([grupo, itens]) => (
                <div key={grupo} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--brs-gray-700)', marginBottom: 6 }}>{grupo}</div>
                  {itens.map((a) => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '2px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={destinos.includes(a.id)} onChange={() => toggleDestino(a.id)} />
                      <span>{a.categoria_nome} <span style={{ color: 'var(--brs-gray-400)' }}>· {a.formato_rotulo}</span></span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1rem', alignItems: 'start' }}>
        {/* canvas */}
        <div className="card" style={{ padding: '0.8rem' }}>
          {!imagemUrl ? (
            <label style={{ display: 'block', border: '2px dashed var(--brs-gray-200)', borderRadius: 12, padding: '3rem', textAlign: 'center', cursor: 'pointer', color: 'var(--brs-gray-400)' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onUpload(e.target.files)} />
              {subindo ? <Loader2 size={24} className="animate-spin" /> : <><ImageIcon size={30} /><div style={{ marginTop: 8, fontWeight: 600 }}>Enviar imagem-base da arte</div></>}
            </label>
          ) : (
            <>
              <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', margin: '0 0 0.5rem' }}>
                Arraste sobre a imagem para marcar um elemento · {dim.w}×{dim.h}px · {elementos.length} elemento(s)
              </p>
              <div
                ref={canvasRef}
                data-canvasbg="1"
                onMouseDown={onCanvasDown}
                onMouseMove={onCanvasMove}
                onMouseUp={onCanvasUp}
                onMouseLeave={onCanvasUp}
                style={{
                  position: 'relative', width: '100%', aspectRatio: `${dim.w} / ${dim.h}`,
                  backgroundImage: `url(${imagemUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
                  borderRadius: 8, overflow: 'hidden', cursor: 'crosshair', userSelect: 'none',
                }}
              >
                {elementos.map((el) => (
                  <div
                    key={el.id}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      setSelId(el.id)
                      const p = pctFromEvent(e)
                      dragRef.current = { modo: 'mover', id: el.id, startX: p.x, startY: p.y, orig: { ...el } }
                    }}
                    style={{
                      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
                      border: `2px solid ${CORES_TIPO[el.tipo]}`, background: `${CORES_TIPO[el.tipo]}22`,
                      borderRadius: 3, cursor: 'move', boxSizing: 'border-box',
                      outline: selId === el.id ? `2px solid ${CORES_TIPO[el.tipo]}` : 'none', outlineOffset: 2,
                    }}
                  >
                    <span style={{ position: 'absolute', top: -18, left: -1, fontSize: 10, fontWeight: 800, color: '#fff', background: CORES_TIPO[el.tipo], borderRadius: 4, padding: '1px 5px', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                      {ICONE_TIPO[el.tipo]} {el.rotulo || el.tipo}
                    </span>
                    <span
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setSelId(el.id)
                        const p = pctFromEvent(e)
                        dragRef.current = { modo: 'resize', id: el.id, startX: p.x, startY: p.y, orig: { ...el } }
                      }}
                      style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: CORES_TIPO[el.tipo], borderRadius: '50%', cursor: 'nwse-resize', border: '2px solid #fff' }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* painel do elemento selecionado */}
        <div className="card" style={{ padding: '1rem', minHeight: 200 }}>
          {!sel ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--brs-gray-400)' }}>
              {imagemUrl ? 'Selecione um elemento (ou arraste na imagem para criar um).' : 'Envie a imagem-base para começar.'}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: '0.85rem' }}>Elemento</strong>
                <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} title="Remover" onClick={() => { setElementos((p) => p.filter((e) => e.id !== sel.id)); setSelId(null) }}>
                  <Trash2 size={15} style={{ color: 'var(--brs-danger)' }} />
                </button>
              </div>
              <div>
                <label style={rotulo}>Tipo</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                  {(['logo', 'texto', 'foto', 'whatsapp'] as const).map((t) => (
                    <button key={t} onClick={() => atualizarEl(sel.id, { tipo: t })}
                      className="btn btn-sm" style={{ background: sel.tipo === t ? CORES_TIPO[t] : 'var(--brs-gray-100)', color: sel.tipo === t ? '#fff' : 'var(--brs-gray-600)', border: 'none', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', fontSize: '0.72rem' }}>
                      {ICONE_TIPO[t]} {t}
                    </button>
                  ))}
                </div>
              </div>
              <div><label style={rotulo}>Rótulo (interno)</label><input className="form-control" value={sel.rotulo || ''} onChange={(e) => atualizarEl(sel.id, { rotulo: e.target.value })} placeholder={sel.tipo} /></div>

              {(sel.tipo === 'logo' || sel.tipo === 'foto') && (
                <div><label style={rotulo}>Proporção</label>
                  <select className="form-control" value={sel.proporcao || 'livre'} onChange={(e) => atualizarEl(sel.id, { proporcao: e.target.value })}>
                    <option value="livre">Livre</option><option value="1:1">1:1 (quadrado)</option>
                    <option value="16:9">16:9</option><option value="4:3">4:3</option><option value="3:4">3:4 (retrato)</option>
                  </select>
                </div>
              )}

              {sel.tipo === 'texto' && (
                <>
                  <div><label style={rotulo}>Máx. caracteres</label><input className="form-control" type="number" value={sel.maxChars ?? ''} onChange={(e) => atualizarEl(sel.id, { maxChars: Number(e.target.value) || undefined })} /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div><label style={rotulo}>Cor</label><input className="form-control" type="color" value={sel.cor || '#000000'} onChange={(e) => atualizarEl(sel.id, { cor: e.target.value })} style={{ height: 34, padding: 2 }} /></div>
                    <div><label style={rotulo}>Alinhamento</label>
                      <select className="form-control" value={sel.alinhamento || 'left'} onChange={(e) => atualizarEl(sel.id, { alinhamento: e.target.value as any })}>
                        <option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option>
                      </select>
                    </div>
                  </div>
                  <div><label style={rotulo}>Fonte (opcional)</label><input className="form-control" value={sel.fonte || ''} onChange={(e) => atualizarEl(sel.id, { fonte: e.target.value })} placeholder="ex.: Poppins" /></div>
                </>
              )}

              {sel.tipo === 'whatsapp' && (
                <div><label style={rotulo}>Modos permitidos</label>
                  {(['texto', 'qrcode'] as const).map((m) => (
                    <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
                      <input type="checkbox" checked={(sel.modoPermitido || ['texto', 'qrcode']).includes(m)}
                        onChange={(e) => {
                          const atual = sel.modoPermitido || ['texto', 'qrcode']
                          atualizarEl(sel.id, { modoPermitido: e.target.checked ? [...new Set([...atual, m])] : atual.filter((x) => x !== m) })
                        }} /> {m === 'texto' ? 'Número em texto' : 'QR Code'}
                    </label>
                  ))}
                </div>
              )}

              <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)', borderTop: '1px dashed var(--brs-gray-200)', paddingTop: 6 }}>
                Posição: {sel.x.toFixed(1)}%, {sel.y.toFixed(1)}% · Tamanho: {sel.w.toFixed(1)}% × {sel.h.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
