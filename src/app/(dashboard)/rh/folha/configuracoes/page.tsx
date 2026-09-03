'use client'

/**
 * RH › Folha › Configurações — o que o Quark não fornece e a folha precisa:
 * Faixas INSS/IR (por vigência, mudam por lei) e Parâmetros por competência
 * mensal (aba DADOS). Permissão rh-folha. O motor de cálculo (Etapa 2) lê
 * essas tabelas.
 */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import {
  getFaixasVigentes,
  listarParametros,
  salvarFaixas,
  salvarParametros,
  type InssFaixa,
  type IrrfFaixa,
  type ParametroCompetencia,
} from '@/lib/folha/config-actions'

const rotulo: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.25rem' }

const PARAM_VAZIO: ParametroCompetencia = {
  competencia: new Date().toISOString().slice(0, 7),
  dias_calculo_salario: 30, dias_uteis_mes: 22, dias_beneficios: 22,
  taxa_va_vr: 0, taxa_vt: 0, taxa_vc: 0, taxa_pds: 0, taxa_adm: 0,
  data_venc_salario: null, data_comp_salario: null, data_venc_fgts: null, observacao: '',
}

export default function FolhaConfigPage() {
  const [aba, setAba] = useState<'faixas' | 'competencia'>('faixas')
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  // faixas
  const [carregandoFaixas, setCarregandoFaixas] = useState(true)
  const [vigencias, setVigencias] = useState<string[]>([])
  const [vigencia, setVigencia] = useState('')
  const [novaVigencia, setNovaVigencia] = useState('')
  const [inss, setInss] = useState<InssFaixa[]>([])
  const [irrf, setIrrf] = useState<IrrfFaixa[]>([])
  const [deducaoDep, setDeducaoDep] = useState(0)
  const [descSimpl, setDescSimpl] = useState(0)
  const [salvandoFaixas, setSalvandoFaixas] = useState(false)

  // competência
  const [params, setParams] = useState<ParametroCompetencia[]>([])
  const [paramForm, setParamForm] = useState<ParametroCompetencia>(PARAM_VAZIO)
  const [salvandoParam, setSalvandoParam] = useState(false)

  async function carregarFaixas(vig?: string) {
    setCarregandoFaixas(true)
    const res = await getFaixasVigentes(vig)
    if (res.success) {
      setVigencias(res.vigencias || [])
      setVigencia(res.vigenciaAtual || '')
      setInss(res.inss || [])
      setIrrf(res.irrf || [])
      setDeducaoDep(res.irrfParam?.deducao_por_dependente || 0)
      setDescSimpl(res.irrfParam?.desconto_simplificado || 0)
    } else setErro(res.error || '')
    setCarregandoFaixas(false)
  }

  async function carregarParams() {
    const res = await listarParametros()
    if (res.success) setParams(res.data || [])
  }

  useEffect(() => {
    carregarFaixas()
    carregarParams()
  }, [])

  async function gravarFaixas() {
    const vig = novaVigencia || vigencia
    if (!vig) return setErro('Informe a vigência.')
    setSalvandoFaixas(true)
    setErro('')
    setOkMsg('')
    const res = await salvarFaixas({ vigencia_inicio: vig, inss, irrf, deducao_por_dependente: deducaoDep, desconto_simplificado: descSimpl })
    setSalvandoFaixas(false)
    if (!res.success) return setErro(res.error || '')
    setOkMsg('Faixas salvas!')
    setNovaVigencia('')
    await carregarFaixas(vig)
  }

  async function gravarParam() {
    setSalvandoParam(true)
    setErro('')
    setOkMsg('')
    const res = await salvarParametros(paramForm)
    setSalvandoParam(false)
    if (!res.success) return setErro(res.error || '')
    setOkMsg('Competência salva!')
    await carregarParams()
  }

  const numInput = (v: number, on: (n: number) => void, w = 110) => (
    <input className="form-control" type="number" step="0.01" value={v} onChange={(e) => on(Number(e.target.value))} style={{ width: w }} />
  )

  return (
    <div style={{ maxWidth: 940 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem' }}>Configurações da Folha</h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.86rem', margin: '0 0 1rem' }}>
        Dados que o QuarkRH não fornece e o cálculo da folha precisa. O motor de cálculo (Pré-Folha) usa a vigência e a
        competência corretas automaticamente.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
        {(['faixas', 'competencia'] as const).map((a) => (
          <button key={a} className="btn btn-sm" onClick={() => setAba(a)} style={{ background: aba === a ? 'var(--brs-navy)' : 'var(--brs-gray-100)', color: aba === a ? '#fff' : 'var(--brs-gray-600)', border: 'none' }}>
            {a === 'faixas' ? 'Faixas INSS / IRRF' : 'Parâmetros do Mês'}
          </button>
        ))}
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      {aba === 'faixas' ? (
        carregandoFaixas ? <Loader2 size={18} className="animate-spin" /> : (
          <>
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={rotulo}>Vigência a editar</label>
                <select className="form-control" value={vigencia} onChange={(e) => carregarFaixas(e.target.value)} style={{ width: 180 }}>
                  {vigencias.length === 0 && <option value="">— nenhuma —</option>}
                  {vigencias.map((v) => <option key={v} value={v}>{new Date(v + 'T12:00').toLocaleDateString('pt-BR')}</option>)}
                </select>
              </div>
              <div>
                <label style={rotulo}>…ou nova vigência (início)</label>
                <input className="form-control" type="date" value={novaVigencia} onChange={(e) => setNovaVigencia(e.target.value)} style={{ width: 180 }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* INSS */}
              <div className="card" style={{ padding: '1rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, margin: '0 0 0.7rem' }}>Faixas INSS (progressivo)</h3>
                {inss.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', width: 20 }}>{i + 1}º</span>
                    <div><label style={rotulo}>Até R$</label>{numInput(f.limite_ate, (n) => setInss((p) => p.map((x, j) => j === i ? { ...x, limite_ate: n } : x)))}</div>
                    <div><label style={rotulo}>Alíq. %</label>{numInput(f.aliquota, (n) => setInss((p) => p.map((x, j) => j === i ? { ...x, aliquota: n } : x)), 80)}</div>
                    <button className="btn btn-ghost btn-icon" style={{ marginTop: 16 }} onClick={() => setInss((p) => p.filter((_, j) => j !== i))}><Trash2 size={14} style={{ color: 'var(--brs-danger)' }} /></button>
                  </div>
                ))}
                <button className="btn btn-outline btn-sm" onClick={() => setInss((p) => [...p, { ordem: p.length + 1, limite_ate: 0, aliquota: 0 }])}><Plus size={13} /> Faixa</button>
              </div>

              {/* IRRF */}
              <div className="card" style={{ padding: '1rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, margin: '0 0 0.7rem' }}>Faixas IRRF</h3>
                {irrf.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', width: 20 }}>{i + 1}º</span>
                    <div><label style={rotulo}>Base até</label>{numInput(f.base_ate, (n) => setIrrf((p) => p.map((x, j) => j === i ? { ...x, base_ate: n } : x)), 90)}</div>
                    <div><label style={rotulo}>Alíq.%</label>{numInput(f.aliquota, (n) => setIrrf((p) => p.map((x, j) => j === i ? { ...x, aliquota: n } : x)), 70)}</div>
                    <div><label style={rotulo}>Deduzir</label>{numInput(f.parcela_deduzir, (n) => setIrrf((p) => p.map((x, j) => j === i ? { ...x, parcela_deduzir: n } : x)), 80)}</div>
                    <button className="btn btn-ghost btn-icon" style={{ marginTop: 16 }} onClick={() => setIrrf((p) => p.filter((_, j) => j !== i))}><Trash2 size={14} style={{ color: 'var(--brs-danger)' }} /></button>
                  </div>
                ))}
                <button className="btn btn-outline btn-sm" onClick={() => setIrrf((p) => [...p, { ordem: p.length + 1, base_ate: 0, aliquota: 0, parcela_deduzir: 0 }])}><Plus size={13} /> Faixa</button>
                <div style={{ display: 'flex', gap: 10, marginTop: '0.8rem' }}>
                  <div><label style={rotulo}>Dedução/dependente</label>{numInput(deducaoDep, setDeducaoDep, 110)}</div>
                  <div><label style={rotulo}>Desconto simplificado</label>{numInput(descSimpl, setDescSimpl, 120)}</div>
                </div>
              </div>
            </div>

            <button className="btn btn-primary" onClick={gravarFaixas} disabled={salvandoFaixas} style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {salvandoFaixas ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar faixas da vigência
            </button>
          </>
        )
      ) : (
        <>
          <div className="card" style={{ padding: '1.1rem', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, margin: '0 0 0.8rem' }}>Parâmetros da competência</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.7rem' }}>
              <div><label style={rotulo}>Competência (AAAA-MM) *</label><input className="form-control" value={paramForm.competencia} onChange={(e) => setParamForm({ ...paramForm, competencia: e.target.value })} placeholder="2026-09" /></div>
              <div><label style={rotulo}>Dias cálc. salário</label>{numInput(paramForm.dias_calculo_salario, (n) => setParamForm({ ...paramForm, dias_calculo_salario: n }), 90)}</div>
              <div><label style={rotulo}>Dias úteis mês</label>{numInput(paramForm.dias_uteis_mes, (n) => setParamForm({ ...paramForm, dias_uteis_mes: n }), 90)}</div>
              <div><label style={rotulo}>Dias benefícios</label>{numInput(paramForm.dias_beneficios, (n) => setParamForm({ ...paramForm, dias_beneficios: n }), 90)}</div>
              <div><label style={rotulo}>Taxa VA/VR</label>{numInput(paramForm.taxa_va_vr, (n) => setParamForm({ ...paramForm, taxa_va_vr: n }), 90)}</div>
              <div><label style={rotulo}>Taxa VT</label>{numInput(paramForm.taxa_vt, (n) => setParamForm({ ...paramForm, taxa_vt: n }), 90)}</div>
              <div><label style={rotulo}>Taxa VC</label>{numInput(paramForm.taxa_vc, (n) => setParamForm({ ...paramForm, taxa_vc: n }), 90)}</div>
              <div><label style={rotulo}>Taxa PDS</label>{numInput(paramForm.taxa_pds, (n) => setParamForm({ ...paramForm, taxa_pds: n }), 90)}</div>
              <div><label style={rotulo}>Taxa ADM</label>{numInput(paramForm.taxa_adm, (n) => setParamForm({ ...paramForm, taxa_adm: n }), 90)}</div>
              <div><label style={rotulo}>Venc. salário</label><input className="form-control" type="date" value={paramForm.data_venc_salario || ''} onChange={(e) => setParamForm({ ...paramForm, data_venc_salario: e.target.value || null })} /></div>
              <div><label style={rotulo}>Competência salário</label><input className="form-control" type="date" value={paramForm.data_comp_salario || ''} onChange={(e) => setParamForm({ ...paramForm, data_comp_salario: e.target.value || null })} /></div>
              <div><label style={rotulo}>Venc. FGTS</label><input className="form-control" type="date" value={paramForm.data_venc_fgts || ''} onChange={(e) => setParamForm({ ...paramForm, data_venc_fgts: e.target.value || null })} /></div>
            </div>
            <button className="btn btn-primary" onClick={gravarParam} disabled={salvandoParam} style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {salvandoParam ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar competência
            </button>
          </div>

          {params.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table className="data-table" style={{ fontSize: '0.8rem' }}>
                <thead><tr><th>Competência</th><th>Dias sal.</th><th>Dias úteis</th><th>VA/VR</th><th>VT</th><th>ADM</th><th></th></tr></thead>
                <tbody>
                  {params.map((p) => (
                    <tr key={p.competencia} style={{ cursor: 'pointer' }} onClick={() => setParamForm(p)}>
                      <td style={{ fontWeight: 700 }}>{p.competencia}</td>
                      <td>{p.dias_calculo_salario}</td><td>{p.dias_uteis_mes}</td>
                      <td>{p.taxa_va_vr}</td><td>{p.taxa_vt}</td><td>{p.taxa_adm}</td>
                      <td style={{ color: 'var(--brs-navy-light)', fontSize: '0.72rem' }}>editar</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
