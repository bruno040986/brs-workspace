'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Bus, ChevronLeft, Plus, Trash2, Save, Loader2,
  MapPin, Calculator, AlertTriangle, Calendar, Info
} from 'lucide-react'
import type { Employee, CompanyUnit } from '@/types'
import { format, addMonths, startOfMonth } from 'date-fns'
import { createVtRecord } from '../../../server-actions'

interface Route {
  type: 'ida' | 'volta'
  line: string
  value: number
}

export default function VTUnifiedPage() {
  const { id } = useParams()
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [units, setUnits] = useState<CompanyUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Header / Control State
  const [mode, setMode] = useState<'option' | 'refusal'>('option')
  const [optionDate, setOptionDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [effectiveDate, setEffectiveDate] = useState(format(startOfMonth(addMonths(new Date(), 1)), 'yyyy-MM-dd'))
  
  // Form State (Option)
  const [selectedUnit, setSelectedUnit] = useState('')
  const [routes, setRoutes] = useState<Route[]>([
    { type: 'ida', line: '', value: 0 },
    { type: 'volta', line: '', value: 0 }
  ])
  const [workingDays, setWorkingDays] = useState(22)
  // Controla se o desconto de 6% sobre o salario e aplicado. Ligado por padrao.
  const [applyDiscount, setApplyDiscount] = useState(true)

  // Form State (Refusal)
  const [refusalReason, setRefusalReason] = useState('')
  
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    
    const [empRes, unitRes] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).single(),
      supabase.from('company_units').select('*').eq('active', true).order('name', { ascending: true })
    ])
    
    if (empRes.data) {
      setEmployee(empRes.data as Employee)
      if (unitRes.data && unitRes.data.length === 1) setSelectedUnit(unitRes.data[0].id)
    }
    if (unitRes.data) setUnits(unitRes.data as CompanyUnit[])
    
    setLoading(false)
  }, [id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const totals = useMemo(() => {
    const daily = routes.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0)
    const monthly = daily * workingDays
    const salary = employee?.gross_salary || 0
    const discount = applyDiscount ? salary * 0.06 : 0

    // Comparativo baseado em 22 dias (base de cálculo do desconto).
    // Com o desconto desligado nao ha trava por valor baixo.
    const monthlyBase = daily * 22
    const isValidOption = !applyDiscount || monthlyBase > discount

    const companyCost = Math.max(0, monthly - discount)

    return { daily, monthly, monthlyBase, discount, companyCost, isValidOption }
  }, [routes, workingDays, employee, applyDiscount])

  function addRoute() {
    setRoutes([...routes, { type: 'ida', line: '', value: 0 }])
  }

  function removeRoute(index: number) {
    setRoutes(routes.filter((_, i) => i !== index))
  }

  function updateRoute(index: number, field: keyof Route, value: string | number) {
    const newRoutes = [...routes]
    newRoutes[index] = { ...newRoutes[index], [field]: value }
    setRoutes(newRoutes)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!employee) return
    if (mode === 'option' && (!selectedUnit || !totals.isValidOption)) return
    
    setSaving(true)
    try {
      await createVtRecord({
        employeeId: employee.id,
        mode,
        optionDate,
        effectiveDate,
        selectedUnit,
        routes,
        workingDays,
        dailyTotal: totals.daily,
        monthlyTotal: totals.monthly,
        maxDiscount: totals.discount,
        companyCost: totals.companyCost,
        refusalReason,
        closePreviousActive: true,
      })

      router.push(`/colaboradores/${employee.id}`)
    } catch (error) {
      console.error(error)
      alert('Erro ao salvar o documento. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page-content text-center"><Loader2 className="spinner" /> Carregando...</div>

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
            Gerar Termo de Vale-Transporte
          </h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            {employee?.name} — {employee?.cpf}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Escolha do Tipo e Datas */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', alignItems: 'end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Tipo do Documento</label>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--brs-gray-100)', padding: '0.25rem', borderRadius: '8px' }}>
                  <button 
                    type="button" 
                    className={`btn btn-sm ${mode === 'option' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setMode('option')}
                  >
                    Opção pelo VT
                  </button>
                  <button 
                    type="button" 
                    className={`btn btn-sm ${mode === 'refusal' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setMode('refusal')}
                  >
                    Recusa do VT
                  </button>
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Data da Opção</label>
                <div style={{ position: 'relative' }}>
                  <input 
                    type="date" 
                    className="form-control" 
                    value={optionDate}
                    onChange={e => setOptionDate(e.target.value)}
                  />
                  <Calendar size={16} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)', pointerEvents: 'none' }} />
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Início da Vigência</label>
                <div style={{ position: 'relative' }}>
                  <input 
                    type="date" 
                    className="form-control" 
                    value={effectiveDate}
                    onChange={e => setEffectiveDate(e.target.value)}
                  />
                  <Calendar size={16} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)', pointerEvents: 'none' }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: mode === 'option' ? '1.5fr 1fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {mode === 'option' ? (
              <>
                {/* Unidade info */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title"><MapPin size={16} /> Unidade de Trabalho</h3>
                  </div>
                  <div className="card-body">
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Selecione a Unidade <span className="required">*</span></label>
                      <select 
                        className="form-control" 
                        required 
                        value={selectedUnit}
                        onChange={e => setSelectedUnit(e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {units.map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Trechos info */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title"><Bus size={16} /> Trechos de Transporte</h3>
                    <button type="button" className="btn btn-outline btn-sm" onClick={addRoute}>
                      <Plus size={14} /> Adicionar Trecho
                    </button>
                  </div>
                  <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '100px' }}>Tipo</th>
                            <th>Linha / Operadora</th>
                            <th style={{ width: '120px' }}>Valor Unit.</th>
                            <th style={{ width: '50px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {routes.map((route, idx) => (
                            <tr key={idx}>
                              <td>
                                <select 
                                  className="form-control" 
                                  value={route.type}
                                  onChange={e => updateRoute(idx, 'type', e.target.value)}
                                >
                                  <option value="ida">Ida</option>
                                  <option value="volta">Volta</option>
                                </select>
                              </td>
                              <td>
                                <input 
                                  type="text" 
                                  className="form-control" 
                                  placeholder="Ex: 600 - Gama/Valparaiso"
                                  value={route.line}
                                  onChange={e => updateRoute(idx, 'line', e.target.value)}
                                />
                              </td>
                              <td>
                                <input 
                                  type="number" 
                                  step="0.01" 
                                  className="form-control" 
                                  placeholder="0,00"
                                  value={route.value}
                                  onChange={e => updateRoute(idx, 'value', e.target.value)}
                                />
                              </td>
                              <td>
                                <button type="button" className="btn btn-ghost btn-sm btn-icon text-danger" onClick={() => removeRoute(idx)}>
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* MODO RECUSA */
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title"><AlertTriangle size={16} /> Motivo da Recusa</h3>
                </div>
                <div className="card-body">
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Descrição do Motivo <span className="required">*</span></label>
                    <textarea 
                      className="form-control" 
                      rows={4}
                      placeholder="Ex: Possuo veículo próprio / Realizo o trajeto a pé..."
                      value={refusalReason}
                      onChange={e => setRefusalReason(e.target.value)}
                      required={mode === 'refusal'}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {mode === 'option' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'sticky', top: '1.5rem' }}>
              {/* Resumo de Cálculos */}
              <div className="card" style={{ border: totals.isValidOption ? '1px solid var(--brs-navy)' : '1px solid var(--brs-danger)', background: 'rgba(27,58,107,0.02)' }}>
                <div className="card-header" style={{ background: totals.isValidOption ? 'var(--brs-navy)' : 'var(--brs-danger)', color: '#fff' }}>
                  <h3 className="card-title" style={{ color: '#fff' }}><Calculator size={16} /> Resumo Financeiro</h3>
                </div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">Dias úteis para o benefício</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      value={workingDays}
                      onChange={e => setWorkingDays(Number(e.target.value))}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', color: 'var(--brs-gray-400)', fontSize: '0.75rem' }}>
                      <Info size={12} />
                      <span>Geralmente utiliza-se 22 dias para a base de cálculo.</span>
                    </div>
                  </div>
                  
                  {/* Toggle: aplicar ou nao o desconto de 6% */}
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '0.75rem', padding: '0.75rem', marginTop: '0.25rem',
                      background: 'var(--brs-gray-50)', border: '1px solid var(--brs-gray-200)',
                      borderRadius: 8, cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>
                        Aplicar desconto de 6%
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
                        {applyDiscount
                          ? 'Descontado do salário (padrão CLT).'
                          : 'Desligado — sem desconto e sem trava por valor baixo.'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={applyDiscount}
                      onChange={e => setApplyDiscount(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                    />
                  </label>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <SummaryRow label="Total Diário" value={totals.daily} />
                    <SummaryRow label="Total Mensal (Info)" value={totals.monthly} />
                    <div style={{ height: '1px', background: 'var(--brs-gray-200)', margin: '0.25rem 0' }} />
                    <SummaryRow
                      label={applyDiscount ? 'Desconto 6% (Máximo)' : 'Desconto (Desativado)'}
                      value={totals.discount}
                      color={applyDiscount ? 'var(--brs-danger)' : 'var(--brs-gray-400)'}
                    />

                    {applyDiscount && !totals.isValidOption && (
                      <div style={{ padding: '0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, marginTop: '0.5rem', color: '#991B1B', fontSize: '0.8rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Opção Inviável</div>
                        O custo do transporte (R$ {totals.monthlyBase.toFixed(2)}) é inferior ao desconto de 6%. Pela política da empresa, emita a **Recusa do VT**.
                      </div>
                    )}

                    {totals.isValidOption && (
                      <div style={{ padding: '0.75rem', background: 'var(--brs-navy)', borderRadius: 8, marginTop: '0.5rem', color: '#fff' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>Custeio Empresa (Estimado)</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>R$ {totals.companyCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: mode === 'refusal' ? '0' : '0' }}>
            <div className="card">
              <div className="card-body">
                <button 
                  type="submit" 
                  className="btn btn-primary btn-lg" 
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={saving || (mode === 'option' && (!selectedUnit || !totals.isValidOption))}
                >
                  {saving ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
                  {saving ? 'Processando...' : `Gerar Termo de ${mode === 'option' ? 'Opção' : 'Recusa'}`}
                </button>
              </div>
            </div>
          </div>

        </div>
      </form>
    </div>
  )
}

function SummaryRow({ label, value, color }: { label: string, value: number, color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--brs-gray-600)' }}>{label}</span>
      <span style={{ fontSize: '1rem', fontWeight: 700, color: color || 'var(--brs-gray-800)' }}>
        R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </span>
    </div>
  )
}
