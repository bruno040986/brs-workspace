'use client'

import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { acaoAparelhoConversa, type AcaoAparelho } from '@/lib/central-conversas/grupos-actions'

const H = 3600_000
const ITENS: Array<{ rotulo: string; acao: AcaoAparelho; duracaoMs?: number; soIndividual?: boolean; perigo?: boolean }> = [
  { rotulo: 'Marcar como não lida (no aparelho)', acao: 'nao_lida' },
  { rotulo: 'Marcar como lida (no aparelho)', acao: 'lida' },
  { rotulo: 'Arquivar (no aparelho)', acao: 'arquivar' },
  { rotulo: 'Desarquivar (no aparelho)', acao: 'desarquivar' },
  { rotulo: 'Silenciar por 8 horas', acao: 'silenciar', duracaoMs: 8 * H },
  { rotulo: 'Silenciar por 1 semana', acao: 'silenciar', duracaoMs: 7 * 24 * H },
  { rotulo: 'Silenciar por 1 ano', acao: 'silenciar', duracaoMs: 365 * 24 * H },
  { rotulo: 'Reativar o som', acao: 'reativar_som' },
  { rotulo: 'Bloquear contato', acao: 'bloquear', soIndividual: true, perigo: true },
  { rotulo: 'Desbloquear contato', acao: 'desbloquear', soIndividual: true },
]

/** B4 (lote 2): ações no WhatsApp do aparelho da conexão. Cada uma responde com o resultado real (sem promessa otimista). */
export default function AcoesAparelho({ conversationId, grupo, onResultado }: { conversationId: number; grupo: boolean; onResultado: (mensagem: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  async function executar(item: (typeof ITENS)[number]) {
    if (item.perigo && !window.confirm('Bloquear este contato no WhatsApp da conexão? Ele não poderá mais enviar mensagens por este número.')) return
    setAberto(false)
    setOcupado(true)
    const r = await acaoAparelhoConversa(conversationId, item.acao, item.duracaoMs).catch(() => ({ ok: false as const, error: 'Falha ao comunicar com o servidor.' }))
    setOcupado(false)
    onResultado(r.ok ? `Feito: ${item.rotulo.toLowerCase()}` : r.error)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAberto((v) => !v)} disabled={ocupado} title="Ações no WhatsApp do aparelho" className="brs-messenger-toolbar-btn" style={{ width: 34, height: 34 }}>
        <MoreVertical size={15} />
      </button>
      {aberto && (
        <div className="brs-messenger" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, padding: 4, minWidth: 250, background: 'var(--msn-surface)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.18)' }} data-brs-messenger-ignore-close="true">
          {ITENS.filter((i) => !(i.soIndividual && grupo)).map((i) => (
            <button key={i.rotulo} type="button" onClick={() => void executar(i)} style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: i.perigo ? '#dc2626' : 'var(--msn-text)', borderRadius: 4, textAlign: 'left' }}>
              {i.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
