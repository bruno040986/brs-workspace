// TEMPORARIO — verifica campanhas encerradas x liberação real no WeSales (01/09/2026).
// Protegido pela sessão normal (mesma permissão da tela de Alocação). Remover depois de usar.
import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requirePermission('alvoconsig-gestao')
  const admin = await createAdminClient()
  const { data: campanhas, error } = await admin
    .from('crm_campanhas')
    .select('id, codigo, descricao, status, encerrada_em, agente_parceiro_id, created_at')
    .order('created_at', { ascending: false })
    .limit(15)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const encerradas = (campanhas || []).filter((c) => c.status === 'encerrada' || c.status === 'encerrando')
  const detalhes = await Promise.all(
    encerradas.map(async (c) => {
      const { data: donos } = await admin.from('crm_dono_leads').select('id, wesales_contact_id, revogado_em').eq('campanha_id', c.id)
      const total = donos?.length || 0
      const revogados = (donos || []).filter((d) => d.revogado_em).length
      const naoRevogados = (donos || []).filter((d) => !d.revogado_em)
      const { data: filaPendente } = naoRevogados.length
        ? await admin.from('crm_wesales_queue').select('id, status').in('contato_id', naoRevogados.map((d) => d.id)).in('status', ['pendente', 'processando', 'erro'])
        : { data: [] as any[] }
      return {
        campanha: c.codigo,
        status: c.status,
        encerrada_em: c.encerrada_em,
        totalLeads: total,
        revogadosNoDono: revogados,
        naoRevogados: naoRevogados.length,
        filaPendenteParaOsNaoRevogados: (filaPendente || []).length,
      }
    }),
  )
  return NextResponse.json({ campanhas, detalhes })
}
