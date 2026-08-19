'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Loader2, Save, Rocket, AlertCircle, X } from 'lucide-react'
import { addCampaignRecipients, finalizeCampaign, getCampaign, saveCampaignDraft, listInstancesForCampaign } from '../../actions'
import type { ZapiInstancePublic } from '@/lib/zapi'
import { DEFAULT_ANTIBAN, validateSlots, type CampaignSlotInput } from '@/lib/disparo-whatsapp'
import StepSource from './StepSource'
import StepMessages from './StepMessages'
import StepSettings from './StepSettings'
import { isoToLocal, localToIso, newKey, slotsToInputs, type WizardState } from './wizard-types'

const STEPS = [
  { n: 1, label: 'Base de disparo' },
  { n: 2, label: 'Mensagens' },
  { n: 3, label: 'Envio e agendamento' },
]

function initialState(): WizardState {
  return {
    draftId: null,
    name: '',
    instanceId: '',
    sourceType: 'csv',
    variables: [],
    recipients: [],
    storedRecipientCount: 0,
    recipientsDirty: false,
    blocks: [{ key: newKey(), body: '', media: null, contact: null }],
    settings: {
      delay_min_seconds: 30,
      delay_max_seconds: 90,
      rotate_templates: true,
      rotation_mode: 'sequential',
      antiban_enabled: false,
      antiban: { ...DEFAULT_ANTIBAN },
    },
    schedule: {
      schedule_mode: 'direct',
      start_at_local: '',
      allowed_weekdays: [1, 2, 3, 4, 5],
      restrict_hours: false,
      window_start: '08:00',
      window_end: '18:00',
      slots: [],
    },
  }
}

