'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Settings } from 'lucide-react'
import { getConfig, salvarConfig } from '@/lib/promocoes/actions'
import { Aviso, Titulo, reaisParaCentavos, useCarga, type Feedback } from '../../_components/ui'
import { statusInstanciaPromocao, type InstanciaPromocaoView } from '@/lib/promocoes/instancia-actions'
import InstanciaCard from './InstanciaCard'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Campo = { k: string; label: string; tipo: 'text' | 'dt' | 'date' | 'reais' | 'int' | 'bool' | 'tags' | 'json' | 'select'; opcoes?: Array<[string, string]>; ajuda?: string }

const SECOES: Array<{ titulo: string; campos: Campo[] }> = [
  {
    titulo: 'Campanha',
    campos: [
      { k: 'nome', label: 'Nome', tipo: 'text' },
      { k: 'status', label: 'Status', tipo: 'select', opcoes: [['rascunho', 'Rascunho'], ['ativa', 'Ativa'], ['encerrada_cadastro', 'Cadastro encerrado'], ['encerrada', 'Encerrada']], ajuda: 'O site só aceita cadastro com a campanha ativa.' },
      { k: 'convenio_id', label: 'Convênio', tipo: 'select' },
      { k: 'cidade', label: 'Cidade', tipo: 'text' },
      { k: 'uf', label: 'UF', tipo: 'text' },
      { k: 'inicio_em', label: 'Início', tipo: 'dt' },
      { k: 'fim_em', label: 'Fim', tipo: 'dt' },
      { k: 'prazo_geracao_ate', label: 'Prazo para gerar números', tipo: 'dt' },
      { k: 'data_sorteio', label: 'Data do sorteio', tipo: 'date' },
    ],
  },
  {
    titulo: 'Regras',
    campos: [
      { k: 'minimo_centavos', label: 'Mínimo por CPF (R$)', tipo: 'reais' },
      { k: 'passo_numeros_centavos', label: 'Valor por passo de números (R$)', tipo: 'reais' },
      { k: 'numeros_por_passo', label: 'Números por passo', tipo: 'int' },
      { k: 'pix_indicador_centavos', label: 'Pix ao indicador (R$)', tipo: 'reais' },
      { k: 'faixas_cartao', label: 'Faixas de cartão (JSON: ate em centavos, pct)', tipo: 'json' },
      { k: 'regra_data_indicacao', label: 'Regra de data da indicação', tipo: 'select', opcoes: [['digitacao_apos_inscricao', 'Digitação a partir da inscrição'], ['pagamento_apos_inscricao', 'Pagamento a partir da inscrição'], ['sem_restricao', 'Sem restrição']] },
      { k: 'prefixo_codigo', label: 'Prefixo do código de inscrição', tipo: 'text' },
      { k: 'prefixo_indicacao', label: 'Prefixo do número de indicação', tipo: 'text' },
    ],
  },
  {
    titulo: 'Comunicação e WeSales',
    campos: [
      { k: 'otp_obrigatorio', label: 'Código por WhatsApp obrigatório (OTP)', tipo: 'bool', ajuda: 'Desligado ou com a instância fora do ar, o cadastro segue marcado como não verificado.' },
      { k: 'telefone_contato', label: 'WhatsApp de contato NuAzul (DDD + número; o 55 é adicionado automaticamente)', tipo: 'text' },
      { k: 'site_base_url', label: 'URL base do site', tipo: 'text' },
      { k: 'regulamento_url', label: 'URL do regulamento', tipo: 'text' },
      { k: 'regulamento_versao', label: 'Versão do regulamento', tipo: 'text' },
      { k: 'wesales_funil_nome', label: 'Funil WeSales (nome)', tipo: 'text', ajuda: 'Vazio = só contato, tags e campos, sem oportunidade.' },
      { k: 'wesales_etapa_nome', label: 'Etapa WeSales (nome)', tipo: 'text' },
      { k: 'wesales_tags', label: 'Tags WeSales (vírgula)', tipo: 'tags' },
    ],
  },
  {
    titulo: 'Pagador e rastreamento',
    campos: [
      { k: 'pagador_cnpj', label: 'CNPJ do pagador do Pix', tipo: 'text' },
      { k: 'pagador_nome', label: 'Nome do pagador', tipo: 'text' },
      { k: 'pixel_meta_id', label: 'Pixel Meta', tipo: 'text' },
      { k: 'ga4_id', label: 'GA4', tipo: 'text' },
      { k: 'gads_id', label: 'Google Ads', tipo: 'text' },
    ],
  },
]

