'use client'

/**
 * Formulário "Novo Ticket" do HelpDesk — ÚNICO, usado pela página /helpdesk
 * (completo: sistema, URL e menu editáveis) e pelo botão flutuante
 * "Reportar problema" do Workspace (modo `rapido`: sistema fixo 'workspace',
 * tela e contexto técnico já capturados). Anexos: colar, escolher ou arrastar.
 */
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { abrirHelpdeskTicket } from '@/lib/helpdesk/actions'
import { useAnexosImagem } from '@/lib/helpdesk/useAnexosImagem'
import { NAV_DIVISOES } from '@/lib/nav/divisoes'
import {
  HELPDESK_MAX_ANEXOS,
  HELPDESK_PRIORIDADES,
  HELPDESK_SISTEMAS,
  HELPDESK_TIPOS,
  type HelpdeskContextoTecnico,
  type HelpdeskPrioridade,
  type HelpdeskSistema,
  type HelpdeskTipo,
} from '@/lib/helpdesk/tipos'

/** Áreas = itens do menu do Workspace (mesmo registro da sidebar). */
const AREAS = NAV_DIVISOES.map((d) => ({
  divisao: d.label,
  itens: d.itens.filter((i) => !i.soon && i.href.startsWith('/')).map((i) => `${d.label} › ${i.label}`),
}))

/** Área e caminho de menu da rota atual (match de prefixo mais longo). */
export function areaDaRota(pathname: string): { area: string; menu: string } {
  let melhor: { area: string; menu: string; tamanho: number } | null = null
  for (const d of NAV_DIVISOES) {
    for (const item of d.itens) {
      for (const sub of [null, ...(item.children || [])]) {
        const href = sub ? sub.href : item.href
        if (!href.startsWith('/')) continue
        const caminho = href.split('?')[0]
        if (pathname !== caminho && !pathname.startsWith(`${caminho}/`)) continue
        if (melhor && caminho.length <= melhor.tamanho) continue
        const area = `${d.label} › ${item.label}`
        melhor = { area, menu: sub ? `${area} › ${sub.label}` : area, tamanho: caminho.length }
      }
    }
  }
  return melhor ? { area: melhor.area, menu: melhor.menu } : { area: '', menu: '' }
}

const LBL = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block' } as const

type Props = {
  onFechar: () => void
  onCriado?: (id: string) => void
  /** Botão flutuante: sistema fixo 'workspace' e tela/contexto capturados. */
  rapido?: { contexto: HelpdeskContextoTecnico; menu: string; area: string }
}

