/**
 * Importação de lote para higienização NVTI.
 *
 * Recebe CSV/XLSX/TXT, extrai CPFs de qualquer coluna (com validação de dígito
 * verificador e correção de zeros à esquerda perdidos pelo Excel), deduplica,
 * cria o lote + itens e chama o worker. Exige operacional-nvti (can_include).
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { cleanCpf, isValidCpf } from '@/lib/nvti/normalize'
import { kickNvtiWorker } from '@/lib/nvti/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_CPFS = 100_000
const INSERT_CHUNK = 1000

function extractCpfsFromWorkbook(buffer: Buffer): { valid: string[]; invalid: number } {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true })
  const seen = new Set<string>()
  let invalid = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      for (const cell of row) {
        if (cell === null || cell === undefined || cell === '') continue
        const digits = cleanCpf(String(cell))
        // 9-11 dígitos: cobre CPF que perdeu zeros à esquerda ao virar número.
        if (digits.length < 9 || digits.length > 11) continue
        const cpf = digits.padStart(11, '0')
        if (seen.has(cpf)) continue
        if (isValidCpf(cpf)) {
          seen.add(cpf)
        } else {
          invalid += 1
        }
      }
    }
  }

  return { valid: Array.from(seen), invalid }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'operacional-nvti', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Envie um arquivo CSV, XLSX ou TXT.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo acima de 20MB.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let extraction: { valid: string[]; invalid: number }
    try {
      extraction = extractCpfsFromWorkbook(buffer)
    } catch {
      return NextResponse.json({ error: 'Não foi possível ler o arquivo. Use CSV, XLSX ou TXT.' }, { status: 400 })
    }

    if (!extraction.valid.length) {
      return NextResponse.json(
        { error: `Nenhum CPF válido encontrado no arquivo${extraction.invalid ? ` (${extraction.invalid} sequência(s) com dígito verificador inválido)` : ''}.` },
        { status: 400 },
      )
    }
    if (extraction.valid.length > MAX_CPFS) {
      return NextResponse.json(
        { error: `O arquivo tem ${extraction.valid.length} CPFs — o máximo por lote é ${MAX_CPFS.toLocaleString('pt-BR')}. Divida em arquivos menores.` },
        { status: 400 },
      )
    }

    const admin = await createAdminClient()
    const { data: batch, error: batchError } = await admin
      .from('nvti_batches')
      .insert({
        file_name: String(file.name || 'lote.csv').slice(0, 200),
        status: 'pending',
        total: extraction.valid.length,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (batchError || !batch) {
      return NextResponse.json({ error: 'Falha ao criar o lote.' }, { status: 500 })
    }

    for (let i = 0; i < extraction.valid.length; i += INSERT_CHUNK) {
      const chunk = extraction.valid.slice(i, i + INSERT_CHUNK).map((cpf) => ({ batch_id: batch.id, cpf }))
      const { error: itemsError } = await admin.from('nvti_batch_items').insert(chunk)
      if (itemsError) {
        await admin.from('nvti_batches').update({ status: 'error', last_error: 'Falha ao gravar itens do lote.' }).eq('id', batch.id)
        return NextResponse.json({ error: 'Falha ao gravar os itens do lote.' }, { status: 500 })
      }
    }

    await kickNvtiWorker()

    return NextResponse.json({
      batchId: batch.id,
      total: extraction.valid.length,
      invalid: extraction.invalid,
    })
  } catch (error) {
    console.error('Erro no upload de lote NVTI:', error)
    return NextResponse.json({ error: 'Erro inesperado ao importar o lote.' }, { status: 500 })
  }
}
