'use client'

/**
 * Provedores e APIs › Figurinhas/GIFs — chave da API do GIPHY (cofre) +
 * classificação + Testar conexão. Uma chave pra todo o grupo: o chat
 * interno do CRM AlvoConsig (e o que mais precisar de GIF) lê daqui.
 * Permissão: sistema-config-figurinhas-gifs.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, PlugZap, Save, Sticker } from 'lucide-react'
import { getGiphyConfig, saveGiphyConfig, testGiphyConnection } from '@/lib/giphy/config-actions'

type Rating = 'g' | 'pg' | 'pg-13'

export default function FigurinhasGifsProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [temChave, setTemChave] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [rating, setRating] = useState<Rating>('g')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    getGiphyConfig()
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setTemChave(res.data.temChave)
        setRating(res.data.rating)
        setIsActive(res.data.isActive)
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await saveGiphyConfig({ apiKey: apiKey.trim() || undefined, rating, isActive })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (apiKey.trim()) setTemChave(true)
      setApiKey('')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await testGiphyConnection()
      if (!res.ok) throw new Error(res.detalhe)
      setOkMsg(res.detalhe)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no teste.')
    } finally {
      setTestando(false)
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  if (carregando) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sticker size={24} /> Figurinhas/GIFs (GIPHY)
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Chave da API do GIPHY — uma só para todo o grupo, cifrada no cofre e usada apenas pelo servidor. É o que alimenta a
        busca de GIFs no chat interno do CRM AlvoConsig. Gere em developers.giphy.com › Create an App › tipo <b>API</b> (a chave
        beta sai na hora; a de produção pede aprovação do app). O Tenor foi descontinuado pelo Google em 30/06/2026.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Credencial
          {temChave && <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700 }}>· configurada ✓</span>}
        </h2>
        <label style={rotulo}>API key {temChave ? '(preencha só para trocar)' : ''}</label>
        <input className="form-control" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={temChave ? '••••••••' : 'cole a API key gerada no GIPHY'} autoComplete="off" />
        <label style={{ ...rotulo, marginTop: '0.8rem' }}>Classificação máxima dos GIFs</label>
        <select className="form-control" value={rating} onChange={(e) => setRating(e.target.value as Rating)} style={{ maxWidth: 320 }}>
          <option value="g">G — livre (recomendado para atendimento)</option>
          <option value="pg">PG</option>
          <option value="pg-13">PG-13</option>
        </select>
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={testar} disabled={testando || (!temChave && !apiKey.trim())} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Integração ativa
          </label>
        </div>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.74rem', margin: '0.8rem 0 0' }}>
          Os termos do GIPHY exigem a marca &quot;Powered by GIPHY&quot; onde os GIFs aparecem — o seletor do chat já mostra.
          &quot;Testar conexão&quot; usa a chave salva; salve antes se acabou de colar uma nova.
        </p>
      </div>

      <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
      </button>
    </div>
  )
}
