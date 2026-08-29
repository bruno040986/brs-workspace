'use client'

import { useState } from 'react'
import { BadgeCheck, Globe, Loader2, Lock } from 'lucide-react'
import { conectar360dialog, criarChatDeSite } from '@/lib/central-conversas/actions'

/** Glifos de marca (o lucide não distribui logos). */
function Instagram({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}
function Facebook({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.3V14h2.8v8h3.4Z" />
    </svg>
  )
}

type View = Awaited<ReturnType<typeof import('@/lib/central-conversas/actions').getCentralConversasView>>

export default function CanaisClient({ view }: { view: View }) {
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [d360, setD360] = useState({ nome: 'WhatsApp Oficial', telefone: '', apiKey: '' })
  const [site, setSite] = useState({ nome: 'Chat do site', siteUrl: 'https://brspromotora.com.br' })
  const [snippet, setSnippet] = useState<string | null>(null)

  const inboxWhats = view.inboxes.filter((i) => i.channel_type === 'Channel::Whatsapp')
  const inboxSite = view.inboxes.filter((i) => i.channel_type === 'Channel::WebWidget')

  async function salvar360(e: React.FormEvent) {
    e.preventDefault()
    setBusy('360')
    setMensagem(null)
    try {
      await conectar360dialog(d360)
      setMensagem({ tipo: 'ok', texto: 'Número oficial conectado via 360dialog. As mensagens já caem no Chatwoot.' })
      setD360({ ...d360, apiKey: '' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Falha ao conectar.' })
    } finally {
      setBusy(null)
    }
  }

  async function criarSite(e: React.FormEvent) {
    e.preventDefault()
    setBusy('site')
    setMensagem(null)
    try {
      const r = await criarChatDeSite(site)
      setSnippet(
        `<script>\n  (function(d,t){var BASE_URL="${view.chatwootUrl}";var g=d.createElement(t),s=d.getElementsByTagName(t)[0];g.src=BASE_URL+"/packs/js/sdk.js";g.defer=true;g.async=true;s.parentNode.insertBefore(g,s);g.onload=function(){window.chatwootSDK.run({websiteToken:"${r.websiteToken}",baseUrl:BASE_URL})}})(document,"script");\n</script>`,
      )
      setMensagem({ tipo: 'ok', texto: 'Chat do site criado. Cole o script abaixo antes do </body> do site.' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Falha ao criar.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Canais</h1>
          <p className="page-subtitle">Outros canais que entram na mesma Central de Conversas, direto pelo Chatwoot.</p>
        </div>
      </div>

      {mensagem && <div className={`alert ${mensagem.tipo === 'ok' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1rem' }}>{mensagem.texto}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        {/* WhatsApp oficial — 360dialog */}
        <section className="card" style={{ padding: '1.25rem' }}>
          <Cabecalho icone={<BadgeCheck size={20} />} titulo="WhatsApp Oficial (360dialog)" sub="Número principal divulgado — API oficial da Meta pela conta 360dialog da BRS. Sem grupos (limitação da API oficial)." />
          {inboxWhats.length > 0 && (
            <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>
              Conectado: {inboxWhats.map((i) => `${i.name}${i.phone_number ? ` (${i.phone_number})` : ''}`).join(', ')}
            </div>
          )}
          {view.can_edit && view.conta && (
            <form onSubmit={salvar360} style={{ display: 'grid', gap: '0.6rem', marginTop: '0.75rem' }}>
              <label className="form-field"><span className="form-label">Nome da caixa</span><input className="form-input" value={d360.nome} onChange={(e) => setD360({ ...d360, nome: e.target.value })} /></label>
              <label className="form-field"><span className="form-label">Número (DDI+DDD+número, só dígitos)</span><input className="form-input" required placeholder="5511999999999" value={d360.telefone} onChange={(e) => setD360({ ...d360, telefone: e.target.value })} /></label>
              <label className="form-field"><span className="form-label">API key da 360dialog</span><input className="form-input" required type="password" value={d360.apiKey} onChange={(e) => setD360({ ...d360, apiKey: e.target.value })} /></label>
              <button type="submit" className="btn btn-primary" disabled={busy === '360'}>{busy === '360' ? <Loader2 size={16} className="spinner" /> : <BadgeCheck size={16} />} Conectar número oficial</button>
            </form>
          )}
        </section>

        {/* Chat do site */}
        <section className="card" style={{ padding: '1.25rem' }}>
          <Cabecalho icone={<Globe size={20} />} titulo="Chat do site" sub="Widget de conversa no site institucional / landing pages. Gera um script pra colar na página." />
          {inboxSite.length > 0 && <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>Ativo: {inboxSite.map((i) => i.name).join(', ')}</div>}
          {view.can_edit && view.conta && (
            <form onSubmit={criarSite} style={{ display: 'grid', gap: '0.6rem', marginTop: '0.75rem' }}>
              <label className="form-field"><span className="form-label">Nome</span><input className="form-input" value={site.nome} onChange={(e) => setSite({ ...site, nome: e.target.value })} /></label>
              <label className="form-field"><span className="form-label">URL do site</span><input className="form-input" required value={site.siteUrl} onChange={(e) => setSite({ ...site, siteUrl: e.target.value })} /></label>
              <button type="submit" className="btn btn-primary" disabled={busy === 'site'}>{busy === 'site' ? <Loader2 size={16} className="spinner" /> : <Globe size={16} />} Gerar script do widget</button>
            </form>
          )}
          {snippet && <pre style={{ marginTop: '0.75rem', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--color-surface-sunken)', padding: '0.75rem', borderRadius: 8 }}>{snippet}</pre>}
        </section>

        {/* Instagram / Messenger — aguardam app da Meta */}
        {[
          { icone: <Instagram size={20} />, titulo: 'Instagram DM', sub: 'Mensagens diretas do perfil profissional da BRS.' },
          { icone: <Facebook size={20} />, titulo: 'Facebook Messenger', sub: 'Mensagens da Página da BRS.' },
        ].map((c) => (
          <section key={c.titulo} className="card" style={{ padding: '1.25rem', opacity: 0.75 }}>
            <Cabecalho icone={c.icone} titulo={c.titulo} sub={c.sub} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem', fontSize: 13, color: 'var(--color-ink-muted)' }}>
              <Lock size={16} /> Depende do app da BRS na Meta (Business Verification + App Review). Quando aprovado, o botão “Conectar com Facebook” aparece aqui.
            </div>
          </section>
        ))}
      </div>

      <p style={{ marginTop: '1.25rem', fontSize: 12, color: 'var(--color-ink-subtle)' }}>
        Precisa de algo além disso (e-mail, Telegram, SMS)? O Chatwoot suporta nativamente — configure em <a href={`${view.chatwootUrl}/app/accounts/${view.conta?.chatwootAccountId || 1}/settings/inboxes/new`} target="_blank" rel="noreferrer">{view.chatwootUrl}</a> que aparece aqui.
      </p>
    </div>
  )
}

function Cabecalho({ icone, titulo, sub }: { icone: React.ReactNode; titulo: string; sub: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(233,5,65,.10)', color: 'var(--color-primary)', flexShrink: 0 }}>{icone}</span>
      <div>
        <div style={{ fontWeight: 700 }}>{titulo}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-ink-subtle)' }}>{sub}</div>
      </div>
    </div>
  )
}
