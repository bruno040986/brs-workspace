'use client'

/**
 * Configurações › IA do Workspace (Jarvis) — aprovado 02/09/2026.
 * Credencial do provedor no cofre (nunca exibida de volta), modelo principal
 * + até 3 reservas (fallback automático quando a cota de um acaba) e a
 * seção Personalidade, que vira o system prompt de TODA conversa.
 */
import { useEffect, useState } from 'react'
import { Bot, KeyRound, Loader2, MessageCircleHeart, Save } from 'lucide-react'
import { getIaConfig, saveIaConfig } from '@/lib/ia/actions'
import type { IaPersonalidade, IaProvider } from '@/lib/ia/config'

const PERSONALIDADE_VAZIA: IaPersonalidade = {
  nome: 'Jarvis',
  modo_falar: '',
  personalidade: '',
  regras: '',
  saudacao: '',
  status_frase: '',
}

export default function IaWorkspacePage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [semAcesso, setSemAcesso] = useState(false)

  const [provider, setProvider] = useState<IaProvider>('openrouter')
  const [temChave, setTemChave] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [modelos, setModelos] = useState<string[]>(['', '', '', ''])
  const [sugeridos, setSugeridos] = useState<string[]>([])
  const [personalidade, setPersonalidade] = useState<IaPersonalidade>(PERSONALIDADE_VAZIA)

  useEffect(() => {
    getIaConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setSemAcesso(true)
          setErro(res.error || 'Sem permissão para configurar a IA do Workspace.')
          return
        }
        setProvider(res.data.provider)
        setTemChave(res.data.temChave)
        const m = [...res.data.modelos]
        while (m.length < 4) m.push('')
        setModelos(m.slice(0, 4))
        setPersonalidade(res.data.personalidade)
        setSugeridos(res.sugeridos || [])
      })
      .catch(() => setErro('Erro ao carregar a configuração.'))
      .finally(() => setCarregando(false))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await saveIaConfig({
        provider,
        apiKey: apiKey.trim() || undefined,
        modelos: modelos.map((m) => m.trim()).filter(Boolean),
        personalidade,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva! A personalidade e os modelos valem imediatamente para todo o Workspace.')
      if (apiKey.trim()) {
        setTemChave(true)
        setApiKey('')
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  function setP<K extends keyof IaPersonalidade>(campo: K, valor: string) {
    setPersonalidade((prev) => ({ ...prev, [campo]: valor }))
  }

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}>
        <Loader2 size={18} className="animate-spin" /> Carregando…
      </div>
    )
  }

  if (semAcesso) {
    return <div className="card" style={{ padding: '2rem', color: 'var(--brs-danger)' }}>{erro}</div>
  }

  const rotuloCampo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Bot size={24} /> IA do Workspace
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Uma credencial só para a empresa toda — cifrada no cofre do servidor, nunca visível no navegador. O acesso ao chat é
        controlado pela permissão <code>workspace-ia</code>.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      {/* Provedor e credencial */}
      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Provedor e credencial
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.9rem' }}>
          <div>
            <label style={rotuloCampo}>Provedor</label>
            <select className="form-control" value={provider} onChange={(e) => setProvider(e.target.value as IaProvider)}>
              <option value="openrouter">OpenRouter</option>
              <option value="anthropic" disabled>Anthropic (em breve)</option>
            </select>
          </div>
          <div>
            <label style={rotuloCampo}>
              Chave de API {temChave ? <span style={{ color: 'var(--brs-success)' }}>· configurada ✓ (preencha só para trocar)</span> : <span style={{ color: 'var(--brs-warning)' }}>· ainda não configurada</span>}
            </label>
            <input
              className="form-control"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={temChave ? '••••••••••••  (deixe em branco para manter)' : 'sk-or-v1-…'}
              autoComplete="off"
            />
          </div>
        </div>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.75rem', margin: '0.6rem 0 0' }}>
          Crie a chave em openrouter.ai → Keys. A chave é gravada cifrada (AES-256-GCM) e usada apenas pelo servidor.
        </p>
      </div>

      {/* Modelos com fallback */}
      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.35rem' }}>Modelos (principal + 3 reservas)</h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.9rem' }}>
          Quando a cota do principal acaba (ou ele cai), a chamada pula automaticamente para o próximo da lista — o
          OpenRouter faz o fallback nativo e o Workspace ainda tenta um a um se a requisição inteira falhar. O modelo que
          respondeu fica registrado em cada mensagem.
        </p>
        {modelos.map((m, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.6rem', marginBottom: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: i === 0 ? 'var(--brs-navy-light)' : 'var(--brs-gray-400)' }}>
              {i === 0 ? 'Principal' : `Reserva ${i}`}
            </span>
            <input
              className="form-control"
              value={m}
              onChange={(e) => setModelos((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={sugeridos[i] || 'ex.: deepseek/deepseek-chat-v3-0324:free'}
              list="ia-modelos-sugeridos"
            />
          </div>
        ))}
        <datalist id="ia-modelos-sugeridos">
          {sugeridos.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.72rem', margin: '0.4rem 0 0' }}>
          Atenção com modelos <code>:free</code>: cota diária pequena e alguns provedores podem usar os dados para treino —
          evite colar dados de cliente. Para uso pesado, um modelo pago de centavos resolve.
        </p>
      </div>

      {/* Personalidade */}
      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageCircleHeart size={17} /> Personalidade
        </h2>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.9rem' }}>
          Estes campos viram as instruções fixas de toda conversa, para qualquer usuário e em qualquer modelo. O prompt
          define quem o agente É; o que ele PODE continua sendo controlado pelo servidor e pelas permissões.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
          <div>
            <label style={rotuloCampo}>Nome do agente</label>
            <input className="form-control" value={personalidade.nome} onChange={(e) => setP('nome', e.target.value)} placeholder="Jarvis" />
          </div>
          <div>
            <label style={rotuloCampo}>Frase de status (Messenger)</label>
            <input className="form-control" value={personalidade.status_frase} onChange={(e) => setP('status_frase', e.target.value)} placeholder="— resolvendo consignado desde 2026" />
          </div>
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <label style={rotuloCampo}>Modo de falar</label>
          <textarea className="form-control" rows={2} value={personalidade.modo_falar} onChange={(e) => setP('modo_falar', e.target.value)} placeholder="Informal na medida, direto, pode usar humor leve e emojis com moderação…" />
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <label style={rotuloCampo}>Personalidade fixa</label>
          <textarea className="form-control" rows={2} value={personalidade.personalidade} onChange={(e) => setP('personalidade', e.target.value)} placeholder="Colega de equipe da BRS: prestativo, proativo, chama cada um pelo primeiro nome, admite quando não sabe…" />
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <label style={rotuloCampo}>Regras invioláveis</label>
          <textarea className="form-control" rows={2} value={personalidade.regras} onChange={(e) => setP('regras', e.target.value)} placeholder="Sempre em pt-BR; nunca inventar valores de margem/taxa; nunca prometer nada a cliente…" />
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <label style={rotuloCampo}>Saudação de conversa nova (use {'{nome}'} para o primeiro nome)</label>
          <input className="form-control" value={personalidade.saudacao} onChange={(e) => setP('saudacao', e.target.value)} placeholder="E aí, {nome}! Precisa de uma força?" />
        </div>
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
