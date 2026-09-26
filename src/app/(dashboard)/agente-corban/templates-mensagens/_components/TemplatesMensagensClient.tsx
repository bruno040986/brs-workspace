'use client'

/**
 * Agente Corban › Templates de Mensagens (fatia 5, 26/09/2026).
 * Lista à esquerda (por grupo); à direita, abas E-mail (editor rico) e
 * WhatsApp (só negrito/itálico/tachado/emoji), variáveis clicáveis,
 * pré-visualização com dados de exemplo, salvar (gera versão), restaurar o
 * padrão e histórico. Texto nunca mais fica no código.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bold, CheckCircle, History, Italic, Loader2, RotateCcw, Save, Strikethrough, X } from 'lucide-react'
import RichTextEditor, { type RichTextHandle } from '@/components/mensagens/RichTextEditor'
import EmojiPicker from '@/app/(dashboard)/rh/parceiros/config/_components/EmojiPicker'
import type { TemplateResolvido } from '@/lib/mensagens/templates'
import { listarVersoesTemplate, previewTemplate, restaurarTemplatePadrao, salvarTemplateMensagem, type VersaoTemplate } from '../actions'

type Mensagem = { type: 'success' | 'error'; text: string }
type Rascunho = { email_assunto: string; email_html: string; whatsapp_texto: string }

function Toast({ mensagem, onClose }: { mensagem: Mensagem | null; onClose: () => void }) {
  useEffect(() => {
    if (!mensagem) return
    const t = window.setTimeout(onClose, mensagem.type === 'error' ? 12000 : 5000)
    return () => window.clearTimeout(t)
  }, [mensagem, onClose])
  if (!mensagem) return null
  const ok = mensagem.type === 'success'
  return (
    <div role="status" style={{ position: 'fixed', top: 16, right: 16, zIndex: 1100, maxWidth: 460, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '0.8rem 1rem', borderRadius: 10, border: `1px solid ${ok ? '#A7F3D0' : '#FECACA'}`, background: ok ? '#ECFDF5' : '#FEF2F2', color: ok ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
      {ok ? <CheckCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
      <span style={{ flex: 1, fontSize: '0.85rem', whiteSpace: 'pre-line' }}>{mensagem.text}</span>
      <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  )
}

/** Textarea do WhatsApp com a marcação nativa do app: *negrito*, _itálico_, ~tachado~ e emoji. */
function WhatsAppEditor({ value, onChange, onReady }: { value: string; onChange: (v: string) => void; onReady: (insert: (t: string) => void) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const envolver = useCallback(
    (marca: string) => {
      const el = ref.current
      if (!el) return
      const { selectionStart: a, selectionEnd: b } = el
      const sel = value.slice(a, b) || 'texto'
      const novo = `${value.slice(0, a)}${marca}${sel}${marca}${value.slice(b)}`
      onChange(novo)
      window.setTimeout(() => { el.focus(); el.setSelectionRange(a + marca.length, a + marca.length + sel.length) }, 0)
    },
    [value, onChange],
  )
  const inserir = useCallback(
    (t: string) => {
      const el = ref.current
      if (!el) { onChange(value + t); return }
      const { selectionStart: a, selectionEnd: b } = el
      onChange(`${value.slice(0, a)}${t}${value.slice(b)}`)
      window.setTimeout(() => { el.focus(); el.setSelectionRange(a + t.length, a + t.length) }, 0)
    },
    [value, onChange],
  )
  useEffect(() => onReady(inserir), [inserir, onReady])
  const B = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" className="btn btn-outline btn-sm" title={title} onClick={onClick}>{children}</button>
  )
  return (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <B title="Negrito (*texto*)" onClick={() => envolver('*')}><Bold size={14} /></B>
        <B title="Itálico (_texto_)" onClick={() => envolver('_')}><Italic size={14} /></B>
        <B title="Tachado (~texto~)" onClick={() => envolver('~')}><Strikethrough size={14} /></B>
        <EmojiPicker onPick={inserir} />
        <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>O WhatsApp só aceita negrito, itálico, tachado e emoji. Links entram como texto.</span>
      </div>
      <textarea ref={ref} className="form-control" rows={10} value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1.5 }} />
    </div>
  )
}

