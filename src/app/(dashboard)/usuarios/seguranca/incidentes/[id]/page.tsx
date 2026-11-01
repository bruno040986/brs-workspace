import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-')

export default async function IncidenteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'seguranca-incidentes', 'can_view')) redirect('/acesso-negado')

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const admin = await createAdminClient()
  const { data: inc } = await admin.from('seg_v_incidentes').select('*').eq('id', id).maybeSingle()
  if (!inc) notFound()
  const [eventos, intencoes] = await Promise.all([
    admin.from('seg_v_incidente_eventos').select('*').eq('incidente_id', id).order('ocorrido_em', { ascending: false }).limit(200),
    admin.from('seg_v_intencoes').select('*').eq('incidente_id', id).order('versao_alerta', { ascending: false }),
  ])

  return (
    <div style={{ padding: '1.5rem' }}>
      <Link href="/usuarios/seguranca/incidentes">← Incidentes</Link>
      <h1>{inc.codigo} · {inc.gravidade} · {inc.estado}</h1>
      <p style={{ fontSize: '0.85rem' }}>
        Regra {inc.regra} · contexto {String(inc.contexto)} · janela {fmt(inc.janela_inicio)} a {fmt(inc.janela_fim)} ·
        {' '}{inc.eventos_total} eventos ({inc.eventos_suprimidos} sem vínculo/suprimidos) · alerta v.{inc.versao_alerta}
      </p>
      <h2>Intenções de notificação</h2>
      <table className="table" style={{ fontSize: '0.8rem' }}>
        <thead><tr><th>Versão</th><th>Tipo</th><th>Prioridade</th><th>Estado</th><th>Destino</th><th>Tentativas</th><th>Criada</th></tr></thead>
        <tbody>
          {(intencoes.data || []).map((n) => (
            <tr key={n.id}><td>{n.versao_alerta}</td><td>{n.tipo}</td><td>{n.prioridade}</td><td>{n.estado}</td><td>{n.destino_logico}</td><td>{n.tentativas}</td><td>{fmt(n.criado_em)}</td></tr>
          ))}
          {(intencoes.data || []).length === 0 && <tr><td colSpan={7}>Nenhuma (média/baixa vão a resumo).</td></tr>}
        </tbody>
      </table>
      <h2>Eventos (identidade informada × validada)</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: '0.8rem' }}>
          <thead><tr><th>Quando</th><th>Fonte</th><th>Tipo</th><th>Informada</th><th>Validada</th><th>IP observado</th><th>Req.</th><th>Payload</th></tr></thead>
          <tbody>
            {(eventos.data || []).map((e) => (
              <tr key={e.evento_id}>
                <td>{fmt(e.ocorrido_em)}</td><td>{e.fonte}</td><td>{e.tipo}</td><td>{e.identidade_informada || '-'}</td>
                <td>{e.identidade_validada_user_id ? String(e.identidade_validada_user_id).slice(0, 8) : '-'}</td>
                <td>{e.ip_observado || '-'}</td><td>{e.request_id ? String(e.request_id).slice(0, 12) : ''}</td>
                <td><code>{JSON.stringify(e.payload).slice(0, 160)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
