import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hasPermissionForUser, requireApiUser } from '@/lib/auth/server'
import {
  QUARKRH_COLUMN_MAP, DATE_FIELDS, MONEY_FIELDS, BOOLEAN_FIELDS,
  normalizeCpf, validateCpf, parseDate, parseMoney, parseBoolean
} from '@/lib/import/columnMap'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser()
    const canImport = user ? await hasPermissionForUser(user.id, 'rh-importacoes', 'can_include') : false
    if (user && !canImport) return NextResponse.json({ error: 'Sem permissao.' }, { status: 403 })
    const supabase = await createAdminClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]

    // O arquivo do QuarkRH tem título na linha 0 e cabeçalhos na linha 1
    const headerRowIndex = rawData.findIndex((row: unknown[]) =>
      row.some((cell: unknown) => String(cell ?? '').trim() === 'Colaborador' || String(cell ?? '').trim() === 'CPF')
    )
    if (headerRowIndex === -1) {
      return NextResponse.json({ error: 'Formato de arquivo não reconhecido. Verifique se é um relatório do QuarkRH.' }, { status: 400 })
    }

    const headers = (rawData[headerRowIndex] as unknown[]).map((h: unknown) => String(h ?? '').trim())
    const dataRows = rawData.slice(headerRowIndex + 1).filter((row: unknown[]) =>
      row.some((cell: unknown) => cell !== null && cell !== undefined && cell !== '')
    )

    let created = 0, updated = 0, errorCount = 0
    const errors: { row: number; cpf: string; error: string }[] = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[]
      try {
        // Mapear colunas para campos internos
        const record: Record<string, unknown> = {}
        headers.forEach((header, colIdx) => {
          const fieldName = QUARKRH_COLUMN_MAP[header]
          if (!fieldName) return
          let value: unknown = row[colIdx]
          
          if (DATE_FIELDS.includes(fieldName)) value = parseDate(value)
          else if (MONEY_FIELDS.includes(fieldName)) value = parseMoney(value)
          else if (BOOLEAN_FIELDS.includes(fieldName)) value = parseBoolean(value)
          else if (value !== null && value !== undefined) value = String(value).trim() || null
          
          record[fieldName] = value ?? null
        })

        // CPF é obrigatório
        const cpfRaw = String(record['cpf'] ?? '').trim()
        if (!cpfRaw) { errors.push({ row: i + 2, cpf: '', error: 'CPF ausente' }); errorCount++; continue }
        const cpf = normalizeCpf(cpfRaw)
        if (!validateCpf(cpf)) { errors.push({ row: i + 2, cpf, error: 'CPF inválido' }); errorCount++; continue }
        record['cpf'] = cpf

        // Nome é obrigatório
        if (!record['name']) { errors.push({ row: i + 2, cpf, error: 'Nome ausente' }); errorCount++; continue }

        // Status padrão
        if (!record['status']) {
          record['status'] = record['termination_date'] ? 'terminated' : 'active'
        }
        if (!record['vt_status']) record['vt_status'] = 'sem_informacao'

        // Upsert por CPF
        const { data: existing } = await supabase
          .from('employees')
          .select('id')
          .eq('cpf', cpf)
          .single()

        if (existing) {
          const { error: updateErr } = await supabase
            .from('employees')
            .update({ ...record, updated_at: new Date().toISOString() })
            .eq('cpf', cpf)
          
          if (updateErr) throw new Error(`Erro ao atualizar: ${updateErr.message}`)
          updated++
        } else {
          const { error: insertErr } = await supabase
            .from('employees')
            .insert(record)
          
          if (insertErr) throw new Error(`Erro ao inserir: ${insertErr.message}`)
          created++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido'
        errors.push({ 
          row: i + 2, 
          cpf: String((dataRows[i] as unknown[])[headers.indexOf('CPF')] ?? 'Desconhecido'), 
          error: message 
        })
        errorCount++
      }
    }

    // Salvar log de importação
    await supabase.from('import_logs').insert({
      file_name: file.name,
      imported_by: user.id,
      total_rows: dataRows.length,
      created_count: created,
      updated_count: updated,
      error_count: errorCount,
      errors_json: errors,
    })

    // Log de auditoria
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'import_employees',
      entity_type: 'employees',
      description: `Importação: ${file.name} | ${created} criados, ${updated} atualizados, ${errorCount} erros`,
    })

    return NextResponse.json({ success: true, total: dataRows.length, created, updated, errors: errorCount, errorDetails: errors })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
