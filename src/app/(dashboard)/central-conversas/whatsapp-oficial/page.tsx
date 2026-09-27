'use client'

/**
 * Central de Atendimento › Saúde do WhatsApp Oficial (YCloud) — números,
 * qualidade, limite, templates, histórico de mudanças e saldo. Só leitura:
 * tudo vem calculado do servidor (frescor `obsoleto` incluso — a tela não
 * deriva nada). Permissão: conversas-whatsapp-oficial-saude.
 */
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import {
  getHistoricoSaudeYcloud,
  getPainelSaudeYcloud,
  getTemplatesYcloud,
  sincronizarYcloudAgora,
  type InstanciaOficial,
} from '@/lib/ycloud/config-actions'
import type { SaldoCarteira, TemplateYcloud } from '@/lib/ycloud/leitura'
import { formatarDataHora, formatarMoeda, rotuloLimite, rotuloQualidade } from '@/lib/ycloud/formatar'

type Painel = { instancias: InstanciaOficial[]; saldos: SaldoCarteira[]; conexaoStatus: string }
type Historico = Array<{ tipo: string; de: unknown; para: unknown; ocorridoEm: string }>

const CAMPOS: Record<string, string> = {
  'sync.quality_rating': 'Qualidade',
  'sync.messaging_limit': 'Limite do número',
  'sync.bm_messaging_limit': 'Limite do portfólio',
  'sync.status': 'Status',
  'sync.name_status': 'Nome de exibição',
}

const valorDe = (v: unknown) => String((v as { valor?: unknown } | null)?.valor ?? '—')

const ROTULO_STATUS_TPL = new Set(['PAUSED', 'REJECTED', 'DISABLED'])

