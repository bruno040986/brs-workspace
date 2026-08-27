import { MonitoramentoConfigForm } from './MonitoramentoConfigForm'
import { getMonitoramentoConfigView } from './actions'

export const dynamic = 'force-dynamic'

export default async function MonitoramentoConfigPage() {
  const config = await getMonitoramentoConfigView()

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Monitoramento — Alerta de Instabilidade
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          O cron <code>auth-healthcheck</code> checa o Supabase Auth a cada 2 minutos e avisa por WhatsApp
          quando o serviço degrada ou volta ao normal. Configure aqui o número e as mensagens, sem precisar
          mexer em variável de ambiente na Vercel.
        </p>
      </div>

      <MonitoramentoConfigForm config={config} />
    </div>
  )
}
