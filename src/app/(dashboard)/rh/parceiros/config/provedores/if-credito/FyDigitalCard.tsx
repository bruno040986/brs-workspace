'use client'

/**
 * Card dedicado da FyDigital (OAuth client_credentials + assinatura JWT
 * RS256) com: credencial, URL do webhook (pra cadastrar com o suporte deles,
 * tecnologia@fy.digital), teste de autenticação e painel de DESCOBERTA
 * (chamadas assinadas de leitura/simulação — mesma lógica do card da
 * Amigoz). Criar Operação de verdade fica de fora até o formato do webhook
 * estar confirmado (ver fydigital-actions.ts).
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, FlaskConical, KeyRound, Link as LinkIcon, Loader2, PlugZap, Save } from 'lucide-react'
import Link from 'next/link'
import { lerConfigIF, salvarConfigIF, type InstituicaoConfigResumo } from '@/lib/if-credito/config-actions'
import { OPERACOES_FYDIGITAL, type OperacaoDescobertaFyDigital } from '@/lib/if-credito/fydigital-operacoes'
import {
  executarDescobertaFyDigital,
  listarChamadasFyDigital,
  listarWebhooksFyDigital,
  obterWebhookUrlFyDigital,
  testarAutenticacaoFyDigital,
  type ChamadaResumoFyDigital,
  type RespostaDescobertaFyDigital,
  type WebhookEventoResumoFyDigital,
} from '@/lib/if-credito/fydigital-actions'

const ROTULO: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

function JsonBox({ valor }: { valor: unknown }) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2)
  return (
    <pre style={{ margin: 0, padding: '0.7rem', background: 'var(--brs-gray-50, #f8fafc)', border: '1px solid var(--brs-gray-200)', borderRadius: 8, fontSize: '0.72rem', maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {texto}
    </pre>
  )
}

function LogoBox({ logoUrl, nome, size = 48 }: { logoUrl: string; nome: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, border: '1px solid var(--brs-gray-200)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff', flexShrink: 0 }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={nome} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : null}
    </div>
  )
}

export function FyDigitalCard({
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
  const [tokenExpira, setTokenExpira] = useState<string | null>(null)

  const [webhookUrl, setWebhookUrl] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [testando, setTestando] = useState(false)

  const [operacao, setOperacao] = useState<OperacaoDescobertaFyDigital>('simular-operacao')
  const [payload, setPayload] = useState(OPERACOES_FYDIGITAL['simular-operacao'].payloadModelo)
  const [executando, setExecutando] = useState(false)
  const [resposta, setResposta] = useState<RespostaDescobertaFyDigital | null>(null)

  const [historico, setHistorico] = useState<ChamadaResumoFyDigital[]>([])
  const [abertoChamada, setAbertoChamada] = useState<string | null>(null)
  const [webhooks, setWebhooks] = useState<WebhookEventoResumoFyDigital[]>([])
  const [abertoWebhook, setAbertoWebhook] = useState<string | null>(null)

  async function recarregarHistorico() {
    const [c, w] = await Promise.all([listarChamadasFyDigital(20), listarWebhooksFyDigital(20)])
    if (c.success) setHistorico(c.data || [])
    if (w.success) setWebhooks(w.data || [])
  }

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
        setTokenExpira(res.data.token_expira_em)
      })
      .catch(() => setErro('Erro ao carregar configuração.'))
      .finally(() => setCarregando(false))
    obterWebhookUrlFyDigital().then((res) => {
      if (res.success && res.data) setWebhookUrl(res.data.url)
    })
    recarregarHistorico()
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

  async function testarAutenticacao() {
    if (testando) return
    setTestando(true)
    setErro('')
    setOkMsg('')
    setResposta(null)
    try {
      const res = await testarAutenticacaoFyDigital()
      if (!res.success || !res.data) throw new Error(res.error)
      setOkMsg('Autenticação OK: OAuth gerou o Bearer e /api/ok respondeu.')
      setResposta(res.data)
      const cfg = await lerConfigIF(instituicao.id)
      if (cfg.success && cfg.data) setTokenExpira(cfg.data.token_expira_em)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no teste de autenticação.')
    } finally {
      setTestando(false)
      recarregarHistorico()
    }
  }

  async function executar() {
    if (executando) return
    setExecutando(true)
    setErro('')
    setResposta(null)
    try {
      const res = await executarDescobertaFyDigital({ operacao, payloadJson: payload })
      if (!res.success || !res.data) throw new Error(res.error)
      setResposta(res.data)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro na descoberta.')
    } finally {
      setExecutando(false)
      recarregarHistorico()
    }
  }

  function copiarWebhookUrl() {
    if (!webhookUrl) return
    navigator.clipboard?.writeText(webhookUrl).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  return (
    <div className="card" style={{ padding: '1.2rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <LogoBox logoUrl={instituicao.logo_url} nome={instituicao.name} />
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {instituicao.name}
            {(temClientSecret || temChavePrivada) && (
              <span style={{ fontSize: '0.68rem', color: 'var(--brs-success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> configurada
              </span>
            )}
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Consignado — OAuth2 + assinatura JWT RS256, tudo assíncrono (fila + webhook)</span>
        </div>
        <Link href="/instituicoes-financeiras" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--brs-navy)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Cadastro da IF <ExternalLink size={12} />
        </Link>
      </div>

      {erro && <div style={{ padding: '0.7rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8, background: 'rgba(220,38,38,0.08)', color: 'var(--brs-danger)', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{erro}</div>}
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
              <label style={ROTULO}>Ambiente</label>
              <select className="form-control" value={ambiente} onChange={(e) => setAmbiente(e.target.value as 'producao' | 'homologacao')}>
                <option value="homologacao">Homologação</option>
                <option value="producao">Produção</option>
              </select>
            </div>
            <div>
              <label style={ROTULO}>Base URL</label>
              <input className="form-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api-hom.fy.digital/" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem' }}>
            <div>
              <label style={ROTULO}>Client ID</label>
              <input className="form-control" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label style={ROTULO}>Client Secret {temClientSecret ? '(preencha só para trocar)' : ''}</label>
              <input className="form-control" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={temClientSecret ? '•••• já configurado' : ''} autoComplete="off" />
            </div>
          </div>

          <div style={{ marginTop: '0.8rem' }}>
            <label style={ROTULO}>Chave Privada da Empresa (RSA) {temChavePrivada ? '(preencha só para trocar)' : ''}</label>
            <textarea className="form-control" rows={3} value={empresaPrivateKey} onChange={(e) => setEmpresaPrivateKey(e.target.value)} placeholder={temChavePrivada ? '•••• já configurada' : '-----BEGIN PRIVATE KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
          </div>
          <div style={{ marginTop: '0.8rem' }}>
            <label style={ROTULO}>Chave Pública da Empresa (RSA) {temChavePublicaEmpresa ? '(preencha só para trocar)' : ''}</label>
            <textarea className="form-control" rows={3} value={empresaPublicKey} onChange={(e) => setEmpresaPublicKey(e.target.value)} placeholder={temChavePublicaEmpresa ? '•••• já configurada' : '-----BEGIN PUBLIC KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
          </div>
          <div style={{ marginTop: '0.8rem' }}>
            <label style={ROTULO}>Chave Pública da API (RSA — verifica assinatura das respostas/webhooks) {temChavePublicaApi ? '(preencha só para trocar)' : ''}</label>
            <textarea className="form-control" rows={3} value={apiPublicKey} onChange={(e) => setApiPublicKey(e.target.value)} placeholder={temChavePublicaApi ? '•••• já configurada' : '-----BEGIN PUBLIC KEY-----'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} autoComplete="off" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.8rem', alignItems: 'end' }}>
            <div>
              <label style={ROTULO}>TTL da simulação (horas)</label>
              <input className="form-control" type="number" min={1} max={168} value={ttlHoras} onChange={(e) => setTtlHoras(Number(e.target.value) || 24)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.6rem' }}>
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Integração ativa
            </label>
          </div>

          {tokenExpira && (
            <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0.6rem 0 0' }}>
              Bearer em cache válido até {new Date(tokenExpira).toLocaleString('pt-BR')}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={salvar} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar configuração
            </button>
            <button className="btn btn-outline" onClick={testarAutenticacao} disabled={testando || !temClientSecret} title={!temClientSecret ? 'Salve Client ID e Client Secret primeiro' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {testando ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Testar autenticação
            </button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--brs-gray-200)', margin: '1.2rem 0' }} />

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <LinkIcon size={14} /> URL do webhook
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)', margin: '0 0 0.5rem' }}>
            A FyDigital não tem endpoint pra cadastrar webhook sozinho — envie esta URL pro suporte deles (
            <a href="mailto:tecnologia@fy.digital" style={{ color: 'var(--brs-navy)' }}>tecnologia@fy.digital</a>) pedindo pra apontar os eventos do ambiente {ambiente === 'producao' ? 'de produção' : 'de homologação'} pra cá. Os eventos recebidos aparecem na tabela mais abaixo.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input className="form-control" readOnly value={webhookUrl} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn-outline btn-sm" onClick={copiarWebhookUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Copy size={13} /> {copiado ? 'Copiado!' : 'Copiar'}
            </button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--brs-gray-200)', margin: '1.2rem 0' }} />

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FlaskConical size={14} /> Descoberta — chamadas assinadas (resposta bruta)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.8rem', alignItems: 'start' }}>
            <div>
              <label style={ROTULO}>Operação</label>
              <select
                className="form-control"
                value={operacao}
                onChange={(e) => {
                  const op = e.target.value as OperacaoDescobertaFyDigital
                  setOperacao(op)
                  setPayload(OPERACOES_FYDIGITAL[op].payloadModelo)
                }}
              >
                {(Object.keys(OPERACOES_FYDIGITAL) as OperacaoDescobertaFyDigital[]).map((op) => (
                  <option key={op} value={op}>{OPERACOES_FYDIGITAL[op].rotulo}</option>
                ))}
              </select>
              <p style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', margin: '0.5rem 0 0' }}>{OPERACOES_FYDIGITAL[operacao].dica}</p>
              <button className="btn btn-primary btn-sm" onClick={executar} disabled={executando || !temChavePrivada} title={!temChavePrivada ? 'Salve a Chave Privada da Empresa primeiro' : ''} style={{ marginTop: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {executando ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Executar
              </button>
            </div>
            <div>
              <label style={ROTULO}>Payload "data" (JSON) — vira {'{ operacao, data }'} assinado como JWT</label>
              <textarea className="form-control" rows={10} value={payload} onChange={(e) => setPayload(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} spellCheck={false} />
            </div>
          </div>

          {resposta && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.4rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge ${resposta.sucesso ? 'badge-success' : 'badge-danger'}`}>HTTP {resposta.http_status || '—'}</span>
                <span>{resposta.operacao}</span>
                <span style={{ color: 'var(--brs-gray-400)', fontWeight: 500 }}>{resposta.duracao_ms} ms</span>
                {resposta.assinatura_valida !== undefined && (
                  <span className={`badge ${resposta.assinatura_valida ? 'badge-success' : 'badge-gray'}`}>
                    {resposta.assinatura_valida ? 'assinatura RS256 verificada' : 'resposta não é JWT assinado'}
                  </span>
                )}
              </div>
              <JsonBox valor={resposta.corpo} />
              {resposta.corpo_decodificado !== undefined && (
                <>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-500)', margin: '0.6rem 0 0.3rem' }}>Decodificado (JWT verificado com a chave pública da API)</div>
                  <JsonBox valor={resposta.corpo_decodificado} />
                </>
              )}
            </div>
          )}

          {historico.length > 0 && (
            <div style={{ marginTop: '1.2rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-500)', marginBottom: '0.4rem' }}>Últimas chamadas enviadas por nós</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Quando</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Operação</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>HTTP</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>ms</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((c) => (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--brs-gray-100, #f1f5f9)' }}>
                        <td style={{ padding: '0.3rem 0.4rem', whiteSpace: 'nowrap' }}>{new Date(c.created_at).toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{c.operacao} <span style={{ color: 'var(--brs-gray-400)' }}>{c.metodo} {c.caminho}</span></td>
                        <td style={{ padding: '0.3rem 0.4rem' }}><span className={`badge ${c.sucesso ? 'badge-success' : 'badge-danger'}`}>{c.http_status ?? '—'}</span></td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{c.duracao_ms ?? '—'}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setAbertoChamada(abertoChamada === c.id ? null : c.id)}>{abertoChamada === c.id ? 'Fechar' : 'Ver resposta'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {abertoChamada && <div style={{ marginTop: '0.6rem' }}><JsonBox valor={historico.find((c) => c.id === abertoChamada)?.resposta ?? null} /></div>}
            </div>
          )}

          <div style={{ marginTop: '1.2rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-500)', marginBottom: '0.4rem' }}>Webhooks recebidos da FyDigital</div>
            {webhooks.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Nenhum ainda — normal até o suporte deles apontar a URL acima pro nosso ambiente.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--brs-gray-500)' }}>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Quando</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Webhook</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>Assinatura</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}>request_id / id externo</th>
                      <th style={{ padding: '0.3rem 0.4rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((w) => (
                      <tr key={w.id} style={{ borderTop: '1px solid var(--brs-gray-100, #f1f5f9)' }}>
                        <td style={{ padding: '0.3rem 0.4rem', whiteSpace: 'nowrap' }}>{new Date(w.recebido_em).toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{w.webhook}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}><span className={`badge ${w.assinatura_valida ? 'badge-success' : 'badge-gray'}`}>{w.assinatura_valida ? 'verificada' : 'não verificada'}</span></td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>{w.request_id || w.id_externo || '—'}</td>
                        <td style={{ padding: '0.3rem 0.4rem' }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setAbertoWebhook(abertoWebhook === w.id ? null : w.id)}>{abertoWebhook === w.id ? 'Fechar' : 'Ver payload'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {abertoWebhook && <div style={{ marginTop: '0.6rem' }}><JsonBox valor={webhooks.find((w) => w.id === abertoWebhook)?.payload ?? null} /></div>}
          </div>
        </>
      )}
    </div>
  )
}