export default function CampaignWizard() {
  const router = useRouter()
  const params = useSearchParams()
  const draftParam = params.get('draft')
  const [state, setState] = useState<WizardState>(initialState)
  const [step, setStep] = useState(1)
  const [instances, setInstances] = useState<ZapiInstancePublic[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<null | 'draft' | 'start'>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patch = useCallback((p: Partial<WizardState>) => setState((s) => ({ ...s, ...p })), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const inst = await listInstancesForCampaign()
      if (!cancelled && inst.success) {
        setInstances(inst.items)
        const def = inst.items.find((i) => i.is_default) || inst.items[0]
        if (def) setState((s) => (s.instanceId ? s : { ...s, instanceId: def.id }))
      }
      if (draftParam) {
        const res = await getCampaign(draftParam)
        if (!cancelled && res.success && res.detail.campaign.status === 'draft') {
          const c = res.detail.campaign
          setState((s) => ({
            ...s,
            draftId: c.id,
            name: c.name,
            instanceId: c.instance_id,
            sourceType: c.source_type,
            variables: c.variables || [],
            recipients: [],
            storedRecipientCount: c.total_count,
            recipientsDirty: false,
            blocks: res.detail.templates.length
              ? res.detail.templates.map((t) => ({ key: newKey(), body: t.body, media: t.media, contact: t.contact }))
              : s.blocks,
            settings: {
              delay_min_seconds: c.delay_min_seconds,
              delay_max_seconds: c.delay_max_seconds,
              rotate_templates: c.rotate_templates,
              rotation_mode: c.rotation_mode,
              antiban_enabled: !!c.antiban,
              antiban: c.antiban || { ...DEFAULT_ANTIBAN },
            },
            schedule: {
              schedule_mode: c.schedule_mode,
              start_at_local: isoToLocal(c.start_at),
              allowed_weekdays: c.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6],
              restrict_hours: !!(c.window_start && c.window_end),
              window_start: (c.window_start || '08:00').slice(0, 5),
              window_end: (c.window_end || '18:00').slice(0, 5),
              slots: res.detail.slots.map((sl) => {
                const local = isoToLocal(sl.run_at)
                return { key: newKey(), date: local.slice(0, 10), time: local.slice(11, 16), quantity: sl.quantity }
              }),
            },
          }))
        } else if (!cancelled && res.success) {
          setError('Só rascunhos podem ser editados.')
        }
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [draftParam])

  const recipientCount = state.recipientsDirty || !state.draftId ? state.recipients.length : state.storedRecipientCount

  const stepError = useMemo(() => {
    if (step === 1) {
      if (!state.name.trim()) return 'Informe o nome da campanha.'
      if (!state.instanceId) return 'Selecione a instância Z-API.'
      if (recipientCount === 0) return 'Carregue pelo menos um destinatário válido.'
    }
    if (step === 2) {
      if (!state.blocks.some((b) => b.body.trim() || b.media)) return 'Adicione pelo menos um bloco com texto ou mídia.'
    }
    if (step === 3) {
      const s = state.settings
      if (s.delay_min_seconds > s.delay_max_seconds) return 'O delay mínimo não pode ser maior que o máximo.'
      if (state.schedule.allowed_weekdays.length === 0) return 'Selecione pelo menos um dia da semana.'
      if (state.schedule.restrict_hours && state.schedule.window_start >= state.schedule.window_end) return 'O fim da janela precisa ser depois do início.'
      if (state.schedule.schedule_mode === 'batches') {
        const check = validateSlots(slotsToInputs(state.schedule.slots) as CampaignSlotInput[], recipientCount)
        if (!check.ok) return check.error
      }
    }
    return null
  }, [step, state, recipientCount])

  async function persist(startNow: boolean) {
    if (stepError) { setError(stepError); return }
    setSaving(startNow ? 'start' : 'draft')
    setError(null)
    setProgress('Salvando campanha…')
    try {
      const sched = state.schedule
      const res = await saveCampaignDraft({
        id: state.draftId || undefined,
        name: state.name,
        instance_id: state.instanceId,
        source_type: state.sourceType,
        variables: state.variables,
        replace_recipients: state.recipientsDirty || !state.draftId,
        templates: state.blocks.map((b) => ({ body: b.body, media: b.media, contact: b.contact })),
        settings: {
          delay_min_seconds: state.settings.delay_min_seconds,
          delay_max_seconds: state.settings.delay_max_seconds,
          rotate_templates: state.settings.rotate_templates,
          rotation_mode: state.settings.rotation_mode,
          antiban: state.settings.antiban_enabled ? state.settings.antiban : null,
        },
        schedule: {
          schedule_mode: sched.schedule_mode,
          start_at: sched.schedule_mode === 'direct' ? localToIso(sched.start_at_local) : null,
          allowed_weekdays: sched.allowed_weekdays,
          window_start: sched.schedule_mode === 'direct' && sched.restrict_hours ? sched.window_start : null,
          window_end: sched.schedule_mode === 'direct' && sched.restrict_hours ? sched.window_end : null,
          timezone: 'America/Sao_Paulo',
          slots: sched.schedule_mode === 'batches' ? slotsToInputs(sched.slots) : [],
        },
      })
      if (!res.success || !res.id) throw new Error(res.error || 'Falha ao salvar.')
      const campaignId = res.id

      if (state.recipientsDirty || !state.draftId) {
        const chunk = 500
        for (let i = 0; i < state.recipients.length; i += chunk) {
          setProgress(`Gravando destinatários ${Math.min(i + chunk, state.recipients.length)}/${state.recipients.length}…`)
          const r = await addCampaignRecipients(campaignId, state.recipients.slice(i, i + chunk), i)
          if (!r.success) throw new Error(r.error || 'Falha ao gravar destinatários.')
        }
      }

      setProgress(startNow ? 'Iniciando campanha…' : 'Finalizando…')
      const fin = await finalizeCampaign(campaignId, { startNow })
      if (!fin.success) throw new Error(fin.error || 'Falha ao finalizar.')
      router.push(startNow ? `/disparo-whatsapp/${campaignId}` : '/disparo-whatsapp')
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar campanha.')
      setSaving(null)
      setProgress(null)
    }
  }

  if (loading) {
    return <div className="page-content" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--brs-gray-600)' }}><Loader2 className="spinner" size={16} /> Carregando…</div>
  }

  return (
    <div className="page-content" style={{ paddingBottom: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Link href="/disparo-whatsapp" className="btn btn-ghost" style={{ padding: '6px 10px' }}><ArrowLeft size={16} /> Campanhas</Link>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>{state.draftId ? 'Editar rascunho' : 'Nova campanha de WhatsApp'}</h1>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {STEPS.map((s) => {
          const done = step > s.n
          const active = step === s.n
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => { if (s.n < step) setStep(s.n) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.9rem', borderRadius: 999, cursor: s.n < step ? 'pointer' : 'default',
                border: `1px solid ${active ? 'var(--brs-navy)' : done ? '#16a34a' : 'var(--brs-gray-200)'}`,
                background: active ? 'rgba(27,58,107,0.08)' : done ? 'rgba(22,163,74,0.08)' : 'var(--brs-surface)',
                color: active ? 'var(--brs-navy)' : done ? '#15803d' : 'var(--brs-gray-500)', fontWeight: 700, fontSize: '0.85rem',
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--brs-navy)' : done ? '#16a34a' : 'var(--brs-gray-200)', color: '#fff', fontSize: '0.75rem' }}>
                {done ? <Check size={12} /> : s.n}
              </span>
              {s.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {step === 1 && <StepSource state={state} patch={patch} instances={instances} />}
      {step === 2 && <StepMessages state={state} patch={patch} />}
      {step === 3 && <StepSettings state={state} patch={patch} recipientCount={recipientCount} />}

      {/* Barra inferior */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, background: 'var(--brs-surface)', borderTop: '1px solid var(--brs-gray-200)',
        padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', boxShadow: '0 -6px 20px rgba(0,0,0,0.06)',
      }}>
        <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
          <strong>{recipientCount}</strong> destinatário(s) · <strong>{state.blocks.filter((b) => b.body.trim() || b.media).length}</strong> bloco(s)
          {state.settings.antiban_enabled ? ' · botão anti-ban' : ''}
          {state.schedule.schedule_mode === 'batches' ? ` · ${state.schedule.slots.length} lote(s)` : state.schedule.start_at_local ? ` · início ${new Date(state.schedule.start_at_local).toLocaleString('pt-BR')}` : ' · inicia ao salvar'}
          {progress && <span style={{ marginLeft: 12, color: 'var(--brs-navy)' }}><Loader2 size={12} className="spinner" /> {progress}</span>}
          {stepError && !progress && <span style={{ marginLeft: 12, color: '#b45309' }}>{stepError}</span>}
        </div>
        {step > 1 && <button type="button" className="btn btn-outline" disabled={!!saving} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Voltar</button>}
        {step < 3 ? (
          <button type="button" className="btn btn-primary" disabled={!!stepError} onClick={() => setStep(step + 1)}>Avançar <ArrowRight size={16} /></button>
        ) : (
          <>
            <button type="button" className="btn btn-outline" disabled={!!saving || !!stepError} onClick={() => persist(false)}>{saving === 'draft' ? <Loader2 size={16} className="spinner" /> : <Save size={16} />} Salvar rascunho</button>
            <button type="button" className="btn btn-success" disabled={!!saving || !!stepError} onClick={() => persist(true)}>{saving === 'start' ? <Loader2 size={16} className="spinner" /> : <Rocket size={16} />} {state.schedule.schedule_mode === 'batches' || state.schedule.start_at_local ? 'Salvar e agendar' : 'Salvar e iniciar'}</button>
          </>
        )}
      </div>
    </div>
  )
}
