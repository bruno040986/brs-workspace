import Link from 'next/link'
import { MessageSquare, Wifi, WifiOff } from 'lucide-react'
import { getCentralConversasView } from '@/lib/central-conversas/actions'
import { ROTULO_PROVEDOR } from '@/lib/central-conversas/capacidades'
import SaudeWhatsAppOficial from './_components/SaudeWhatsAppOficial'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  desconectada: 'Desconectada',
  aguardando_qr: 'Aguardando QR Code',
  conectando: 'Conectando…',
  conectada: 'Conectada',
  erro: 'Erro',
}

export default async function CentralConversasPage() {
  const view = await getCentralConversasView()

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.5rem' }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)', flexShrink: 0 }}>
          <MessageSquare size={24} />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: 'var(--color-ink)' }}>Comunicação</h1>
      </div>

      {/* CONEXÕES — resumo só de status, sem contagem de mensagens (fica pra depois) */}
      <section className="card" style={{ padding: '1.25rem', marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Conexões</h2>
          <Link href="/central-conversas/canais" className="btn btn-outline btn-sm">Gerenciar conexões</Link>
        </div>

        {view.instancias.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-subtle)', margin: 0 }}>
            Nenhuma conexão criada ainda. <Link href="/central-conversas/canais" style={{ fontWeight: 700 }}>Crie a primeira em Canais</Link>.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {view.instancias.map((i) => {
              const conectada = i.status === 'conectada'
              return (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '0.85rem', padding: '0.5rem 0', borderBottom: '1px solid var(--color-line)' }}>
                  {conectada ? <Wifi size={15} style={{ color: '#059669', flexShrink: 0 }} /> : <WifiOff size={15} style={{ color: 'var(--color-ink-subtle)', flexShrink: 0 }} />}
                  <b style={{ minWidth: 160 }}>{i.nome}</b>
                  <span style={{ color: 'var(--color-ink-subtle)' }}>{ROTULO_PROVEDOR[i.provedor] || i.provedor}</span>
                  {i.numero && <code style={{ fontSize: '0.78rem' }}>+{i.numero}</code>}
                  <span className={`badge ${conectada ? 'badge-success' : i.status === 'erro' ? 'badge-danger' : ''}`} style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {STATUS_LABEL[i.status] || i.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* SAÚDE DO WHATSAPP OFICIAL — seção maior e dedicada; some sozinha sem permissão */}
      <SaudeWhatsAppOficial />
    </div>
  )
}
