'use client'

/**
 * Cartão "Cotas das IAs" da tela /projetos: quanto cada IA já usou de cada
 * cota. O dado é informado (IA registra pelo MCP com cota_registrar, ou o
 * Bruno edita aqui); nenhuma IA expõe a própria cota por API.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Gauge, Pencil, Plus, Trash2 } from 'lucide-react'
import { registrarCotas, removerCota } from '@/lib/projetos/actions'
import { MAX_COTA_NOME, MAX_COTA_OBS, MAX_COTAS, corCota, tempoDesde, validarCotas } from '@/lib/projetos/puro'
import type { AgenteComCotas, Cota } from '@/lib/projetos/tipos'
import { Aviso, Modal, erroMsg } from './ui'

const COR = { success: 'var(--brs-success)', warning: 'var(--brs-warning)', danger: 'var(--brs-danger)' }
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const dataCurta = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
const paraLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const maisRecente = (cs: Cota[]) => cs.reduce((x, y) => (Date.parse(y.atualizadoEm) > Date.parse(x.atualizadoEm) ? y : x))

type Linha = { nome: string; percentual: string; reiniciaEm: string; observacao: string }
const LINHA_VAZIA: Linha = { nome: '', percentual: '', reiniciaEm: '', observacao: '' }

function BarraCota({ c }: { c: Cota }) {
  const cor = corCota(c.percentualUsado)
  return (
    <div
      title={`Atualizado ${tempoDesde(c.atualizadoEm)} por ${c.atualizadoPorNome}${c.observacao ? `\n${c.observacao}` : ''}`}
      style={{ flex: '1 1 150px', minWidth: 140, maxWidth: 280 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: '0.75rem' }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
        <span className={`badge badge-${cor}`}>{pct(c.percentualUsado)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={c.nome}
        aria-valuenow={c.percentualUsado}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 3, background: 'var(--brs-gray-100)', overflow: 'hidden', margin: '4px 0 2px' }}
      >
        <div style={{ width: `${c.percentualUsado}%`, height: '100%', background: COR[cor] }} />
      </div>
      {c.reiniciaEm && <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>reinicia em {dataCurta(c.reiniciaEm)}</div>}
    </div>
  )
}

export function CotasCard({ agentes, erro, onSalvo }: { agentes: AgenteComCotas[]; erro: string; onSalvo: () => Promise<void> }) {
  const [aberto, setAberto] = useState(true)
  const [editando, setEditando] = useState<AgenteComCotas | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState('')

  function editar(a: AgenteComCotas) {
    setErroModal('')
    setEditando(a)
    setLinhas(
      a.cotas.length
        ? a.cotas.map((c) => ({ nome: c.nome, percentual: String(c.percentualUsado), reiniciaEm: paraLocal(c.reiniciaEm), observacao: c.observacao || '' }))
        : [{ ...LINHA_VAZIA }],
    )
  }

  const mudar = (i: number, campo: keyof Linha, valor: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))

  async function salvar() {
    if (!editando || salvando) return
    setSalvando(true)
    setErroModal('')
    try {
      const preenchidas = linhas.filter((l) => l.nome.trim() || l.percentual.trim() || l.reiniciaEm || l.observacao.trim())
      const cotas = preenchidas.length
        ? validarCotas(
            preenchidas.map((l) => ({
              nome: l.nome,
              percentualUsado: l.percentual,
              reiniciaEm: l.reiniciaEm ? new Date(l.reiniciaEm).toISOString() : null,
              observacao: l.observacao,
            })),
          )
        : []
      if (cotas.length) {
        const r = await registrarCotas(editando.id, cotas)
        if (!r.success) throw new Error(r.error)
      }
      // Removidas ou renomeadas: some da lista a cota antiga cujo nome não ficou.
      const ficam = new Set(cotas.map((c) => c.nome.toLowerCase()))
      for (const c of editando.cotas.filter((x) => !ficam.has(x.nome.toLowerCase()))) {
        const r = await removerCota(c.id)
        if (!r.success) throw new Error(r.error)
      }
      await onSalvo()
      setEditando(null)
    } catch (err) {
      setErroModal(erroMsg(err, 'Erro ao salvar cotas.'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
        style={{ width: '100%', background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '0.8rem 1rem', fontWeight: 700, fontSize: '0.95rem' }}
      >
        {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Gauge size={16} /> Cotas das IAs
      </button>
      {aberto && (
        <div style={{ padding: '0 1rem 0.9rem' }}>
          <Aviso erro={erro} />
          {agentes.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem 1rem', flexWrap: 'wrap', padding: '0.6rem 0', borderTop: '1px solid var(--brs-gray-100)' }}>
              <div style={{ flex: '0 0 160px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{a.nome}</div>
                {a.cotas.length > 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }} title={`por ${maisRecente(a.cotas).atualizadoPorNome}`}>
                    atualizado {tempoDesde(maisRecente(a.cotas).atualizadoEm)}
                  </div>
                )}
              </div>
              <div style={{ flex: '1 1 300px', display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem' }}>
                {a.cotas.length ? a.cotas.map((c) => <BarraCota key={c.id} c={c} />) : <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Sem leitura registrada.</span>}
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => editar(a)}>
                <Pencil size={13} /> Editar
              </button>
            </div>
          ))}
          {agentes.length === 0 && !erro && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhuma IA cadastrada.</div>}
        </div>
      )}

      {editando && (
        <Modal
          titulo={`Cotas de ${editando.nome}`}
          largura={720}
          onFechar={() => !salvando && setEditando(null)}
          rodape={
            <>
              <button className="btn btn-outline" onClick={() => setEditando(null)} disabled={salvando}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </>
          }
        >
          <Aviso erro={erroModal} />
          <p style={{ fontSize: '0.78rem', color: 'var(--brs-gray-600)', marginTop: 0 }}>
            Percentual <strong>já usado</strong> (0–100). Linha removida ou renomeada some ao salvar.
          </p>
          {linhas.map((l, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0.5rem 0', borderTop: i ? '1px solid var(--brs-gray-100)' : undefined }}>
              <input className="form-control" style={{ flex: '2 1 160px' }} placeholder="Nome (ex.: 5 horas)" maxLength={MAX_COTA_NOME} value={l.nome} onChange={(e) => mudar(i, 'nome', e.target.value)} aria-label="Nome da cota" />
              <input className="form-control" style={{ flex: '0 0 90px' }} type="number" min={0} max={100} step="0.01" placeholder="% usado" value={l.percentual} onChange={(e) => mudar(i, 'percentual', e.target.value)} aria-label="Percentual usado" />
              <input className="form-control" style={{ flex: '1 1 190px' }} type="datetime-local" value={l.reiniciaEm} onChange={(e) => mudar(i, 'reiniciaEm', e.target.value)} aria-label="Reinicia em" title="Reinicia em" />
              <button className="btn btn-ghost btn-icon" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} aria-label="Remover cota" title="Remover cota">
                <Trash2 size={15} />
              </button>
              <input className="form-control" style={{ flex: '1 1 100%' }} placeholder="Observação (opcional)" maxLength={MAX_COTA_OBS} value={l.observacao} onChange={(e) => mudar(i, 'observacao', e.target.value)} aria-label="Observação" />
            </div>
          ))}
          <button className="btn btn-outline btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setLinhas((ls) => [...ls, { ...LINHA_VAZIA }])} disabled={linhas.length >= MAX_COTAS}>
            <Plus size={14} /> Adicionar cota
          </button>
        </Modal>
      )}
    </div>
  )
}
