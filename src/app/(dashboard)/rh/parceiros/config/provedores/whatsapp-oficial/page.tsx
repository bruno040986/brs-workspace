'use client'

/**
 * Provedores e APIs › WhatsApp Oficial (YCloud) — chave da conta da BRS
 * (cofre), números da conta e ativação como instância do BRS Messenger.
 * Permissão: sistema-config-whatsapp-oficial. A chave é write-only: o
 * servidor nunca a devolve. Uso interno da BRS — sem mensalidade.
 */
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { HeartPulse, KeyRound, Loader2, PlugZap, RefreshCw } from 'lucide-react'
import {
  ativarNumeroYcloud,
  desativarNumeroYcloud,
  getConexaoYcloud,
  saveChaveYcloud,
  sincronizarYcloudAgora,
  testYcloudConnection,
  type ConexaoBrsPublica,
  type NumeroDaConta,
} from '@/lib/ycloud/config-actions'
import { formatarDataHora, formatarMoeda, rotuloLimite, rotuloQualidade } from '@/lib/ycloud/formatar'

const ROTULO_STATUS: Record<ConexaoBrsPublica['status'], { texto: string; cor: string }> = {
  ativa: { texto: 'Conexão ativa', cor: 'var(--brs-success)' },
  invalida: { texto: 'Chave recusada pela YCloud', cor: 'var(--brs-danger)' },
  removida: { texto: 'Removida', cor: 'var(--brs-gray-400)' },
  nenhuma: { texto: 'Sem chave cadastrada', cor: 'var(--brs-gray-400)' },
}

