'use client'

/**
 * Operacional › Nuvidio › Criar Link — espelha os campos do painel da
 * Nuvidio (departamento, expiração, agendamento) + os dados de negócio da
 * proposta (IF, forma de contrato, convênio, cliente, parceiro, proposta).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Link2, Loader2 } from 'lucide-react'
import { criarNuvidioConvite, getNuvidioLookups, type NuvidioLookups } from '@/lib/nuvidio/convites-actions'

const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

export default function CriarLinkNuvidioPage() {
  const router = useRouter()
  const [lookups, setLookups] = useState<NuvidioLookups | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [linkCriado, setLinkCriado] = useState('')

  const [form, setForm] = useState({
    departmentId: '',
    expiracaoHoras: 48,
    agendarPara: '',
    instituicaoFinanceiraId: '',
    formaContratoId: '',
    convenioId: '',
    cpf: '',
    nomeCliente: '',
    telefoneCliente: '',
    emailCliente: '',
    agenteParceiroId: '',
    propostaNumero: '',
    propostaValor: '',
  })

  useEffect(() => {
    getNuvidioLookups()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setLookups(res.data)
        setForm((f) => ({ ...f, departmentId: res.data!.departmentPadraoId || res.data!.departments[0]?.id || '' }))
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  function set<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  async function criar() {
    if (salvando) return
    setSalvando(true)
    setErro('')
    try {
      const res = await criarNuvidioConvite({
        departmentId: form.departmentId,
        departmentNome: lookups?.departments.find((d) => d.id === form.departmentId)?.nome || '',
        expiracaoHoras: Number(form.expiracaoHoras) || 48,
        agendarPara: form.agendarPara ? new Date(form.agendarPara).toISOString() : null,
        instituicaoFinanceiraId: form.instituicaoFinanceiraId || null,
        formaContratoId: form.formaContratoId || null,
        convenioId: form.convenioId || null,
        cpf: form.cpf,
        nomeCliente: form.nomeCliente,
        telefoneCliente: form.telefoneCliente,
        emailCliente: form.emailCliente,
        agenteParceiroId: form.agenteParceiroId || null,
        propostaNumero: form.propostaNumero,
        propostaValor: form.propostaValor ? Number(String(form.propostaValor).replace(/\./g, '').replace(',', '.')) : null,
      })
      if (!res.success) throw new Error(res.error)
      setLinkCriado(res.link)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar o link.')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
  }

  if (linkCriado) {
    return (
      <div className="card" style={{ maxWidth: 640, padding: '1.5rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem' }}>✅</div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0.4rem 0' }}>Link criado!</h2>
        <p style={{ wordBreak: 'break-all', fontSize: '0.85rem', color: 'var(--brs-gray-600)', background: 'var(--brs-gray-50)', padding: '0.7rem', borderRadius: 8 }}>{linkCriado}</p>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.8rem' }}>
          <button className="btn btn-outline" onClick={() => navigator.clipboard.writeText(linkCriado)}><Copy size={15} /> Copiar link</button>
          <button className="btn btn-primary" onClick={() => router.push('/nuvidio')}>Ir para Links Criados (enviar) →</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link2 size={22} /> Criar Link Nuvidio
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Cria o convite de videochamada direto na Nuvidio — sem entrar no sistema deles. O envio ao parceiro/cliente é
        feito na tela Links Criados, com os templates.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {lookups && !lookups.temCredenciais && (
        <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-warning)', marginBottom: '1rem', color: '#92400e', fontWeight: 600 }}>
          Aguardando credenciais: peça a um administrador para configurar a API em Provedores e APIs › Nuvidio.
        </div>
      )}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.9rem' }}>Chamada (Nuvidio)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.8rem' }}>
          <div>
            <label style={rotulo}>Departamento *</label>
            {lookups && lookups.departments.length > 0 ? (
              <select className="form-control" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                <option value="">— Escolha —</option>
                {lookups.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
            ) : (
              <input className="form-control" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder="Id do departamento" />
            )}
          </div>
          <div>
            <label style={rotulo}>Expira em (horas)</label>
            <input className="form-control" type="number" min={1} max={336} value={form.expiracaoHoras} onChange={(e) => set('expiracaoHoras', Number(e.target.value))} />
          </div>
          <div>
            <label style={rotulo}>Agendar para (opcional)</label>
            <input className="form-control" type="datetime-local" value={form.agendarPara} onChange={(e) => set('agendarPara', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.9rem' }}>Cliente e proposta</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.8rem' }}>
          <div>
            <label style={rotulo}>Nome do cliente *</label>
            <input className="form-control" value={form.nomeCliente} onChange={(e) => set('nomeCliente', e.target.value)} />
          </div>
          <div>
            <label style={rotulo}>CPF</label>
            <input className="form-control" value={form.cpf} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" />
          </div>
          <div>
            <label style={rotulo}>Telefone (WhatsApp)</label>
            <input className="form-control" value={form.telefoneCliente} onChange={(e) => set('telefoneCliente', e.target.value)} placeholder="(61) 9…" />
          </div>
          <div>
            <label style={rotulo}>E-mail do cliente</label>
            <input className="form-control" value={form.emailCliente} onChange={(e) => set('emailCliente', e.target.value)} />
          </div>
          <div>
            <label style={rotulo}>Nº da proposta</label>
            <input className="form-control" value={form.propostaNumero} onChange={(e) => set('propostaNumero', e.target.value)} />
          </div>
          <div>
            <label style={rotulo}>Valor liberado (R$)</label>
            <input className="form-control" value={form.propostaValor} onChange={(e) => set('propostaValor', e.target.value)} placeholder="0,00" />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 0.9rem' }}>Operação</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <div>
            <label style={rotulo}>Instituição Financeira</label>
            <select className="form-control" value={form.instituicaoFinanceiraId} onChange={(e) => set('instituicaoFinanceiraId', e.target.value)}>
              <option value="">—</option>
              {lookups?.instituicoes.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={rotulo}>Forma de Contrato</label>
            <select className="form-control" value={form.formaContratoId} onChange={(e) => set('formaContratoId', e.target.value)}>
              <option value="">—</option>
              {lookups?.formasContrato.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={rotulo}>Convênio</label>
            <select className="form-control" value={form.convenioId} onChange={(e) => set('convenioId', e.target.value)}>
              <option value="">—</option>
              {lookups?.convenios.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={rotulo}>Parceiro</label>
            <select className="form-control" value={form.agenteParceiroId} onChange={(e) => set('agenteParceiroId', e.target.value)}>
              <option value="">—</option>
              {lookups?.parceiros.map((p) => (
                <option key={p.id} value={p.id}>{p.arw_code ? `${p.arw_code} — ` : ''}{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={criar} disabled={salvando || !lookups?.temCredenciais || !form.departmentId || !form.nomeCliente.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Criar link na Nuvidio
      </button>
    </div>
  )
}