export default function TemplatesMensagensClient({ templates: iniciais, podeEditar }: { templates: TemplateResolvido[]; podeEditar: boolean }) {
  const [templates, setTemplates] = useState(iniciais)
  const [chave, setChave] = useState(iniciais[0]?.chave || '')
  const atual = useMemo(() => templates.find((t) => t.chave === chave) || null, [templates, chave])
  const [aba, setAba] = useState<'email' | 'whatsapp'>('email')
  const [rascunho, setRascunho] = useState<Rascunho>({ email_assunto: '', email_html: '', whatsapp_texto: '' })
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)
  const fecharMensagem = useCallback(() => setMensagem(null), [])
  const [salvando, setSalvando] = useState(false)
  const [preview, setPreview] = useState<{ assunto: string; html: string; texto: string } | null>(null)
  const [versoes, setVersoes] = useState<VersaoTemplate[] | null>(null)
  const rteRef = useRef<RichTextHandle | null>(null)
  const waInsert = useRef<((t: string) => void) | null>(null)

  useEffect(() => {
    if (!atual) return
    setRascunho({ email_assunto: atual.email_assunto, email_html: atual.email_html, whatsapp_texto: atual.whatsapp_texto })
    setAba(atual.canais.includes('email') ? 'email' : 'whatsapp')
    setPreview(null)
    setVersoes(null)
  }, [atual])

  const alterado = !!atual && (rascunho.email_assunto !== atual.email_assunto || rascunho.email_html !== atual.email_html || rascunho.whatsapp_texto !== atual.whatsapp_texto)

  function inserirVariavel(v: string) {
    const token = `{{${v}}}`
    if (aba === 'email') rteRef.current?.insertText(token)
    else waInsert.current?.(token)
  }

  async function recarregar(chaveSel: string) {
    // As actions revalidam a rota; aqui basta refletir o que foi salvo no estado local.
    setTemplates((prev) => prev.map((t) => (t.chave === chaveSel ? { ...t, ...rascunho, personalizado: true } : t)))
  }

  async function salvar() {
    if (!atual || salvando) return
    setSalvando(true)
    try {
      const r = await salvarTemplateMensagem({ chave: atual.chave, ...rascunho })
      if (!r.success) { setMensagem({ type: 'error', text: r.error }); return }
      await recarregar(atual.chave)
      setTemplates((prev) => prev.map((t) => (t.chave === atual.chave ? { ...t, versao: r.versao } : t)))
      setMensagem({ type: 'success', text: `Salvo como versão ${r.versao}.${r.avisos.length ? `\n${r.avisos.join('\n')}` : ''}` })
    } finally {
      setSalvando(false)
    }
  }

  async function restaurar() {
    if (!atual || salvando) return
    if (!window.confirm('Voltar ao texto padrão? A personalização atual vai para o histórico.')) return
    setSalvando(true)
    try {
      const r = await restaurarTemplatePadrao(atual.chave)
      if (!r.success) { setMensagem({ type: 'error', text: r.error }); return }
      window.location.reload()
    } finally {
      setSalvando(false)
    }
  }

  async function verPreview() {
    if (!atual) return
    const r = await previewTemplate({ chave: atual.chave, ...rascunho })
    if (!r.success) { setMensagem({ type: 'error', text: r.error }); return }
    setPreview({ assunto: r.assunto, html: r.html, texto: r.texto })
  }

  async function verHistorico() {
    if (!atual) return
    const r = await listarVersoesTemplate(atual.chave)
    if (!r.success) { setMensagem({ type: 'error', text: r.error }); return }
    setVersoes(r.versoes)
  }

  const grupos = useMemo(() => {
    const m = new Map<string, TemplateResolvido[]>()
    for (const t of templates) m.set(t.grupo, [...(m.get(t.grupo) || []), t])
    return [...m.entries()]
  }, [templates])

  return (
    <div className="page-content">
      <Toast mensagem={mensagem} onClose={fecharMensagem} />
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>Templates de Mensagens</h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
          Cada mensagem que o sistema manda ao parceiro, por e-mail e WhatsApp. Clique numa variável para inseri-la onde o cursor está. Sem personalização, vale o texto padrão.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div className="card" style={{ padding: '0.75rem' }}>
          {grupos.map(([grupo, lista]) => (
            <div key={grupo} style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--brs-gray-500)', margin: '0.25rem 0.4rem' }}>{grupo}</div>
              {lista.map((t) => (
                <button
                  key={t.chave}
                  type="button"
                  onClick={() => setChave(t.chave)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.6rem', borderRadius: 8, border: 'none', cursor: 'pointer', background: t.chave === chave ? 'var(--brs-navy)' : 'transparent', color: t.chave === chave ? '#fff' : 'var(--brs-gray-800)' }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t.nome}</div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                    {t.canais.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(' + ')}
                    {t.por_envolvido ? ' · por envolvido' : ''}
                    {t.personalizado ? ` · v${t.versao}` : ' · padrão'}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {atual && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{atual.nome}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)', marginTop: 2 }}>{atual.descricao}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', marginTop: 4 }}>
                {atual.personalizado ? `Personalizado · versão ${atual.versao}${atual.updated_by_nome ? ` por ${atual.updated_by_nome}` : ''}${atual.updated_at ? ` em ${new Date(atual.updated_at).toLocaleString('pt-BR')}` : ''}` : 'Texto padrão (nunca personalizado)'}
              </div>

              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>Variáveis:</span>
                {atual.variaveis.map((v) => (
                  <button key={v.chave} type="button" className="btn btn-outline btn-sm" title={`${v.descricao}${v.lista ? ' (lista)' : ''}`} onClick={() => inserirVariavel(v.chave)} disabled={!podeEditar}>
                    {`{{${v.chave}}}`}
                  </button>
                ))}
                {atual.variaveis.some((v) => v.chave === 'codigo_arw') && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>Bloco condicional: {'{{#codigo_arw}}...{{/codigo_arw}}'} só aparece se houver código.</span>
                )}
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                {atual.canais.includes('email') && (
                  <button type="button" className="btn btn-sm" onClick={() => setAba('email')} style={{ background: aba === 'email' ? 'var(--brs-navy)' : 'var(--brs-gray-100)', color: aba === 'email' ? '#fff' : 'var(--brs-gray-600)', border: 'none' }}>E-mail</button>
                )}
                {atual.canais.includes('whatsapp') && (
                  <button type="button" className="btn btn-sm" onClick={() => setAba('whatsapp')} style={{ background: aba === 'whatsapp' ? 'var(--brs-navy)' : 'var(--brs-gray-100)', color: aba === 'whatsapp' ? '#fff' : 'var(--brs-gray-600)', border: 'none' }}>WhatsApp</button>
                )}
              </div>

              {aba === 'email' ? (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <div>
                    <label className="form-label">Assunto</label>
                    <input className="form-control" value={rascunho.email_assunto} onChange={(e) => setRascunho((r) => ({ ...r, email_assunto: e.target.value }))} disabled={!podeEditar} />
                  </div>
                  <div style={{ minHeight: 320, display: 'flex', flexDirection: 'column' }}>
                    <label className="form-label">Corpo do e-mail</label>
                    <RichTextEditor key={atual.chave} value={rascunho.email_html} onChange={(html) => setRascunho((r) => ({ ...r, email_html: html }))} onReady={(h) => { rteRef.current = h }} />
                  </div>
                </div>
              ) : (
                <WhatsAppEditor key={atual.chave} value={rascunho.whatsapp_texto} onChange={(v) => setRascunho((r) => ({ ...r, whatsapp_texto: v }))} onReady={(f) => { waInsert.current = f }} />
              )}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                {podeEditar && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={salvando || !alterado} onClick={salvar}>
                    {salvando ? <Loader2 size={14} className="spinner" /> : <Save size={14} />} Salvar (gera versão)
                  </button>
                )}
                <button type="button" className="btn btn-outline btn-sm" onClick={verPreview}>Pré-visualizar com dados de exemplo</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={verHistorico}><History size={14} /> Histórico</button>
                {podeEditar && atual.personalizado && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={salvando} onClick={restaurar}><RotateCcw size={14} /> Restaurar padrão</button>
                )}
              </div>
            </div>

            {preview && (
              <div className="card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.75rem' }}>
                <div style={{ fontWeight: 700 }}>Pré-visualização (dados de exemplo)</div>
                {atual.canais.includes('email') && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase' }}>E-mail · assunto: <span style={{ textTransform: 'none', color: 'var(--brs-gray-800)' }}>{preview.assunto}</span></div>
                    {/* Prévia isolada: iframe com sandbox vazio (sem script, sem mesma origem) — HTML gravado por
                        outro editor nunca roda nesta página. O servidor também recusa script/eventos ao salvar. */}
                    <iframe
                      title="Pré-visualização do e-mail"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#1f2937;margin:12px 16px}</style></head><body>${preview.html}</body></html>`}
                      style={{ width: '100%', minHeight: 260, border: '1px solid var(--brs-gray-200)', borderRadius: 8, marginTop: 4, background: '#fff' }}
                    />
                  </div>
                )}
                {atual.canais.includes('whatsapp') && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-500)', textTransform: 'uppercase' }}>WhatsApp</div>
                    <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: '#e7f8ef', borderRadius: 8, padding: '0.75rem 1rem', marginTop: 4, fontSize: '0.9rem' }}>{preview.texto}</pre>
                  </div>
                )}
              </div>
            )}

            {versoes && (
              <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Histórico de versões</div>
                {versoes.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Nunca personalizado.</div>
                ) : (
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {versoes.map((v) => (
                      <div key={v.versao} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.82rem', flexWrap: 'wrap' }}>
                        <span className="badge badge-navy">v{v.versao}</span>
                        <span style={{ color: 'var(--brs-gray-500)' }}>{new Date(v.created_at).toLocaleString('pt-BR')}{v.autor ? ` · ${v.autor}` : ''}</span>
                        <span style={{ color: 'var(--brs-gray-700)' }}>{v.email_assunto === null && v.whatsapp_texto === null ? 'restaurou o padrão' : v.email_assunto || ''}</span>
                        {podeEditar && v.email_assunto !== null && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRascunho({ email_assunto: v.email_assunto || '', email_html: v.email_html || '', whatsapp_texto: v.whatsapp_texto || '' })}>
                            Carregar no editor
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
