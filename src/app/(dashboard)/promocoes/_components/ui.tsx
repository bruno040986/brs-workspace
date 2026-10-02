'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle } from 'lucide-react'

export type Feedback = { type: 'success' | 'error'; text: string } | null

export function Titulo({ icon, titulo, sub, children }: { icon?: React.ReactNode; titulo: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {icon}
          {titulo}
        </div>
        {sub && <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

export function Aviso({ f }: { f: Feedback }) {
  if (!f) return null
  const ok = f.type === 'success'
  return (
    <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, border: `1px solid ${ok ? '#A7F3D0' : '#FECACA'}`, background: ok ? '#ECFDF5' : '#FEF2F2', color: ok ? '#065F46' : '#991B1B', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      {ok ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{f.text}</span>
    </div>
  )
}

/** Carrega uma lista via server action; `recarregar` refaz a chamada. */
export function useCarga<T>(loader: () => Promise<({ ok: true } & T) | { ok: false; error: string }>) {
  const [data, setData] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const recarregar = useCallback(async () => {
    try {
      const r = await loader()
      if (r.ok) {
        setData(r as T)
        setErro(null)
      } else setErro(r.error)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar.')
    } finally {
      setCarregando(false)
    }
  }, [loader])
  useEffect(() => {
    void Promise.resolve().then(recarregar)
  }, [recarregar])
  return { data, erro, carregando, recarregar }
}

const CORES: Record<string, string> = {
  ativa: 'badge-success', confirmada: 'badge-success', valida: 'badge-success', valido: 'badge-success', ok: 'badge-success', emitido: 'badge-success', pago: 'badge-success', validado: 'badge-success',
  informada: 'badge-warning', pendente: 'badge-warning', devido: 'badge-warning', apurado: 'badge-warning', emitido_parcial: 'badge-warning', em_remessa: 'badge-warning', enviado: 'badge-warning',
  invalidada: 'badge-danger', cancelada: 'badge-danger', erro: 'badge-danger', desconsiderado: 'badge-danger', anulado: 'badge-danger',
}
export function Selo({ valor }: { valor: string }) {
  return <span className={`badge ${CORES[valor] || 'badge-gray'}`}>{valor.replace(/_/g, ' ')}</span>
}

export const brData = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
export const brDataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

export const TIPOS_OP: Record<string, string> = {
  novo: 'Novo',
  refinanciamento: 'Refinanciamento',
  portabilidade: 'Portabilidade',
  saque_cartao_consignado: 'Saque cartão consignado',
  saque_cartao_beneficio: 'Saque cartão benefício',
  outro: 'Outro',
}

/** "1.234,56" -> 123456 (centavos); inválido -> NaN. */
export function reaisParaCentavos(v: string): number {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

export function Vazio({ colSpan, carregando, texto }: { colSpan: number; carregando: boolean; texto: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--brs-gray-500)' }}>
        {carregando ? <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} /> : texto}
      </td>
    </tr>
  )
}

export function Busca({ valor, onChange, placeholder, children }: { valor: string; onChange: (v: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="form-control" style={{ flex: 1, minWidth: 240 }} placeholder={placeholder} value={valor} onChange={(e) => onChange(e.target.value)} />
      {children}
    </div>
  )
}

export function useDebounce<T>(v: T, ms = 400): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}
