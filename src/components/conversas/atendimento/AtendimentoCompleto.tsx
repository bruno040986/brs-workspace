'use client'

import { useEffect } from 'react'
import { MessageCircle } from 'lucide-react'
import { publicarPresencaFullpage } from '@/lib/messenger/fullpage-channel'
import { useAtendimento } from './useAtendimento'
import ListaConversas from './ListaConversas'
import ThreadConversa from './ThreadConversa'
import PainelContato from './PainelContato'

/** /conversas — 3 colunas (300/1fr/300), tema MSN, exatamente como o design aprovado. */
export default function AtendimentoCompleto() {
  const at = useAtendimento()

  useEffect(() => publicarPresencaFullpage(), [])

  const departamento = at.selecionada?.meta.team?.name || null

  return (
    <div className="brs-messenger" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 300px', height: '100%', minHeight: 0 }}>
      {at.erro && (
        <div style={{ gridColumn: '1 / -1', padding: '6px 12px', background: '#fee2e2', color: '#b91c1c', fontSize: 12 }}>{at.erro}</div>
      )}
      <div style={{ borderRight: '1px solid var(--msn-border)', minHeight: 0 }}>
        <ListaConversas
          aba={at.aba}
          onAbaChange={at.setAba}
          filaCount={at.filaCount}
          contadores={at.contadores}
          busca={at.busca}
          onBuscaChange={at.setBusca}
          canais={at.canaisAtendimento}
          canalId={at.canalId}
          onCanalChange={at.setCanalId}
          departamentos={at.departamentos}
          departamentoId={at.departamentoId}
          onDepartamentoChange={at.setDepartamentoId}
          ehSupervisor={at.ehSupervisor}
          presenca={at.presenca}
          onPresencaChange={at.mudarPresenca}
          contatos={at.contatos}
          carregandoContatos={at.carregandoContatos}
          conversas={at.conversas}
          carregando={at.carregandoLista}
          disponivel={at.disponivel}
          selecionadaId={at.selecionada?.id ?? null}
          onSelecionar={at.selecionarConversa}
          onNovaConversa={at.novaConversa}
        />
      </div>
      <div style={{ minHeight: 0, minWidth: 0 }}>
        {at.selecionada ? (
          <ThreadConversa
            conversa={at.selecionada}
            mensagens={at.mensagens}
            carregando={at.carregandoThread}
            agentes={at.agentes}
            respostasRapidas={at.respostasRapidas}
            departamento={departamento}
            departamentos={at.departamentos}
            enviando={at.enviando}
            onEnviarTexto={at.enviarTexto}
            onEnviarNota={at.enviarNota}
            onEnviarAnexo={at.enviarAnexo}
            onEnviarAudio={at.enviarAudio}
            onTransferir={at.transferir}
            onEncerrar={at.encerrar}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--msn-muted)' }}>
            <MessageCircle size={40} strokeWidth={1.3} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Selecione uma conversa</span>
          </div>
        )}
      </div>
      <div style={{ borderLeft: '1px solid var(--msn-border)', minHeight: 0 }}>
        {at.selecionada ? (
          <PainelContato
            conversa={at.selecionada}
            mensagens={at.mensagens}
            agentes={at.agentes}
            tagsConta={at.tagsConta}
            tagsConversa={at.tagsConversa}
            departamento={departamento}
            onSilenciar={at.silenciar}
            onMarcarNaoLida={at.marcarNaoLida}
            onVincular={at.vincular}
            onSalvarObservacoes={at.salvarObservacoes}
            onSalvarTags={at.salvarTags}
            onAtribuirAgente={at.atribuirAgente}
            buscarEntidades={at.buscarEntidades}
          />
        ) : (
          <div style={{ height: '100%' }} />
        )}
      </div>
    </div>
  )
}
