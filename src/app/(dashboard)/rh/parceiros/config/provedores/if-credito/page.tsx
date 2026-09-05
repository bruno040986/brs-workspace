'use client'

/**
 * Provedores e APIs › APIs de Instituições Financeiras de Crédito — card por
 * IF (a 1ª é a FyDigital). Credenciais no cofre AES, write-only. O teste de
 * conexão real depende do adaptador (Fatia 4); aqui é só cadastro.
 * Permissão: sistema-config-if-credito.
 */
import { useEffect, useState } from 'react'
import { Banknote, CheckCircle2, KeyRound, Loader2, Save } from 'lucide-react'
import {
  lerConfigIF,
  listarInstituicoesConfig,
  salvarConfigIF,
  type InstituicaoConfigResumo,
} from '@/lib/if-credito/config-actions'

export default function IfCreditoConfigPage() {
  const [instituicoes, setInstituicoes] = useState<InstituicaoConfigResumo[]>([])
  const [instituicaoId, setInstituicaoId] = useState('')
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [carregandoConfig, setCarregandoConfig] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const [ambiente, setAmbiente] = useState<'producao' | 'homologacao'>('homologacao')
  const [baseUrl, setBaseUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [empresaPrivateKey, setEmpresaPrivateKey] = useState('')
  const [empresaPublicKey, setEmpresaPublicKey] = useState('')
  const [apiPublicKey, setApiPublicKey] = useState('')
  const [ttlHoras, setTtlHoras] = useState(24)
  const [ativo, setAtivo] = useState(false)

  const [temClientSecret, setTemClientSecret] = useState(false)
  const [temChavePrivada, setTemChavePrivada] = useState(false)
  const [temChavePublicaEmpresa, setTemChavePublicaEmpresa] = useState(false)
  const [temChavePublicaApi, setTemChavePublicaApi] = useState(false)

  useEffect(() => {
    listarInstituicoesConfig()
      .then((res) => {
        if (!res.success) {
          setErro(res.error || 'Sem permissão.')
          return
        }
        setInstituicoes(res.data || [])
        if (res.data && res.data.length > 0) setInstituicaoId(res.data[0].id)
      })
      .catch(() => setErro('Erro ao carregar instituições.'))
      .finally(() => setCarregandoLista(false))
  }, [])

  useEffect(() => {
    if (!instituicaoId) return
    setCarregandoConfig(true)
    setErro('')
    setOkMsg('')
    // limpa os campos secretos ao trocar de IF (write-only, nunca vêm do servidor)
    setClientSecret('')
    setEmpresaPrivateKey('')
    setEmpresaPublicKey('')
    setApiPublicKey('')
    lerConfigIF(instituicaoId)
      .then((res) => {
        if (!res.success || !res.data) {
          setErro(res.error || 'Erro ao carregar configuração.')
          return
        }
        setAmbiente(res.data.ambiente)
        setBaseUrl(res.data.base_url)
        setClientId(res.data.client_id)
        setTtlHoras(res.data.simulacao_ttl_horas)
        setAtivo(res.data.ativo)
        setTemClientSecret(res.data.temClientSecret)
        setTemChavePrivada(res.data.temChavePrivada)
        setTemChavePublicaEmpresa(res.data.temChavePublicaEmpresa)
        setTemChavePublicaApi(res.data.temChavePublicaApi)
      })
      .catch(() => setErro('Erro ao carregar configuração.'))
      .finally(() => setCarregandoConfig(false))
  }, [instituicaoId])

  async function salvar() {
    if (salvando || !instituicaoId) return
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await salvarConfigIF({
        instituicao_financeira_id: instituicaoId,
        ambiente,
        base_url: baseUrl,
        client_id: clientId,
        client_secret: clientSecret.trim() || undefined,
        empresa_private_key: empresaPrivateKey.trim() || undefined,
        empresa_public_key: empresaPublicKey.trim() || undefined,
        api_public_key: apiPublicKey.trim() || undefined,
        simulacao_ttl_horas: ttlHoras,
        ativo,
      })
      if (!res.success) throw new Error(res.error)
      setOkMsg('Configuração salva!')
      if (clientSecret.trim()) setTemClientSecret(true)
      if (empresaPrivateKey.trim()) setTemChavePrivada(true)
      if (empresaPublicKey.trim()) setTemChavePublicaEmpresa(true)
      if (apiPublicKey.trim()) setTemChavePublicaApi(true)
      setClientSecret('')
      setEmpresaPrivateKey('')
      setEmpresaPublicKey('')
      setApiPublicKey('')
      setInstituicoes((prev) => prev.map((i) => (i.id === instituicaoId ? { ...i, temConfig: true, ativo } : i)))
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  if (carregandoLista) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Banknote size={24} /> APIs de Instituições Financeiras de Crédito
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Credenciais das APIs de propostas de crédito (a 1ª é a FyDigital) — cifradas no cofre, usadas só pelo
        servidor. As propostas criadas por essas integrações aparecem no <strong>Painel de Operações</strong>.
      </p>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      {instituicoes.length === 0 ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>
          Nenhuma instituição financeira cadastrada. Cadastre em <strong>Instituições Financeiras</strong> primeiro.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <label style={rotulo}>Instituição Financeira</label>
            <select className="form-control" value={instituicaoId} onChange={(e) => setInstituicaoId(e.target.value)}>
              {instituicoes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} {i.temConfig ? (i.ativo ? '· configurada, ativa' : '· configurada, inativa') : '· sem configuração'}
                </option>
              ))}
            </select>
          </div>

          {carregandoConfig ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '1.5rem' }}><Loader2 size={18} className="animate-spin" /> Carregando configuração…</div>
          ) : (
            <>
              <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <KeyRound size={17} /> Credencial
                  {(temClientSecret || temChavePrivada) && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--brs-success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle2 size={13} /> configurada
                    </span>
                  )}
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  <div>
                    <label style={rotulo}>Ambiente</label>
                    <select className="form-control" value={ambiente} onChange={(e) => setAmbiente(e.target.value as 'producao' | 'homologacao')}>
                      <option value="homologacao">Homologação</option>
                      <option value="producao">Produção</option>
                    </select>
                  </div>
                  <div>
                    <label style={rotulo}>Base URL</label>
                    <input className="form-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api-hom.fy.digital/" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem' }}>
                  <div>
                    <label style={rotulo}>Client ID</label>
                    <input className="form-control" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
                  </div>
                  <div>
                    <label style={rotulo}>Client Secret {temClientSecret ? '(preencha só para trocar)' : ''}</label>
                    <input className="form-control" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={temClientSecret ? '•••• já configurado' : ''} autoComplete="off" />
                  </div>
                </div>

                <div style={{ marginTop: '0.8rem' }}>
                  <label style={rotulo}>Chave Privada da Empresa (RSA) {temChavePrivada ? '(preencha só para trocar)' : ''}</label>
                  <textarea className="form-control" rows={3} value={empresaPrivateKey} onChange={(e) => setEmpresaPrivateKey(e.target.value)} placeholder={temChavePrivada ? '•••• já configurada' : '-----BEGIN PRIVATE KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
                </div>
                <div style={{ marginTop: '0.8rem' }}>
                  <label style={rotulo}>Chave Pública da Empresa (RSA) {temChavePublicaEmpresa ? '(preencha só para trocar)' : ''}</label>
                  <textarea className="form-control" rows={3} value={empresaPublicKey} onChange={(e) => setEmpresaPublicKey(e.target.value)} placeholder={temChavePublicaEmpresa ? '•••• já configurada' : '-----BEGIN PUBLIC KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
                </div>
                <div style={{ marginTop: '0.8rem' }}>
                  <label style={rotulo}>Chave Pública da API (RSA — decifra as respostas) {temChavePublicaApi ? '(preencha só para trocar)' : ''}</label>
                  <textarea className="form-control" rows={3} value={apiPublicKey} onChange={(e) => setApiPublicKey(e.target.value)} placeholder={temChavePublicaApi ? '•••• já configurada' : '-----BEGIN PUBLIC KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem', alignItems: 'end' }}>
                  <div>
                    <label style={rotulo}>TTL da simulação (horas)</label>
                    <input className="form-control" type="number" min={1} max={168} value={ttlHoras} onChange={(e) => setTtlHoras(Number(e.target.value) || 24)} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.6rem' }}>
                    <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Integração ativa
                  </label>
                </div>

                <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0.8rem 0 0' }}>
                  Teste de conexão disponível depois que a integração desta IF for ativada (depende do adaptador).
                </p>
              </div>

              <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
