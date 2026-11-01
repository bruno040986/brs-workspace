import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { LACUNAS_FONTE } from '@/lib/seguranca/lacunas'

export const dynamic = 'force-dynamic'

const GRAVIDADES = ['baixa', 'media', 'alta', 'critica']
const ESTADOS = ['aberto', 'em_analise', 'contido', 'encerrado']
const fmt = (v: string) => new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

// Somente leitura. Permissao propria: seguranca-incidentes (can_view). Dados via views seg_v_* (service_role).
export default async function IncidentesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const permissions = await getCurrentUserEffectivePermissions()
  if (!hasPermission(permissions, 'seguranca-incidentes', 'can_view')) redirect('/acesso-negado')

  const q = await searchParams
  const admin = await createAdminClient()
  let query = admin.from('seg_v_incidentes').select('*').order('atualizado_em', { ascending: false }).limit(200)
  if (q.gravidade && GRAVIDADES.includes(q.gravidade)) query = query.eq('gravidade', q.gravidade)
  if (q.estado && ESTADOS.includes(q.estado)) query = query.eq('estado', q.estado)
  if (q.regra) query = query.ilike('regra', `%${q.regra.replace(/[^a-z0-9_]/gi, '').slice(0, 60)}%`)
  const [{ data, error }, desvios, ultima] = await Promise.all([
    query,
    admin.from('seg_monitor_desvios').select('id, detectado_em, item_tipo, item_chave, tipo_desvio, gravidade, motivo').eq('estado', 'aberto').order('detectado_em', { ascending: false }).limit(50),
    admin.from('seg_config').select('valor, atualizado_em').eq('chave', 'monitor.ultima_execucao').maybeSingle(),
  ])
  const linhas = (data || []) as Array<Record<string, string | number | boolean>>

  return (
    <div style={{ padding: '1.5rem' }}>
      <h1>Segurança › Incidentes</h1>
      <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>
        Monitor de configuração: {ultima.data ? `última execução ${fmt(ultima.data.atualizado_em)}` : 'nunca executou'}.{ultima.data && (ultima.data.valor as { baseline?: boolean })?.baseline === false ? ' Sem baseline: modo absoluto (só violações; nada "novo" é detectado até definir a baseline).' : ''}
        IP e user-agent são dados observados, sem atribuição de autoria. Identidade informada não é identidade validada.
      </p>
      <form method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <select name="gravidade" className="form-control" style={{ maxWidth: 160 }} defaultValue={q.gravidade || ''}>
          <option value="">Gravidade</option>{GRAVIDADES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select name="estado" className="form-control" style={{ maxWidth: 160 }} defaultValue={q.estado || ''}>
          <option value="">Estado</option>{ESTADOS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input name="regra" className="form-control" style={{ maxWidth: 220 }} placeholder="Regra" defaultValue={q.regra} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
      </form>
      {error && <div className="alert alert-error">Não foi possível carregar os incidentes.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: '0.8rem' }}>
          <thead><tr><th>Código</th><th>Gravidade</th><th>Estado</th><th>Regra</th><th>Contexto</th><th>Eventos</th><th>Suprimidos</th><th>Alerta v.</th><th>Intenções abertas</th><th>Atualizado</th></tr></thead>
          <tbody>
            {linhas.map((i) => (
              <tr key={String(i.id)}>
                <td><Link href={`/usuarios/seguranca/incidentes/${String(i.id)}`}>{i.codigo}</Link></td>
                <td>{i.gravidade}</td><td>{i.estado}</td><td>{i.regra}{i.agregado ? ' (volume anômalo)' : ''}</td>
                <td>{String(i.contexto).slice(0, 40)}</td><td>{i.eventos_total}</td><td>{i.eventos_suprimidos}</td>
                <td>{i.versao_alerta}</td><td>{i.intencoes_abertas}</td><td>{fmt(String(i.atualizado_em))}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={10}>Nenhum incidente.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: '2rem' }}>Desvios de configuração abertos</h2>
      <table className="table" style={{ fontSize: '0.8rem' }}>
        <thead><tr><th>Detectado</th><th>Tipo</th><th>Item</th><th>Desvio</th><th>Gravidade</th><th>Motivo</th></tr></thead>
        <tbody>
          {(desvios.data || []).map((d) => (
            <tr key={d.id}><td>{fmt(d.detectado_em)}</td><td>{d.item_tipo}</td><td>{String(d.item_chave).slice(0, 80)}</td><td>{d.tipo_desvio}</td><td>{d.gravidade}</td><td>{d.motivo || '-'}</td></tr>
          ))}
          {(desvios.data || []).length === 0 && <tr><td colSpan={6}>Nenhum.</td></tr>}
        </tbody>
      </table>

      <h2 style={{ marginTop: '2rem' }}>Lacunas de fonte</h2>
      <ul style={{ fontSize: '0.8rem' }}>{LACUNAS_FONTE.map((l) => <li key={l.fonte}><strong>{l.fonte}:</strong> {l.lacuna}</li>)}</ul>
    </div>
  )
}
