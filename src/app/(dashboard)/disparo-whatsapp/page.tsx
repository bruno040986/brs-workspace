'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, RefreshCw, Loader2, MessageSquare, AlertCircle, X, Zap } from 'lucide-react'
import { listCampaigns, startCampaign, pauseCampaign, cancelCampaign, refreshCampaignCounters, deleteCampaign, pokeWorker } from './actions'
import CampaignCard from './_components/CampaignCard'
import type { CampaignRecord } from '@/lib/disparo-whatsapp'
import type { ZapiInstancePublic } from '@/lib/zapi'

export default function DisparoWhatsappPage() {
  const [items, setItems] = useState<CampaignRecord[]>([])
  const [instances, setInstances] = useState<ZapiInstancePublic[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await listCampaigns()
    if (res.success) {
      setItems(res.items)
      setInstances(res.instances)
      setError(null)
    } else setError(res.error || 'Erro ao carregar campanhas.')
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Polling enquanto houver campanha em execução/agendada
  useEffect(() => {
    const active = items.some((c) => c.status === 'running' || c.status === 'scheduled')
    if (timer.current) clearInterval(timer.current)
    if (active) timer.current = setInterval(() => load(true), 15000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [items, load])

  async function run(id: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusyId(id)
    const res = await fn()
    if (!res.success) setError(res.error || 'Falha na operação.')
    await load(true)
    setBusyId(null)
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={22} style={{ color: '#25D366' }} /> Suas Campanhas
          </h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Panorama dos disparos de WhatsApp: inicie, pause, cancele e acompanhe entregas.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={() => run('poke', pokeWorker)} title="Forçar o processamento agora"><Zap size={16} /> Processar agora</button>
          <button type="button" className="btn btn-outline" onClick={() => load()} title="Atualizar"><RefreshCw size={16} /></button>
          <Link href="/disparo-whatsapp/nova" className="btn btn-primary"><Plus size={16} /> Nova campanha</Link>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--brs-gray-600)', padding: '2rem' }}><Loader2 className="spinner" size={16} /> Carregando…</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', color: 'var(--brs-gray-300)' }} />
          Nenhuma campanha ainda. Clique em <strong>Nova campanha</strong> para cadastrar o primeiro disparo.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {items.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              instance={instances.find((i) => i.id === c.instance_id) || null}
              busy={busyId === c.id}
              onStart={() => run(c.id, () => startCampaign(c.id))}
              onPause={() => run(c.id, () => pauseCampaign(c.id))}
              onCancel={() => { if (window.confirm(`Cancelar a campanha "${c.name}"? Os pendentes não serão enviados.`)) run(c.id, () => cancelCampaign(c.id)) }}
              onRefresh={() => run(c.id, () => refreshCampaignCounters(c.id))}
              onDelete={() => { if (window.confirm(`Excluir a campanha "${c.name}" e todo o histórico dela?`)) run(c.id, () => deleteCampaign(c.id)) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
