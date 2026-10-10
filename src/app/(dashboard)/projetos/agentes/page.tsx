'use client'

/** Agentes de IA dos Projetos: gera/renova o token MCP de cada IA. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bot, Copy, KeyRound } from 'lucide-react'
import { gerarTokenAgente, listarAgentes, listarCotas } from '@/lib/projetos/actions'
import type { Agente, ContaCotas } from '@/lib/projetos/tipos'
import { CotasCard } from '../_components/cotas'
import { Aviso, Carregando, Modal, erroMsg } from '../_components/ui'

export default function AgentesPage() {
  const [agentes, setAgentes] = useState<Agente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [gerando, setGerando] = useState('')
  const [gerado, setGerado] = useState<{ nome: string; url: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [cotas, setCotas] = useState<ContaCotas[]>([])
  const [erroCotas, setErroCotas] = useState('')

  async function carregar() {
    try {
      const [res, resCotas] = await Promise.all([listarAgentes(), listarCotas()])
      // Cotas falhando não derruba a lista de agentes.
      if (resCotas.success) setCotas(resCotas.data)
      setErroCotas(resCotas.success ? '' : resCotas.error)
      if (!res.success) throw new Error(res.error)
      setAgentes(res.data)
      setErro('')
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao carregar agentes.'))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // carga inicial fora do corpo síncrono do efeito (react-hooks/set-state-in-effect)
    void Promise.resolve().then(carregar)
    const t = window.setInterval(carregar, 60_000)
    return () => window.clearInterval(t)
  }, [])

  async function gerar(a: Agente) {
    if (gerando) return
    const aviso = a.temToken ? `\n\nO token atual de ${a.nome} deixa de funcionar imediatamente.` : ''
    if (!window.confirm(`Gerar novo token MCP para ${a.nome}?${aviso}`)) return
    setGerando(a.id)
    setErro('')
    try {
      const res = await gerarTokenAgente(a.id)
      if (!res.success) throw new Error(res.error)
      setCopiado(false)
      setGerado({ nome: a.nome, url: res.data.url })
      await carregar()
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao gerar token.'))
    } finally {
      setGerando('')
    }
  }

  async function copiar() {
    if (!gerado) return
    try {
      await navigator.clipboard.writeText(gerado.url)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        <Link href="/projetos" className="btn btn-ghost btn-sm">
          <ArrowLeft size={15} /> Projetos
        </Link>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={22} /> Agentes de IA
        </h1>
      </div>

      <Aviso erro={erro} />

      {carregando ? (
        <Carregando />
      ) : (
        <div className="card table-wrapper" style={{ marginBottom: '1rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Slug</th>
                <th>Ativo</th>
                <th>Token configurado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agentes.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>{a.nome}</td>
                  <td><code>{a.slug}</code></td>
                  <td><span className={`badge ${a.ativo ? 'badge-success' : 'badge-gray'}`}>{a.ativo ? 'Sim' : 'Não'}</span></td>
                  <td><span className={`badge ${a.temToken ? 'badge-success' : 'badge-warning'}`}>{a.temToken ? 'Sim' : 'Não'}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => gerar(a)} disabled={!!gerando}>
                      <KeyRound size={14} /> {gerando === a.id ? 'Gerando…' : a.temToken ? 'Renovar token' : 'Gerar token'}
                    </button>
                  </td>
                </tr>
              ))}
              {agentes.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>Nenhum agente cadastrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!carregando && <CotasCard contas={cotas} erro={erroCotas} onSalvo={carregar} />}

      <div className="card">
        <div className="card-header"><h3 className="card-title">Como conectar</h3></div>
        <div className="card-body" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
          <div><strong>claude.ai:</strong> Configurações → Conectores → adicionar conector personalizado com a URL.</div>
          <div><strong>ChatGPT:</strong> ative o modo desenvolvedor e adicione um conector MCP com a URL.</div>
          <div><strong>Claude Code / Codex / Antigravity:</strong> adicione um servidor MCP do tipo HTTP com a URL na configuração.</div>
        </div>
      </div>

      {gerado && (
        <Modal
          titulo={`Token de ${gerado.nome}`}
          onFechar={() => setGerado(null)}
          rodape={<button className="btn btn-primary" onClick={() => setGerado(null)}>Já guardei</button>}
        >
          <p style={{ fontSize: '0.85rem', color: 'var(--brs-danger)', fontWeight: 600, marginTop: 0 }}>
            Guarde agora: esta URL não será exibida de novo.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-control" readOnly value={gerado.url} onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} />
            <button className="btn btn-outline" onClick={copiar}>
              <Copy size={14} /> {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
