import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

type Linha = {
  id: number; criado_em: string; sistema: string; etapa: string; resultado: string; motivo: string
  identidade_informada: string | null; user_id_validado: string | null; request_id: string | null
  ip_observado: string | null; pausa_ate: string | null; alerta: boolean; desbloqueado_por: string | null
}

const RESULTADOS = ['sucesso', 'falha', 'pausa', 'bloqueado', 'erro_infra', 'negado', 'alerta']
const ETAPAS = ['senha', 'identidade', 'totp', 'email', 'ativacao', 'sessao', 'logout', 'admin', 'permissao']

// Somente leitura. Permissao propria: sistema-logs-acessos (can_view).
export default async function LogsAcessosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'sistema-logs-acessos', 'can_view')) redirect('/acesso-negado')

  const q = await searchParams
  const admin = await createAdminClient()
  let query = admin.from('acessos_log').select('id, criado_em, sistema, etapa, resultado, motivo, identidade_informada, user_id_validado, request_id, ip_observado, pausa_ate, alerta, desbloqueado_por').order('criado_em', { ascending: false }).limit(200)
  if (q.resultado && RESULTADOS.includes(q.resultado)) query = query.eq('resultado', q.resultado)
  if (q.etapa && ETAPAS.includes(q.etapa)) query = query.eq('etapa', q.etapa)
  if (q.email) query = query.ilike('identidade_informada', `%${q.email.replace(/[%_,()]/g, '').slice(0, 100)}%`)
  if (q.de && !Number.isNaN(Date.parse(q.de))) query = query.gte('criado_em', new Date(q.de).toISOString())
  if (q.ate && !Number.isNaN(Date.parse(q.ate))) query = query.lte('criado_em', new Date(q.ate).toISOString())
  const { data, error } = await query
  const linhas = (data || []) as Linha[]

  return (
    <div style={{ padding: '1.5rem' }}>
      <h1>Logs de acessos</h1>
      <form method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <input name="email" className="form-control" style={{ maxWidth: 240 }} placeholder="E-mail informado" defaultValue={q.email} />
        <select name="resultado" className="form-control" style={{ maxWidth: 160 }} defaultValue={q.resultado || ''}>
          <option value="">Resultado</option>{RESULTADOS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select name="etapa" className="form-control" style={{ maxWidth: 160 }} defaultValue={q.etapa || ''}>
          <option value="">Etapa</option>{ETAPAS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input name="de" type="datetime-local" className="form-control" style={{ maxWidth: 200 }} defaultValue={q.de} />
        <input name="ate" type="datetime-local" className="form-control" style={{ maxWidth: 200 }} defaultValue={q.ate} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
      </form>
      {error && <div className="alert alert-error">Não foi possível carregar os logs.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: '0.8rem' }}>
          <thead><tr><th>Data</th><th>Sistema</th><th>Etapa</th><th>Resultado</th><th>Motivo</th><th>Informado</th><th>Validado</th><th>IP observado</th><th>Pausa até</th><th>Alerta</th><th>Desbloqueador</th><th>Req.</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                <td>{l.sistema}</td><td>{l.etapa}</td><td>{l.resultado}</td><td>{l.motivo}</td>
                <td>{l.identidade_informada || '-'}</td><td>{l.user_id_validado ? l.user_id_validado.slice(0, 8) : '-'}</td>
                <td>{l.ip_observado || '-'}</td><td>{l.pausa_ate ? new Date(l.pausa_ate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'}</td>
                <td>{l.alerta ? 'sim' : ''}</td><td>{l.desbloqueado_por ? l.desbloqueado_por.slice(0, 8) : ''}</td><td>{l.request_id?.slice(0, 12)}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={12}>Nenhum registro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
