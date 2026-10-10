'use client'

/** Peças visuais compartilhadas pelas telas de Projetos (sem lib de UI: CSS global). */
import { useState, type ReactNode } from 'react'
import { Bot, Loader2, Send, User, X } from 'lucide-react'
import {
  MENSAGEM_TIPO_LABEL,
  PROJETO_STATUS_LABEL,
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type Mensagem,
  type ProjetoStatus,
  type TarefaPrioridade,
  type TarefaStatus,
} from '@/lib/projetos/tipos'

export const dataFmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

/** Prazo é data pura (YYYY-MM-DD): formata sem passar por Date para não perder um dia no fuso. */
export const prazoFmt = (prazo?: string | null) => (prazo ? prazo.slice(0, 10).split('-').reverse().join('/') : '')

export const erroMsg = (err: unknown, padrao: string) => (err instanceof Error ? err.message : padrao)

const PROJETO_BADGE: Record<ProjetoStatus, string> = {
  rascunho: 'badge-gray',
  escrita_tecnica: 'badge-info',
  brainstorm: 'badge-gold',
  planejamento: 'badge-navy',
  execucao: 'badge-warning',
  concluido: 'badge-success',
  arquivado: 'badge-gray',
}
const TAREFA_BADGE: Record<TarefaStatus, string> = {
  pendente: 'badge-gray',
  em_andamento: 'badge-info',
  bloqueado: 'badge-danger',
  em_revisao: 'badge-warning',
  concluido: 'badge-success',
}
const PRIORIDADE_BADGE: Record<TarefaPrioridade, string> = { baixa: 'badge-gray', media: 'badge-navy', alta: 'badge-danger' }

export const ProjetoStatusBadge = ({ status }: { status: ProjetoStatus }) => (
  <span className={`badge ${PROJETO_BADGE[status]}`}>{PROJETO_STATUS_LABEL[status] ?? status}</span>
)
export const TarefaStatusBadge = ({ status }: { status: TarefaStatus }) => (
  <span className={`badge ${TAREFA_BADGE[status]}`}>{TAREFA_STATUS_LABEL[status] ?? status}</span>
)
export const PrioridadeBadge = ({ prioridade }: { prioridade: TarefaPrioridade }) => (
  <span className={`badge ${PRIORIDADE_BADGE[prioridade]}`}>{TAREFA_PRIORIDADE_LABEL[prioridade] ?? prioridade}</span>
)

export const AgenteChips = ({ agentes }: { agentes: Agente[] }) =>
  agentes.length === 0 ? (
    <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.75rem' }}>—</span>
  ) : (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {agentes.map((a) => (
        <span key={a.id} className="badge badge-navy">
          <Bot size={11} /> {a.nome}
        </span>
      ))}
    </span>
  )

export const Aviso = ({ erro }: { erro: string }) =>
  erro ? (
    <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>
      {erro}
    </div>
  ) : null

export const Carregando = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem 0' }}>
    <Loader2 size={18} className="animate-spin" /> Carregando…
  </div>
)

export const Rotulo = ({ children }: { children: ReactNode }) => (
  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', margin: '0.8rem 0 0.25rem' }}>{children}</label>
)

export function Modal({ titulo, onFechar, children, rodape, largura = 600 }: { titulo: ReactNode; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number }) {
  return (
    <div className="modal-backdrop" onClick={onFechar}>
      <div className="modal" style={{ maxWidth: largura }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{titulo}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onFechar} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" style={{ paddingTop: '0.6rem' }}>{children}</div>
        {rodape && <div className="modal-footer">{rodape}</div>}
      </div>
    </div>
  )
}

/** Linha "mudou status de X para Y" a partir do meta da mensagem tipo 'status'. */
function textoStatus(m: Mensagem) {
  const meta = (m.meta ?? {}) as { entidade?: string; de?: string; para?: string }
  const labels: Record<string, string> = meta.entidade === 'tarefa' ? TAREFA_STATUS_LABEL : PROJETO_STATUS_LABEL
  const alvo = meta.entidade === 'tarefa' ? `da T-${m.tarefaNumero ?? '?'}` : 'do projeto'
  const de = meta.de ? labels[meta.de] ?? meta.de : '—'
  const para = meta.para ? labels[meta.para] ?? meta.para : '—'
  return `${m.autorNome} mudou status ${alvo} de ${de} para ${para}`
}

const TIPO_BADGE: Partial<Record<Mensagem['tipo'], string>> = {
  decisao: 'badge-success',
  registro_direto: 'badge-gold',
  contribuicao: 'badge-info',
  escrita_tecnica: 'badge-navy',
}

