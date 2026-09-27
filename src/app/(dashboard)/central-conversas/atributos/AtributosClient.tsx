'use client'

/**
 * Atributos personalizados do Chatwoot (D3): Parceiro/Código, Instituição Financeira, Promotora,
 * Convênio (contato) e Motivo de Contato (conversa). Servem de filtro e de condição de automação.
 * Parceiro/Instituição/Promotora espelham o vínculo do Workspace (que segue dono); Convênio vem do
 * cadastro de convênios; Motivo de Contato é uma lista editável aqui.
 * Permissão: central-conversas.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react'
import { espelharVinculosExistentes, listarAtributos, sincronizarAtributos, type ItemAtributo } from '@/lib/central-conversas/atributos-actions'

export default function AtributosClient() {
  const [carregando, setCarregando] = useState(true)
  const [itens, setItens] = useState<ItemAtributo[]>([])
  const [motivosTexto, setMotivosTexto] = useState('')
  const [totalConvenios, setTotalConvenios] = useState(0)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState<'sync' | 'espelho' | null>(null)

  async function carregar() {
    setCarregando(true)
    const r = await listarAtributos().catch(() => ({ ok: false as const, error: 'Falha ao carregar.' }))
    if (r.ok) {
      setItens(r.itens)
      setMotivosTexto(r.motivos.join('\n'))
      setTotalConvenios(r.totalConvenios)
      setErro('')
    } else setErro(r.error)
    setCarregando(false)
  }
  useEffect(() => {
    void carregar()
  }, [])

  async function sincronizar() {
    setOcupado('sync')
    setErro('')
    setAviso('')
    const r = await sincronizarAtributos(motivosTexto.split('\n')).catch(() => ({ ok: false as const, error: 'Falha ao sincronizar.' }))
    setOcupado(null)
    if (!r.ok) return setErro(r.error)
    setAviso(`Criadas: ${r.criadas.join(', ') || 'nenhuma'}. Listas atualizadas: ${r.atualizadas.join(', ') || 'nenhuma'}.`)
    await carregar()
  }

  async function espelhar() {
    if (!window.confirm('Copiar para o Chatwoot os vínculos (parceiro/instituição/promotora) dos contatos que já existem no Workspace? Faz até 300 contatos por clique.')) return
    setOcupado('espelho')
    setErro('')
    setAviso('')
    const r = await espelharVinculosExistentes().catch(() => ({ ok: false as const, error: 'Falha ao espelhar.' }))
    setOcupado(null)
    if (!r.ok) return setErro(r.error)
    setAviso(`Vínculos espelhados: ${r.espelhados}${r.falhas ? ` (${r.falhas} falharam)` : ''}.`)
  }

  const faltam = itens.some((i) => !i.existe)
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Atributos personalizados</h1>
      <div style={{ fontSize: 13, color: 'var(--color-ink-subtle)', marginBottom: 12 }}>
        Campos extras no Chatwoot para filtrar conversas e montar automações. Parceiro/Instituição/Promotora espelham o vínculo do contato no Workspace; Convênio vem do cadastro de convênios ({totalConvenios} ativos); Motivo de Contato é a lista abaixo.
      </div>
      {erro && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      {aviso && <div style={{ color: 'var(--color-success, #16a34a)', fontSize: 13, marginBottom: 8 }}>{aviso}</div>}
      {carregando ? (
        <Loader2 className="spinner" />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {itens.map((i) => (
              <div key={i.def.chave} className="card" style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                {i.existe ? <CheckCircle2 size={16} color="#16a34a" /> : <Circle size={16} color="#9ca3af" />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{i.def.nome} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-ink-subtle)' }}>· {i.def.modelo === 'contato' ? 'contato' : 'conversa'} · {i.def.tipo === 6 ? `lista (${i.valores.length} valores)` : 'texto'}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-subtle)' }}>{i.def.descricao}</div>
                </div>
                <span style={{ fontSize: 12 }}>{i.existe ? 'criado no Chatwoot' : 'ainda não criado'}</span>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Motivos de contato (um por linha)</div>
          <textarea className="input" rows={7} style={{ width: '100%', marginBottom: 10 }} value={motivosTexto} onChange={(e) => setMotivosTexto(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => void sincronizar()} disabled={ocupado !== null}>
              {ocupado === 'sync' ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />} {faltam ? 'Criar atributos e sincronizar listas' : 'Sincronizar listas'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void espelhar()} disabled={ocupado !== null || faltam} title={faltam ? 'Crie os atributos primeiro' : undefined}>
              {ocupado === 'espelho' ? <Loader2 size={14} className="spinner" /> : null} Espelhar vínculos existentes
            </button>
          </div>
        </>
      )}
    </div>
  )
}
