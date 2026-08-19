'use client'

import { useMemo } from 'react'
import { Timer, Shuffle, ShieldCheck, CalendarClock, Clock, Plus, Trash2, Layers, Info } from 'lucide-react'
import WhatsappPreview from '@/components/whatsapp/WhatsappPreview'
import { DELAY_MAX_LIMIT, DELAY_MIN_LIMIT, WEEKDAY_LABELS, describeDirectSchedule } from '@/lib/disparo-whatsapp'
import type { WizardState } from './wizard-types'
import { localToIso, newKey } from './wizard-types'

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{ width: 40, height: 22, borderRadius: 999, background: checked ? '#16a34a' : 'var(--brs-gray-300)', position: 'relative', transition: 'background .2s', display: 'inline-block' }}
      >
        <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
      </span>
      {label && <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{label}</span>}
    </label>
  )
}

function fmtSec(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}min ${r}s` : `${m}min`
}

export default function StepSettings({ state, patch, recipientCount }: { state: WizardState; patch: (p: Partial<WizardState>) => void; recipientCount: number }) {
  const s = state.settings
  const sc = state.schedule
  const setS = (p: Partial<WizardState['settings']>) => patch({ settings: { ...s, ...p } })
  const setSc = (p: Partial<WizardState['schedule']>) => patch({ schedule: { ...sc, ...p } })

  const avgDelay = (s.delay_min_seconds + s.delay_max_seconds) / 2
  const estimate = useMemo(() => {
    const total = recipientCount * avgDelay
    if (total < 3600) return `${Math.round(total / 60)} min`
    return `${(total / 3600).toFixed(1)} h`
  }, [recipientCount, avgDelay])

  const slotSum = sc.slots.reduce((a, b) => a + (Number(b.quantity) || 0), 0)
  const remaining = recipientCount - slotSum

  function toggleDay(d: number) {
    const has = sc.allowed_weekdays.includes(d)
    setSc({ allowed_weekdays: has ? sc.allowed_weekdays.filter((x) => x !== d) : [...sc.allowed_weekdays, d].sort() })
  }
  function addSlot() {
    const last = sc.slots[sc.slots.length - 1]
    const base = last ? new Date(`${last.date}T${last.time}`) : new Date(Date.now() + 3600_000)
    const next = new Date(base.getTime() + (last ? 4 * 3600_000 : 0))
    const pad = (n: number) => String(n).padStart(2, '0')
    setSc({ slots: [...sc.slots, { key: newKey(), date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`, time: `${pad(next.getHours())}:${pad(next.getMinutes())}`, quantity: Math.max(1, remaining > 0 ? remaining : 1) }] })
  }
  function updateSlot(key: string, p: Partial<WizardState['schedule']['slots'][number]>) {
    setSc({ slots: sc.slots.map((x) => (x.key === key ? { ...x, ...p } : x)) })
  }
  function removeSlot(key: string) { setSc({ slots: sc.slots.filter((x) => x.key !== key) }) }
  function distributeEvenly() {
    if (!sc.slots.length) return
    const n = sc.slots.length
    const base = Math.floor(recipientCount / n)
    let rest = recipientCount - base * n
    setSc({ slots: sc.slots.map((x) => { const q = base + (rest > 0 ? 1 : 0); if (rest > 0) rest -= 1; return { ...x, quantity: q } }) })
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {/* Anti-Ban: delays e rotação */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Timer size={18} style={{ color: 'var(--brs-navy)' }} />
          <div style={{ fontWeight: 800 }}>Configurações Anti-Ban</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Delay entre mensagens</div>
          <div style={{ fontWeight: 800, color: '#16a34a' }}>{fmtSec(s.delay_min_seconds)} – {fmtSec(s.delay_max_seconds)}</div>
        </div>
        <div className="form-grid form-grid-2" style={{ marginBottom: 6 }}>
          <div>
            <label className="form-label">Mínimo</label>
            <input type="range" min={DELAY_MIN_LIMIT} max={DELAY_MAX_LIMIT} step={5} value={s.delay_min_seconds} onChange={(e) => { const v = Number(e.target.value); setS({ delay_min_seconds: v, delay_max_seconds: Math.max(v, s.delay_max_seconds) }) }} style={{ width: '100%', accentColor: '#16a34a' }} />
          </div>
          <div>
            <label className="form-label">Máximo</label>
            <input type="range" min={DELAY_MIN_LIMIT} max={DELAY_MAX_LIMIT} step={5} value={s.delay_max_seconds} onChange={(e) => { const v = Number(e.target.value); setS({ delay_max_seconds: v, delay_min_seconds: Math.min(v, s.delay_min_seconds) }) }} style={{ width: '100%', accentColor: '#16a34a' }} />
          </div>
        </div>
        <div className="form-hint">O intervalo real de cada envio é sorteado entre o mínimo e o máximo (15s a 5min). Estimativa para {recipientCount} destinatário(s): ~{estimate} de envio contínuo.</div>

        <div style={{ borderTop: '1px solid var(--brs-gray-100)', margin: '12px 0' }} />
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem' }}><Layers size={16} /> Alternar mensagens (rotação dos blocos)</div>
            <Toggle checked={s.rotate_templates} onChange={(v) => setS({ rotate_templates: v })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', opacity: s.rotate_templates ? 1 : 0.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem' }}><Shuffle size={16} /> Ordem aleatória {s.rotate_templates ? '' : '(ligue a rotação)'}</div>
            <Toggle checked={s.rotation_mode === 'random'} onChange={(v) => setS({ rotation_mode: v ? 'random' : 'sequential' })} />
          </div>
          <div className="form-hint">{state.blocks.filter((b) => b.body.trim() || b.media).length} bloco(s) cadastrado(s). {s.rotate_templates ? (s.rotation_mode === 'random' ? 'Cada destinatário recebe um bloco sorteado.' : 'Os blocos alternam em sequência (1, 2, 3, 1, 2…).') : 'Todos recebem o bloco 1.'}</div>
        </div>
      </div>

      {/* Botão anti-ban */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><ShieldCheck size={18} style={{ color: '#16a34a' }} /> Botão Anti-Ban</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>Envia, logo após a mensagem, botões de resposta para gerar interação e reduzir risco de banimento. Quem responde "não" entra em opt-out automaticamente.</div>
          </div>
          <Toggle checked={s.antiban_enabled} onChange={(v) => setS({ antiban_enabled: v })} />
        </div>
        {s.antiban_enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(260px,1fr)', gap: '1rem', marginTop: 12 }}>
            <div>
              <div className="form-grid form-grid-2">
                <div className="form-group"><label className="form-label">Título (destaque)</label><input className="form-control" value={s.antiban.title} onChange={(e) => setS({ antiban: { ...s.antiban, title: e.target.value } })} /></div>
                <div className="form-group"><label className="form-label">Rodapé</label><input className="form-control" value={s.antiban.footer} onChange={(e) => setS({ antiban: { ...s.antiban, footer: e.target.value } })} /></div>
              </div>
              <div className="form-group"><label className="form-label">Mensagem principal</label><input className="form-control" value={s.antiban.message} onChange={(e) => setS({ antiban: { ...s.antiban, message: e.target.value } })} /></div>
              <div className="form-grid form-grid-2">
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Opção 1 (positiva)</label><input className="form-control" value={s.antiban.positive_label} onChange={(e) => setS({ antiban: { ...s.antiban, positive_label: e.target.value } })} /></div>
                <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Opção 2 (negativa → opt-out)</label><input className="form-control" value={s.antiban.negative_label} onChange={(e) => setS({ antiban: { ...s.antiban, negative_label: e.target.value } })} /></div>
              </div>
              <div className="form-hint" style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'flex-start' }}><Info size={12} style={{ marginTop: 2 }} /> Botões dependem do suporte da Z-API/WhatsApp para a conta; se não renderizarem, a mensagem chega como texto e o opt-out por resposta escrita continua funcionando.</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', marginBottom: 6 }}>Preview da mensagem</div>
              <WhatsappPreview body="" compact buttonMessage={{ title: s.antiban.title, message: s.antiban.message, footer: s.antiban.footer }} buttons={[s.antiban.positive_label, s.antiban.negative_label]} />
            </div>
          </div>
        )}
      </div>

      {/* Agendamento */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <CalendarClock size={18} style={{ color: 'var(--brs-navy)' }} />
          <div style={{ fontWeight: 800 }}>Agendamento</div>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginBottom: 12 }}>Configure quando a campanha será executada. Sem agendamento, ela inicia assim que for salva.</div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 12 }}>
          {([['direct', 'Direto (janela contínua)'], ['batches', 'Lotes (data, hora e quantidade)']] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setSc({ schedule_mode: mode })} className={`btn ${sc.schedule_mode === mode ? 'btn-primary' : 'btn-outline'} btn-sm`}>{label}</button>
          ))}
        </div>

        {sc.schedule_mode === 'direct' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="form-group" style={{ marginBottom: 0, maxWidth: 360 }}>
              <label className="form-label"><Clock size={12} /> Data/Hora de início (opcional)</label>
              <input type="datetime-local" className="form-control" value={sc.start_at_local} onChange={(e) => setSc({ start_at_local: e.target.value })} />
              <div className="form-hint">Deixe vazio para iniciar assim que salvar.</div>
            </div>
            <div>
              <div className="form-label">Dias permitidos</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAY_LABELS.map((d, i) => {
                  const on = sc.allowed_weekdays.includes(i)
                  return <button key={d} type="button" onClick={() => toggleDay(i)} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`} style={{ minWidth: 52 }}>{d}</button>
                })}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '0.78rem' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSc({ allowed_weekdays: [1, 2, 3, 4, 5] })}>Dias úteis</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSc({ allowed_weekdays: [0, 1, 2, 3, 4, 5, 6] })}>Todos os dias</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSc({ allowed_weekdays: [0, 6] })}>Só final de semana</button>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem' }}><Clock size={16} /> Restringir horário</div>
                <Toggle checked={sc.restrict_hours} onChange={(v) => setSc({ restrict_hours: v })} />
              </div>
              {sc.restrict_hours && (
                <div className="form-grid form-grid-2" style={{ marginTop: 8, maxWidth: 420 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Início</label><input type="time" className="form-control" value={sc.window_start} onChange={(e) => setSc({ window_start: e.target.value })} /></div>
                  <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Fim</label><input type="time" className="form-control" value={sc.window_end} onChange={(e) => setSc({ window_end: e.target.value })} /></div>
                </div>
              )}
            </div>
            <div style={{ background: 'rgba(27,58,107,0.06)', border: '1px solid rgba(27,58,107,0.15)', borderRadius: 10, padding: '0.6rem 0.85rem', fontSize: '0.85rem', color: 'var(--brs-navy)' }}>
              📅 <strong>Resumo:</strong> {describeDirectSchedule({ start_at: localToIso(sc.start_at_local), allowed_weekdays: sc.allowed_weekdays, window_start: sc.restrict_hours ? sc.window_start : null, window_end: sc.restrict_hours ? sc.window_end : null, timezone: 'America/Sao_Paulo' })}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
              A campanha tem <strong>{recipientCount}</strong> destinatário(s). Distribua em lotes: a soma das quantidades precisa ser exatamente {recipientCount}.
              {' '}<span style={{ fontWeight: 700, color: remaining === 0 ? '#15803d' : '#b45309' }}>{remaining === 0 ? '✓ Total fechado' : remaining > 0 ? `Faltam ${remaining}` : `Excedem ${-remaining}`}</span>
            </div>
            <div className="table-wrapper" style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10 }}>
              <table className="data-table">
                <thead><tr><th>#</th><th>Data</th><th>Hora</th><th>Disparos</th><th></th></tr></thead>
                <tbody>
                  {sc.slots.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--brs-gray-500)', padding: '1rem' }}>Nenhum lote. Clique em "Adicionar lote".</td></tr>
                  ) : sc.slots.map((sl, i) => (
                    <tr key={sl.key}>
                      <td style={{ color: 'var(--brs-gray-400)' }}>{i + 1}</td>
                      <td style={{ padding: 4 }}><input type="date" className="form-control" style={{ padding: '4px 8px' }} value={sl.date} onChange={(e) => updateSlot(sl.key, { date: e.target.value })} /></td>
                      <td style={{ padding: 4 }}><input type="time" className="form-control" style={{ padding: '4px 8px' }} value={sl.time} onChange={(e) => updateSlot(sl.key, { time: e.target.value })} /></td>
                      <td style={{ padding: 4 }}><input type="number" min={1} className="form-control" style={{ padding: '4px 8px', width: 110 }} value={sl.quantity} onChange={(e) => updateSlot(sl.key, { quantity: Number(e.target.value) })} /></td>
                      <td><button type="button" className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => removeSlot(sl.key)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={addSlot}><Plus size={14} /> Adicionar lote</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={distributeEvenly} disabled={!sc.slots.length}>Distribuir igualmente</button>
            </div>
            <div className="form-hint">Dentro de cada lote, o delay aleatório entre mensagens continua valendo. O próximo lote só começa no horário marcado.</div>
          </div>
        )}
      </div>
    </div>
  )
}