const dtLocal = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T').slice(0, 16) : '')
const reaisTxt = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

function paraForm(c: any): Record<string, any> {
  const f: Record<string, any> = {}
  for (const s of SECOES) for (const k of s.campos) {
    const v = c[k.k]
    f[k.k] = k.tipo === 'dt' ? dtLocal(v) : k.tipo === 'reais' ? reaisTxt(Number(v)) : k.tipo === 'tags' ? (v || []).join(', ') : k.tipo === 'json' ? JSON.stringify(v) : k.tipo === 'bool' ? !!v : (v ?? '')
  }
  return f
}

export default function ConfigPage() {
  const { slug } = useParams<{ slug: string }>()
  const loader = useCallback(() => getConfig(slug), [slug])
  const { data, erro, carregando, recarregar } = useCarga(loader)
  const [f, setF] = useState<Record<string, any> | null>(null)
  const [fb, setFb] = useState<Feedback>(null)
  const [saving, setSaving] = useState(false)
  const [inst, setInst] = useState<{ v: InstanciaPromocaoView | null } | null>(null)

  useEffect(() => {
    if (data) void Promise.resolve().then(() => setF(paraForm(data.campanha)))
  }, [data])

  useEffect(() => {
    void statusInstanciaPromocao(slug).then((r) => setInst({ v: r.ok ? r.instancia : null }))
  }, [slug])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!f) return
    const patch: Record<string, any> = {}
    try {
      for (const s of SECOES) for (const k of s.campos) {
        const v = f[k.k]
        patch[k.k] =
          k.tipo === 'dt' ? (v ? `${v}:00-03:00` : null)
          : k.tipo === 'reais' ? reaisParaCentavos(String(v))
          : k.tipo === 'int' ? Number(v)
          : k.tipo === 'tags' ? String(v).split(',').map((t) => t.trim()).filter(Boolean)
          : k.tipo === 'json' ? JSON.parse(v)
          : k.tipo === 'bool' ? !!v
          : v === '' ? null : v
        if (k.tipo === 'reais' && Number.isNaN(patch[k.k])) throw new Error(`Valor inválido em "${k.label}".`)
      }
    } catch (err) {
      return setFb({ type: 'error', text: err instanceof Error ? err.message : 'Dados inválidos.' })
    }
    setSaving(true)
    const r = await salvarConfig(slug, patch)
    setSaving(false)
    setFb(r.ok ? { type: 'success', text: 'Configuração salva.' } : { type: 'error', text: r.error })
    if (r.ok) recarregar()
  }

  return (
    <div className="page-content">
      <Titulo icon={<Settings size={18} />} titulo="Configuração" sub="Parâmetros da campanha, WeSales, pagador e instância de WhatsApp." />
      <Aviso f={fb || (erro ? { type: 'error', text: erro } : null)} />
      {carregando && <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />}
      {f && data && (
        <form onSubmit={salvar}>
          {SECOES.map((s) => (
            <div key={s.titulo} className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>{s.titulo}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                {s.campos.map((k) => (
                  <div key={k.k} className="form-group" style={k.tipo === 'json' ? { gridColumn: '1 / -1' } : undefined}>
                    <label className="form-label">{k.label}</label>
                    {k.tipo === 'bool' ? (
                      <div>
                        <input type="checkbox" checked={!!f[k.k]} onChange={(e) => setF({ ...f, [k.k]: e.target.checked })} />
                      </div>
                    ) : k.tipo === 'select' ? (
                      <select className="form-control" value={f[k.k] ?? ''} onChange={(e) => setF({ ...f, [k.k]: e.target.value })}>
                        {k.k === 'convenio_id' ? (
                          <>
                            <option value="">— nenhum —</option>
                            {data.convenios.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nome}
                              </option>
                            ))}
                          </>
                        ) : (
                          k.opcoes!.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))
                        )}
                      </select>
                    ) : (
                      <input
                        className="form-control"
                        type={k.tipo === 'dt' ? 'datetime-local' : k.tipo === 'date' ? 'date' : 'text'}
                        value={f[k.k] ?? ''}
                        onChange={(e) => setF({ ...f, [k.k]: e.target.value })}
                      />
                    )}
                    {k.ajuda && <small style={{ color: 'var(--brs-gray-500)' }}>{k.ajuda}</small>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : null} Salvar configuração
          </button>
        </form>
      )}
      <div style={{ marginTop: '1.5rem' }}>
        {inst && data && <InstanciaCard slug={slug} inicial={inst.v} podeEditar={data.podeEditar} />}
      </div>
    </div>
  )
}
