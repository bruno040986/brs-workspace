'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, CirclePlus, Landmark, Loader2, Save, Trash2, X } from 'lucide-react'
import {
  salvarConvenioBcSecao,
  type ConvenioBc,
  type ConvenioBcInstituicao,
  type ConvenioBcInstituicaoForma,
  type FormaContratoAtiva,
  type InstituicaoAtiva,
} from '../../bc-actions'
import { salvarOrgao, type OrgaoEmpregador, type PublicoAtendido } from '../../cadastros-actions'

function novaLinha(financialInstitutionId: string): ConvenioBcInstituicao {
  return {
    financial_institution_id: financialInstitutionId,
    canais_quitacao: [],
    modo_orgaos: 'exceto',
    observacao: '',
    is_active: true,
    publicos: [],
    orgaos: [],
    formas: [],
  }
}

function toggleArrayValue(arr: string[], value: string) {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

function CanaisQuitacaoInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [texto, setTexto] = useState('')

  function adicionar() {
    const v = texto.trim()
    if (!v) return
    if (!value.includes(v)) onChange([...value, v])
    setTexto('')
  }

  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          {value.map((v) => (
            <span key={v} className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              {v}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'inline-flex', padding: 0 }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          className="form-control"
          placeholder="Ex.: PIX, Boleto, Débito em folha..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              adicionar()
            }
          }}
        />
        <button type="button" className="btn btn-outline btn-sm" onClick={adicionar}>
          Adicionar
        </button>
      </div>
    </div>
  )
}

