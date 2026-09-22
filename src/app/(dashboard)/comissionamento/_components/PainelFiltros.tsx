'use client'

/**
 * Painel de filtros das telas de Comissionamento (Tabelas e Prazos), no estilo do
 * ARW: campos em grade, "Listar" aplica (ou Enter num campo) e "Limpar" volta ao
 * padrão. A grade quebra sozinha conforme a largura livre da tela.
 */

import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { filtrarOpcoesCombobox, normalizarBuscaCombobox } from '@/lib/comissionamento-filtros'

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

/**
 * Campo de referência com muitas opções (Financeira, Convênio, Forma de
 * Contrato, Tipo de Formalização, Promotora, Tabela de Comissão): digita para
 * buscar a partir de `minimoCaracteres`; abaixo disso mostra a lista inteira.
 * A opção "sem filtro" (`vazio`) fica sempre fixa no topo da lista.
 */
export function ComboboxFiltro({
  label,
  valor,
  onChange,
  opcoes,
  vazio,
  placeholder,
  minimoCaracteres = 3,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
  opcoes: OpcaoFiltro[]
  vazio?: string
  placeholder?: string
  minimoCaracteres?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [destaque, setDestaque] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaId = useId()

  const selecionado = opcoes.find((opcao) => opcao.valor === valor)
  const filtradas = filtrarOpcoesCombobox(opcoes, busca, minimoCaracteres)
  const listaVisivel = vazio !== undefined ? [{ valor: '', label: vazio }, ...filtradas] : filtradas
  const faltamCaracteres = minimoCaracteres - normalizarBuscaCombobox(busca).length

  function abrir() {
    setBusca('')
    setDestaque(0)
    setAberto(true)
  }

  function selecionar(opcaoValor: string) {
    onChange(opcaoValor)
    setBusca('')
    setAberto(false)
    inputRef.current?.blur()
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>) {
    if (!aberto) {
      if (evento.key === 'ArrowDown' || evento.key === 'Enter') {
        abrir()
        evento.preventDefault()
      }
      return
    }
    if (evento.key === 'ArrowDown') {
      setDestaque((atual) => Math.min(atual + 1, listaVisivel.length - 1))
      evento.preventDefault()
    } else if (evento.key === 'ArrowUp') {
      setDestaque((atual) => Math.max(atual - 1, 0))
      evento.preventDefault()
    } else if (evento.key === 'Enter') {
      const opcao = listaVisivel[destaque]
      if (opcao) selecionar(opcao.valor)
      evento.preventDefault()
    } else if (evento.key === 'Escape') {
      setBusca('')
      setAberto(false)
      inputRef.current?.blur()
    }
  }

  return (
    <CampoFiltro label={label}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          className="form-control"
          role="combobox"
          aria-expanded={aberto}
          aria-autocomplete="list"
          aria-controls={listaId}
          value={aberto ? busca : selecionado?.label || ''}
          placeholder={aberto ? selecionado?.label || placeholder || vazio : placeholder || vazio}
          onFocus={abrir}
          onBlur={() => setAberto(false)}
          onChange={(evento) => {
            setBusca(evento.target.value)
            setDestaque(0)
            if (!aberto) setAberto(true)
          }}
          onKeyDown={aoTeclar}
        />
        {valor && !aberto && (
          <button
            type="button"
            aria-label="Limpar"
            onClick={() => onChange('')}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brs-gray-400)', padding: 2, lineHeight: 0 }}
          >
            <X size={14} />
          </button>
        )}
        {aberto && (
          <div id={listaId} role="listbox" style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 260, overflowY: 'auto', background: 'var(--brs-surface)', border: '1px solid var(--brs-gray-200)', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}>
            {listaVisivel.length === 0 ? (
              <div style={{ padding: '0.6rem 0.85rem', fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Nenhum resultado</div>
            ) : (
              listaVisivel.map((opcao, indice) => (
                <div
                  key={opcao.valor || '__vazio__'}
                  role="option"
                  aria-selected={opcao.valor === valor}
                  // preventDefault no mousedown: mantém o foco no input (não dispara
                  // blur antes do click) — senão a lista fecharia antes de selecionar.
                  onMouseDown={(evento) => evento.preventDefault()}
                  onMouseEnter={() => setDestaque(indice)}
                  onClick={() => selecionar(opcao.valor)}
                  style={{
                    padding: '0.5rem 0.85rem',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    background: indice === destaque ? 'var(--brs-gray-50)' : 'transparent',
                    fontWeight: opcao.valor === valor ? 600 : 400,
                    color: opcao.valor === '' ? 'var(--brs-gray-500)' : 'var(--brs-gray-800)',
                  }}
                >
                  {opcao.label}
                </div>
              ))
            )}
            {faltamCaracteres > 0 && (
              <div style={{ padding: '0.4rem 0.85rem', fontSize: '0.72rem', color: 'var(--brs-gray-400)', borderTop: '1px solid var(--brs-gray-100)' }}>
                Digite mais {faltamCaracteres} letra{faltamCaracteres > 1 ? 's' : ''} para filtrar
              </div>
            )}
          </div>
        )}
      </div>
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
    // overflow:visible sobrescreve o overflow:hidden do .card — senão o menu
    // suspenso do ComboboxFiltro seria cortado nas bordas do painel.
    <form className="card" onSubmit={enviar} style={{ padding: '1rem', marginBottom: '1.5rem', overflow: 'visible' }}>
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
