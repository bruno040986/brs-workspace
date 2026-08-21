import Link from 'next/link'
import {
  getCentralOverview,
  getOrchestratorStats,
  getVendeaiMeta,
  getWesalesMeta,
} from '../actions'

export const dynamic = 'force-dynamic'

const SLUG = 'clt'

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{title}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', marginBottom: '0.75rem' }}>{subtitle}</div>
      {children}
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return <div style={{ fontSize: '0.85rem', color: '#991B1B' }}>{message}</div>
}

export default async function SistemasPage() {
  const [overview, statsRes, wesalesRes, vendeaiRes] = await Promise.all([
    getCentralOverview(),
    getOrchestratorStats(SLUG),
    getWesalesMeta(SLUG),
    getVendeaiMeta(SLUG),
  ])

  const stats = statsRes.ok ? statsRes.data : null
  const nvti = overview.nvti

  const eventCount = (source: string, window: 'events24h' | 'events7d') =>
    (stats?.[window] ?? []).filter((r) => r.source === source).reduce((acc, r) => acc + r.count, 0)

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Sistemas integrados
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Uma visão por plataforma, com os números que elas não mostram: o que o orquestrador
          recebeu, processou e falhou — e as cotas que a central controla.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        <Section title="WeSales (CRM)" subtitle="Fonte da verdade dos leads — location CLT">
          {wesalesRes.ok ? (
            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
              <div>Tags na location: <strong>{wesalesRes.data.tags.length}</strong></div>
              <div>Campos personalizados: <strong>{wesalesRes.data.customFields.length}</strong></div>
              <div>Funis: <strong>{wesalesRes.data.pipelines.length}</strong></div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>
                Tags e campos alimentam o construtor de público das <Link href="/central-integracoes/acoes" style={{ color: 'var(--brs-navy)' }}>ações manuais</Link>.
              </div>
            </div>
          ) : (
            <ErrorNote message={wesalesRes.error} />
          )}
        </Section>

        <Section title="CallFace (IA de voz)" subtitle="Liga para leads higienizados — agente Núbia, campanha fixa">
          {stats ? (
            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
              <div>Webhooks de ligação (24h): <strong>{eventCount('callface', 'events24h')}</strong></div>
              <div>Webhooks de ligação (7d): <strong>{eventCount('callface', 'events7d')}</strong></div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>
                Resultados (autorizou WhatsApp, interesse, descadastro) são gravados no contato do
                WeSales e visíveis no detalhe de cada evento.
              </div>
            </div>
          ) : (
            <ErrorNote message={statsRes.ok ? 'Sem dados.' : statsRes.error} />
          )}
        </Section>

        <Section title="Vende.AI (WhatsApp IA)" subtitle="Atendimento, simulação e digitação — fluxo CLT">
          <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
            {stats ? (
              <>
                <div>Eventos recebidos (24h): <strong>{eventCount('vendeai', 'events24h')}</strong></div>
                {stats.dailyQuota.length ? (
                  stats.dailyQuota.map((q) => (
                    <div key={q.scope}>Cota diária de API usada hoje: <strong>{q.used}{q.limit ? ` / ${q.limit}` : ''}</strong></div>
                  ))
                ) : (
                  <div>Cota diária de API usada hoje: <strong>0 / 1000</strong></div>
                )}
              </>
            ) : null}
            {vendeaiRes.ok ? (
              <div style={{ marginTop: '0.4rem' }}>
                {vendeaiRes.data.inboxes.map((inbox) => (
                  <div key={String(inbox.id)} style={{ fontSize: '0.85rem' }}>
                    Inbox <strong>{inbox.name}</strong> · {inbox.templates.length} template(s) aprovado(s)
                  </div>
                ))}
                {vendeaiRes.data.inboxes.length === 0 ? <div>Nenhuma inbox retornada.</div> : null}
              </div>
            ) : (
              <ErrorNote message={vendeaiRes.error} />
            )}
          </div>
        </Section>

        <Section title="Nova Vida TI (higienização)" subtitle="Roda dentro do Workspace — consumo e cache">
          {nvti ? (
            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
              <div>Status: <strong>{!nvti.configured ? 'Sem credenciais' : nvti.active ? 'Ativa' : 'Inativa'}</strong></div>
              <div>Consultas no mês: <strong>{nvti.queries30d.total}</strong> ({nvti.queries30d.cached} via cache)</div>
              <div>
                Por origem:{' '}
                {nvti.queries30d.byOrigin.map((o) => `${o.origin}: ${o.count}`).join(' · ') || '—'}
              </div>
              <div>Lotes ativos: <strong>{nvti.activeBatches}</strong></div>
              <div style={{ marginTop: '0.4rem' }}>
                <Link href="/higienizacao-nvti" className="btn btn-outline" style={{ fontSize: '0.8rem' }}>
                  Abrir Higienização NVTI
                </Link>
              </div>
            </div>
          ) : (
            <ErrorNote message="Painel NVTI indisponível." />
          )}
        </Section>
      </div>
    </div>
  )
}