export function Timeline({ mensagens, mostrarTarefa = false, vazio = 'Nenhuma mensagem ainda.' }: { mensagens: Mensagem[]; mostrarTarefa?: boolean; vazio?: string }) {
  if (mensagens.length === 0) return <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', padding: '0.6rem 0' }}>{vazio}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {mensagens.map((m) =>
        m.tipo === 'status' ? (
          <div key={m.id} style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', fontStyle: 'italic', padding: '0 0.3rem' }}>
            {textoStatus(m)} · {dataFmt(m.createdAt)}
          </div>
        ) : (
          <div key={m.id} className="card" style={{ padding: '0.7rem 0.85rem', borderLeft: `3px solid ${m.autorTipo === 'agente' ? 'var(--brs-gold, #c9a84c)' : 'var(--brs-navy)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.75rem', marginBottom: '0.35rem' }}>
              {m.autorTipo === 'agente' ? <Bot size={14} /> : <User size={14} />}
              <strong>{m.autorNome}</strong>
              <span className={`badge ${TIPO_BADGE[m.tipo] ?? 'badge-gray'}`}>{MENSAGEM_TIPO_LABEL[m.tipo] ?? m.tipo}</span>
              {mostrarTarefa && m.tarefaNumero != null && <span className="badge badge-gray">T-{m.tarefaNumero}</span>}
              <span style={{ marginLeft: 'auto', color: 'var(--brs-gray-400)' }}>{dataFmt(m.createdAt)}</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.84rem', lineHeight: 1.5 }}>{m.conteudo}</div>
          </div>
        ),
      )}
    </div>
  )
}

/** Textarea + tipo (Mensagem/Decisão) + Enviar. `onEnviar` lança Error em caso de falha. */
export function FormMensagem({ onEnviar }: { onEnviar: (tipo: 'mensagem' | 'decisao', conteudo: string) => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<'mensagem' | 'decisao'>('mensagem')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar() {
    if (!texto.trim() || enviando) return
    setEnviando(true)
    setErro('')
    try {
      await onEnviar(tipo, texto.trim())
      setTexto('')
      setTipo('mensagem')
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao enviar mensagem.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ marginTop: '0.9rem' }}>
      <Aviso erro={erro} />
      <textarea className="form-control" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva uma mensagem…" />
      <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem', justifyContent: 'flex-end' }}>
        <select className="form-control" style={{ width: 'auto' }} value={tipo} onChange={(e) => setTipo(e.target.value as 'mensagem' | 'decisao')}>
          <option value="mensagem">Mensagem</option>
          <option value="decisao">Decisão</option>
        </select>
        <button className="btn btn-primary" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send size={14} /> {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

export type FormProjeto = { titulo: string; objetivo: string; ideiaPrincipal: string; participanteIds: string[]; redatorAgenteId: string }

/** Campos de criar/editar projeto. Redator só entre os participantes marcados. */
export function CamposProjeto({ form, setForm, agentes }: { form: FormProjeto; setForm: (f: FormProjeto) => void; agentes: Agente[] }) {
  function alternar(id: string, marcado: boolean) {
    const participanteIds = marcado ? [...form.participanteIds, id] : form.participanteIds.filter((x) => x !== id)
    setForm({ ...form, participanteIds, redatorAgenteId: participanteIds.includes(form.redatorAgenteId) ? form.redatorAgenteId : '' })
  }
  const marcados = agentes.filter((a) => form.participanteIds.includes(a.id))
  return (
    <>
      <Rotulo>Título *</Rotulo>
      <input className="form-control" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
      <Rotulo>Objetivo / Finalidade *</Rotulo>
      <textarea className="form-control" rows={3} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} />
      <Rotulo>Ideia principal *</Rotulo>
      <textarea className="form-control" rows={4} value={form.ideiaPrincipal} onChange={(e) => setForm({ ...form, ideiaPrincipal: e.target.value })} />
      <Rotulo>IAs envolvidas</Rotulo>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem' }}>
        {agentes.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhum agente cadastrado.</span>}
        {agentes.map((a) => (
          <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', cursor: 'pointer', opacity: a.ativo ? 1 : 0.55 }}>
            <input type="checkbox" checked={form.participanteIds.includes(a.id)} onChange={(e) => alternar(a.id, e.target.checked)} />
            {a.nome}
            {!a.ativo && ' (inativo)'}
          </label>
        ))}
      </div>
      <Rotulo>IA redatora técnica</Rotulo>
      <select className="form-control" value={form.redatorAgenteId} onChange={(e) => setForm({ ...form, redatorAgenteId: e.target.value })} disabled={marcados.length === 0}>
        <option value="">{marcados.length === 0 ? 'Marque as IAs envolvidas primeiro' : '— Nenhuma —'}</option>
        {marcados.map((a) => (
          <option key={a.id} value={a.id}>{a.nome}</option>
        ))}
      </select>
    </>
  )
}