export default function WhatsAppOficialProvedorPage() {
  const [carregando, setCarregando] = useState(true)
  const [conexao, setConexao] = useState<ConexaoBrsPublica | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [nomeConta, setNomeConta] = useState('')
  const [ocupado, setOcupado] = useState<string>('') // 'salvar' | 'testar' | 'sync' | `num:${numero}`
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [numeros, setNumeros] = useState<NumeroDaConta[]>([])
  const [saldo, setSaldo] = useState<{ moeda: string; saldo: string } | null>(null)
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [confirmarDesativar, setConfirmarDesativar] = useState('')

  const testar = useCallback(async () => {
    setOcupado('testar')
    setErro('')
    try {
      const r = await testYcloudConnection()
      if (!r.ok) throw new Error(r.detalhe)
      setOkMsg(r.detalhe)
      setNumeros(r.numeros || [])
      setSaldo(r.saldo ? { moeda: r.saldo.moeda, saldo: r.saldo.saldo } : null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no teste.')
    } finally {
      setOcupado('')
    }
  }, [])

  const recarregarConexao = useCallback(async () => {
    const r = await getConexaoYcloud()
    if (!r.success || !r.data) {
      setErro(r.error || 'Sem permissão.')
      return null
    }
    setConexao(r.data)
    setNomeConta(r.data.nome)
    return r.data
  }, [])

  useEffect(() => {
    getConexaoYcloud()
      .then((r) => {
        if (!r.success || !r.data) {
          setErro(r.error || 'Sem permissão.')
          return undefined
        }
        setConexao(r.data)
        setNomeConta(r.data.nome)
        return r.data.temChave ? testar() : undefined
      })
      .catch(() => setErro('Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [testar])

  async function salvarETestar() {
    setOcupado('salvar')
    setErro('')
    setOkMsg('')
    try {
      const r = await saveChaveYcloud({ apiKey, nome: nomeConta.trim() || undefined })
      if (!r.success) throw new Error(r.error)
      setApiKey('')
      await recarregarConexao()
      await testar()
      setOkMsg('Chave validada e salva.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
      setOcupado('')
    }
  }

  async function ativar(n: NumeroDaConta) {
    setOcupado(`num:${n.numero}`)
    setErro('')
    setOkMsg('')
    try {
      const r = await ativarNumeroYcloud({ numero: n.numero, nome: (nomes[n.numero] || n.nomeVerificado || n.numero).trim() })
      if (!r.success) throw new Error(r.error)
      setOkMsg(`Número ${n.exibicao} ativado no BRS Messenger.`)
      await recarregarConexao()
      await testar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao ativar.')
    } finally {
      setOcupado('')
    }
  }

  async function desativar(n: NumeroDaConta) {
    if (!n.instanciaId) return
    setOcupado(`num:${n.numero}`)
    setErro('')
    setOkMsg('')
    try {
      const r = await desativarNumeroYcloud(n.instanciaId)
      if (!r.success) throw new Error(r.error)
      setOkMsg(`Número ${n.exibicao} desativado. O histórico das conversas foi preservado.`)
      setConfirmarDesativar('')
      await testar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao desativar.')
    } finally {
      setOcupado('')
    }
  }

  async function sincronizar() {
    setOcupado('sync')
    setErro('')
    setOkMsg('')
    try {
      const r = await sincronizarYcloudAgora()
      if (!r.success || !r.data) throw new Error(r.error)
      const d = r.data
      if (d.erros.length) throw new Error(d.erros.join(' · '))
      setOkMsg(`Sincronizado: ${d.numeros} número(s), ${d.templates} template(s), ${d.alertas} alerta(s).`)
      await recarregarConexao()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao sincronizar.')
    } finally {
      setOcupado('')
    }
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }
  const status = ROTULO_STATUS[conexao?.status || 'nenhuma']

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}>
        <Loader2 size={18} className="animate-spin" /> Carregando…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: '0.5rem' }}>
        <Image src="/logotipos/ycloud.png" alt="YCloud" width={500} height={500} style={{ width: 72, height: 72, borderRadius: 12 }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>WhatsApp Oficial (YCloud)</h1>
      </div>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Conta YCloud da BRS para atendimento pelo BRS Messenger na API oficial do WhatsApp. Uso interno, sem mensalidade. A chave
        fica cifrada no servidor e nunca volta para o navegador. Custos das mensagens são debitados da carteira da YCloud da BRS.
      </p>

      {erro && <div role="alert" className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div role="status" className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={17} /> Conta e chave
        </h2>
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: '0.9rem' }}>
          <span style={{ color: status.cor, fontWeight: 700 }}>● {status.texto}</span>
          <span style={{ color: 'var(--brs-gray-600)' }}>
            Webhook: <b>{conexao?.webhookConfigurado ? 'configurado' : 'será criado ao ativar o 1º número'}</b>
          </span>
          <span style={{ color: 'var(--brs-gray-600)' }}>Último teste: <b>{formatarDataHora(conexao?.ultimoTesteEm)}</b></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.9rem' }}>
          <div>
            <label htmlFor="ycloud-key" style={rotulo}>API Key da YCloud {conexao?.temChave ? '(preencha só para trocar)' : ''}</label>
            <input id="ycloud-key" className="form-control" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={conexao?.temChave ? '••••••••' : 'Cole a chave (painel YCloud › Developers)'} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="ycloud-nome" style={rotulo}>Nome da conta</label>
            <input id="ycloud-nome" className="form-control" value={nomeConta} onChange={(e) => setNomeConta(e.target.value)} placeholder="BRS Promotora" />
          </div>
        </div>
        <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {apiKey.trim() ? (
            <button className="btn btn-primary btn-sm" onClick={salvarETestar} disabled={!!ocupado} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {ocupado === 'salvar' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Salvar e testar
            </button>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={testar} disabled={!!ocupado || !conexao?.temChave} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {ocupado === 'testar' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conexão
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={sincronizar} disabled={!!ocupado || !conexao?.temChave} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {ocupado === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar agora
          </button>
          <Link href="/central-conversas/whatsapp-oficial" className="btn btn-outline btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <HeartPulse size={14} /> Painel de saúde
          </Link>
        </div>
      </div>

      {conexao?.temChave && (
        <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Números da conta</h2>
            {saldo && <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Saldo da carteira: <b>{formatarMoeda(saldo.saldo, saldo.moeda)}</b></span>}
          </div>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem', margin: '0 0 0.8rem' }}>
            Ativar cria a instância no BRS Messenger (recebe, responde e aparece nos departamentos) e configura o webhook na YCloud
            automaticamente. Desativar preserva o histórico. Limite = conversas que a empresa pode iniciar em 24 h, compartilhado
            por todos os números do portfólio na Meta.
          </p>
          {numeros.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>{ocupado === 'testar' ? 'Consultando a YCloud…' : 'Nenhum número habilitado nesta conta da YCloud.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '0.78rem' }}>
                <thead>
                  <tr><th>Número</th><th>Nome verificado</th><th>Qualidade</th><th>Limite (24 h)</th><th>Status</th><th>Ação</th></tr>
                </thead>
                <tbody>
                  {numeros.map((n) => {
                    const q = rotuloQualidade(n.qualidade)
                    const linhaOcupada = ocupado === `num:${n.numero}`
                    return (
                      <tr key={n.numero}>
                        <td style={{ whiteSpace: 'nowrap' }}><code>{n.exibicao}</code></td>
                        <td>{n.nomeVerificado || '—'}</td>
                        <td><span style={{ color: q.cor, fontWeight: 700 }}>● {q.rotulo}</span></td>
                        <td>{rotuloLimite(n.limitePortfolio)}</td>
                        <td>{n.status || '—'}</td>
                        <td style={{ minWidth: 250 }}>
                          {n.instanciaId ? (
                            confirmarDesativar === n.numero ? (
                              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <button className="btn btn-sm" style={{ background: 'var(--brs-danger)', color: '#fff' }} onClick={() => desativar(n)} disabled={!!ocupado}>
                                  {linhaOcupada ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar'}
                                </button>
                                <button className="btn btn-outline btn-sm" onClick={() => setConfirmarDesativar('')} disabled={!!ocupado}>Cancelar</button>
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                                <b style={{ color: 'var(--brs-success)' }}>Ativo</b>
                                <button className="btn btn-outline btn-sm" onClick={() => setConfirmarDesativar(n.numero)} disabled={!!ocupado}>Desativar</button>
                              </span>
                            )
                          ) : (
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input
                                className="form-control"
                                aria-label={`Nome da instância para ${n.exibicao}`}
                                style={{ width: 130, padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                                placeholder={n.nomeVerificado || 'Nome (ex.: Suporte)'}
                                value={nomes[n.numero] || ''}
                                onChange={(e) => setNomes((v) => ({ ...v, [n.numero]: e.target.value }))}
                              />
                              <button className="btn btn-primary btn-sm" onClick={() => ativar(n)} disabled={!!ocupado}>
                                {linhaOcupada ? <Loader2 size={13} className="animate-spin" /> : 'Ativar'}
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
