'use client'

/**
 * RH › Sincronização QuarkRH — puxa colaboradores da API e faz upsert em
 * `employees` (nunca sobrescreve salário/banco). Menu próprio. Permissão
 * rh-quark-sync.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Users } from 'lucide-react'
import { listarSyncLogs, sincronizarColaboradoresQuark, type SyncLogRow } from '@/lib/folha/sync-actions'

export default function QuarkSyncPage() {
  const [logs, setLogs] = useState<SyncLogRow[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; ignorados: number; total: number } | null>(null)

  async function carregar() {
    const res = await listarSyncLogs()
    if (res.success) setLogs(res.data || [])
    else setErro(res.error || '')
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  async function sincronizar() {
    if (sincronizando) return
    if (!window.confirm('Sincronizar colaboradores do QuarkRH? Atualiza nome, cargo, setor, vínculo, admissão, PIS e eSocial — nunca toca em salário ou dados bancários.')) return
    setSincronizando(true)
    setErro('')
    setResultado(null)
    try {
      const res = await sincronizarColaboradoresQuark()
      if (!res.success) throw new Error(res.error)
      setResultado({ criados: res.criados, atualizados: res.atualizados, ignorados: res.ignorados, total: res.total })
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha na sincronização.')
    } finally {
      setSincronizando(false)
    }
  }

  const dataFmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Users size={22} /> Sincronização QuarkRH
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Puxa os colaboradores da API do QuarkRH e atualiza o cadastro do Workspace (nome, cargo, setor, vínculo,
        admissão, PIS, eSocial). <strong>Nunca sobrescreve salário nem dados bancários</strong> — esses são do
        Workspace. Configure o token em Provedores e APIs › QuarkRH.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {resultado && (
        <div className="card" style={{ padding: '0.9rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <CheckCircle2 size={18} style={{ color: 'var(--brs-success)' }} />
          <span style={{ fontWeight: 700 }}>{resultado.total} recebidos</span>
          <span style={{ color: 'var(--brs-success)' }}>{resultado.criados} criados</span>
          <span style={{ color: 'var(--brs-info)' }}>{resultado.atualizados} atualizados</span>
          {resultado.ignorados > 0 && <span style={{ color: 'var(--brs-gray-400)' }}>{resultado.ignorados} ignorados</span>}
        </div>
      )}

      <button className="btn btn-primary" onClick={sincronizar} disabled={sincronizando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '1.5rem' }}>
        {sincronizando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Sincronizar agora
      </button>

      <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.6rem' }}>Histórico</h2>
      {carregando ? (
        <Loader2 size={18} className="animate-spin" />
      ) : logs.length === 0 ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>Nenhuma sincronização ainda.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="data-table" style={{ fontSize: '0.82rem' }}>
            <thead><tr><th>Data</th><th>Recebidos</th><th>Criados</th><th>Atualizados</th><th>Ignorados</th><th>Erros</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{dataFmt(l.created_at)}</td>
                  <td>{l.total_recebidos}</td>
                  <td style={{ color: 'var(--brs-success)' }}>{l.criados}</td>
                  <td style={{ color: 'var(--brs-info)' }}>{l.atualizados}</td>
                  <td style={{ color: 'var(--brs-gray-400)' }}>{l.ignorados}</td>
                  <td style={{ color: l.erros ? 'var(--brs-danger)' : 'var(--brs-gray-400)' }}>{l.erros}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
