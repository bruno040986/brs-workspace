import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'
import { titularesDosNumeros } from '@/lib/promocoes/direitos-service'
import { mascararCpf } from '@/lib/promocoes/mascara'

/* eslint-disable @typescript-eslint/no-explicit-any */

const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requirePermission('comercial-promocoes')
  } catch {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }
  const { slug } = await params
  const db: any = await createAdminClient()
  const { data: camp } = await db.from('promocao_campanhas').select('id').eq('slug', slug).maybeSingle()
  if (!camp) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 })
  const { data } = await db.from('promocao_numeros').select('numero, status, titular_tipo, titular_id, created_at, motivo').eq('campanha_id', camp.id).order('numero')
  const tit = await titularesDosNumeros(db, data || [])
  const linhas = [['Numero', 'Titular', 'CPF (mascarado)', 'Tipo', 'Status', 'Gerado em', 'Motivo']]
  for (const n of data || []) {
    const t = tit.get(`${n.titular_tipo}:${n.titular_id}`)
    linhas.push([String(n.numero).padStart(5, '0'), t?.nome || '', t ? mascararCpf(t.cpf) : '', n.titular_tipo === 'indicador' ? 'Indicador' : 'Servidor', n.status, n.created_at, n.motivo || ''])
  }
  return new NextResponse('﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="numeros-${slug}.csv"` },
  })
}