export default function NovoTicketModal({ onFechar, onCriado, rapido }: Props) {
  const [f, setF] = useState({
    titulo: '',
    tipo: '' as HelpdeskTipo | '',
    prioridade: 'atrapalha' as HelpdeskPrioridade,
    area: rapido?.area || '',
    esperado: '',
    aconteceu: '',
    descricao: '',
    sistema: (rapido ? 'workspace' : '') as HelpdeskSistema | '',
    url: rapido?.contexto.url || '',
    menu_contexto: rapido?.menu || '',
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0) // dragenter/dragleave disparam por filho
  const anexos = useAnexosImagem()
  const set = (patch: Partial<typeof f>) => setF((atual) => ({ ...atual, ...patch }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !salvando && onFechar()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar, salvando])

  function montarDescricao() {
    if (f.tipo !== 'bug') return f.descricao.trim()
    return [
      ['O que você esperava', f.esperado],
      ['O que aconteceu', f.aconteceu],
      ['Detalhes / passos', f.descricao],
    ]
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}:\n${v.trim()}`)
      .join('\n\n')
  }

  async function enviar() {
    if (salvando) return
    const descricao = montarDescricao()
    if (!f.tipo) return setErro('Escolha o tipo.')
    if (!f.titulo.trim()) return setErro('Dê um título ao ticket.')
    if (f.tipo === 'bug' && !f.aconteceu.trim()) return setErro('Conte o que aconteceu.')
    if (!descricao) return setErro('Descreva o problema ou pedido.')
    if (!f.sistema) return setErro('Escolha o sistema.')
    if (anexos.enviando) return setErro('Aguarde o envio das imagens.')
    if (anexos.comErro) return setErro('Remova as imagens que falharam antes de abrir o ticket.')
    setSalvando(true)
    setErro('')
    try {
      const res = await abrirHelpdeskTicket({
        titulo: f.titulo,
        descricao,
        url: f.url,
        menu_contexto: f.menu_contexto,
        sistema: f.sistema,
        tipo: f.tipo,
        area: f.area,
        prioridade: f.prioridade,
        contexto_tecnico: rapido?.contexto,
        anexos: anexos.prontos,
      })
      if (!res.success) throw new Error(res.error)
      onCriado?.(res.id || '')
      onFechar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao abrir ticket.')
    } finally {
      setSalvando(false)
    }
  }

  const opcao = (ativo: boolean) =>
    ({
      border: `2px solid ${ativo ? 'var(--brs-navy)' : 'var(--brs-gray-200)'}`,
      background: ativo ? 'var(--brs-gray-100)' : 'transparent',
      borderRadius: 10,
      cursor: 'pointer',
      color: 'inherit',
    }) as const

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        profundidade.current++
        setArrastando(true)
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={() => {
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (!profundidade.current) setArrastando(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        profundidade.current = 0
        setArrastando(false)
        anexos.adicionar(e.dataTransfer.files)
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="helpdesk-novo-titulo"
        className="card"
        onPaste={anexos.onPaste}
        style={{ width: 'min(600px, 100%)', maxHeight: '90dvh', overflow: 'auto', padding: '1.1rem', outline: arrastando ? '3px dashed var(--brs-navy)' : 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
          <strong id="helpdesk-novo-titulo">{rapido ? 'Reportar problema' : 'Novo Ticket'}</strong>
          <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
        </div>

        <span style={LBL} id="helpdesk-tipo-lbl">Tipo *</span>
        <div role="group" aria-labelledby="helpdesk-tipo-lbl" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', margin: '0.3rem 0 0.9rem' }}>
          {HELPDESK_TIPOS.map((t) => (
            <button key={t.id} type="button" aria-pressed={f.tipo === t.id} onClick={() => set({ tipo: t.id })} style={{ ...opcao(f.tipo === t.id), padding: '0.65rem 0.4rem', fontWeight: 700, fontSize: '0.85rem' }}>
              <span aria-hidden style={{ fontSize: '1.4rem', display: 'block' }}>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>

        <label style={LBL} htmlFor="helpdesk-titulo">Título *</label>
        <input id="helpdesk-titulo" autoFocus className="form-control" maxLength={200} value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Resumo curto do problema ou pedido" style={{ margin: '0.25rem 0 0.8rem' }} />

        {f.tipo === 'bug' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.7rem', marginBottom: '0.8rem' }}>
            <div>
              <label style={LBL} htmlFor="helpdesk-esperado">O que você esperava</label>
              <textarea id="helpdesk-esperado" className="form-control" rows={3} value={f.esperado} onChange={(e) => set({ esperado: e.target.value })} style={{ marginTop: '0.25rem' }} />
            </div>
            <div>
              <label style={LBL} htmlFor="helpdesk-aconteceu">O que aconteceu *</label>
              <textarea id="helpdesk-aconteceu" className="form-control" rows={3} value={f.aconteceu} onChange={(e) => set({ aconteceu: e.target.value })} style={{ marginTop: '0.25rem' }} />
            </div>
          </div>
        )}

        <label style={LBL} htmlFor="helpdesk-descricao">{f.tipo === 'bug' ? 'Detalhes / passos para reproduzir' : 'Descrição *'}</label>
        <textarea
          id="helpdesk-descricao"
          className="form-control"
          rows={4}
          value={f.descricao}
          onChange={(e) => set({ descricao: e.target.value })}
          placeholder="Dica: cole um print aqui com Ctrl+V"
          style={{ margin: '0.25rem 0 0.6rem' }}
        />

        {/* anexos */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          {anexos.anexos.map((a) => (
            <div key={a.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: `2px solid ${a.status === 'erro' ? 'var(--brs-danger)' : 'var(--brs-gray-200)'}` }} title={a.erro || a.nome}>
              {/* eslint-disable-next-line @next/next/no-img-element -- object URL local */}
              <img src={a.preview} alt={a.nome} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: a.status === 'ok' ? 1 : 0.5 }} />
              {a.status === 'enviando' && <Loader2 size={18} className="animate-spin" aria-label="Enviando" style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}
              {a.status === 'erro' && <span role="alert" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: '0.6rem', fontWeight: 700, background: 'var(--brs-danger)', color: '#fff', textAlign: 'center' }}>falhou</span>}
              <button type="button" onClick={() => anexos.remover(a.id)} aria-label={`Remover ${a.nome}`} style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.65)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <X size={12} />
              </button>
            </div>
          ))}
          {anexos.anexos.length < HELPDESK_MAX_ANEXOS && (
            <label className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
              <ImagePlus size={15} /> Anexar imagem
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { anexos.adicionar(e.target.files); e.target.value = '' }} />
            </label>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>
            até {HELPDESK_MAX_ANEXOS} imagens · cole (Ctrl+V) ou arraste aqui
          </span>
          {anexos.aviso && <span role="status" style={{ fontSize: '0.72rem', color: 'var(--brs-danger)', width: '100%' }}>{anexos.aviso}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.7rem', marginBottom: '0.8rem' }}>
          <div>
            <label style={LBL} htmlFor="helpdesk-area">Área</label>
            <select id="helpdesk-area" className="form-control" value={f.area} onChange={(e) => set({ area: e.target.value })} style={{ marginTop: '0.25rem' }}>
              <option value="">— Escolha —</option>
              {AREAS.map((g) => (
                <optgroup key={g.divisao} label={g.divisao}>
                  {g.itens.map((a) => <option key={a} value={a}>{a.split(' › ')[1]}</option>)}
                </optgroup>
              ))}
              <option value="Outro">Outro</option>
            </select>
          </div>
          {!rapido && (
            <div>
              <label style={LBL} htmlFor="helpdesk-sistema">Sistema *</label>
              <select id="helpdesk-sistema" className="form-control" value={f.sistema} onChange={(e) => set({ sistema: e.target.value as HelpdeskSistema })} style={{ marginTop: '0.25rem' }}>
                <option value="">— Escolha —</option>
                {HELPDESK_SISTEMAS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <span style={LBL} id="helpdesk-prioridade-lbl">Prioridade *</span>
        <div role="group" aria-labelledby="helpdesk-prioridade-lbl" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.3rem 0 0.8rem' }}>
          {HELPDESK_PRIORIDADES.map((p) => (
            <button key={p.id} type="button" aria-pressed={f.prioridade === p.id} onClick={() => set({ prioridade: p.id })} style={{ ...opcao(f.prioridade === p.id), padding: '0.45rem 0.8rem', fontWeight: 700, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: p.cor }} />
              {p.label}
            </button>
          ))}
        </div>

        {rapido ? (
          <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
            Tela: {f.menu_contexto || rapido.contexto.pathname} — o endereço e os dados do navegador vão junto para ajudar a investigar.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.7rem' }}>
            <div>
              <label style={LBL} htmlFor="helpdesk-menu">Menu / contexto</label>
              <input id="helpdesk-menu" className="form-control" maxLength={200} value={f.menu_contexto} onChange={(e) => set({ menu_contexto: e.target.value })} placeholder="Ex.: Configurações → Usuários" style={{ marginTop: '0.25rem' }} />
            </div>
            <div>
              <label style={LBL} htmlFor="helpdesk-url">URL da tela</label>
              <input id="helpdesk-url" className="form-control" maxLength={500} value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" style={{ marginTop: '0.25rem' }} />
            </div>
          </div>
        )}

        {erro && <div role="alert" style={{ marginTop: '0.8rem', color: 'var(--brs-danger)', fontWeight: 600, fontSize: '0.82rem' }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={salvando || anexos.enviando}>
            {salvando ? 'Abrindo…' : anexos.enviando ? 'Enviando imagens…' : 'Abrir Ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}
