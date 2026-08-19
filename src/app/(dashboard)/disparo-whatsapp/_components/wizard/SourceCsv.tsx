'use client'

import { useRef, useState } from 'react'
import { Upload, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { buildCsvTemplate, buildRecipientsFromRows, guessNameColumn, guessPhoneColumn, uniqueVariableNames, type RecipientDraft } from '@/lib/disparo-whatsapp'

type Parsed = { variables: string[]; rows: Array<Record<string, string>>; fileName: string }

export default function SourceCsv({ onRecipients }: { onRecipients: (r: RecipientDraft[], variables: string[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [phoneCol, setPhoneCol] = useState('')
  const [nameCol, setNameCol] = useState('')
  const [summary, setSummary] = useState<{ valid: number; invalid: number; duplicates: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function downloadTemplate() {
    const blob = new Blob([buildCsvTemplate()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-disparo-whatsapp.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(file: File) {
    setParsing(true)
    setError(null)
    setSummary(null)
    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', raw: false, codepage: 65001 })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][]
      const headerIdx = matrix.findIndex((row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim()))
      if (headerIdx < 0) throw new Error('Planilha vazia.')
      const headers = (matrix[headerIdx] as unknown[]).map((h) => String(h ?? '').trim())
      const variables = uniqueVariableNames(headers.map((h, i) => h || `coluna_${i + 1}`))
      const rows: Array<Record<string, string>> = []
      for (const raw of matrix.slice(headerIdx + 1)) {
        if (!Array.isArray(raw) || !raw.some((c) => String(c ?? '').trim())) continue
        const row: Record<string, string> = {}
        variables.forEach((v, i) => { row[v] = String(raw[i] ?? '').trim() })
        rows.push(row)
      }
      const p: Parsed = { variables, rows, fileName: file.name }
      setParsed(p)
      const guessPhone = guessPhoneColumn(variables) || ''
      const guessName = guessNameColumn(variables) || ''
      setPhoneCol(guessPhone)
      setNameCol(guessName)
      if (guessPhone) apply(p, guessPhone, guessName)
    } catch (err: any) {
      setError(err?.message || 'Não foi possível ler a planilha.')
      setParsed(null)
    }
    setParsing(false)
  }

  function apply(p: Parsed, phone: string, name: string) {
    if (!phone) return
    const result = buildRecipientsFromRows(p.rows, phone, name || null, (_row, index) => ({ row: index + 2, file: p.fileName }))
    setSummary({ valid: result.recipients.length, invalid: result.invalid.length, duplicates: result.duplicates })
    onRecipients(result.recipients, p.variables)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={parsing}>
          {parsing ? <Loader2 size={16} className="spinner" /> : <Upload size={16} />} Selecionar planilha (.csv, .xlsx)
        </button>
        <button type="button" className="btn btn-outline" onClick={downloadTemplate}><Download size={16} /> Baixar modelo CSV</button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>A primeira linha deve ter os nomes das colunas. Cada coluna vira uma variável no editor.</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {parsed && (
        <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.85rem', marginBottom: 8 }}><strong>{parsed.fileName}</strong> — {parsed.rows.length} linha(s), colunas: {parsed.variables.join(', ')}</div>
          <div className="form-grid form-grid-2">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Coluna do telefone <span className="required">*</span></label>
              <select className="form-control" value={phoneCol} onChange={(e) => { setPhoneCol(e.target.value); apply(parsed, e.target.value, nameCol) }}>
                <option value="">Selecione…</option>
                {parsed.variables.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Coluna do nome (opcional)</label>
              <select className="form-control" value={nameCol} onChange={(e) => { setNameCol(e.target.value); apply(parsed, phoneCol, e.target.value) }}>
                <option value="">—</option>
                {parsed.variables.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          {summary && (
            <div style={{ display: 'flex', gap: '1rem', marginTop: 10, fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <span style={{ color: '#15803d', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} /> {summary.valid} válido(s)</span>
              {summary.invalid > 0 && <span style={{ color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={14} /> {summary.invalid} telefone(s) inválido(s) descartado(s)</span>}
              {summary.duplicates > 0 && <span style={{ color: '#b45309' }}>{summary.duplicates} duplicado(s) removido(s)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
