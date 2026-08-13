'use client'

import { useState, useEffect } from 'react'
import { getProvedoresConfig, saveProvedoresConfig, testAssinafyConnection, inspectAssinafyTemplates, syncAssinafyContractFields, smokeTestAssinafyContract, listAgentesForContract, generatePartnerContract, reconcileAssinafyDocuments, registerAssinafyWebhook, listAssinafyDocuments, enqueueEngineTestJob, runEngineOnce, listEngineJobs } from '../../../actions'
import { FileText, Key, Save, Loader2, CheckCircle, AlertCircle, Building2, FlaskConical, ShieldCheck, PlugZap, ListTree, Rocket, FileSignature, RefreshCw, Webhook, Cog } from 'lucide-react'

export default function AssinaturaConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [templates, setTemplates] = useState<any[] | null>(null)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<any[] | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [smokeEmail, setSmokeEmail] = useState('')
  const [smokeTemplate, setSmokeTemplate] = useState('Teste_Final')
  const [smoking, setSmoking] = useState(false)
  const [smokeResult, setSmokeResult] = useState<any | null>(null)
  const [smokeError, setSmokeError] = useState<string | null>(null)
  const [agentes, setAgentes] = useState<any[]>([])
  const [selectedAgente, setSelectedAgente] = useState('')
  const [genEmail, setGenEmail] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<any | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<any[] | null>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)
  const [registeringWebhook, setRegisteringWebhook] = useState(false)
  const [webhookMsg, setWebhookMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [jobs, setJobs] = useState<any[] | null>(null)
  const [engineBusy, setEngineBusy] = useState(false)
  const [engineMsg, setEngineMsg] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Assinafy State
  const [assinafyId, setAssinafyId] = useState('')
  const [assinafyApiKey, setAssinafyApiKey] = useState('')
  const [assinafyAccountId, setAssinafyAccountId] = useState('')
  const [assinafyEnvironment, setAssinafyEnvironment] = useState<'sandbox' | 'production'>('production')
  const [assinafyWebhookSecret, setAssinafyWebhookSecret] = useState('')
  const [assinafyActive, setAssinafyActive] = useState(false)

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      const res = await getProvedoresConfig()
      if (res.success && res.assinafy) {
        setAssinafyId(res.assinafy.id || '')
        setAssinafyApiKey(res.assinafy.api_key || '')
        setAssinafyAccountId(res.assinafy.account_id || '')
        setAssinafyEnvironment(res.assinafy.environment === 'sandbox' ? 'sandbox' : 'production')
        setAssinafyWebhookSecret(res.assinafy.webhook_secret || '')
        setAssinafyActive(res.assinafy.is_active ?? false)
      } else {
        setMessage({ type: 'error', text: 'Erro ao carregar configurações do Assinafy.' })
      }
      setLoading(false)
    }

    loadConfig()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    const payload = {
      assinafy: {
        id: assinafyId || undefined,
        api_key: assinafyApiKey,
        account_id: assinafyAccountId.trim(),
        environment: assinafyEnvironment,
        webhook_secret: assinafyWebhookSecret.trim(),
        is_active: assinafyActive
      }
    }

    const res = await saveProvedoresConfig(payload)
    if (res.success) {
      setMessage({ type: 'success', text: 'Configurações do Assinafy salvas com sucesso!' })
      if (!assinafyId) {
        const configReload = await getProvedoresConfig()
        if (configReload.success && configReload.assinafy) {
          setAssinafyId(configReload.assinafy.id || '')
        }
      }
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar configurações.' })
    }
    setSaving(false)
  }

  async function handleSyncContractFields() {
    setSyncing(true)
    setSyncError(null)
    setSyncResults(null)
    const res = await syncAssinafyContractFields()
    if (res.success) {
      setSyncResults(res.results || [])
    } else {
      setSyncError(res.error || 'Falha ao sincronizar campos.')
    }
    setSyncing(false)
  }

  async function handleLoadJobs() {
    const res = await listEngineJobs()
    if (res.success) setJobs(res.jobs || [])
  }

  async function handleEnqueueTest() {
    setEngineBusy(true); setEngineMsg(null)
    const res: any = await enqueueEngineTestJob()
    setEngineMsg(res.success ? (res.deduped ? 'Job já existia (dedupe).' : 'Job de teste enfileirado.') : (res.error || 'Falha ao enfileirar.'))
    await handleLoadJobs()
    setEngineBusy(false)
  }

  async function handleRunEngine() {
    setEngineBusy(true); setEngineMsg(null)
    const res: any = await runEngineOnce()
    setEngineMsg(res.success ? `Motor rodou: ${res.claimed} job(s) processado(s).` : (res.error || 'Falha ao rodar o motor.'))
    await handleLoadJobs()
    setEngineBusy(false)
  }

  async function handleLoadDocuments() {
    setLoadingDocs(true)
    const res = await listAssinafyDocuments()
    if (res.success) setDocuments(res.documents || [])
    setLoadingDocs(false)
  }

  async function handleReconcile() {
    setReconciling(true)
    setReconcileMsg(null)
    const res = await reconcileAssinafyDocuments()
    if (res.success) {
      setReconcileMsg(`${res.checked} verificado(s), ${res.updated} atualizado(s).`)
      await handleLoadDocuments()
    } else {
      setReconcileMsg(res.error || 'Falha na reconciliação.')
    }
    setReconciling(false)
  }

  async function handleRegisterWebhook() {
    setRegisteringWebhook(true)
    setWebhookMsg(null)
    const res = await registerAssinafyWebhook()
    if (res.success) {
      setWebhookMsg({ ok: true, text: `Webhook registrado: ${res.url}${res.hasSecret ? '' : ' (sem segredo — recomenda-se configurar)'}` })
    } else {
      setWebhookMsg({ ok: false, text: res.error || 'Falha ao registrar webhook.' })
    }
    setRegisteringWebhook(false)
  }

  async function handleLoadAgentes() {
    const res = await listAgentesForContract()
    if (res.success) setAgentes(res.agentes || [])
  }

  async function handleGenerateContract() {
    setGenerating(true)
    setGenError(null)
    setGenResult(null)
    const res = await generatePartnerContract({
      partnerId: selectedAgente,
      templateName: smokeTemplate.trim(),
      testEmail: genEmail.trim(),
    })
    if (res.success) {
      setGenResult(res)
    } else {
      setGenError(res.error || 'Falha ao gerar contrato.')
    }
    setGenerating(false)
  }

  async function handleSmokeTest() {
    setSmoking(true)
    setSmokeError(null)
    setSmokeResult(null)
    const res = await smokeTestAssinafyContract({ templateName: smokeTemplate.trim(), testEmail: smokeEmail.trim() })
    if (res.success) {
      setSmokeResult(res)
    } else {
      setSmokeError(res.error || 'Falha no smoke test.')
    }
    setSmoking(false)
  }

  async function handleInspectTemplates() {
    setInspecting(true)
    setInspectError(null)
    setTemplates(null)
    const res = await inspectAssinafyTemplates()
    if (res.success) {
      setTemplates(res.templates || [])
    } else {
      setInspectError(res.error || 'Falha ao listar templates.')
    }
    setInspecting(false)
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    const res = await testAssinafyConnection({
      api_key: assinafyApiKey,
      account_id: assinafyAccountId.trim(),
      environment: assinafyEnvironment,
    })
    if (res.success) {
      const envLabel = assinafyEnvironment === 'sandbox' ? 'Sandbox' : 'Produção'
      setTestResult({ ok: true, text: `Conexão validada com sucesso (${envLabel}).` })
    } else {
      setTestResult({ ok: false, text: res.error || 'Falha ao validar a conexão.' })
    }
    setTesting(false)
  }

  if (loading) {
    return (
      <div className="page-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
          Configurações de API - Assinatura Eletrônica
        </h1>
        <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Configure os provedores de assinatura eletrônica dos contratos e termos de parceria
        </p>
      </div>

      {message && (
        <div 
          style={{ 
            padding: '1rem', 
            borderRadius: '8px', 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`
          }}
        >
          {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} style={{ maxWidth: '600px' }}>
        {/* Provedor de Assinatura: Assinafy */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', padding: '0.5rem', borderRadius: '8px' }}>
              <FileText size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>Assinafy</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>Plataforma para formalização e assinatura de contratos</p>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">API Key do Assinafy</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Key size={16} />
              </span>
              <input 
                type="password" 
                className="form-control" 
                style={{ paddingLeft: '2.25rem' }}
                placeholder="Token de acesso da API do Assinafy"
                value={assinafyApiKey}
                onChange={e => setAssinafyApiKey(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">ID da Conta (Account ID)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Building2 size={16} />
              </span>
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '2.25rem' }}
                placeholder="ID do workspace (Minha Conta → Workspaces)"
                value={assinafyAccountId}
                onChange={e => setAssinafyAccountId(e.target.value)}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', margin: '0.35rem 0 0' }}>
              Obrigatório para os disparos: a API da Assinafy escopa quase tudo por conta de workspace.
            </p>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Ambiente</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {([
                { value: 'sandbox', label: 'Sandbox (teste)', icon: FlaskConical, hint: 'Não gera cobrança nem envia convites reais' },
                { value: 'production', label: 'Produção', icon: ShieldCheck, hint: 'Documentos e cobranças reais' },
              ] as const).map(opt => {
                const Icon = opt.icon
                const selected = assinafyEnvironment === opt.value
                const isProd = opt.value === 'production'
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setAssinafyEnvironment(opt.value)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: selected ? (isProd ? '#FEF2F2' : '#FFFBEB') : '#fff',
                      border: `2px solid ${selected ? (isProd ? '#EF4444' : '#F59E0B') : 'var(--brs-gray-200)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.875rem', color: 'var(--brs-gray-800)' }}>
                      <Icon size={16} /> {opt.label}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginTop: '0.25rem' }}>{opt.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Segredo do Webhook (opcional)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }}>
                <Key size={16} />
              </span>
              <input
                type="password"
                className="form-control"
                style={{ paddingLeft: '2.25rem' }}
                placeholder="Usado para validar a origem dos webhooks recebidos"
                value={assinafyWebhookSecret}
                onChange={e => setAssinafyWebhookSecret(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <input
              type="checkbox"
              id="assinafyActive"
              checked={assinafyActive}
              onChange={e => setAssinafyActive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="assinafyActive" style={{ fontSize: '0.875rem', color: 'var(--brs-gray-700)', cursor: 'pointer', userSelect: 'none' }}>
              Ativar disparos e coleta de assinaturas (Assinafy)
            </label>
          </div>

          {testResult && (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem',
                fontWeight: 500,
                background: testResult.ok ? '#ECFDF5' : '#FEF2F2',
                color: testResult.ok ? '#065F46' : '#991B1B',
                border: `1px solid ${testResult.ok ? '#A7F3D0' : '#FECACA'}`,
              }}
            >
              {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.text}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={testing || saving || !assinafyApiKey || !assinafyAccountId.trim()}
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
              title="Valida as credenciais na Assinafy sem salvar"
            >
              {testing ? <Loader2 size={16} className="spinner" /> : <PlugZap size={16} />}
              Testar Conexão
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || testing} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar Configurações
            </button>
          </div>
        </div>
      </form>

      {/* Inspeção de templates: mostra os role_id / field_id reais cadastrados na Assinafy */}
      <div className="card" style={{ padding: '1.5rem', maxWidth: '600px', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', color: '#6366F1', padding: '0.5rem', borderRadius: '8px' }}>
            <ListTree size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--brs-gray-800)' }}>Templates cadastrados</h3>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
              Lista os papéis e campos (com IDs) dos templates na conta configurada.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleInspectTemplates}
          disabled={inspecting}
          style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}
        >
          {inspecting ? <Loader2 size={16} className="spinner" /> : <ListTree size={16} />}
          Inspecionar Templates
        </button>

        {/* Criar todos os campos do contrato de uma vez (idempotente) */}
        <div style={{ padding: '0.85rem', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem' }}>
            Campos do Contrato PS PJ
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', margin: '0 0 0.6rem' }}>
            Cria na Assinafy todos os campos do contrato (nomeados e mapeados ao dicionário),
            pulando os que já existem. Depois é só posicionar cada um no editor de template.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSyncContractFields}
            disabled={syncing}
            style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
          >
            {syncing ? <Loader2 size={16} className="spinner" /> : <PlugZap size={16} />}
            Criar campos do contrato
          </button>

          {syncError && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: '#991B1B' }}>{syncError}</div>
          )}

          {syncResults && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.4rem' }}>
                {syncResults.filter((r: any) => r.created).length} criados, {syncResults.filter((r: any) => !r.created).length} já existiam
              </div>
              {syncResults.map((r: any) => (
                <div key={r.name} style={{ fontSize: '0.74rem', color: 'var(--brs-gray-600)' }}>
                  {r.created ? '🆕' : '✓'} <strong>{r.name}</strong> → <code>{r.canonicalKey}</code>{' '}
                  <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-400)', fontSize: '0.68rem' }}>{r.field_id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {inspectError && (
          <div style={{ padding: '0.75rem', borderRadius: 8, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: '0.8rem', marginBottom: '1rem' }}>
            {inspectError}
          </div>
        )}

        {templates && templates.length === 0 && (
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Nenhum template encontrado nesta conta.</div>
        )}

        {/* Smoke test do fluxo A: gera um contrato preenchido e retorna os links de assinatura */}
        <div style={{ padding: '0.85rem', borderRadius: 8, background: '#EFF6FF', border: '1px solid #BFDBFE', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem' }}>
            Smoke test do fluxo A (sandbox)
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', margin: '0 0 0.6rem' }}>
            Gera um contrato preenchido com dados de exemplo a partir do template e retorna os links de
            assinatura por parte. Todos os convites vão para o e-mail de teste informado (sandbox, sem cobrança).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Nome do template (ex.: Teste_Final)"
              value={smokeTemplate}
              onChange={e => setSmokeTemplate(e.target.value)}
            />
            <input
              type="email"
              className="form-control"
              placeholder="E-mail de teste (recebe os convites)"
              value={smokeEmail}
              onChange={e => setSmokeEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSmokeTest}
            disabled={smoking || !smokeEmail.trim()}
            style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
          >
            {smoking ? <Loader2 size={16} className="spinner" /> : <Rocket size={16} />}
            Rodar smoke test
          </button>

          {smokeError && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: '#991B1B' }}>{smokeError}</div>
          )}

          {smokeResult && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.76rem', color: 'var(--brs-gray-700)' }}>
              <div style={{ fontWeight: 700, color: '#065F46', marginBottom: '0.35rem' }}>
                ✅ Documento gerado — status: {smokeResult.status || '(criando)'}
              </div>
              <div>Template: <strong>{smokeResult.templateName}</strong></div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--brs-gray-400)' }}>document_id: {smokeResult.documentId}</div>
              <div style={{ margin: '0.4rem 0' }}>{smokeResult.signerCount} signatário(s) · {smokeResult.mapped?.length || 0} campo(s) preenchido(s) · {smokeResult.unmapped?.length || 0} sem mapeamento</div>

              {(smokeResult.signingUrls?.length || 0) > 0 ? (
                <div style={{ marginTop: '0.4rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Links de assinatura:</div>
                  {smokeResult.signingUrls.map((u: any, i: number) => (
                    <div key={i} style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>
                      • <a href={u.url} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}>{u.url}</a>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: '0.4rem', color: 'var(--brs-gray-500)' }}>
                  Links ainda não disponíveis (documento pode estar processando metadados). Consulte pela Assinafy em instantes.
                </div>
              )}

              {(smokeResult.unmapped?.length || 0) > 0 && (
                <div style={{ marginTop: '0.5rem', color: 'var(--brs-gray-500)' }}>
                  Campos no template sem mapeamento: {smokeResult.unmapped.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Gerar contrato com dados REAIS de um parceiro */}
        <div style={{ padding: '0.85rem', borderRadius: 8, background: '#FAF5FF', border: '1px solid #E9D5FF', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileSignature size={15} /> Gerar contrato de um parceiro real
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', margin: '0 0 0.6rem' }}>
            Preenche o template com o corban_data real do parceiro escolhido e cria o pedido de assinatura.
            Convites vão para o e-mail de teste (sandbox).
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <select
              className="form-control"
              style={{ flex: 1 }}
              value={selectedAgente}
              onChange={e => setSelectedAgente(e.target.value)}
              onFocus={() => { if (agentes.length === 0) handleLoadAgentes() }}
            >
              <option value="">{agentes.length ? 'Selecione um parceiro…' : 'Clique para carregar parceiros…'}</option>
              {agentes.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}{a.cpf_cnpj ? ` — ${a.cpf_cnpj}` : ''}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <input type="email" className="form-control" style={{ flex: 1 }} placeholder="E-mail de teste (recebe os convites)" value={genEmail} onChange={e => setGenEmail(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerateContract}
            disabled={generating || !selectedAgente || !genEmail.trim()}
            style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
          >
            {generating ? <Loader2 size={16} className="spinner" /> : <FileSignature size={16} />}
            Gerar contrato
          </button>

          {genError && <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: '#991B1B' }}>{genError}</div>}

          {genResult && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.76rem', color: 'var(--brs-gray-700)' }}>
              <div style={{ fontWeight: 700, color: '#065F46', marginBottom: '0.35rem' }}>
                ✅ Contrato gerado para {genResult.partnerName} — status: {genResult.status || '(criando)'}
              </div>
              <div>{genResult.filled?.length || 0} campo(s) preenchido(s) com dado real · {genResult.missing?.length || 0} sem dado · {genResult.unmapped?.length || 0} não mapeado(s)</div>

              {(genResult.signingUrls?.length || 0) > 0 && (
                <div style={{ marginTop: '0.4rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Links de assinatura:</div>
                  {genResult.signingUrls.map((u: any, i: number) => (
                    <div key={i} style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>
                      • <a href={u.url} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}>{u.url}</a>
                    </div>
                  ))}
                </div>
              )}

              {(genResult.missing?.length || 0) > 0 && (
                <div style={{ marginTop: '0.5rem', color: 'var(--brs-gray-500)' }}>
                  Campos sem dado no cadastro (foram como &quot;—&quot;): {genResult.missing.map((m: any) => m.canonicalKey).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Documentos & assinaturas: status, reconciliação e webhook (frente B) */}
        <div style={{ padding: '0.85rem', borderRadius: 8, background: '#F0F9FF', border: '1px solid #BAE6FD', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={15} /> Documentos &amp; Assinaturas
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', margin: '0 0 0.6rem' }}>
            Acompanha o status dos contratos. A reconciliação consulta a Assinafy diretamente (rede de
            segurança do webhook). O registro de webhook exige URL pública (não funciona em localhost).
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <button type="button" className="btn btn-secondary" onClick={handleLoadDocuments} disabled={loadingDocs} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {loadingDocs ? <Loader2 size={15} className="spinner" /> : <FileText size={15} />} Carregar documentos
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleReconcile} disabled={reconciling} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {reconciling ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />} Reconciliar
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleRegisterWebhook} disabled={registeringWebhook} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {registeringWebhook ? <Loader2 size={15} className="spinner" /> : <Webhook size={15} />} Registrar webhook
            </button>
          </div>

          {reconcileMsg && <div style={{ fontSize: '0.74rem', color: 'var(--brs-gray-600)', marginBottom: '0.4rem' }}>{reconcileMsg}</div>}
          {webhookMsg && <div style={{ fontSize: '0.74rem', color: webhookMsg.ok ? '#065F46' : '#991B1B', marginBottom: '0.4rem', wordBreak: 'break-all' }}>{webhookMsg.text}</div>}

          {documents && documents.length === 0 && (
            <div style={{ fontSize: '0.76rem', color: 'var(--brs-gray-500)' }}>Nenhum documento registrado ainda (gere um contrato ou aplique a migration).</div>
          )}
          {documents && documents.map((d: any) => (
            <div key={d.document_id} style={{ borderTop: '1px solid var(--brs-gray-100)', padding: '0.5rem 0', fontSize: '0.74rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <strong style={{ color: 'var(--brs-gray-800)' }}>{d.template_name || 'Documento'}</strong>
                <span style={{
                  padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700,
                  background: ['certificated'].includes(d.status) ? '#DCFCE7' : ['rejected_by_signer', 'rejected_by_user', 'failed', 'expired'].includes(d.status) ? '#FEE2E2' : '#FEF9C3',
                  color: ['certificated'].includes(d.status) ? '#166534' : ['rejected_by_signer', 'rejected_by_user', 'failed', 'expired'].includes(d.status) ? '#991B1B' : '#854D0E',
                }}>{d.status || '—'}</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.66rem', color: 'var(--brs-gray-400)' }}>{d.document_id} · {d.environment || ''}</div>
            </div>
          ))}
        </div>

        {/* Motor de execução (frente C): fila de jobs */}
        <div style={{ padding: '0.85rem', borderRadius: 8, background: '#F1F5F9', border: '1px solid #CBD5E1', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Cog size={15} /> Motor de execução (fila de jobs)
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', margin: '0 0 0.6rem' }}>
            Núcleo do motor: fila durável, idempotente, com retry. Em produção o cron drena a fila a cada 2 min;
            aqui dá pra enfileirar um job de teste e rodar manualmente. (Requer a migration process_jobs aplicada.)
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={handleEnqueueTest} disabled={engineBusy} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {engineBusy ? <Loader2 size={15} className="spinner" /> : <PlugZap size={15} />} Enfileirar teste
            </button>
            <button type="button" className="btn btn-primary" onClick={handleRunEngine} disabled={engineBusy} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {engineBusy ? <Loader2 size={15} className="spinner" /> : <Cog size={15} />} Rodar motor
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleLoadJobs} disabled={engineBusy} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <RefreshCw size={15} /> Carregar jobs
            </button>
          </div>
          {engineMsg && <div style={{ fontSize: '0.74rem', color: 'var(--brs-gray-600)', marginBottom: '0.4rem' }}>{engineMsg}</div>}
          {jobs && jobs.length === 0 && <div style={{ fontSize: '0.76rem', color: 'var(--brs-gray-500)' }}>Nenhum job na fila.</div>}
          {jobs && jobs.map((j: any) => (
            <div key={j.id} style={{ borderTop: '1px solid var(--brs-gray-100)', padding: '0.4rem 0', fontSize: '0.73rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span><strong>{j.kind}</strong> <span style={{ color: 'var(--brs-gray-400)' }}>· tent. {j.attempts}/{j.max_attempts}</span></span>
              <span style={{
                padding: '0.05rem 0.45rem', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700,
                background: j.status === 'done' ? '#DCFCE7' : j.status === 'failed' ? '#FEE2E2' : j.status === 'running' ? '#DBEAFE' : '#FEF9C3',
                color: j.status === 'done' ? '#166534' : j.status === 'failed' ? '#991B1B' : j.status === 'running' ? '#1E40AF' : '#854D0E',
              }}>{j.status}</span>
            </div>
          ))}
        </div>

        {templates && templates.map((tpl: any) => (
          <div key={tpl.id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--brs-gray-800)' }}>{tpl.name}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', fontFamily: 'monospace', marginBottom: '0.75rem' }}>template_id: {tpl.id}</div>

            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', marginBottom: '0.35rem' }}>Papéis ({tpl.roles?.length || 0})</div>
            {(tpl.roles || []).map((r: any) => (
              <div key={r.id} style={{ fontSize: '0.76rem', color: 'var(--brs-gray-600)' }}>
                • {r.name} <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-400)' }}>({r.id})</span>
              </div>
            ))}

            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--brs-gray-700)', margin: '0.75rem 0 0.35rem' }}>Campos ({tpl.fields?.length || 0})</div>
            {(tpl.fields || []).map((f: any, i: number) => (
              <div key={`${f.field_id}-${i}`} style={{ fontSize: '0.76rem', color: 'var(--brs-gray-600)' }}>
                • {f.label || '(sem nome)'} <span style={{ color: 'var(--brs-gray-400)' }}>[{f.type}]</span>{' '}
                <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-400)' }}>{f.field_id}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