function Bloco({ titulo, carregar, children }: { titulo: string; carregar: () => Promise<void>; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        aria-expanded={aberto}
        onClick={() => {
          if (!aberto) void carregar()
          setAberto(!aberto)
        }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {titulo}
      </button>
      {aberto && <div style={{ marginTop: '0.6rem' }}>{children}</div>}
    </div>
  )
}

function Detalhe({ inst }: { inst: InstanciaOficial }) {
  const [templates, setTemplates] = useState<TemplateYcloud[] | null>(null)
  const [historico, setHistorico] = useState<Historico | null>(null)
  const [erroT, setErroT] = useState('')
  const [erroH, setErroH] = useState('')

  const carregarTemplates = async () => {
    setErroT('')
    try {
      const t = await getTemplatesYcloud(inst.id, false)
      if (!t.success) throw new Error(t.error)
      setTemplates(t.data || [])
    } catch (e) {
      setErroT(e instanceof Error ? e.message : 'Falha ao carregar templates.')
    }
  }
  const carregarHistorico = async () => {
    setErroH('')
    try {
      const h = await getHistoricoSaudeYcloud(inst.id)
      if (!h.success) throw new Error(h.error)
      setHistorico(h.data || [])
    } catch (e) {
      setErroH(e instanceof Error ? e.message : 'Falha ao carregar histórico.')
    }
  }
  const carregando = (
    <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)', display: 'flex', gap: 6, alignItems: 'center' }}>
      <Loader2 size={14} className="animate-spin" /> Carregando…
    </div>
  )

  return (
    <div>
      <Bloco titulo="Templates" carregar={carregarTemplates}>
        {erroT ? (
          <div role="alert" style={{ color: 'var(--brs-danger)', fontSize: '0.8rem' }}>{erroT}</div>
        ) : !templates ? carregando : templates.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Nenhum template sincronizado.</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 320 }}>
            <table className="table" style={{ fontSize: '0.74rem' }}>
              <thead><tr><th>Nome</th><th>Idioma</th><th>Categoria</th><th>Status</th><th>Qualidade</th><th>Sincronizado em</th></tr></thead>
              <tbody>
                {templates.map((t) => {
                  const q = rotuloQualidade(t.qualidade)
                  const alerta = ROTULO_STATUS_TPL.has(t.status)
                  return (
                    <tr key={`${t.nome}-${t.idioma}`} style={alerta ? { background: 'rgba(220,38,38,0.08)' } : undefined}>
                      <td><code>{t.nome}</code></td>
                      <td>{t.idioma}</td>
                      <td>{t.categoria}</td>
                      <td style={{ fontWeight: 700, color: t.status === 'APPROVED' ? 'var(--brs-success)' : alerta ? 'var(--brs-danger)' : 'var(--brs-gray-600)' }}>{alerta ? `⚠ ${t.status}` : t.status}</td>
                      <td><span style={{ color: q.cor, fontWeight: 700 }}>● {q.rotulo}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatarDataHora(t.sincronizadoEm)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
      <Bloco titulo="Histórico de mudanças" carregar={carregarHistorico}>
        {erroH ? (
          <div role="alert" style={{ color: 'var(--brs-danger)', fontSize: '0.8rem' }}>{erroH}</div>
        ) : !historico ? carregando : historico.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>Nenhuma mudança registrada</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.76rem', maxHeight: 280, overflowY: 'auto' }}>
            {historico.map((h, i) => (
              <li key={i}>
                <b>{CAMPOS[h.tipo] || h.tipo}</b>: {valorDe(h.de)} → {valorDe(h.para)} <span style={{ color: 'var(--brs-gray-400)' }}>({formatarDataHora(h.ocorridoEm)})</span>
              </li>
            ))}
          </ul>
        )}
      </Bloco>
    </div>
  )
}

export default function SaudeWhatsAppOficialPage() {
  const [painel, setPainel] = useState<Painel | null>(null)
  const [semConexao, setSemConexao] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const carregar = useCallback(async () => {
    const r = await getPainelSaudeYcloud()
    if (!r.success || !r.data) throw new Error(r.error || 'Sem permissão.')
    setSemConexao(!r.data.conexao)
    setPainel({ instancias: r.data.instancias, saldos: r.data.saldos, conexaoStatus: r.data.conexao?.status || 'nenhuma' })
  }, [])

  useEffect(() => {
    getPainelSaudeYcloud()
      .then((r) => {
        if (!r.success || !r.data) throw new Error(r.error || 'Sem permissão.')
        setSemConexao(!r.data.conexao)
        setPainel({ instancias: r.data.instancias, saldos: r.data.saldos, conexaoStatus: r.data.conexao?.status || 'nenhuma' })
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [])

  async function sincronizar() {
    setSincronizando(true)
    setErro('')
    setOkMsg('')
    try {
      const r = await sincronizarYcloudAgora()
      if (!r.success || !r.data) throw new Error(r.error)
      if (r.data.erros.length) throw new Error(r.data.erros.join(' · '))
      setOkMsg(`Sincronizado: ${r.data.numeros} número(s), ${r.data.templates} template(s), ${r.data.alertas} alerta(s).`)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao sincronizar (é preciso permissão de edição no card do provedor).')
    } finally {
      setSincronizando(false)
    }
  }

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brs-gray-400)', padding: '2rem' }}>
        <Loader2 size={18} className="animate-spin" /> Carregando…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <Image src="/logotipos/ycloud.png" alt="YCloud" width={500} height={500} style={{ width: 56, height: 56, borderRadius: 10 }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Saúde do WhatsApp Oficial</h1>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/rh/parceiros/config/provedores/whatsapp-oficial" className="btn btn-outline btn-sm">Configurar conta</Link>
          <button className="btn btn-outline btn-sm" onClick={sincronizar} disabled={sincronizando || semConexao} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {sincronizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar agora
          </button>
        </span>
      </div>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.25rem' }}>
        Qualidade, limite e templates dos números oficiais do BRS Messenger. Atualizado automaticamente a cada 15 minutos; dados com
        mais de 24 h aparecem como desatualizados. Você recebe um aviso no sino quando a qualidade cai, o limite muda ou um template é pausado.
      </p>

      {erro && <div role="alert" className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}
      {okMsg && <div role="status" className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-success)', marginBottom: '1rem', color: 'var(--brs-success)', fontWeight: 600 }}>{okMsg}</div>}

      {semConexao && (
        <div className="card" style={{ padding: '1rem', fontSize: '0.85rem' }}>
          Nenhuma conta YCloud conectada. <Link href="/rh/parceiros/config/provedores/whatsapp-oficial" style={{ fontWeight: 700 }}>Cadastre a chave no card WhatsApp Oficial (YCloud)</Link>.
        </div>
      )}

      {painel && painel.conexaoStatus === 'invalida' && (
        <div role="alert" className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', fontWeight: 600, color: 'var(--brs-danger)' }}>
          A YCloud recusou a chave da conta. Gere uma nova no painel da YCloud e atualize em Provedores e APIs.
        </div>
      )}

      {painel && painel.saldos.length > 0 && (
        <div className="card" style={{ padding: '1rem 1.2rem', marginBottom: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0 }}>Carteira YCloud</h2>
          {painel.saldos.map((s) => (
            <span key={s.moeda} style={{ fontSize: '0.9rem' }}>
              <b>{formatarMoeda(s.saldo, s.moeda)}</b>
              <span style={{ fontSize: '0.72rem', color: s.obsoleto ? 'var(--brs-danger)' : 'var(--brs-gray-400)', marginLeft: 8 }}>
                atualizado em {formatarDataHora(s.observadoEm)}
              </span>
              {s.obsoleto && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--brs-danger)', border: '1px solid var(--brs-danger)', borderRadius: 999, padding: '1px 8px', marginLeft: 6 }}>desatualizado</span>}
            </span>
          ))}
        </div>
      )}

      {painel && !semConexao && painel.instancias.length === 0 && (
        <div className="card" style={{ padding: '1rem', fontSize: '0.85rem' }}>
          Nenhum número ativado. <Link href="/rh/parceiros/config/provedores/whatsapp-oficial" style={{ fontWeight: 700 }}>Ative um número no card WhatsApp Oficial (YCloud)</Link>.
        </div>
      )}

      {painel?.instancias.map((i) => {
        const q = rotuloQualidade(i.saude.qualidade)
        return (
          <div key={i.id} className="card" style={{ padding: '1rem 1.2rem', marginBottom: '0.8rem' }}>
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: '1rem' }}>{i.nome}</span>
              <code style={{ fontSize: '0.78rem' }}>{i.numero}</code>
              <span style={{ fontSize: '0.75rem', color: 'var(--brs-gray-600)' }}>Instância: {i.status}</span>
              {i.saude.obsoleto && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--brs-danger)', border: '1px solid var(--brs-danger)', borderRadius: 999, padding: '1px 8px' }}>desatualizado</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.8rem', marginTop: '0.8rem', fontSize: '0.8rem' }}>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>QUALIDADE</div><b style={{ color: q.cor }}>● {q.rotulo}</b></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>LIMITE DO PORTFÓLIO</div><b>{rotuloLimite(i.saude.limitePortfolio)}</b></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>LIMITE DO NÚMERO</div><span style={{ fontSize: '0.74rem' }}>{rotuloLimite(i.saude.limiteNumero)}</span></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>STATUS</div><b>{i.saude.status}</b></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>NOME VERIFICADO</div><b>{i.saude.nomeVerificado || '—'}</b> <span style={{ color: 'var(--brs-gray-400)' }}>({i.saude.nameStatus})</span></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>TEMPLATES APROVADOS</div><b>{i.templatesAprovados}</b></div>
              <div><div style={{ color: 'var(--brs-gray-400)', fontSize: '0.7rem', fontWeight: 700 }}>ÚLTIMA ATUALIZAÇÃO</div><b>{formatarDataHora(i.saude.observadoEm)}</b></div>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', margin: '0.6rem 0 0' }}>
              Limite = conversas que a empresa pode iniciar em 24 h, compartilhado entre os números do portfólio.
            </p>
            <Detalhe inst={i} />
          </div>
        )
      })}
    </div>
  )
}
