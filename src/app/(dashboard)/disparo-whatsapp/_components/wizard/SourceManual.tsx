'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ClipboardPaste, Columns3 } from 'lucide-react'
import { buildRecipientsFromRows, parsePastedTable, slugifyVariable, type RecipientDraft } from '@/lib/disparo-whatsapp'

type Row = { key: string; values: Record<string, string> }
const BASE_COLS = ['nome', 'telefone']
const k = () => Math.random().toString(36).slice(2, 9)

export default function SourceManual({ variables, recipients, onRecipients }: { variables: string[]; recipients: RecipientDraft[]; onRecipients: (r: RecipientDraft[], variables: string[]) => void }) {
  const [cols, setCols] = useState<string[]>(variables.length ? variables : BASE_COLS)
  const [rows, setRows] = useState<Row[]>(() =>
    recipients.length
      ? recipients.map((r) => ({ key: k(), values: { ...r.variables, telefone: r.phone_raw || r.phone } }))
      : [{ key: k(), values: {} }, { key: k(), values: {} }, { key: k(), values: {} }],
  )
  const [newCol, setNewCol] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const summary = useMemo(() => {
    const data = rows.map((r) => { const o: Record<string, string> = {}; cols.forEach((c) => { o[c] = r.values[c] || '' }); return o }).filter((r) => Object.values(r).some((v) => v.trim()))
    return buildRecipientsFromRows(data, 'telefone', 'nome', (_r, i) => ({ row: i + 1 }))
  }, [rows, cols])

  useEffect(() => {
    onRecipients(summary.recipients, cols)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, cols])

  function setCell(rowKey: string, col: string, value: string) {
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, values: { ...r.values, [col]: value } } : r)))
  }
  function addRow() { setRows((prev) => [...prev, { key: k(), values: {} }]) }
  function removeRow(rowKey: string) { setRows((prev) => prev.filter((r) => r.key !== rowKey)) }
  function addCol() {
    const name = slugifyVariable(newCol)
    if (!name || cols.includes(name)) return
    setCols((prev) => [...prev, name])
    setNewCol('')
  }
  function removeCol(c: string) {
    if (BASE_COLS.includes(c)) return
    setCols((prev) => prev.filter((x) => x !== c))
  }
  function applyPaste() {
    const table = parsePastedTable(pasteText)
    if (!table.length) return
    const first = table[0]
    // 1ª linha é cabeçalho se nenhuma célula parece telefone
    const looksHeader = !first.some((c) => c.replace(/\D/g, '').length >= 8)
    const srcHeaders: string[] = looksHeader
      ? first.map((h, i) => slugifyVariable(h) || `coluna_${i + 1}`)
      : first.map((_c, i) => cols[i] || `coluna_${i + 1}`)
    const body = looksHeader ? table.slice(1) : table
    const finalCols = Array.from(new Set([...BASE_COLS, ...cols, ...srcHeaders]))
    setCols(finalCols)
    setRows((prev) => [
      ...prev.filter((r) => Object.values(r.values).some((v) => String(v || '').trim())),
      ...body.map((cells) => {
        const values: Record<string, string> = {}
        cells.forEach((cell, i) => { const col = srcHeaders[i]; if (col) values[col] = cell })
        return { key: k(), values }
      }),
    ])
    setPasteText('')
    setPasteOpen(false)
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={addRow}><Plus size={14} /> Linha</button>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input className="form-control" style={{ width: 160, padding: '4px 8px' }} placeholder="nova coluna (ex.: valor)" value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCol() } }} />
          <button type="button" className="btn btn-outline btn-sm" onClick={addCol}><Columns3 size={14} /> Coluna</button>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setPasteOpen((v) => !v)}><ClipboardPaste size={14} /> Colar do Excel</button>
        <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>{summary.recipients.length} válido(s){summary.invalid.length ? ` · ${summary.invalid.length} inválido(s)` : ''}{summary.duplicates ? ` · ${summary.duplicates} duplicado(s)` : ''}</span>
      </div>

      {pasteOpen && (
        <div style={{ border: '1px dashed var(--brs-gray-300)', borderRadius: 10, padding: '0.75rem' }}>
          <textarea className="form-control" rows={5} placeholder={'Cole aqui as linhas copiadas do Excel/Sheets (colunas separadas por TAB, ; ou ,). Se a primeira linha for cabeçalho, ela vira o nome das colunas.'} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasteOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyPaste}>Aplicar</button>
          </div>
        </div>
      )}

      <div className="table-wrapper" style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              {cols.map((c) => (
                <th key={c}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <code>{`{{${c}}}`}</code>
                    {!BASE_COLS.includes(c) && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => removeCol(c)} title="Remover coluna"><Trash2 size={11} /></button>}
                  </span>
                </th>
              ))}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td style={{ color: 'var(--brs-gray-400)' }}>{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} style={{ padding: 4 }}>
                    <input className="form-control" style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 120 }} value={r.values[c] || ''} onChange={(e) => setCell(r.key, c, e.target.value)} placeholder={c === 'telefone' ? '(11) 99999-9999' : c} />
                  </td>
                ))}
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(r.key)} style={{ color: '#b91c1c' }}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
