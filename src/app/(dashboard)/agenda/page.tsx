import AgendaClient from './_components/AgendaClient'
import { getAgendaBootstrap } from './actions'

export const dynamic = 'force-dynamic'

export default async function AgendaPage() {
  const bootstrap = await getAgendaBootstrap()

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Agenda &amp; Tarefas
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Tarefas da equipe com responsável e status, e compromissos com os envolvidos — tudo em um só lugar.
        </p>
      </div>

      <AgendaClient bootstrap={bootstrap} />
    </div>
  )
}
