'use client'

/**
 * Nuvidio › Atendimento — a tela em que o atendente fica com o Workspace
 * aberto aguardando chamadas (Nuvidio é receptivo).
 *
 * Plano A: painel da Nuvidio EMBUTIDO via SSO transparente do atendente
 * (iframe). Plano B (se o iframe deles bloquear): botão que abre em nova
 * guia, já logado; a fila e a tabulação continuam aqui.
 *
 * Som: toque de TELEFONE FIXO ANTIGO (/notificacao-nuvidio.wav, sintetizado
 * — deliberadamente diferente do "chat" do Messenger) quando um convite
 * entra em chamada ou chega cliente na fila. Detecção via polling leve dos
 * convites (o webhook atualiza o banco; a tela observa).
 */
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Headset, Loader2, PhoneCall, Volume2 } from 'lucide-react'
import {
  abrirAtendimentoNuvidio,
  listarNuvidioConvites,
  tabularNuvidioConvite,
  type NuvidioConviteRow,
} from '@/lib/nuvidio/convites-actions'

export default function AtendimentoNuvidioPage() {
  const [ssoUrl, setSsoUrl] = useState<string | null>(null)
  const [ssoErro, setSsoErro] = useState('')
  const [carregandoSso, setCarregandoSso] = useState(true)
  const [fila, setFila] = useState<NuvidioConviteRow[]>([])
  const [somLiberado, setSomLiberado] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const emCursoAnteriorRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    abrirAtendimentoNuvidio()
      .then((res) => {
        if (res.success) setSsoUrl(res.url)
        else setSsoErro(res.error)
      })
      .catch(() => setSsoErro('Falha ao obter o acesso do atendente.'))
      .finally(() => setCarregandoSso(false))
  }, [])

  useEffect(() => {
    audioRef.current = new Audio('/notificacao-nuvidio.wav')
    audioRef.current.volume = 0.85
  }, [])

  async function carregarFila() {
    const res = await listarNuvidioConvites({})
    if (!res.success || !res.data) return
    const ativos = res.data.filter((r) => r.status === 'aguardando_chamada' || r.status === 'chamada_em_curso' || r.status === 'chamada_realizada')
    setFila(ativos)

    // toca o telefone quando um convite ENTRA em "chamada_em_curso"
    const emCursoAgora = new Set(ativos.filter((r) => r.status === 'chamada_em_curso').map((r) => r.id))
    const antes = emCursoAnteriorRef.current
    const temNovo = [...emCursoAgora].some((id) => !antes.has(id))
    emCursoAnteriorRef.current = emCursoAgora
    if (temNovo && audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    }
  }

  useEffect(() => {
    carregarFila()
    const t = window.setInterval(carregarFila, 10_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function tabular(id: string, status: 'aprovado' | 'reprovado' | 'aguardando_refazer') {
    await tabularNuvidioConvite({ conviteId: id, status })
    await carregarFila()
  }

  function liberarSom() {
    // navegadores exigem um gesto antes de tocar áudio — este botão "arma" o toque
    audioRef.current?.play().then(() => {
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.currentTime = 0
      setSomLiberado(true)
    }).catch(() => setSomLiberado(true))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 130px)', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Headset size={22} /> Nuvidio — Atendimento
        </h1>
        {!somLiberado && (
          <button className="btn btn-outline btn-sm" onClick={liberarSom} title="O navegador exige um clique antes de permitir som">
            <Volume2 size={14} /> Ativar toque de chamada
          </button>
        )}
        {ssoUrl && (
          <a className="btn btn-outline btn-sm" href={ssoUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
            <ExternalLink size={14} /> Abrir em nova guia
          </a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '0.8rem', flex: 1, minHeight: 0 }}>
        {/* painel Nuvidio embutido */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex' }}>
          {carregandoSso ? (
            <div style={{ margin: 'auto', color: 'var(--brs-gray-400)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Loader2 size={18} className="animate-spin" /> Conectando ao painel da Nuvidio…
            </div>
          ) : ssoUrl ? (
            <iframe
              src={ssoUrl}
              title="Atendimento Nuvidio"
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="camera; microphone; display-capture; autoplay"
            />
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--brs-gray-400)', padding: '2rem', maxWidth: 460 }}>
              <PhoneCall size={28} style={{ marginBottom: 8 }} />
              <p style={{ fontWeight: 700, color: 'var(--brs-gray-600)' }}>Painel embutido indisponível</p>
              <p style={{ fontSize: '0.82rem' }}>
                {ssoErro || 'O SSO do atendente não devolveu uma URL.'} Se a Nuvidio bloquear o iframe, use "Abrir em
                nova guia" — a fila e a tabulação continuam aqui do lado.
              </p>
            </div>
          )}
        </div>

        {/* fila + tabulação */}
        <div className="card" style={{ padding: '0.8rem', overflow: 'auto' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--brs-gray-400)', marginBottom: '0.6rem' }}>
            Fila ({fila.length})
          </div>
          {fila.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhuma chamada ativa. O telefone toca quando entrar. ☎️</div>}
          {fila.map((r) => (
            <div key={r.id} style={{ border: '1px solid var(--brs-gray-100)', borderLeft: `3px solid ${r.status === 'chamada_em_curso' ? '#d97706' : r.status === 'chamada_realizada' ? '#7c3aed' : '#0284c7'}`, borderRadius: 9, padding: '0.55rem 0.65rem', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{r.nome_cliente}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)' }}>
                {[r.proposta_numero && `Prop. ${r.proposta_numero}`, r.instituicao_nome, r.parceiro_nome].filter(Boolean).join(' · ')}
              </div>
              <div style={{ fontSize: '0.66rem', fontWeight: 700, marginTop: 3, color: r.status === 'chamada_em_curso' ? '#d97706' : r.status === 'chamada_realizada' ? '#7c3aed' : '#0284c7' }}>
                {r.status === 'chamada_em_curso' ? '📞 Em curso' : r.status === 'chamada_realizada' ? 'Realizada — tabule' : 'Aguardando'}
              </div>
              {(r.status === 'chamada_realizada' || r.status === 'chamada_em_curso') && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: '0.66rem', padding: '0.2rem 0.5rem', color: 'var(--brs-success)' }} onClick={() => tabular(r.id, 'aprovado')}>Aprovar</button>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: '0.66rem', padding: '0.2rem 0.5rem', color: 'var(--brs-danger)' }} onClick={() => tabular(r.id, 'reprovado')}>Reprovar</button>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: '0.66rem', padding: '0.2rem 0.5rem' }} onClick={() => tabular(r.id, 'aguardando_refazer')}>Refazer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
