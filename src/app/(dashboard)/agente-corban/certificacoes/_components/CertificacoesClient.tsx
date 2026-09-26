'use client'

/**
 * Agente Corban › Certificações — edição do catálogo (fatia 3, roteiro do
 * Fable). Quatro abas: Certificadoras (site + logotipo), Tipos (flag
 * obrigatório), Certificações (cobrem N tipos) e Vencimentos. As regras
 * (vigência por tipo, obrigatórios na mesma pessoa) vivem em
 * src/lib/certificacoes.ts e são aplicadas na Análise de cada cadastro.
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Loader2, Pencil, Plus, UploadCloud, X } from 'lucide-react'
import {
  getCatalogoCertificacoes,
  listarVencimentos,
  salvarCertificacao,
  salvarCertificadora,
  salvarTipoCertificacao,
  uploadLogotipoCertificadora,
  type Certificacao,
  type CertificacaoTipo,
  type Certificadora,
  type VencimentoRow,
} from '../actions'

type Catalogo = { certificadoras: Certificadora[]; tipos: CertificacaoTipo[]; certificacoes: Certificacao[] }
type Aba = 'certificadoras' | 'tipos' | 'certificacoes' | 'vencimentos'
type Mensagem = { type: 'success' | 'error'; text: string }

const DIAS_OPCOES = [30, 60, 90, 180]

function fmtData(iso: string) {
  return String(iso).slice(0, 10).split('-').reverse().join('/')
}

function Toast({ mensagem, onClose }: { mensagem: Mensagem | null; onClose: () => void }) {
  useEffect(() => {
    if (!mensagem) return
    const t = window.setTimeout(onClose, mensagem.type === 'error' ? 12000 : 5000)
    return () => window.clearTimeout(t)
  }, [mensagem, onClose])
  if (!mensagem) return null
  const ok = mensagem.type === 'success'
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1100,
        maxWidth: 440,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        padding: '0.8rem 1rem',
        borderRadius: 10,
        border: `1px solid ${ok ? '#A7F3D0' : '#FECACA'}`,
        background: ok ? '#ECFDF5' : '#FEF2F2',
        color: ok ? '#065F46' : '#991B1B',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-start',
      }}
    >
      {ok ? <CheckCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
      <span style={{ flex: 1, fontSize: '0.85rem', wordBreak: 'break-word' }}>{mensagem.text}</span>
      <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar aviso">
        <X size={14} />
      </button>
    </div>
  )
}

function Modal({
  titulo,
  onClose,
  onSalvar,
  salvando,
  desabilitarSalvar,
  children,
}: {
  titulo: string
  onClose: () => void
  onSalvar: () => void
  salvando: boolean
  desabilitarSalvar?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{titulo}</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: '0.75rem' }}>
          {children}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={onSalvar} disabled={salvando || desabilitarSalvar}>
            {salvando ? <Loader2 size={15} className="spinner" /> : null}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function Situacao({ ativo }: { ativo: boolean }) {
  return <span className={`badge ${ativo ? 'badge-success' : 'badge-gray'}`}>{ativo ? 'Ativa' : 'Inativa'}</span>
}

export default function CertificacoesClient({
  catalogoInicial,
  vencimentosIniciais,
  podeIncluir,
  podeEditar,
}: {
  catalogoInicial: Catalogo
  vencimentosIniciais: VencimentoRow[]
  podeIncluir: boolean
  podeEditar: boolean
}) {
  const [aba, setAba] = useState<Aba>('certificadoras')
  const [catalogo, setCatalogo] = useState<Catalogo>(catalogoInicial)
  const [mensagem, setMensagem] = useState<Mensagem | null>(null)
  const fecharMensagem = useCallback(() => setMensagem(null), [])

  const [certificadoraModal, setCertificadoraModal] = useState<Partial<Certificadora> | null>(null)
  const [tipoModal, setTipoModal] = useState<Partial<CertificacaoTipo> | null>(null)
  const [certificacaoModal, setCertificacaoModal] = useState<(Partial<Certificacao> & { tipo_ids: string[] }) | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [enviandoLogo, setEnviandoLogo] = useState<string | null>(null)

  const [dias, setDias] = useState(60)
  const [vencimentos, setVencimentos] = useState<VencimentoRow[]>(vencimentosIniciais)
  const [carregandoVenc, setCarregandoVenc] = useState(false)

  const certificadoraNome = useMemo(() => new Map(catalogo.certificadoras.map((c) => [c.id, c.nome])), [catalogo.certificadoras])
  const tipoNome = useMemo(() => new Map(catalogo.tipos.map((t) => [t.id, t.nome])), [catalogo.tipos])

  async function recarregar() {
    const r = await getCatalogoCertificacoes()
    if (!r.success) {
      setMensagem({ type: 'error', text: r.error })
      return
    }
    setCatalogo({ certificadoras: r.certificadoras, tipos: r.tipos, certificacoes: r.certificacoes })
  }

  async function executar(fn: () => Promise<{ success: boolean; error?: string }>, ok: string, fechar: () => void) {
    if (salvando) return
    setSalvando(true)
    try {
      const r = await fn()
      if (!r.success) {
        setMensagem({ type: 'error', text: r.error || 'Não foi possível salvar.' })
        return
      }
      fechar()
      setMensagem({ type: 'success', text: ok })
      await recarregar()
    } finally {
      setSalvando(false)
    }
  }

  async function handleLogo(certificadoraId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setEnviandoLogo(certificadoraId)
    try {
      const fd = new FormData()
      fd.set('file', file)
      const r = await uploadLogotipoCertificadora(certificadoraId, fd)
      if (!r.success) {
        setMensagem({ type: 'error', text: r.error })
        return
      }
      setMensagem({ type: 'success', text: 'Logotipo atualizado.' })
      await recarregar()
    } finally {
      setEnviandoLogo(null)
    }
  }

  async function trocarDias(novo: number) {
    setDias(novo)
    setCarregandoVenc(true)
    try {
      const r = await listarVencimentos(novo)
      if (!r.success) {
        setMensagem({ type: 'error', text: r.error })
        return
      }
      setVencimentos(r.rows)
    } finally {
      setCarregandoVenc(false)
    }
  }

  const abas: Array<[Aba, string]> = [
    ['certificadoras', 'Certificadoras'],
    ['tipos', 'Tipos'],
    ['certificacoes', 'Certificações'],
    ['vencimentos', 'Vencimentos'],
  ]

  return (
    <div className="page-content">
      <Toast mensagem={mensagem} onClose={fecharMensagem} />

      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>Certificações</h1>
        <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
          Certificadoras, tipos de certificação e as certificações que cada uma cobre. Os lançamentos por pessoa acontecem na Análise de cada cadastro.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {abas.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className="btn btn-sm"
            onClick={() => setAba(id)}
            style={{
              background: aba === id ? 'var(--brs-navy)' : 'var(--brs-gray-100)',
              color: aba === id ? '#fff' : 'var(--brs-gray-600)',
              border: 'none',
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ Certificadoras */}
      {aba === 'certificadoras' && (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Certificadoras</div>
            {podeIncluir && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCertificadoraModal({ nome: '', site: '', is_active: true })}>
                <Plus size={14} /> Nova certificadora
              </button>
            )}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Logotipo</th>
                <th>Nome</th>
                <th>Site</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalogo.certificadoras.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.logotipo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logotipo_url} alt={c.nome} style={{ height: 28, maxWidth: 120, objectFit: 'contain' }} />
                    ) : (
                      <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.78rem' }}>sem logotipo</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td>
                    {c.site ? (
                      <a href={c.site} target="_blank" rel="noreferrer">
                        {c.site.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Situacao ativo={c.is_active} />
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {podeEditar && (
                      <>
                        <label className="btn btn-ghost btn-sm" style={{ cursor: enviandoLogo === c.id ? 'wait' : 'pointer' }} title="PNG, JPG, SVG ou WebP até 2 MB">
                          {enviandoLogo === c.id ? <Loader2 size={13} className="spinner" /> : <UploadCloud size={13} />} Logotipo
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display: 'none' }} disabled={enviandoLogo !== null} onChange={(e) => handleLogo(c.id, e)} />
                        </label>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCertificadoraModal({ ...c })}>
                          <Pencil size={13} /> Editar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {catalogo.certificadoras.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--brs-gray-500)' }}>
                    Nenhuma certificadora cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------------ Tipos */}
      {aba === 'tipos' && (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Tipos de certificação</div>
            {podeIncluir && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setTipoModal({ nome: '', obrigatorio: false, is_active: true })}>
                <Plus size={14} /> Novo tipo
              </button>
            )}
          </div>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
            Um tipo marcado como obrigatório é exigido nas análises novas: pelo menos um sócio ou administrador precisa ter todos os tipos obrigatórios vigentes. Desmarcar
            não apaga nenhum lançamento, só deixa de exigir.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Obrigatório</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalogo.tipos.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.nome}</td>
                  <td>{t.obrigatorio ? <span className="badge badge-danger">Obrigatório</span> : '—'}</td>
                  <td>
                    <Situacao ativo={t.is_active} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {podeEditar && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTipoModal({ ...t })}>
                        <Pencil size={13} /> Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {catalogo.tipos.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--brs-gray-500)' }}>
                    Nenhum tipo cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------------ Certificações */}
      {aba === 'certificacoes' && (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Certificações</div>
            {podeIncluir && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setCertificacaoModal({ certificadora_id: catalogo.certificadoras[0]?.id || '', nome: '', is_active: true, tipo_ids: [] })}
              >
                <Plus size={14} /> Nova certificação
              </button>
            )}
          </div>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
            Uma certificação pode cobrir vários tipos (por exemplo, Crédito Consignado + LGPD + PLDFT). A validade lançada vale para todos os tipos que ela cobre.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Certificadora</th>
                <th>Certificação</th>
                <th>Cobre os tipos</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {catalogo.certificacoes.map((c) => (
                <tr key={c.id}>
                  <td>{certificadoraNome.get(c.certificadora_id) || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td>{c.tipo_ids.map((id) => tipoNome.get(id)).filter(Boolean).join(', ') || '—'}</td>
                  <td>
                    <Situacao ativo={c.is_active} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {podeEditar && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCertificacaoModal({ ...c })}>
                        <Pencil size={13} /> Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {catalogo.certificacoes.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--brs-gray-500)' }}>
                    Nenhuma certificação cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------------ Vencimentos */}
      {aba === 'vencimentos' && (
        <div className="card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <AlertTriangle size={16} style={{ color: '#b45309' }} /> Vencimentos (inclui as já vencidas)
            </div>
            <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              Vencem em até
              <select className="form-control" style={{ width: 110 }} value={dias} onChange={(e) => trocarDias(Number(e.target.value))} disabled={carregandoVenc}>
                {DIAS_OPCOES.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </select>
              {carregandoVenc && <Loader2 size={14} className="spinner" />}
            </label>
          </div>
          {vencimentos.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>Nenhuma certificação conferida vence nos próximos {dias} dias.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>CPF</th>
                  <th>Certificação</th>
                  <th>Validade</th>
                  <th>Dias</th>
                  <th>Parceiro</th>
                </tr>
              </thead>
              <tbody>
                {vencimentos.map((r) => (
                  <tr key={r.id}>
                    <td>{r.nome || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.cpf}</td>
                    <td>
                      {r.certificacao_nome} <span style={{ color: 'var(--brs-gray-400)' }}>{r.certificadora_nome}</span>
                    </td>
                    <td>{fmtData(r.data_validade)}</td>
                    <td style={{ color: r.dias < 0 ? '#b91c1c' : '#b45309', fontWeight: 700 }}>{r.dias < 0 ? `vencida há ${-r.dias}` : r.dias}</td>
                    <td>
                      {r.processo_id ? (
                        <Link href={`/agente-corban/cadastros-recebidos/${r.processo_id}`} style={{ color: 'var(--brs-navy)' }}>
                          {r.agente_nome || 'ver processo'}
                        </Link>
                      ) : (
                        r.agente_nome || '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ Modais */}
      {certificadoraModal && (
        <Modal
          titulo={certificadoraModal.id ? 'Editar certificadora' : 'Nova certificadora'}
          onClose={() => setCertificadoraModal(null)}
          salvando={salvando}
          desabilitarSalvar={!String(certificadoraModal.nome || '').trim()}
          onSalvar={() =>
            executar(
              () =>
                salvarCertificadora({
                  id: certificadoraModal.id,
                  nome: certificadoraModal.nome || '',
                  site: certificadoraModal.site || '',
                  is_active: certificadoraModal.is_active ?? true,
                }),
              'Certificadora salva.',
              () => setCertificadoraModal(null),
            )
          }
        >
          <div>
            <label className="form-label">Nome *</label>
            <input className="form-control" value={certificadoraModal.nome || ''} onChange={(e) => setCertificadoraModal((m) => ({ ...m, nome: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Site (começa com http:// ou https://)</label>
            <input className="form-control" value={certificadoraModal.site || ''} placeholder="https://" onChange={(e) => setCertificadoraModal((m) => ({ ...m, site: e.target.value }))} />
          </div>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={certificadoraModal.is_active ?? true} onChange={(e) => setCertificadoraModal((m) => ({ ...m, is_active: e.target.checked }))} />
            Ativa
          </label>
          {!certificadoraModal.id && <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>O logotipo é enviado depois de salvar, pelo botão Logotipo da linha.</div>}
        </Modal>
      )}

      {tipoModal && (
        <Modal
          titulo={tipoModal.id ? 'Editar tipo de certificação' : 'Novo tipo de certificação'}
          onClose={() => setTipoModal(null)}
          salvando={salvando}
          desabilitarSalvar={!String(tipoModal.nome || '').trim()}
          onSalvar={() =>
            executar(
              () => salvarTipoCertificacao({ id: tipoModal.id, nome: tipoModal.nome || '', obrigatorio: Boolean(tipoModal.obrigatorio), is_active: tipoModal.is_active ?? true }),
              'Tipo salvo.',
              () => setTipoModal(null),
            )
          }
        >
          <div>
            <label className="form-label">Nome *</label>
            <input className="form-control" value={tipoModal.nome || ''} onChange={(e) => setTipoModal((m) => ({ ...m, nome: e.target.value }))} />
          </div>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
            <input style={{ marginTop: 3 }} type="checkbox" checked={Boolean(tipoModal.obrigatorio)} onChange={(e) => setTipoModal((m) => ({ ...m, obrigatorio: e.target.checked }))} />
            <span>
              Obrigatório
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
                Exigido nas análises novas. Desmarcar depois não apaga lançamentos, só deixa de exigir.
              </span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={tipoModal.is_active ?? true} onChange={(e) => setTipoModal((m) => ({ ...m, is_active: e.target.checked }))} />
            Ativo
          </label>
        </Modal>
      )}

      {certificacaoModal && (
        <Modal
          titulo={certificacaoModal.id ? 'Editar certificação' : 'Nova certificação'}
          onClose={() => setCertificacaoModal(null)}
          salvando={salvando}
          desabilitarSalvar={!String(certificacaoModal.nome || '').trim() || !certificacaoModal.certificadora_id || certificacaoModal.tipo_ids.length === 0}
          onSalvar={() =>
            executar(
              () =>
                salvarCertificacao({
                  id: certificacaoModal.id,
                  certificadora_id: certificacaoModal.certificadora_id || '',
                  nome: certificacaoModal.nome || '',
                  tipo_ids: certificacaoModal.tipo_ids,
                  is_active: certificacaoModal.is_active ?? true,
                }),
              'Certificação salva.',
              () => setCertificacaoModal(null),
            )
          }
        >
          <div>
            <label className="form-label">Certificadora *</label>
            <select className="form-control" value={certificacaoModal.certificadora_id || ''} onChange={(e) => setCertificacaoModal((m) => (m ? { ...m, certificadora_id: e.target.value } : m))}>
              <option value="">Selecione</option>
              {catalogo.certificadoras
                .filter((c) => c.is_active || c.id === certificacaoModal.certificadora_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                    {c.is_active ? '' : ' (inativa)'}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="form-label">Nome da certificação *</label>
            <input
              className="form-control"
              value={certificacaoModal.nome || ''}
              placeholder="Ex.: Certificação ANEC Completa + LGPD + PLDFT"
              onChange={(e) => setCertificacaoModal((m) => (m ? { ...m, nome: e.target.value } : m))}
            />
          </div>
          <div>
            <label className="form-label">Tipos que ela cobre * (pelo menos um)</label>
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              {catalogo.tipos
                .filter((t) => t.is_active || certificacaoModal.tipo_ids.includes(t.id))
                .map((t) => (
                  <label key={t.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={certificacaoModal.tipo_ids.includes(t.id)}
                      onChange={(e) =>
                        setCertificacaoModal((m) =>
                          m ? { ...m, tipo_ids: e.target.checked ? [...m.tipo_ids, t.id] : m.tipo_ids.filter((id) => id !== t.id) } : m,
                        )
                      }
                    />
                    {t.nome}
                    {t.obrigatorio ? <span className="badge badge-danger">Obrigatório</span> : null}
                    {t.is_active ? '' : ' (inativo)'}
                  </label>
                ))}
            </div>
          </div>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={certificacaoModal.is_active ?? true} onChange={(e) => setCertificacaoModal((m) => (m ? { ...m, is_active: e.target.checked } : m))} />
            Ativa
          </label>
        </Modal>
      )}
    </div>
  )
}
