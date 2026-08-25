'use client'

/**
 * Ações manuais da Central de Integrações.
 *
 * Wizard em 4 passos (ação -> público -> preview -> confirmar) + lista de jobs
 * com progresso ao vivo e pause/resume/cancel. O público é sempre um filtro
 * sobre o WeSales; bases subidas aparecem como tags `base-*`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Loader2, Pause, Play,
  Plus, RefreshCw, Rocket, Trash2, X,
} from 'lucide-react'
import {
  centralJobOp,
  createCentralJob,
  getCentralJob,
  listCentralJobs,
  previewCentralAudience,
  type AudiencePreview,
  type VendeaiMeta,
  type WesalesMeta,
} from '../actions'
import {
  JOB_ACTION_LABEL,
  JOB_STATUS_LABEL,
  type AudienceDefinition,
  type CentralJob,
  type CentralJobItem,
  type JobAction,
} from '../types'

const WIZARD_ACTIONS: JobAction[] = ['callface_calls', 'vendeai_template', 'vendeai_leads', 'nvti_hygiene']

const ACTION_HINT: Record<string, string> = {
  callface_calls:
    'Cada contato vira uma ligação da agente de voz. Ritmo conservador (10/min) e janela 09h-19h seg-sex por padrão — ajuste abaixo se precisar.',
  vendeai_template:
    'Dispara um template Meta aprovado pela inbox oficial da Vende.AI. Respeita 10/min e o teto de 1000 chamadas/dia da API.',
  vendeai_leads:
    'Pré-cadastra os contatos na Vende.AI (a IA pula perguntas já respondidas). Expira em 7 dias — repita se a campanha continuar.',
  nvti_hygiene:
    'Higieniza os CPFs do público na Nova Vida TI (cache de 30 dias, sem custo quando reaproveita) e grava celular/WhatsApp no contato do WeSales.',
}

function fmt(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function TagPicker({ label, hint, all, selected, onChange }: {
  label: string
  hint?: string
  all: string[]
  selected: string[]
  onChange: (tags: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const options = useMemo(
    () => all.filter((t) => t.toLowerCase().includes(query.toLowerCase()) && !selected.includes(t)).slice(0, 12),
    [all, query, selected],
  )
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>{label}</div>
      {hint ? <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginBottom: 4 }}>{hint}</div> : null}
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: 6 }}>
        {selected.map((tag) => (
          <span key={tag} className="badge badge-navy" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {tag}
            <X size={11} style={{ cursor: 'pointer' }} onClick={() => onChange(selected.filter((t) => t !== tag))} />
          </span>
        ))}
        {selected.length === 0 ? <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Nenhuma selecionada</span> : null}
      </div>
      <input
        className="form-input"
        placeholder="Buscar tag…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 320 }}
      />
      {query && options.length ? (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: 6 }}>
          {options.map((tag) => (
            <button key={tag} type="button" className="badge badge-gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => { onChange([...selected, tag]); setQuery('') }}>
              <Plus size={10} /> {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function ActionsClient({ slug, initialJobs, jobsError, wesalesMeta, vendeaiMeta }: {
  slug: string
  initialJobs: CentralJob[]
  jobsError: string | null
  wesalesMeta: WesalesMeta | null
  vendeaiMeta: VendeaiMeta | null
}) {
  const [jobs, setJobs] = useState(initialJobs)
  const [error, setError] = useState<string | null>(jobsError)
  const [busy, setBusy] = useState(false)

  // ------- wizard -------
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [action, setAction] = useState<JobAction>('callface_calls')
  const [label, setLabel] = useState('')
  const [tagsAny, setTagsAny] = useState<string[]>([])
  const [tagsAll, setTagsAll] = useState<string[]>([])
  const [tagsNone, setTagsNone] = useState<string[]>([])
  const [cfKey, setCfKey] = useState('')
  const [cfValue, setCfValue] = useState('')
  const [inboxId, setInboxId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateParams, setTemplateParams] = useState('')
  const [templateMessage, setTemplateMessage] = useState('')
  const [perMinute, setPerMinute] = useState(10)
  const [windowStart, setWindowStart] = useState('09:00')
  const [windowEnd, setWindowEnd] = useState('19:00')
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  // ------- job detail -------
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<CentralJobItem[]>([])

  const audience: AudienceDefinition = useMemo(() => ({
    ...(tagsAny.length ? { tagsAny } : {}),
    ...(tagsAll.length ? { tagsAll } : {}),
    ...(tagsNone.length ? { tagsNone } : {}),
    ...(cfKey && cfValue ? { customFields: [{ key: cfKey, value: cfValue }] } : {}),
    excludeDnd: true,
  }), [tagsAny, tagsAll, tagsNone, cfKey, cfValue])

  const hasAudience = Boolean(tagsAny.length || tagsAll.length || tagsNone.length || (cfKey && cfValue))

  const refreshJobs = useCallback(async () => {
    setBusy(true)
    const res = await listCentralJobs(slug)
    if (res.ok) { setJobs(res.data.jobs); setError(null) } else setError(res.error)
    setBusy(false)
  }, [slug])

  const hasActive = jobs.some((j) => ['loading', 'queued', 'materializing', 'running', 'waiting_window'].includes(j.status))
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(refreshJobs, 10_000)
    return () => clearInterval(timer)
  }, [hasActive, refreshJobs])

  const runPreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreview(null)
    const res = await previewCentralAudience(slug, audience)
    if (res.ok) setPreview(res.data)
    else setError(res.error)
    setPreviewLoading(false)
  }, [slug, audience])

  const resetWizard = () => {
    setStep(1); setLabel(''); setTagsAny([]); setTagsAll([]); setTagsNone([])
    setCfKey(''); setCfValue(''); setPreview(null); setTemplateParams(''); setTemplateMessage('')
  }

  const confirm = useCallback(async () => {
    setCreating(true)
    setError(null)
    const params: Record<string, unknown> = {}
    const pacing: Record<string, unknown> = {}
    if (action === 'vendeai_template') {
      const [name, category] = templateName.split('|')
      params.inboxId = inboxId
      params.templateName = name
      params.templateCategory = category || 'MARKETING'
      params.templateMessage = templateMessage.trim()
      if (templateParams.trim()) {
        const map: Record<string, string> = {}
        // Cada linha e uma variavel. Posicional: "valor" -> {"1": valor}.
        // Nomeada (template NAMED da Meta): "nome=valor" -> {"nome": valor}.
        templateParams.split('\n').forEach((line, i) => {
          const value = line.trim()
          if (!value) return
          const eq = value.indexOf('=')
          if (eq > 0) map[value.slice(0, eq).trim()] = value.slice(eq + 1).trim()
          else map[String(i + 1)] = value
        })
        params.templateParams = map
      }
    }
    if (action === 'callface_calls') {
      pacing.perMinute = perMinute
      pacing.windowStart = windowStart
      pacing.windowEnd = windowEnd
      pacing.days = [1, 2, 3, 4, 5]
    }
    const res = await createCentralJob(slug, { action, label: label || JOB_ACTION_LABEL[action], audience, params, pacing })
    if (res.ok) {
      setCreated(res.data.job.id)
      setWizardOpen(false)
      resetWizard()
      await refreshJobs()
    } else {
      setError(res.error)
    }
    setCreating(false)
  }, [slug, action, label, audience, inboxId, templateName, templateMessage, templateParams, perMinute, windowStart, windowEnd, refreshJobs])

  const doOp = useCallback(async (id: string, op: 'pause' | 'resume' | 'cancel') => {
    const res = await centralJobOp(slug, id, op)
    if (!res.ok) setError(res.error)
    await refreshJobs()
  }, [slug, refreshJobs])

  const openDetail = useCallback(async (id: string) => {
    if (detailId === id) { setDetailId(null); return }
    setDetailId(id)
    setDetailItems([])
    const res = await getCentralJob(slug, id, true)
    if (res.ok) setDetailItems(res.data.items ?? [])
  }, [slug, detailId])

  const tags = wesalesMeta?.tags ?? []
  const selectedTemplate = useMemo(() => {
    const [name] = templateName.split('|')
    return (vendeaiMeta?.inboxes ?? []).filter((i) => String(i.id) === inboxId).flatMap((i) => i.templates).find((t) => t.name === name) ?? null
  }, [vendeaiMeta, inboxId, templateName])
  const expectedParams = selectedTemplate?.paramCount ?? 0
  const filledParams = templateParams.split('\n').map((l) => l.trim()).filter(Boolean).length
  const paramsOk = action !== 'vendeai_template' || filledParams === expectedParams

  const pickTemplate = (value: string) => {
    setTemplateName(value)
    const [name] = value.split('|')
    const t = (vendeaiMeta?.inboxes ?? []).filter((i) => String(i.id) === inboxId).flatMap((i) => i.templates).find((x) => x.name === name)
    if (!t) return
    // Pré-preenche: corpo do template com {primeiro_nome} no lugar de cada {{…}},
    // e uma variável por linha (todas com {primeiro_nome} — ajuste se precisar).
    const body = t.body ?? ''
    setTemplateMessage(body.replace(/\{\{[^}]*\}\}/g, '{primeiro_nome}'))
    setTemplateParams(Array.from({ length: t.paramCount ?? 0 }, () => '{primeiro_nome}').join('\n'))
  }
  const canNext = step === 1 ? Boolean(action) && (action !== 'vendeai_template' || (inboxId && templateName && templateMessage.trim() && paramsOk)) : step === 2 ? hasAudience : true

  return (
    <div>
      {error ? (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <AlertCircle size={16} /> <span style={{ flex: 1 }}>{error}</span>
          <X size={16} style={{ cursor: 'pointer' }} onClick={() => setError(null)} />
        </div>
      ) : null}
      {created ? (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 10, background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <CheckCircle size={16} /> Job criado e enviado ao orquestrador. Acompanhe o progresso abaixo.
          <X size={16} style={{ cursor: 'pointer', marginLeft: 'auto' }} onClick={() => setCreated(null)} />
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.9rem' }}>
        <button className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { setWizardOpen(!wizardOpen); setStep(1) }}>
          <Rocket size={15} /> Nova ação
        </button>
        <button className="btn btn-outline" onClick={refreshJobs} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {busy ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />} Atualizar
        </button>
      </div>

      {wizardOpen ? (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', border: '1px solid var(--brs-gold)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.8rem', fontWeight: 700 }}>
            {['1. Ação', '2. Público', '3. Preview', '4. Confirmar'].map((s, i) => (
              <span key={s} style={{ padding: '0.3rem 0.7rem', borderRadius: 999, background: step === i + 1 ? 'var(--brs-navy)' : 'var(--brs-gray-50)', color: step === i + 1 ? '#fff' : 'var(--brs-gray-500)' }}>{s}</span>
            ))}
          </div>

          {step === 1 ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                {WIZARD_ACTIONS.map((a) => (
                  <div key={a} onClick={() => setAction(a)} style={{ cursor: 'pointer', padding: '0.9rem', borderRadius: 10, border: `2px solid ${action === a ? 'var(--brs-navy)' : 'var(--brs-gray-100)'}`, background: action === a ? '#eff6ff' : '#fff' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--brs-gray-900)' }}>{JOB_ACTION_LABEL[a]}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)', marginBottom: '1rem' }}>{ACTION_HINT[action]}</div>

              <input className="form-input" placeholder="Nome do job (ex.: Ligações elegíveis agosto)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 420, marginBottom: '0.9rem' }} />

              {action === 'vendeai_template' ? (
                <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 480 }}>
                  <select className="form-input" value={inboxId} onChange={(e) => setInboxId(e.target.value)}>
                    <option value="">Escolha a inbox…</option>
                    {(vendeaiMeta?.inboxes ?? []).map((i) => <option key={String(i.id)} value={String(i.id)}>{i.name}</option>)}
                  </select>
                  <select className="form-input" value={templateName} onChange={(e) => pickTemplate(e.target.value)} disabled={!inboxId}>
                    <option value="">Escolha o template…</option>
                    {(vendeaiMeta?.inboxes ?? []).filter((i) => String(i.id) === inboxId).flatMap((i) => i.templates).map((t) => (
                      <option key={t.name} value={`${t.name}|${t.category}`}>{t.name} ({t.category})</option>
                    ))}
                  </select>
                  {selectedTemplate ? (
                    <div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginBottom: 6 }}>
                        Preview aprovado na Meta · {expectedParams} variável(is)
                        {selectedTemplate.parameterFormat === 'NAMED' ? ' · formato NOMEADO: preencha cada variável como nome=valor (ex.: nome={primeiro_nome})' : ' · formato posicional: uma linha por {{1}}, {{2}}…'}
                      </div>
                      <div style={{ background: '#e5ddd5', borderRadius: 10, padding: '0.9rem', maxWidth: 380 }}>
                        <div style={{ background: '#fff', borderRadius: 8, padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#111', whiteSpace: 'pre-wrap', boxShadow: '0 1px 1px rgba(0,0,0,.08)' }}>
                          {selectedTemplate.header ? <div style={{ fontWeight: 700, marginBottom: 6 }}>{selectedTemplate.header}</div> : null}
                          {selectedTemplate.body || '(sem corpo retornado)'}
                          {selectedTemplate.footer ? <div style={{ color: '#8696a0', fontSize: '0.75rem', marginTop: 6 }}>{selectedTemplate.footer}</div> : null}
                        </div>
                        {(selectedTemplate.buttons ?? []).map((b) => (
                          <div key={b} style={{ background: '#fff', borderRadius: 8, padding: '0.5rem', marginTop: 4, textAlign: 'center', color: '#00a884', fontSize: '0.85rem', fontWeight: 600 }}>↩ {b}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <textarea className="form-input" rows={3} placeholder={'Texto da mensagem (obrigatório) — espelho do corpo do template aprovado na Meta. A Vende.AI usa isso para registrar a conversa no CRM; o envio real sai pelo template.\nPlaceholders: {nome} {primeiro_nome} {telefone} {cpf}'} value={templateMessage} onChange={(e) => setTemplateMessage(e.target.value)} />
                  <textarea className="form-input" rows={2} placeholder={'Variáveis do template, uma por linha (linha 1 = {{1}}, etc.) — opcional.\nPlaceholders: {nome} {primeiro_nome} {telefone} {cpf}'} value={templateParams} onChange={(e) => setTemplateParams(e.target.value)} />
                  {selectedTemplate && !paramsOk ? (
                    <div style={{ fontSize: '0.78rem', color: '#991B1B' }}>
                      O template espera {expectedParams} variável(is) e você preencheu {filledParams} — a Meta rejeita o envio se não bater (#132000).
                    </div>
                  ) : null}
                  {!vendeaiMeta ? <div style={{ fontSize: '0.78rem', color: '#92400E' }}>Inboxes indisponíveis (orquestrador offline ou WABA pendente).</div> : null}
                </div>
              ) : null}

              {action === 'callface_calls' ? (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Ritmo (contatos/min)
                    <input type="number" min={1} max={60} className="form-input" value={perMinute} onChange={(e) => setPerMinute(Number(e.target.value) || 10)} style={{ width: 90, marginLeft: 6 }} />
                  </label>
                  <label style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Janela
                    <input type="time" className="form-input" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={{ width: 110, marginLeft: 6 }} />
                  </label>
                  <span style={{ color: 'var(--brs-gray-400)' }}>até</span>
                  <input type="time" className="form-input" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={{ width: 110 }} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>seg-sex (América/São Paulo)</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <TagPicker label="Contato tem QUALQUER uma destas tags" hint="Bases subidas aparecem como tags base-*" all={tags} selected={tagsAny} onChange={setTagsAny} />
              <TagPicker label="E TODAS estas tags" all={tags} selected={tagsAll} onChange={setTagsAll} />
              <TagPicker label="E NENHUMA destas tags" hint="ex.: callface-descadastro" all={tags} selected={tagsNone} onChange={setTagsNone} />
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="form-input" style={{ maxWidth: 260 }} value={cfKey} onChange={(e) => setCfKey(e.target.value)}>
                  <option value="">Campo personalizado (opcional)…</option>
                  {(wesalesMeta?.customFields ?? []).map((f) => <option key={f.id} value={f.key}>{f.name}</option>)}
                </select>
                <input className="form-input" style={{ maxWidth: 200 }} placeholder="Valor (ex.: Sim)" value={cfValue} onChange={(e) => setCfValue(e.target.value)} />
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.6rem' }}>
                Contatos marcados como DND (descadastro) são sempre excluídos automaticamente.
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              {!preview && !previewLoading ? (
                <button className="btn btn-primary" onClick={runPreview}>Calcular público</button>
              ) : null}
              {previewLoading ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--brs-gray-500)' }}><Loader2 size={16} className="spinner" /> Consultando o WeSales…</div> : null}
              {preview ? (
                <div>
                  <div style={{ fontSize: '1.05rem', color: 'var(--brs-gray-900)', marginBottom: '0.5rem' }}>
                    <strong>{preview.total.toLocaleString('pt-BR')}</strong> contato(s) no público.
                    {action === 'nvti_hygiene' ? <span style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}> Custo máximo estimado: R$ {(preview.total * 0.06).toFixed(2).replace('.', ',')} (menos com cache).</span> : null}
                    {action === 'callface_calls' ? <span style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}> ~{Math.ceil(preview.total / Math.max(perMinute, 1))} min de fila no ritmo atual.</span> : null}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', marginBottom: 6 }}>Amostra:</div>
                  {preview.sample.map((c) => (
                    <div key={c.contactId} style={{ fontSize: '0.85rem', color: 'var(--brs-gray-700)' }}>
                      {c.name ?? '—'} · {c.phone ?? 'sem telefone'} {c.cpf ? `· CPF ${c.cpf}` : ''}
                    </div>
                  ))}
                  <button className="btn btn-outline" style={{ marginTop: '0.6rem' }} onClick={runPreview}>Recalcular</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--brs-gray-800)', display: 'grid', gap: '0.3rem' }}>
              <div>Ação: <strong>{JOB_ACTION_LABEL[action]}</strong></div>
              <div>Nome: <strong>{label || JOB_ACTION_LABEL[action]}</strong></div>
              <div>Público: <strong>{preview ? `${preview.total.toLocaleString('pt-BR')} contato(s)` : 'não calculado'}</strong></div>
              {action === 'callface_calls' ? <div>Ritmo: <strong>{perMinute}/min · {windowStart}-{windowEnd} seg-sex</strong></div> : null}
              {action === 'vendeai_template' ? <div>Template: <strong>{templateName.split('|')[0]}</strong> (inbox {inboxId})</div> : null}
              {action === 'vendeai_template' ? <div>Mensagem: <em>{templateMessage.slice(0, 120)}{templateMessage.length > 120 ? '…' : ''}</em></div> : null}
              <div style={{ color: '#92400E', fontSize: '0.82rem', marginTop: '0.4rem' }}>
                Ao confirmar, o job entra na fila do orquestrador e começa imediatamente (respeitando janela e ritmo).
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem' }}>
            {step > 1 ? (
              <button className="btn btn-outline" onClick={() => setStep(step - 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ChevronLeft size={15} /> Voltar
              </button>
            ) : null}
            {step < 4 ? (
              <button className="btn btn-primary" disabled={!canNext || (step === 3 && !preview)} onClick={() => setStep(step + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Avançar <ChevronRight size={15} />
              </button>
            ) : (
              <button className="btn btn-gold" disabled={creating} onClick={confirm} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {creating ? <Loader2 size={15} className="spinner" /> : <Rocket size={15} />} Disparar
              </button>
            )}
            <button className="btn btn-outline" onClick={() => { setWizardOpen(false); resetWizard() }} style={{ marginLeft: 'auto' }}>Cancelar</button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Ação</th>
                <th>Status</th>
                <th>Progresso</th>
                <th>OK / Erro / Pulados</th>
                <th>Criado</th>
                <th>Por</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const st = JOB_STATUS_LABEL[job.status] ?? { label: job.status, badge: 'badge-gray' }
                const active = ['loading', 'queued', 'materializing', 'running', 'waiting_window'].includes(job.status)
                const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0
                return (
                  <FragmentRow key={job.id}>
                    <tr onClick={() => openDetail(job.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{job.label ?? job.id.slice(0, 8)}</td>
                      <td style={{ fontSize: '0.82rem' }}>{JOB_ACTION_LABEL[job.action] ?? job.action}</td>
                      <td>
                        <span className={`badge ${st.badge}`}>{st.label}</span>
                        {job.note ? <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', marginTop: 2 }}>{job.note}</div> : null}
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <div style={{ fontSize: '0.8rem' }}>{job.processed}/{job.total} ({pct}%)</div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--brs-gray-100)', marginTop: 3 }}>
                          <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: job.status === 'error' ? '#dc2626' : 'var(--brs-navy)' }} />
                        </div>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        <span style={{ color: '#16a34a' }}>{job.succeeded}</span> / <span style={{ color: '#dc2626' }}>{job.failed}</span> / <span style={{ color: 'var(--brs-gray-400)' }}>{job.skipped}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{fmt(job.created_at)}</td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.created_by ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {active && job.status !== 'paused' ? (
                          <button title="Pausar" className="icon-button" onClick={(e) => { e.stopPropagation(); void doOp(job.id, 'pause') }}><Pause size={15} /></button>
                        ) : null}
                        {job.status === 'paused' || job.status === 'error' ? (
                          <button title="Retomar" className="icon-button" onClick={(e) => { e.stopPropagation(); void doOp(job.id, 'resume') }}><Play size={15} /></button>
                        ) : null}
                        {active || job.status === 'paused' ? (
                          <button title="Cancelar" className="icon-button" onClick={(e) => { e.stopPropagation(); if (window.confirm('Cancelar este job? Itens pendentes não serão executados.')) void doOp(job.id, 'cancel') }}><Trash2 size={15} /></button>
                        ) : null}
                      </td>
                    </tr>
                    {detailId === job.id ? (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--brs-gray-50)', padding: '0.75rem 1rem' }}>
                          {job.last_error ? <div style={{ color: '#991B1B', fontSize: '0.82rem', marginBottom: 6 }}>Último erro: {job.last_error}</div> : null}
                          {detailItems.length === 0 ? (
                            <div style={{ color: 'var(--brs-gray-400)', fontSize: '0.82rem' }}>Carregando itens…</div>
                          ) : (
                            <div style={{ display: 'grid', gap: 2 }}>
                              {detailItems.map((item) => (
                                <div key={item.id} style={{ fontSize: '0.78rem', color: 'var(--brs-gray-700)' }}>
                                  <span className={`badge ${item.status === 'done' ? 'badge-success' : item.status === 'error' ? 'badge-danger' : item.status === 'skipped' ? 'badge-warning' : 'badge-gray'}`} style={{ marginRight: 6 }}>{item.status}</span>
                                  {item.name ?? '—'} · {item.phone ?? item.cpf ?? ''} {item.error ? <span style={{ color: '#991B1B' }}> — {item.error}</span> : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                )
              })}
              {jobs.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '2rem' }}>Nenhum job ainda — crie a primeira ação acima.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
