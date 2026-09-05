'use client'

/**
 * Provedores e APIs › APIs de Instituições Financeiras de Crédito.
 * Cada IF tem campos de integração próprios (a FyDigital exige OAuth +
 * assinatura RS256 + 3 chaves; outras IFs vão exigir outra coisa) — por isso
 * NÃO existe um formulário genérico com seletor de IF. Só as IFs com "API
 * Disponível" marcada no cadastro (Instituições Financeiras › Conexão de
 * API) aparecem aqui: a FyDigital ganha um card DEDICADO com os campos dela;
 * as demais aparecem como card simples (logo + "API não configurada") até
 * ganharem seu próprio adaptador. Credenciais no cofre AES, write-only. O
 * teste de conexão real depende do adaptador (Fatia 4); aqui é só cadastro.
 * Permissão: sistema-config-if-credito.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Banknote, CheckCircle2, ExternalLink, KeyRound, Landmark, Loader2, Save } from 'lucide-react'
import {
  lerConfigIF,
  listarInstituicoesConfig,
  salvarConfigIF,
  type InstituicaoConfigResumo,
} from '@/lib/if-credito/config-actions'

// "FyDigital" não tem acento em nenhuma variação plausível de cadastro —
// só normaliza caixa e remove espaços/pontuação antes de comparar.
function ehFyDigital(nome: string): boolean {
  const n = nome.toLowerCase().replace(/[^a-z0-9]/g, '')
  return n.includes('fydigital')
}

function LogoBox({ logoUrl, nome, size = 44 }: { logoUrl: string; nome: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, border: '1px solid var(--brs-gray-200)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff', flexShrink: 0 }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={nome} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <Landmark size={size * 0.45} style={{ color: 'var(--brs-gray-300)' }} />
      )}
    </div>
  )
}

export default function IfCreditoConfigPage() {
  const [instituicoes, setInstituicoes] = useState<InstituicaoConfigResumo[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [erroLista, setErroLista] = useState('')

  useEffect(() => {
    listarInstituicoesConfig()
      .then((res) => {
        if (!res.success) {
          setErroLista(res.error || 'Sem permissão.')
          return
        }
        setInstituicoes(res.data || [])
      })
      .catch(() => setErroLista('Erro ao carregar instituições.'))
      .finally(() => setCarregandoLista(false))
  }, [])

  const fyDigital = instituicoes.find((i) => ehFyDigital(i.name)) || null
  const outras = instituicoes.filter((i) => i.id !== fyDigital?.id)

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Banknote size={24} /> APIs de Instituições Financeiras de Crédito
      </h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Credenciais das APIs de propostas de crédito — cifradas no cofre, usadas só pelo servidor. As propostas
        criadas por essas integrações aparecem no <strong>Painel de Operações</strong>. Só aparecem aqui as IFs com
        "API Disponível" marcada em <Link href="/instituicoes-financeiras" style={{ color: 'var(--brs-navy)' }}>Instituições Financeiras</Link> › Conexão de API.
      </p>

      {erroLista && <div className="card" style={{ padding: '0.8rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--brs-danger)', color: 'var(--brs-danger)', fontWeight: 600 }}>{erroLista}</div>}

      {carregandoLista ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
      ) : (
        <>
          {fyDigital ? (
            <FyDigitalCard instituicao={fyDigital} onAtualizado={(patch) => setInstituicoes((prev) => prev.map((i) => (i.id === fyDigital.id ? { ...i, ...patch } : i)))} />
          ) : (
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <LogoBox logoUrl="" nome="FyDigital" />
              <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
                A FyDigital ainda não está marcada como "API Disponível" no cadastro de Instituições Financeiras — marque
                lá para configurar a credencial aqui.
              </div>
            </div>
          )}

          {outras.length > 0 && (
            <>
              <h2 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 0.75rem' }}>
                Outras IFs com API disponível
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {outras.map((i) => (
                  <div key={i.id} className="card" style={{ padding: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <LogoBox logoUrl={i.logo_url} nome={i.name} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{i.name}</div>
                      <span className="badge badge-gray" style={{ marginTop: 4 }}>
                        {i.temConfig ? (i.ativo ? 'Configurada' : 'Configuração inativa') : 'API não configurada'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card dedicado da FyDigital (campos específicos dela — OAuth + JWT RS256)
// ---------------------------------------------------------------------------
function FyDigitalCard({
  instituicao,
  onAtualizado,
}: {
  instituicao: InstituicaoConfigResumo
  onAtualizado: (patch: Partial<InstituicaoConfigResumo>) => void
}) {
  const [carregando, setCarregando] = useState(true)
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
    setCarregando(true)
    lerConfigIF(instituicao.id)
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
      .finally(() => setCarregando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituicao.id])

  async function salvar() {
    if (salvando) return
    setSalvando(true)
    setErro('')
    setOkMsg('')
    try {
      const res = await salvarConfigIF({
        instituicao_financeira_id: instituicao.id,
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
      onAtualizado({ temConfig: true, ativo })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  return (
    <div className="card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <LogoBox logoUrl={instituicao.logo_url} nome={instituicao.name} size={48} />
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {instituicao.name}
            {(temClientSecret || temChavePrivada) && (
              <span style={{ fontSize: '0.68rem', color: 'var(--brs-success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> configurada
              </span>
            )}
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Consignado — OAuth2 + assinatura JWT RS256</span>
        </div>
        <Link href="/instituicoes-financeiras" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--brs-navy)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Cadastro da IF <ExternalLink size={12} />
        </Link>
      </div>

      {erro && <div style={{ padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontWeight: 600, fontSize: '0.8rem' }}>{erro}</div>}
      {okMsg && <div style={{ padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8, background: 'rgba(22,163,74,0.08)', color: 'var(--brs-success)', fontWeight: 600, fontSize: '0.8rem' }}>{okMsg}</div>}

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '1rem 0' }}><Loader2 size={18} className="animate-spin" /> Carregando configuração…</div>
      ) : (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <KeyRound size={14} /> Credencial
          </div>

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
            Teste de conexão disponível depois que o adaptador desta IF for ativado.
          </p>

          <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
          </button>
        </>
      )}
    </div>
  )
}
