'use client'

/** Agentes de IA › Base de Conhecimento Geral (spec §6.3): seções markdown com ordem, ativo e contador de tokens. */
import { useState } from 'react'
import { AlertTriangle, Save, Trash2 } from 'lucide-react'
import { estimarTokens, LIMITE_TOKENS_BC } from '@/lib/ia/perfis'
import { excluirSecaoConhecimento, salvarSecaoConhecimento, type SecaoConhecimento } from '../actions'

type Rascunho = Omit<SecaoConhecimento, 'versao'> & { nova?: boolean }

export default function ConhecimentoClient({ secoes: iniciais, podeEditar }: { secoes: SecaoConhecimento[]; podeEditar: boolean }) {
  const [secoes, setSecoes] = useState<Rascunho[]>(iniciais)
  const [salvo, setSalvo] = useState(() => JSON.stringify(iniciais.map(({ versao: _v, ...r }) => r)))
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const original = new Map(JSON.parse(salvo).map((r: Rascunho) => [r.chave, JSON.stringify(r)]))

  const total = secoes.filter((s) => s.ativo).reduce((n, s) => n + estimarTokens(s.conteudo_md), 0)
  const editar = (chave: string, parte: Partial<Rascunho>) => setSecoes((l) => l.map((s) => (s.chave === chave ? { ...s, ...parte } : s)))

  async function salvar(s: Rascunho) {
    setOcupado(s.chave)
    const { nova, ...dados } = s
    const r = await salvarSecaoConhecimento(dados, !!nova)
    setOcupado(null)
    if (!r.success) { setMsg({ ok: false, texto: r.error }); return }
    setSecoes((l) => l.map((x) => (x.chave === s.chave ? { ...x, nova: false } : x)))
    setSalvo((j) => JSON.stringify([...JSON.parse(j).filter((x: Rascunho) => x.chave !== s.chave), dados]))
    setMsg({ ok: true, texto: `Seção "${s.titulo}" salva.` })
  }

  async function excluir(s: Rascunho) {
    if (!window.confirm(`Excluir a seção "${s.titulo}"?`)) return
    if (!s.nova) {
      setOcupado(s.chave)
      const r = await excluirSecaoConhecimento(s.chave)
      setOcupado(null)
      if (!r.success) { setMsg({ ok: false, texto: r.error }); return }
    }
    setSecoes((l) => l.filter((x) => x.chave !== s.chave))
  }

  return (
    <div className="page-content" style={{ display: 'grid', gap: '1rem' }}>
      <div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>Base de Conhecimento Geral</h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
          Textos (markdown) que todos os agentes usam para explicar o crédito em linguagem simples. Só seções ativas entram no prompt.
        </div>
      </div>
      <div className="card" style={{ padding: '0.7rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', color: total > LIMITE_TOKENS_BC ? '#991B1B' : undefined }}>
        {total > LIMITE_TOKENS_BC && <AlertTriangle size={16} />}
        <span style={{ fontSize: '0.85rem' }}>
          ~{total.toLocaleString('pt-BR')} de {LIMITE_TOKENS_BC.toLocaleString('pt-BR')} tokens (estimativa de 4 caracteres por token).
          {total > LIMITE_TOKENS_BC && ' Passou do limite: reduza o texto para não encarecer e confundir o agente.'}
        </span>
      </div>
      {msg && <div role="status" className="card" style={{ padding: '0.7rem 1rem', color: msg.ok ? '#065F46' : '#991B1B' }}>{msg.texto}</div>}

      {secoes.map((s) => {
        const sujo = s.nova || original.get(s.chave) !== JSON.stringify((({ nova: _n, ...r }) => r)(s))
        return (
          <div key={s.chave} className="card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.6rem', opacity: s.ativo ? 1 : 0.65 }}>
            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'minmax(0,1fr) 90px auto', alignItems: 'center' }}>
              <input className="form-control" disabled={!podeEditar} aria-label="Título" value={s.titulo} onChange={(e) => editar(s.chave, { titulo: e.target.value })} />
              <input className="form-control" type="number" disabled={!podeEditar} aria-label="Ordem" title="Ordem" value={s.ordem} onChange={(e) => editar(s.chave, { ordem: Number(e.target.value) })} />
              <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input type="checkbox" disabled={!podeEditar} checked={s.ativo} onChange={(e) => editar(s.chave, { ativo: e.target.checked })} /> ativa
              </label>
            </div>
            <textarea className="form-control" rows={6} disabled={!podeEditar} value={s.conteudo_md} onChange={(e) => editar(s.chave, { conteudo_md: e.target.value })} style={{ fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
              <span>{s.chave} · ~{estimarTokens(s.conteudo_md)} tokens</span>
              {podeEditar && (
                <span style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={ocupado === s.chave} onClick={() => excluir(s)}><Trash2 size={13} /> Excluir</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!sujo || ocupado === s.chave} onClick={() => salvar(s)}><Save size={13} /> Salvar</button>
                </span>
              )}
            </div>
          </div>
        )
      })}
      {podeEditar && (
        <button type="button" className="btn btn-outline" style={{ justifySelf: 'start' }} onClick={() => {
          const chave = window.prompt('Chave da nova seção (minúsculas, números e hífen):')?.trim().toLowerCase()
          if (chave) setSecoes((l) => [...l, { chave, titulo: '', conteudo_md: '', ordem: l.length + 1, ativo: true, nova: true }])
        }}>+ Nova seção</button>
      )}
    </div>
  )
}
