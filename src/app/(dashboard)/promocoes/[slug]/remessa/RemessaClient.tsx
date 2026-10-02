'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Download, Loader2, Send, Wallet } from 'lucide-react'
import { gerarRemessa, listarRemessas, marcarEnviadaPagamento, obterRemessa } from '@/lib/promocoes/remessa-actions'

type Remessa = {
  id: string
  data_referencia: string
  status: 'gerada' | 'exportada' | 'enviada_pagamento'
  total_centavos: number
  qtd_itens: number
  gerada_em: string | null
  exportada_em: string | null
  enviada_em: string | null
}
type Item = { id: string; indicado_nome: string; indicado_cpf: string; valor_centavos: number; pix_tipo: string; pix: string; banco: string | null }

const STATUS: Record<Remessa['status'], string> = { gerada: 'Gerada', exportada: 'Exportada', enviada_pagamento: 'Enviada para pagamento' }
const TIPO: Record<string, string> = { cpf: 'CPF', telefone: 'Telefone', email: 'E-mail', aleatoria: 'Aleatória', dados_bancarios: 'Dados Bancários' }
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (d: string) => d.split('-').reverse().join('/')
const hora = (t: string | null) => (t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-')

export default function RemessaClient({ slug }: { slug: string }) {
  const [remessas, setRemessas] = useState<Remessa[]>([])
  const [pendentes, setPendentes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [aberta, setAberta] = useState<Remessa | null>(null)
  const [itens, setItens] = useState<Item[]>([])

  const carregar = useCallback(async () => {
    const r = await listarRemessas(slug)
    if (r.success) {
      setRemessas(r.remessas as Remessa[])
      setPendentes(r.pendentes)
    } else setMsg({ ok: false, text: r.error })
    setLoading(false)
  }, [slug])

  const abrir = useCallback(async (rem: Remessa) => {
    setAberta(rem)
    const r = await obterRemessa(slug, rem.id)
    if (r.success) {
      setItens(r.itens as Item[])
      setAberta(r.remessa as Remessa)
    } else setMsg({ ok: false, text: r.error })
  }, [slug])

  useEffect(() => { void Promise.resolve().then(carregar) }, [carregar])

  async function gerar() {
    setBusy(true); setMsg(null)
    const r = await gerarRemessa(slug)
    if (r.success) setMsg({ ok: true, text: `Remessa gerada com ${r.qtd} item(ns).` })
    else setMsg({ ok: false, text: r.error })
    await carregar()
    setBusy(false)
  }

  async function marcar() {
    if (!aberta) return
    if (!confirm(`Marcar a remessa de ${dia(aberta.data_referencia)} como enviada para pagamento? Isso avisa cada indicador por WhatsApp e não pode ser desfeito.`)) return
    setBusy(true); setMsg(null)
    const r = await marcarEnviadaPagamento(slug, aberta.id)
    if (r.success) setMsg({ ok: true, text: `Marcada como enviada. ${r.avisos} aviso(s) de WhatsApp na fila.` })
    else setMsg({ ok: false, text: r.error })
    await carregar()
    await abrir(aberta)
    setBusy(false)
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={18} /> Remessa de Pagamento (Pix do indicador)
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Gere a remessa do dia com os R$ 50 devidos, exporte o Excel e marque como enviada para pagamento.
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: '1rem', padding: '0.875rem 1rem', borderRadius: 10, display: 'flex', gap: '0.5rem', alignItems: 'center', border: `1px solid ${msg.ok ? '#A7F3D0' : '#FECACA'}`, background: msg.ok ? '#ECFDF5' : '#FEF2F2', color: msg.ok ? '#065F46' : '#991B1B' }}>
          {msg.ok ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{msg.text}</span>
        </div>
      )}

      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><strong>{pendentes}</strong> Pix devido(s) ainda sem remessa</div>
        <button type="button" className="btn btn-primary" onClick={gerar} disabled={busy || pendentes === 0}>
          {busy ? <Loader2 size={16} className="spinner" /> : <Wallet size={16} />} Gerar remessa do dia
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Dia</th><th>Status</th><th>Itens</th><th>Total</th><th>Gerada</th><th>Exportada</th><th>Enviada</th><th /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></td></tr>
              ) : remessas.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma remessa gerada.</td></tr>
              ) : remessas.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{dia(r.data_referencia)}</td>
                  <td>{STATUS[r.status]}</td>
                  <td>{r.qtd_itens}</td>
                  <td>{brl(Number(r.total_centavos))}</td>
                  <td>{hora(r.gerada_em)}</td>
                  <td>{hora(r.exportada_em)}</td>
                  <td>{hora(r.enviada_em)}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-outline btn-sm" onClick={() => abrir(r)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aberta && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700 }}>Remessa de {dia(aberta.data_referencia)} — {STATUS[aberta.status]}</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <a className="btn btn-outline" href={`/api/promocoes/interno/${slug}/remessas/${aberta.id}/excel`} onClick={() => setTimeout(() => { carregar(); abrir(aberta) }, 1500)}>
                <Download size={16} /> Exportar Excel
              </a>
              <button type="button" className="btn btn-primary" onClick={marcar} disabled={busy || aberta.status !== 'exportada'} title={aberta.status === 'gerada' ? 'Exporte o Excel primeiro' : undefined}>
                <Send size={16} /> Marcar como enviada para pagamento
              </button>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>CPF</th><th>Nome</th><th>Valor</th><th>Tipo de chave</th><th>Pix / Dados bancários</th></tr></thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontFamily: 'monospace' }}>{i.indicado_cpf}</td>
                    <td>{i.indicado_nome}</td>
                    <td>{brl(i.valor_centavos)}</td>
                    <td>{TIPO[i.pix_tipo]}</td>
                    <td style={{ fontFamily: 'monospace' }}>{i.banco ? `${i.banco} · ` : ''}{i.pix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.8rem', marginTop: '0.75rem' }}>Pix e dados bancários aparecem mascarados; o Excel leva os dados completos.</div>
        </div>
      )}
    </div>
  )
}
