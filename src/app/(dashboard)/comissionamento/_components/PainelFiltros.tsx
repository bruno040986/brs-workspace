'use client'

/**
 * Painel de filtros das telas de Comissionamento (Tabelas e Prazos), no estilo do
 * ARW: campos em grade, "Listar" aplica (ou Enter num campo) e "Limpar" volta ao
 * padrão. A grade quebra sozinha conforme a largura livre da tela.
 */

import type { FormEvent, ReactNode } from 'react'
import { Loader2, Search, X } from 'lucide-react'

export type OpcaoFiltro = { valor: string; label: string }

export function CampoFiltro({ label, children, linhaInteira }: { label: string; children: ReactNode; linhaInteira?: boolean }) {
  return (
    <div className="form-group" style={{ margin: 0, minWidth: 0, gridColumn: linhaInteira ? '1 / -1' : undefined }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}

export function TextoFiltro({ label, valor, onChange, placeholder, tipo = 'text' }: { label: string; valor: string; onChange: (v: string) => void; placeholder?: string; tipo?: 'text' | 'number' | 'date' }) {
  return (
    <CampoFiltro label={label}>
      <input type={tipo} className="form-control" value={valor} placeholder={placeholder} min={tipo === 'number' ? 1 : undefined} onChange={(e) => onChange(e.target.value)} />
    </CampoFiltro>
  )
}

/** `vazio` = texto da opção que representa "sem filtro" (valor ''); omitido = sem essa opção. */
export function SelectFiltro({ label, valor, onChange, opcoes, vazio }: { label: string; valor: string; onChange: (v: string) => void; opcoes: OpcaoFiltro[]; vazio?: string }) {
  return (
    <CampoFiltro label={label}>
      <select className="form-control" value={valor} onChange={(e) => onChange(e.target.value)}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.label}</option>)}
      </select>
    </CampoFiltro>
  )
}

export const OPCOES_BLOQUEIO: OpcaoFiltro[] = [
  { valor: 'nao', label: 'Não' },
  { valor: 'sim', label: 'Sim' },
  { valor: 'todos', label: 'Todos' },
]

export const OPCOES_SEGURO: OpcaoFiltro[] = [
  { valor: 'com', label: 'Com seguro' },
  { valor: 'sem', label: 'Sem seguro' },
  { valor: 'nao_informado', label: 'Não informado' },
]

export function PainelFiltros({ children, onListar, onLimpar, carregando, resumo }: { children: ReactNode; onListar: () => void; onLimpar: () => void; carregando?: boolean; resumo?: ReactNode }) {
  function enviar(evento: FormEvent) {
    evento.preventDefault()
    onListar()
  }

  return (
    <form className="card" onSubmit={enviar} style={{ padding: '1rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.85rem 1rem' }}>{children}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid var(--brs-gray-100)' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)', minWidth: 0 }}>{resumo}</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={onLimpar} disabled={carregando}><X size={16} />Limpar</button>
          <button type="submit" className="btn btn-primary" disabled={carregando}>
            {carregando ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
            Listar
          </button>
        </div>
      </div>
    </form>
  )
}
