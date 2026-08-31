'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Maximize2 } from 'lucide-react'
import { observarFullpageAberta } from '@/lib/messenger/fullpage-channel'
import { useAtendimento } from './useAtendimento'
import ListaConversas from './ListaConversas'
import ThreadConversa from './ThreadConversa'
import PainelContato from './PainelContato'

function nomeDoCanal(inboxId: number | undefined, canais: { inboxes: Array<{ id: number; nome: string }>; instancias: Array<{ id: string; nome: string; inboxId: number | null }> }) {
  if (!inboxId) return null
  const instancia = canais.instancias.find((i) => i.inboxId === inboxId)
  if (instancia) return instancia.nome
  return canais.inboxes.find((i) => i.id === inboxId)?.nome || null
}

/**
 * Aba Atendimento do dock (MessengerDockTabs): uma coluna com push
 * lista→thread; painel do contato vira gaveta que desliza por cima
 * (botão ⓘ no cabeçalho da thread). Quando `/conversas` está aberta em
 * outra aba, suprime toasts/sons locais de novas mensagens (mantém badge).
 */
export default function AtendimentoCompacto() {
  const at = useAtendimento()
  const [painelAberto, setPainelAberto] = useState(false)
  const suprimirRef = useRef(false)
  const naoLidasRef = useRef<Record<number, number>>({})
  const inicializadoRef = useRef(false)
  const [toasts, setToasts] = useState<Array<{ id: string; texto: string }>>([])

  useEffect(
    () =>
      observarFullpageAberta((aberta) => {
        suprimirRef.current = aberta
      }),
    [],
  )

  // Fecha a gaveta do painel ao trocar/desmarcar a conversa selecionada —
  // "ajustar estado quando uma prop muda" durante o render (padrão oficial do
  // React), em vez de um useEffect com setState direto no corpo.
  const [ultimaConversaId, setUltimaConversaId] = useState<number | null>(null)
  const conversaAtualId = at.selecionada?.id ?? null
  if (conversaAtualId !== ultimaConversaId) {
    setUltimaConversaId(conversaAtualId)
    if (painelAberto) setPainelAberto(false)
  }

  // Toast local de "nova mensagem" pro dock — só quando /conversas não está
  // aberta em outra aba (BroadcastChannel acima); o badge de não lidas do
  // dock em si continua vindo do polling normal, sem depender disso.
  useEffect(() => {
    void (async () => {
      const anteriores = naoLidasRef.current
      const atuais: Record<number, number> = {}
      const nomesComNovaMensagem: string[] = []
      for (const c of at.conversas) {
        atuais[c.id] = c.unread_count
        if (inicializadoRef.current && c.unread_count > (anteriores[c.id] || 0)) {
          nomesComNovaMensagem.push(c.meta.sender?.name || 'Contato')
        }
      }
      naoLidasRef.current = atuais
      inicializadoRef.current = true
      if (!suprimirRef.current && nomesComNovaMensagem.length > 0) {
        const texto = nomesComNovaMensagem.length === 1 ? `${nomesComNovaMensagem[0]} enviou uma mensagem.` : `${nomesComNovaMensagem.length} conversas com novas mensagens.`
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        setToasts((prev) => [...prev.slice(-2), { id, texto }])
        window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500)
      }
    })()
  }, [at.conversas])

  const departamento = at.selecionada ? nomeDoCanal(at.selecionada.inbox_id, at.canaisAtendimento) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      {at.erro && <div style={{ padding: '5px 10px', background: '#fee2e2', color: '#b91c1c', fontSize: 11 }}>{at.erro}</div>}
      <div style={{ flex: 1, minHeight: 0 }}>
        {at.selecionada ? (
          <ThreadConversa
            conversa={at.selecionada}
            mensagens={at.mensagens}
            carregando={at.carregandoThread}
            agentes={at.agentes}
            respostasRapidas={at.respostasRapidas}
            departamento={departamento}
            enviando={at.enviando}
            compacto
            onVoltar={() => at.selecionarConversa(null)}
            onAbrirPainel={() => setPainelAberto(true)}
            onEnviarTexto={at.enviarTexto}
            onEnviarNota={at.enviarNota}
            onEnviarAnexo={at.enviarAnexo}
            onEnviarAudio={at.enviarAudio}
            onTransferir={at.transferir}
            onEncerrar={at.encerrar}
          />
        ) : (
          <ListaConversas
            aba={at.aba}
            onAbaChange={at.setAba}
            filaCount={at.filaCount}
            busca={at.busca}
            onBuscaChange={at.setBusca}
            canais={at.canaisAtendimento}
            canalId={at.canalId}
            onCanalChange={at.setCanalId}
            conversas={at.conversas}
            carregando={at.carregandoLista}
            disponivel={at.disponivel}
            selecionadaId={null}
            onSelecionar={at.selecionarConversa}
            onNovaConversa={at.novaConversa}
          />
        )}
      </div>

      {!at.selecionada && (
        <Link
          href="/conversas"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, fontSize: 12, fontWeight: 700, borderTop: '1px solid var(--msn-border)', color: 'var(--msn-accent)' }}
        >
          <Maximize2 size={14} /> Abrir em tela cheia
        </Link>
      )}

      {at.selecionada && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--msn-surface)',
            transform: painelAberto ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform .22s ease',
            boxShadow: painelAberto ? '-4px 0 16px rgba(0,0,0,.18)' : 'none',
            zIndex: 30,
          }}
        >
          <PainelContato
            conversa={at.selecionada}
            mensagens={at.mensagens}
            agentes={at.agentes}
            tagsConta={at.tagsConta}
            tagsConversa={at.tagsConversa}
            departamento={departamento}
            onFechar={() => setPainelAberto(false)}
            onSilenciar={at.silenciar}
            onMarcarNaoLida={at.marcarNaoLida}
            onVincular={at.vincular}
            onSalvarObservacoes={at.salvarObservacoes}
            onSalvarTags={at.salvarTags}
            onTransferir={at.transferir}
            buscarEntidades={at.buscarEntidades}
          />
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{ position: 'absolute', bottom: 46, left: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 40, pointerEvents: 'none' }}>
          {toasts.map((t) => (
            <div key={t.id} style={{ background: 'var(--msn-surface)', border: '1px solid var(--msn-border)', borderRadius: 6, padding: '6px 10px', fontSize: 11.5, color: 'var(--msn-text)', boxShadow: '0 4px 12px rgba(0,0,0,.16)' }}>
              {t.texto}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
