/**
 * Exportação CSV do resultado de um lote de higienização NVTI.
 * Separador ';' e BOM UTF-8 (abre certo no Excel BR). Inclui uma linha por CPF
 * do lote; CPFs com erro saem com a coluna ERRO preenchida.
 */

import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { csvHeaderLine, flattenForCsv } from '@/lib/nvti/normalize'
import type { NvtiResultado } from '@/lib/nvti/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PAGE = 1000

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await ctx.params
  const batchId = String(params?.id || '')
  if (!batchId) return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  const allowed = await hasPermissionForUser(user.id, 'operacional-nvti', 'can_view')
  if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const admin = await createAdminClient()
  const { data: batch } = await admin
    .from('nvti_batches')
    .select('id, file_name')
    .eq('id', batchId)
    .maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Lote não encontrado.' }, { status: 404 })

  const lines: string[] = [`${csvHeaderLine()};STATUS;ERRO`]

  for (let offset = 0; ; offset += PAGE) {
    const { data: items } = await admin
      .from('nvti_batch_items')
      .select('cpf, status, error, query_id')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (!items || !items.length) break

    const queryIds = items.map((item) => item.query_id).filter(Boolean) as string[]
    const responses = new Map<string, NvtiResultado>()
    for (let i = 0; i < queryIds.length; i += 200) {
      const slice = queryIds.slice(i, i + 200)
      const { data: queries } = await admin
        .from('nvti_queries')
        .select('id, response')
        .in('id', slice)
      for (const query of queries || []) {
        if (query.response) responses.set(String(query.id), query.response as NvtiResultado)
      }
    }

    for (const item of items) {
      const resultado = item.query_id ? responses.get(String(item.query_id)) : undefined
      if (resultado) {
        lines.push(`${flattenForCsv(resultado)};OK;`)
      } else {
        const emptyCells = csvHeaderLine().split(';').length - 1
        const status = item.status === 'error' ? 'ERRO' : 'PENDENTE'
        lines.push(`${item.cpf}${';'.repeat(emptyCells)};${status};${String(item.error || '').replace(/[;\n"]/g, ' ')}`)
      }
    }

    if (items.length < PAGE) break
  }

  const csv = `﻿${lines.join('\r\n')}`
  const safeName = String(batch.file_name || 'lote').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 80)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="higienizacao_${safeName}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
