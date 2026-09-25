'use client'

/**
 * Item "Certificações CRCP — <pessoa>" da Análise (fatia 3, 25/09/2026).
 *
 * O operador: abre o CRCP, copia o CPF, anexa o print do resultado (evidência
 * obrigatória para aprovar), lança cada certificação com validade e marca como
 * conferida. Os lançamentos são da PESSOA (CPF) e valem em outros processos.
 * A exigência (todos os obrigatórios vigentes na mesma pessoa) é conferida ao
 * concluir a Análise — aqui só se mostra a situação por tipo.
 */
import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { formatCpfOrCnpjDisplay } from '@/lib/agente-corban'
import { avaliarObrigatorios, diasParaVencer } from '@/lib/certificacoes'
import type { CorbanOnboardingItem } from '@/lib/agente-corban-onboarding'
import EvidenciasBloco, { type EvidenciaComUrl } from './EvidenciasBloco'
import type { CertificacoesDoProcesso, SalvarLancamentoInput } from '../actions'

export const CRCP_URL = 'https://crcp.org.br/resultadoConsulta'

const rotulo: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.2rem' }

function fmtData(iso: string | null | undefined) {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : String(iso)
}

export default function CertificacoesCard({
  item,
  evidencias,
  certificacoes,
  processoId,
  agenteParceiroId,
  busy,
  onEvidenciasChanged,
  onErro,
  onSalvarLancamento,
  onRemoverLancamento,
}: {
  item: CorbanOnboardingItem
  evidencias: EvidenciaComUrl[]
  certificacoes: CertificacoesDoProcesso
  processoId: string
  agenteParceiroId: string
  busy: boolean
  onEvidenciasChanged: () => Promise<void>
  onErro: (texto: string) => void
  onSalvarLancamento: (input: SalvarLancamentoInput) => Promise<void>
  onRemoverLancamento: (id: string) => Promise<void>
}) {
  const cpf = String(item.valor?.cpf || '')
  const nome = String(item.valor?.nome || '')
  const resposta = item.valor?.resposta_parceiro as Record<string, any> | undefined
  const lancamentos = certificacoes.lancamentos.filter((l) => l.cpf === cpf)
  const avaliacao = useMemo(() => avaliarObrigatorios(lancamentos, certificacoes.vinculos, certificacoes.tipos), [lancamentos, certificacoes])

  const [copiado, setCopiado] = useState(false)
  const [abrirForm, setAbrirForm] = useState(false)
  const [form, setForm] = useState({ certificacao_id: '', numero: '', data_exame: '', data_validade: '', verificado: true })
  const [salvando, setSalvando] = useState(false)

  const catalogoAtivo = certificacoes.catalogo.filter((c) => c.is_active)
  const porCertificadora = useMemo(() => {
    const m = new Map<string, typeof catalogoAtivo>()
    for (const c of catalogoAtivo) m.set(c.certificadora_nome, [...(m.get(c.certificadora_nome) || []), c])
    return [...m.entries()]
  }, [catalogoAtivo])

  async function salvar() {
    if (!form.certificacao_id || !form.data_validade) return
    setSalvando(true)
    try {
      await onSalvarLancamento({
        cpf,
        nome,
        certificacao_id: form.certificacao_id,
        numero: form.numero,
        data_exame: form.data_exame || null,
        data_validade: form.data_validade,
        verificado: form.verificado,
        processo_id: processoId,
        agente_parceiro_id: agenteParceiroId,
      })
      setForm({ certificacao_id: '', numero: '', data_exame: '', data_validade: '', verificado: true })
      setAbrirForm(false)
    } finally {
      setSalvando(false)
    }
  }

  function usarResposta() {
    if (!resposta) return
    const cert = catalogoAtivo.find((c) => c.nome === resposta.certificacao || c.id === resposta.certificacao_id)
    setForm({
      certificacao_id: cert?.id || '',
      numero: String(resposta.numero || ''),
      data_exame: String(resposta.data_exame || '').slice(0, 10),
      data_validade: String(resposta.data_validade || '').slice(0, 10),
      verificado: true,
    })
    setAbrirForm(true)
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
        <span style={{ fontWeight: 600 }}>{nome || 'Pessoa'}</span>
        <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-700)' }}>{formatCpfOrCnpjDisplay(cpf)}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Copiar CPF (só dígitos) para colar no CRCP"
          onClick={() => {
            navigator.clipboard.writeText(cpf)
            setCopiado(true)
            window.setTimeout(() => setCopiado(false), 1200)
          }}
        >
          {copiado ? <Check size={13} style={{ color: 'var(--brs-success)' }} /> : <Copy size={13} />} Copiar CPF
        </button>
        <a className="btn btn-outline btn-sm" href={CRCP_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Abrir CRCP
        </a>
      </div>

      <EvidenciasBloco tipo="crcp" itemId={item.id} bloqueado={item.status === 'aprovado'} evidencias={evidencias} onChanged={onEvidenciasChanged} onErro={onErro} />

      {/* Situação por tipo obrigatório (só lançamentos conferidos contam) */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brs-gray-600' }}>Tipos obrigatórios:</span>
        {avaliacao.obrigatorios.length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>nenhum marcado no catálogo</span>}
        {avaliacao.vigentes.map((t) => (
          <span key={t.id} className="badge badge-success" title={`Vigente até ${fmtData(t.validade)}`}>
            {t.nome} · até {fmtData(t.validade)}
          </span>
        ))}
        {avaliacao.vencidos.map((t) => (
          <span key={t.id} className="badge badge-danger" title={`Venceu em ${fmtData(t.validade)}`}>
            {t.nome} · vencida {fmtData(t.validade)}
          </span>
        ))}
        {avaliacao.faltantes.map((t) => (
          <span key={t.id} className="badge badge-gray">
            {t.nome} · sem lançamento
          </span>
        ))}
        {avaliacao.obrigatorios.length > 0 && (
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: avaliacao.cumpre ? '#15803d' : '#b45309' }}>
            {avaliacao.cumpre ? 'Esta pessoa cumpre os obrigatórios' : 'Esta pessoa NÃO cumpre os obrigatórios'}
          </span>
        )}
      </div>

      {resposta && (
        <div style={{ fontSize: '0.8rem', background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
          <div style={{ fontWeight: 700, color: '#854d0e', marginBottom: '0.2rem' }}>
            Resposta do parceiro{item.valor?.respondido_em ? ` em ${new Date(item.valor.respondido_em).toLocaleString('pt-BR')}` : ''}
          </div>
          {resposta.possui === false ? (
            <div>Declarou NÃO possuir certificação. Justificativa: {resposta.justificativa || '—'}</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.15rem' }}>
              <div>
                {resposta.certificadora || '—'} · {resposta.certificacao || '—'} · nº {resposta.numero || '—'} · exame {fmtData(resposta.data_exame)} · validade{' '}
                {fmtData(resposta.data_validade)}
              </div>
              {Array.isArray(resposta.arquivos) && resposta.arquivos.length > 0 && (
                <div>
                  Arquivos:{' '}
                  {resposta.arquivos.map((a: any, i: number) => (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                      {a.fileName || `arquivo ${i + 1}`}
                    </a>
                  ))}
                </div>
              )}
              <div>
                <button type="button" className="btn btn-outline btn-sm" onClick={usarResposta}>
                  <Plus size={13} /> Usar na lançada (conferir no CRCP antes)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lançamentos da pessoa */}
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        {lancamentos.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-400)' }}>Nenhuma certificação lançada para este CPF.</div>}
        {lancamentos.map((l) => {
          const dias = diasParaVencer(l.data_validade)
          const corValidade = dias < 0 ? '#b91c1c' : dias <= 60 ? '#b45309' : 'var(--brs-gray-700)'
          return (
            <div key={l.id} style={{ border: '1px dashed var(--brs-gray-200)', borderRadius: 8, padding: '0.45rem 0.6rem', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{l.certificacao_nome}</span>
              <span style={{ color: 'var(--brs-gray-400)' }}>{l.certificadora_nome}</span>
              {l.numero && <span style={{ fontFamily: 'monospace' }}>nº {l.numero}</span>}
              <span style={{ color: 'var(--brs-gray-400)' }}>exame {fmtData(l.data_exame)}</span>
              <span style={{ color: corValidade, fontWeight: 600 }}>
                validade {fmtData(l.data_validade)}
                {dias < 0 ? ' (vencida)' : dias <= 60 ? ` (vence em ${dias} d)` : ''}
              </span>
              {l.verificado_em ? (
                <span className="badge badge-success" title={`Conferido no CRCP em ${new Date(l.verificado_em).toLocaleString('pt-BR')}${l.verificado_por_nome ? ` por ${l.verificado_por_nome}` : ''}`}>
                  conferida
                </span>
              ) : (
                <span className="badge badge-warning" title="Informada pelo parceiro: confira no CRCP e marque">
                  {l.origem === 'parceiro' ? 'informada pelo parceiro' : 'não conferida'}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {!l.verificado_em && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() =>
                    onSalvarLancamento({
                      id: l.id,
                      cpf: l.cpf,
                      nome: l.nome,
                      certificacao_id: l.certificacao_id,
                      numero: l.numero || '',
                      data_exame: l.data_exame,
                      data_validade: l.data_validade,
                      verificado: true,
                      processo_id: processoId,
                      agente_parceiro_id: agenteParceiroId,
                    })
                  }
                >
                  <Check size={13} /> Marcar conferida
                </button>
              )}
              {item.status !== 'aprovado' && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title="Remover lançamento" onClick={() => window.confirm('Remover este lançamento?') && onRemoverLancamento(l.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {abrirForm ? (
        <div className="card" style={{ padding: '0.75rem 0.9rem', display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 320, flex: 1 }}>
              <label style={rotulo}>Certificação *</label>
              <select className="form-control" value={form.certificacao_id} onChange={(e) => setForm((f) => ({ ...f, certificacao_id: e.target.value }))}>
                <option value="">Selecione</option>
                {porCertificadora.map(([certificadora, lista]) => (
                  <optgroup key={certificadora} label={certificadora}>
                    {lista.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label style={rotulo}>Número</label>
              <input className="form-control" style={{ width: 180 }} value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} />
            </div>
            <div>
              <label style={rotulo}>Data do exame</label>
              <input className="form-control" type="date" value={form.data_exame} onChange={(e) => setForm((f) => ({ ...f, data_exame: e.target.value }))} />
            </div>
            <div>
              <label style={rotulo}>Validade *</label>
              <input className="form-control" type="date" value={form.data_validade} onChange={(e) => setForm((f) => ({ ...f, data_validade: e.target.value }))} />
            </div>
          </div>
          {form.certificacao_id && (
            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
              Cobre:{' '}
              {certificacoes.vinculos
                .filter((v) => v.certificacao_id === form.certificacao_id)
                .map((v) => certificacoes.tipos.find((t) => t.id === v.tipo_id)?.nome)
                .filter(Boolean)
                .join(', ') || 'nenhum tipo vinculado'}
            </div>
          )}
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={form.verificado} onChange={(e) => setForm((f) => ({ ...f, verificado: e.target.checked }))} />
            Conferi no CRCP (só lançamento conferido conta para a exigência)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={salvando || busy || !form.certificacao_id || !form.data_validade} onClick={salvar}>
              {salvando ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Salvar lançamento
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={salvando} onClick={() => setAbrirForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        item.status !== 'aprovado' && (
          <div>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAbrirForm(true)}>
              <Plus size={14} /> Lançar certificação
            </button>
          </div>
        )
      )}
    </div>
  )
}
