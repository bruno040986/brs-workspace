// TEMPORARIO — investiga encerramento de campanha que nao libera leads (01/09/2026). Remover apos o uso.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('x-diag-token') !== '46e33443acd942789cfd50926b3b9945271591fa725bd0fb') {
    return NextResponse.json({ error: 'nope' }, { status: 401 })
  }
  const admin = await createAdminClient()
  const [campanhas, filaRecente] = await Promise.all([
    admin.from('crm_campanhas').select('id, codigo, descricao, status, encerrada_em, agente_parceiro_id, created_at').order('created_at', { ascending: false }).limit(6),
    admin.from('crm_wesales_queue').select('id, operacao, contato_id, payload, status, tentativas, ultimo_erro, created_at').order('created_at', { ascending: false }).limit(15),
  ])
  const campanhaIds = (campanhas.data || []).map((c: any) => c.id)
  const donos = campanhaIds.length
    ? await admin.from('crm_dono_leads').select('id, wesales_contact_id, campanha_id, revogado_em, alocado_por').in('campanha_id', campanhaIds).order('id', { ascending: false }).limit(20)
    : { data: [] as any[] }
  return NextResponse.json({
    campanhas: campanhas.data, campanhasErro: campanhas.error?.message ?? null,
    filaRecente: filaRecente.data, filaErro: filaRecente.error?.message ?? null,
    donos: donos.data, donosErro: (donos as any).error?.message ?? null,
  })
}
