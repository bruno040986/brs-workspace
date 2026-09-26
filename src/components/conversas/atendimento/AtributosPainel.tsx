'use client'

import { useEffect, useState } from 'react'
import { definirConvenioContato, definirMotivoConversa, getAtributosPainel, type AtributosPainel as Dados } from '@/lib/central-conversas/atributos-actions'

/** Convênio (do contato) e Motivo de Contato (da conversa) no painel do atendimento (D3). Gravam direto no Chatwoot. */
export default function AtributosPainel({ conversationId, contactId }: { conversationId: number; contactId: number | null }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(null)
    void getAtributosPainel(conversationId, contactId).then((r) => {
      if (!vivo) return
      if (r.ok) setDados(r.dados)
      else setErro(r.error)
    })
    return () => {
      vivo = false
    }
  }, [conversationId, contactId])

  async function gravar(campo: 'convenio' | 'motivo', valor: string) {
    if (!dados) return
    setSalvando(true)
    setErro(null)
    const r = campo === 'convenio' ? (contactId ? await definirConvenioContato(contactId, valor) : ({ ok: false, error: 'Contato desconhecido.' } as const)) : await definirMotivoConversa(conversationId, valor)
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    setDados({ ...dados, [campo]: valor })
  }

  if (erro && !dados) return <div style={{ fontSize: 11.5, color: '#b91c1c' }}>{erro}</div>
  if (!dados) return null
  if (!dados.definido) return <div style={{ fontSize: 11.5, color: 'var(--msn-muted)' }}>Atributos ainda não criados (Central de Conversas › Atributos).</div>

  const select = (valor: string, opcoes: string[], onChange: (v: string) => void, vazio: string) => (
    <select className="brs-messenger-select" style={{ width: '100%' }} value={valor} disabled={salvando} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vazio}</option>
      {valor && !opcoes.includes(valor) && <option value={valor}>{valor}</option>}
      {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--msn-muted)', textTransform: 'uppercase' }}>Atributos</div>
      {erro && <div style={{ fontSize: 11.5, color: '#b91c1c' }}>{erro}</div>}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 4 }}>Convênio (do contato)</div>
        {select(dados.convenio, dados.opcoesConvenio, (v) => void gravar('convenio', v), 'Não informado')}
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--msn-muted)', marginBottom: 4 }}>Motivo de contato (desta conversa)</div>
        {select(dados.motivo, dados.opcoesMotivo, (v) => void gravar('motivo', v), 'Não informado')}
      </div>
    </section>
  )
}