export default function InstituicoesTab({
  convenioId,
  bc,
  formasAtivas,
  instituicoesAtivas,
  publicosAtivos,
  orgaosAtivos,
  onSaved,
  onOrgaoCriado,
}: {
  convenioId: string
  bc: ConvenioBc
  formasAtivas: FormaContratoAtiva[]
  instituicoesAtivas: InstituicaoAtiva[]
  publicosAtivos: PublicoAtendido[]
  orgaosAtivos: OrgaoEmpregador[]
  onSaved: () => void
  onOrgaoCriado: () => void
}) {
  const [linhas, setLinhas] = useState<ConvenioBcInstituicao[]>(bc.instituicoes)
  const [adicionarId, setAdicionarId] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [novoOrgaoIndex, setNovoOrgaoIndex] = useState<number | null>(null)
  const [novoOrgaoNome, setNovoOrgaoNome] = useState('')
  const [salvandoOrgao, setSalvandoOrgao] = useState(false)

  useEffect(() => {
    setLinhas(bc.instituicoes)
  }, [bc])

  const formasPermitidasInfo = useMemo(
    () => bc.formas.map((f) => ({ ...f, nome: formasAtivas.find((x) => x.id === f.forma_contrato_id)?.nome || '(forma inativa)' })),
    [bc.formas, formasAtivas],
  )

  const publicosElegiveis = useMemo(
    () => bc.publicos.map((p) => publicosAtivos.find((x) => x.id === p.publico_id)).filter(Boolean) as PublicoAtendido[],
    [bc.publicos, publicosAtivos],
  )

  const instituicoesDisponiveis = useMemo(
    () => instituicoesAtivas.filter((i) => !linhas.some((l) => l.financial_institution_id === i.id)),
    [instituicoesAtivas, linhas],
  )

  function nomeIf(id: string) {
    return instituicoesAtivas.find((i) => i.id === id)?.name || '(instituição inativa)'
  }

  function adicionarInstituicao() {
    if (!adicionarId) return
    setLinhas((prev) => [...prev, novaLinha(adicionarId)])
    setAdicionarId('')
  }

  function removerInstituicao(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx))
  }

  function atualizarLinha(idx: number, patch: Partial<ConvenioBcInstituicao>) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  function togglePublico(idx: number, publicoId: string) {
    atualizarLinha(idx, { publicos: toggleArrayValue(linhas[idx].publicos, publicoId) })
  }

  function toggleOrgao(idx: number, orgaoId: string) {
    atualizarLinha(idx, { orgaos: toggleArrayValue(linhas[idx].orgaos, orgaoId) })
  }

  function toggleForma(idx: number, formaId: string) {
    const linha = linhas[idx]
    const existe = linha.formas.some((f) => f.forma_contrato_id === formaId)
    if (existe) {
      atualizarLinha(idx, { formas: linha.formas.filter((f) => f.forma_contrato_id !== formaId) })
    } else {
      const novaForma: ConvenioBcInstituicaoForma = {
        forma_contrato_id: formaId,
        margem_considerada: null,
        prazo_minimo: null,
        prazo_maximo: null,
        publicos_restritos: null,
        observacao: '',
      }
      atualizarLinha(idx, { formas: [...linha.formas, novaForma] })
    }
  }

  function atualizarForma(idx: number, formaId: string, patch: Partial<ConvenioBcInstituicaoForma>) {
    atualizarLinha(idx, {
      formas: linhas[idx].formas.map((f) => (f.forma_contrato_id === formaId ? { ...f, ...patch } : f)),
    })
  }

  function toggleRestringirPublico(idx: number, formaId: string) {
    const forma = linhas[idx].formas.find((f) => f.forma_contrato_id === formaId)
    atualizarForma(idx, formaId, { publicos_restritos: forma?.publicos_restritos ? null : [] })
  }

  function togglePublicoRestrito(idx: number, formaId: string, publicoId: string) {
    const forma = linhas[idx].formas.find((f) => f.forma_contrato_id === formaId)
    const atual = forma?.publicos_restritos || []
    atualizarForma(idx, formaId, { publicos_restritos: toggleArrayValue(atual, publicoId) })
  }

  async function criarOrgaoInline(idx: number) {
    const nome = novoOrgaoNome.trim()
    if (!nome) return
    setSalvandoOrgao(true)
    try {
      const res = await salvarOrgao({ convenio_id: convenioId, nome })
      if (res.success && res.id) {
        toggleOrgao(idx, res.id)
        setNovoOrgaoNome('')
        setNovoOrgaoIndex(null)
        onOrgaoCriado()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao criar o órgão.' })
      }
    } finally {
      setSalvandoOrgao(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarConvenioBcSecao(convenioId, 'instituicoes', linhas)
      if (res.success) {
        setMessage({ type: 'success', text: 'Instituições salvas.' })
        onSaved()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem' }}>Matriz Instituição × Forma</div>
        {linhas.length === 0 || formasPermitidasInfo.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
            Vincule instituições e defina as formas permitidas (aba Formas & Margens) para ver a matriz.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instituição</th>
                  {formasPermitidasInfo.map((f) => (
                    <th key={f.forma_contrato_id}>{f.nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.financial_institution_id}>
                    <td style={{ fontWeight: 600 }}>{nomeIf(l.financial_institution_id)}</td>
                    {formasPermitidasInfo.map((f) => {
                      const op = l.formas.find((x) => x.forma_contrato_id === f.forma_contrato_id)
                      return (
                        <td key={f.forma_contrato_id} style={{ textAlign: 'center', fontSize: '0.82rem' }}>
                          {op ? `${op.margem_considerada ?? '—'}% / ${op.prazo_minimo ?? '—'}–${op.prazo_maximo ?? '—'}m` : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="form-control" style={{ maxWidth: 320 }} value={adicionarId} onChange={(e) => setAdicionarId(e.target.value)}>
          <option value="">Selecione uma instituição...</option>
          {instituicoesDisponiveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-outline" onClick={adicionarInstituicao} disabled={!adicionarId}>
          <CirclePlus size={16} />
          Adicionar Instituição
        </button>
      </div>

      {linhas.map((linha, idx) => {
        const publicosBase = linha.publicos.length > 0 ? publicosElegiveis.filter((p) => linha.publicos.includes(p.id)) : publicosElegiveis
        return (
          <div key={linha.financial_institution_id} className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800 }}>
                <Landmark size={16} />
                {nomeIf(linha.financial_institution_id)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={linha.is_active} onChange={(e) => atualizarLinha(idx, { is_active: e.target.checked })} />
                  Ativo
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removerInstituicao(idx)} title="Remover vínculo">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Canais de Quitação</label>
              <CanaisQuitacaoInput value={linha.canais_quitacao} onChange={(next) => atualizarLinha(idx, { canais_quitacao: next })} />
            </div>

            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="form-label">Público Atendido por Esta Instituição</label>
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginBottom: '0.4rem' }}>
                Deixe tudo desmarcado para "atende todos os públicos do convênio".
              </div>
              {publicosElegiveis.length === 0 ? (
                <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>Nenhum público elegível definido na aba Público.</div>
              ) : (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {publicosElegiveis.map((p) => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                      <input type="checkbox" checked={linha.publicos.includes(p.id)} onChange={() => togglePublico(idx, p.id)} />
                      {p.nome}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="form-label">Restrição de Órgãos</label>
              <div style={{ marginBottom: '0.5rem' }}>
                <select
                  className="form-control"
                  style={{ maxWidth: 320 }}
                  value={linha.modo_orgaos}
                  onChange={(e) => atualizarLinha(idx, { modo_orgaos: e.target.value as 'exceto' | 'somente' })}
                >
                  <option value="exceto">Atende todos, EXCETO os marcados</option>
                  <option value="somente">Atende SOMENTE os marcados</option>
                </select>
              </div>
              {orgaosAtivos.length === 0 ? (
                <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Nenhum órgão cadastrado para este convênio ainda.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  {orgaosAtivos.map((o) => (
                    <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                      <input type="checkbox" checked={linha.orgaos.includes(o.id)} onChange={() => toggleOrgao(idx, o.id)} />
                      {o.nome}
                    </label>
                  ))}
                </div>
              )}
              {novoOrgaoIndex === idx ? (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input className="form-control" placeholder="Nome do órgão" value={novoOrgaoNome} onChange={(e) => setNovoOrgaoNome(e.target.value)} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => criarOrgaoInline(idx)} disabled={salvandoOrgao}>
                    {salvandoOrgao ? <Loader2 size={14} className="spinner" /> : 'Criar'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNovoOrgaoIndex(null); setNovoOrgaoNome('') }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNovoOrgaoIndex(idx)}>
                  <CirclePlus size={14} />
                  Cadastrar novo órgão
                </button>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="form-label">Formas Operadas</label>
              {formasPermitidasInfo.length === 0 ? (
                <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>Defina as formas permitidas na aba Formas & Margens primeiro.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  {formasPermitidasInfo.map((fInfo) => {
                    const forma = linha.formas.find((f) => f.forma_contrato_id === fInfo.forma_contrato_id)
                    const operada = !!forma
                    return (
                      <div key={fInfo.forma_contrato_id} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                          <input type="checkbox" checked={operada} onChange={() => toggleForma(idx, fInfo.forma_contrato_id)} />
                          {fInfo.nome} {fInfo.percentual_margem != null ? `(teto do convênio: ${fInfo.percentual_margem}%)` : ''}
                        </label>
                        {operada && forma && (
                          <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem' }}>
                            <div className="form-grid form-grid-3">
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Margem Considerada (%)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  className="form-control"
                                  value={forma.margem_considerada ?? ''}
                                  onChange={(e) =>
                                    atualizarForma(idx, fInfo.forma_contrato_id, { margem_considerada: e.target.value === '' ? null : Number(e.target.value) })
                                  }
                                />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Prazo Mínimo (meses)</label>
                                <input
                                  type="number"
                                  min={1}
                                  className="form-control"
                                  value={forma.prazo_minimo ?? ''}
                                  onChange={(e) => atualizarForma(idx, fInfo.forma_contrato_id, { prazo_minimo: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Prazo Máximo (meses)</label>
                                <input
                                  type="number"
                                  min={1}
                                  className="form-control"
                                  value={forma.prazo_maximo ?? ''}
                                  onChange={(e) => atualizarForma(idx, fInfo.forma_contrato_id, { prazo_maximo: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                              </div>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                              <input type="checkbox" checked={!!forma.publicos_restritos} onChange={() => toggleRestringirPublico(idx, fInfo.forma_contrato_id)} />
                              Restringir público para esta forma
                            </label>
                            {forma.publicos_restritos && (
                              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                {publicosBase.length === 0 ? (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>Nenhum público disponível para restringir.</span>
                                ) : (
                                  publicosBase.map((p) => (
                                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                                      <input
                                        type="checkbox"
                                        checked={(forma.publicos_restritos || []).includes(p.id)}
                                        onChange={() => togglePublicoRestrito(idx, fInfo.forma_contrato_id, p.id)}
                                      />
                                      {p.nome}
                                    </label>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
          Salvar Instituições
        </button>
      </div>
    </div>
  )
}
