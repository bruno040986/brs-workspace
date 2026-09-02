'use client'

import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle,
  Edit2,
  Loader2,
  Save,
  UploadCloud,
  UserCheck,
  X,
} from 'lucide-react'
import { formatCpfOrCnpjDisplay } from '@/lib/agente-corban'
import {
  CHECKLIST_PORTAL_STEP_LABELS,
  CHECKLIST_PROVENANCIA_BADGE,
  CHECKLIST_PROVENANCIA_LABELS,
  CORBAN_ONBOARDING_ETAPAS,
  CORBAN_ONBOARDING_ETAPAS_ATIVAS,
  CORBAN_ONBOARDING_ETAPA_LABELS,
  CORBAN_ONBOARDING_ITEM_STATUS_BADGE,
  CORBAN_ONBOARDING_ITEM_STATUS_LABELS,
  CORBAN_ONBOARDING_STATUS_BADGE,
  CORBAN_ONBOARDING_STATUS_LABELS,
  PRESENCA_DIGITAL_CLASSIFICACAO_LABELS,
  formatChecklistItemValue,
  formatEventoDescricao,
  getAdministracao,
  getDivergenciasReceita,
  getSignatarios,
  getSocios,
  groupChecklistItems,
  isChavePixChave,
  itemDispensaAprovacao,
  resolveChecklistFieldKind,
  resolveItemPortalStep,
  resolveItemProvenancia,
  resolvePersonByCpf,
  sumCapitalShare,
  type ChecklistPortalStep,
  type CorbanOnboardingEtapa,
  type CorbanOnboardingItem,
  type CorbanOnboardingProcessoStatus,
  type PresencaDigitalClassificacao,
} from '@/lib/agente-corban-onboarding'
import DocumentViewer, { type DocumentViewerFile } from './DocumentViewer'
import EtapasFinaisPanel from './EtapasFinaisPanel'
import { solicitarCorrecao } from '../etapas-actions'
import {
  aprovarSecao,
  assumirResponsavel,
  avaliarChavePix,
  avaliarDocAnalise,
  avaliarItem,
  avaliarPresencaDigital,
  concluirEtapaAnalise,
  concluirEtapaValidacao,
  editarItemValor,
  getProcesso,
  uploadDocAnalise,
  type ProcessoDetalhe,
} from '../actions'

type SuccessData = Extract<ProcessoDetalhe, { success: true }>
type DocAnaliseComUrl = SuccessData['docs'][number]
type Message = { type: 'success' | 'error'; text: string }

function parseAnaliseChave(
  chave: string,
): { tipoDocumento: 'serasa' | 'cartao_cnpj'; alvoTipo: 'cpf' | 'cnpj'; alvoValor: string } | null {
  const serasaMatch = chave.match(/^analise:serasa:cpf:(.+)$/)
  if (serasaMatch) return { tipoDocumento: 'serasa', alvoTipo: 'cpf', alvoValor: serasaMatch[1] }
  const cartaoMatch = chave.match(/^analise:cartao_cnpj:cnpj:(.+)$/)
  if (cartaoMatch) return { tipoDocumento: 'cartao_cnpj', alvoTipo: 'cnpj', alvoValor: cartaoMatch[1] }
  return null
}

const iconBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 5,
  border: '1px solid var(--brs-gray-200)',
  background: '#fff',
  color: 'var(--brs-gray-600)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
} as const

function toDocumentFiles(valor: any): DocumentViewerFile[] {
  if (Array.isArray(valor)) {
    return valor.filter((item) => item?.url).map((item) => ({ fileName: item.fileName, url: item.url }))
  }
  return []
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--brs-gray-400)', minWidth: 190, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--brs-gray-700)', whiteSpace: 'pre-line' }}>{value}</span>
    </div>
  )
}

function MessageBanner({ message }: { message: Message | null }) {
  if (!message) return null
  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '0.875rem 1rem',
        borderRadius: 10,
        border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
        background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
        color: message.type === 'success' ? '#065F46' : '#991B1B',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
      }}
    >
      {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
    </div>
  )
}

export default function ProcessoOnboardingClient({ initialData }: { initialData: SuccessData }) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [reprovarItem, setReprovarItem] = useState<CorbanOnboardingItem | null>(null)
  const [motivo, setMotivo] = useState('')
  const [instrucoes, setInstrucoes] = useState('')
  const [editarItem, setEditarItem] = useState<CorbanOnboardingItem | null>(null)
  const [editarValor, setEditarValor] = useState('')
  const [aprovandoSecao, setAprovandoSecao] = useState<ChecklistPortalStep | null>(null)
  const [etapaSelecionada, setEtapaSelecionada] = useState<CorbanOnboardingEtapa>(data.processo.etapa_atual)

  const corbanData: Record<string, any> = data.agente.corban_data || {}

  async function refresh() {
    setLoading(true)
    const result = await getProcesso(data.processo.id)
    setLoading(false)
    if (result.success) setData(result)
  }

  async function handleAprovarItem(item: CorbanOnboardingItem) {
    setBusyId(item.id)
    const result = await avaliarItem(item.id, { status: 'aprovado' })
    setBusyId(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao aprovar item.' })
      return
    }
    setMessage({ type: 'success', text: `"${item.rotulo}" aprovado.` })
    await refresh()
  }

  function openReprovar(item: CorbanOnboardingItem) {
    setReprovarItem(item)
    setMotivo('')
    setInstrucoes('')
  }

  async function handleConfirmarReprovacao() {
    if (!reprovarItem) return
    if (!motivo.trim() || !instrucoes.trim()) {
      setMessage({ type: 'error', text: 'Informe o motivo e as instruções de correção.' })
      return
    }
    setBusyId(reprovarItem.id)
    const result = await avaliarItem(reprovarItem.id, { status: 'reprovado', motivo, instrucoes })
    setBusyId(null)
    setReprovarItem(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao reprovar item.' })
      return
    }
    setMessage({ type: 'success', text: 'Item reprovado.' })
    await refresh()
  }

  function openEditar(item: CorbanOnboardingItem) {
    setEditarItem(item)
    setEditarValor(item.valor === true ? 'true' : item.valor === false ? 'false' : String(item.valor ?? ''))
  }

  async function handleSalvarEdicao() {
    if (!editarItem) return
    setBusyId(editarItem.id)
    const result = await editarItemValor(editarItem.id, editarValor)
    setBusyId(null)
    setEditarItem(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao editar item.' })
      return
    }
    setMessage({ type: 'success', text: 'Item editado — aguardando nova aprovação.' })
    await refresh()
  }

  async function handleAprovarSecao(passo: ChecklistPortalStep) {
    setAprovandoSecao(passo)
    const result = await aprovarSecao(data.processo.id, passo)
    setAprovandoSecao(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao aprovar seção.' })
      return
    }
    setMessage({ type: 'success', text: `${CHECKLIST_PORTAL_STEP_LABELS[passo]}: ${result.aprovados} campo(s) aprovado(s).` })
    await refresh()
  }

  async function handlePresencaDigital(item: CorbanOnboardingItem, classificacao: PresencaDigitalClassificacao, texto?: string) {
    setBusyId(item.id)
    const result = await avaliarPresencaDigital(item.id, { classificacao, texto })
    setBusyId(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao classificar.' })
      return
    }
    await refresh()
  }

  async function handleChavePix(item: CorbanOnboardingItem, respostas: { existe: boolean; pertenceCnpj: boolean; mesmaInstituicao: boolean }) {
    setBusyId(item.id)
    const result = await avaliarChavePix(item.id, respostas)
    setBusyId(null)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao avaliar a chave PIX.' })
      return
    }
    await refresh()
  }

  async function handleConcluirEtapa() {
    const action = etapaSelecionada === 'validacao' ? concluirEtapaValidacao : concluirEtapaAnalise
    setLoading(true)
    const result = await action(data.processo.id)
    setLoading(false)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao concluir etapa.' })
      return
    }
    setMessage({ type: 'success', text: 'Etapa concluída.' })
    await refresh()
    if (etapaSelecionada === 'validacao') setEtapaSelecionada('analise')
  }

  const etapaEhChecklist = etapaSelecionada === 'validacao' || etapaSelecionada === 'analise'
  const temReprovados = data.itens.some((item) => item.status === 'reprovado')

  async function handleSolicitarCorrecao() {
    if (!window.confirm('Agrupar todos os itens reprovados e enviar o link de correção ao parceiro (e-mail + WhatsApp)?')) return
    setLoading(true)
    const result = await solicitarCorrecao(data.processo.id)
    setLoading(false)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error })
      return
    }
    setMessage({ type: 'success', text: `${result.detalhe} Link: ${result.link}` })
    await refresh()
  }

  async function handleAssumir() {
    setLoading(true)
    const result = await assumirResponsavel(data.processo.id)
    setLoading(false)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Erro ao assumir processo.' })
      return
    }
    await refresh()
  }

  const itensEtapa = useMemo(
    () => data.itens.filter((item) => item.etapa === etapaSelecionada),
    [data.itens, etapaSelecionada],
  )
  const podeConcluirEtapa =
    itensEtapa.length > 0 &&
    itensEtapa.every((item) => item.status === 'aprovado' || itemDispensaAprovacao(item, corbanData)) &&
    etapaSelecionada === data.processo.etapa_atual

  const itensPorPasso = useMemo(() => {
    if (etapaSelecionada !== 'validacao') return null
    const grupos: Record<ChecklistPortalStep, CorbanOnboardingItem[]> = {
      compliance: [],
      empresa: [],
      comercial: [],
      bancario: [],
      sociedade: [],
      signatarios: [],
      documentos: [],
    }
    for (const item of itensEtapa) {
      grupos[resolveItemPortalStep(item)].push(item)
    }
    return grupos
  }, [itensEtapa, etapaSelecionada])

  const docsByAlvo = useMemo(() => {
    const map = new Map<string, DocAnaliseComUrl[]>()
    for (const doc of data.docs) {
      const key = `${doc.tipo_documento}:${doc.alvo_tipo}:${doc.alvo_valor}`
      map.set(key, [...(map.get(key) || []), doc])
    }
    return map
  }, [data.docs])

  return (
    <div className="page-content">
      <Link href="/agente-corban/cadastros-recebidos" className="btn btn-ghost btn-sm" style={{ marginBottom: '0.75rem' }}>
        <ArrowLeft size={15} />
        Voltar para Cadastros Recebidos
      </Link>

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>{data.agente.name}</div>
            <div style={{ color: 'var(--brs-gray-500)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {formatCpfOrCnpjDisplay(data.agente.cpf_cnpj || '')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`badge ${CORBAN_ONBOARDING_STATUS_BADGE[data.processo.status as CorbanOnboardingProcessoStatus]}`}>
              {CORBAN_ONBOARDING_STATUS_LABELS[data.processo.status as CorbanOnboardingProcessoStatus]}
            </span>
            {data.responsavelNome ? (
              <span className="badge badge-navy">Responsável: {data.responsavelNome}</span>
            ) : (
              <button type="button" className="btn btn-outline btn-sm" onClick={handleAssumir} disabled={loading}>
                <UserCheck size={15} />
                Assumir processo
              </button>
            )}
          </div>
        </div>
      </div>

      <MessageBanner message={message} />

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {CORBAN_ONBOARDING_ETAPAS.map((etapa, idx) => {
          const hasItens = data.itens.some((item) => item.etapa === etapa)
          const isActiveStage = CORBAN_ONBOARDING_ETAPAS_ATIVAS.includes(etapa)
          const isCurrent = data.processo.etapa_atual === etapa
          const isPast = CORBAN_ONBOARDING_ETAPAS.indexOf(data.processo.etapa_atual) > idx
          const clickable = isActiveStage && (hasItens || isCurrent || isPast)
          const selected = etapaSelecionada === etapa

          return (
            <button
              key={etapa}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && setEtapaSelecionada(etapa)}
              className="btn btn-sm"
              title={!isActiveStage ? 'Disponível nas próximas fases (C–F)' : undefined}
              style={{
                background: selected ? 'var(--brs-navy)' : isPast ? 'rgba(22,163,74,0.12)' : isCurrent ? 'rgba(2,132,199,0.12)' : 'var(--brs-gray-100)',
                color: selected ? '#fff' : isPast ? '#15803d' : isCurrent ? '#0369a1' : 'var(--brs-gray-500)',
                border: 'none',
                cursor: clickable ? 'pointer' : 'not-allowed',
                opacity: clickable ? 1 : 0.65,
              }}
            >
              {idx + 1}. {CORBAN_ONBOARDING_ETAPA_LABELS[etapa]}
            </button>
          )
        })}
      </div>

      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)' }}>
            {etapaEhChecklist ? 'Checklist — ' : ''}{CORBAN_ONBOARDING_ETAPA_LABELS[etapaSelecionada]}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {temReprovados && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={loading}
                title="Agrupa os itens reprovados, gera o magic link e envia e-mail + WhatsApp ao parceiro"
                onClick={handleSolicitarCorrecao}
              >
                Solicitar correção ao parceiro
              </button>
            )}
            {etapaEhChecklist && etapaSelecionada === data.processo.etapa_atual && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!podeConcluirEtapa || loading} onClick={handleConcluirEtapa}>
                {loading ? <Loader2 size={15} className="spinner" /> : <Check size={15} />}
                Concluir etapa
              </button>
            )}
          </div>
        </div>

        {!etapaEhChecklist ? (
          <EtapasFinaisPanel
            etapa={etapaSelecionada}
            processo={data.processo as unknown as Record<string, any>}
            agente={data.agente as unknown as Record<string, any>}
            onRefresh={refresh}
            onMensagem={(m) => setMessage({ type: m.tipo === 'ok' ? 'success' : 'error', text: m.texto })}
          />
        ) : itensEtapa.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', padding: '1.5rem 0', textAlign: 'center' }}>
            Nenhum item gerado para esta etapa ainda.
          </div>
        ) : etapaSelecionada === 'validacao' && itensPorPasso ? (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <ComplianceSecao corbanData={corbanData} />

            <EmpresaSecao
              items={itensPorPasso.empresa}
              corbanData={corbanData}
              busyId={busyId}
              aprovando={aprovandoSecao === 'empresa'}
              onAprovarSecao={() => handleAprovarSecao('empresa')}
              onAprovarItem={handleAprovarItem}
              onAbrirEditar={openEditar}
              onAbrirReprovar={openReprovar}
            />

            <ComercialSecao
              items={itensPorPasso.comercial}
              corbanData={corbanData}
              busyId={busyId}
              onClassificar={handlePresencaDigital}
            />

            <BancarioSecao
              items={itensPorPasso.bancario}
              corbanData={corbanData}
              busyId={busyId}
              aprovando={aprovandoSecao === 'bancario'}
              onAprovarSecao={() => handleAprovarSecao('bancario')}
              onAbrirEditar={openEditar}
              onAbrirReprovar={openReprovar}
              onAvaliarPix={handleChavePix}
            />

            <SociedadeSecao
              items={itensPorPasso.sociedade}
              corbanData={corbanData}
              busyId={busyId}
              aprovando={aprovandoSecao === 'sociedade'}
              onAprovarSecao={() => handleAprovarSecao('sociedade')}
              onAbrirEditar={openEditar}
              onAbrirReprovar={openReprovar}
            />

            <SignatariosSecao
              items={itensPorPasso.signatarios}
              corbanData={corbanData}
              busyId={busyId}
              aprovando={aprovandoSecao === 'signatarios'}
              onAprovarSecao={() => handleAprovarSecao('signatarios')}
              onAbrirEditar={openEditar}
              onAbrirReprovar={openReprovar}
            />

            {itensPorPasso.documentos.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)', marginBottom: '0.6rem' }}>
                  {CHECKLIST_PORTAL_STEP_LABELS.documentos}
                </div>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {itensPorPasso.documentos.map((item) => (
                    <div key={item.id} style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--brs-gray-900)' }}>{item.rotulo}</div>
                        <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[item.status]}`}>
                          {CORBAN_ONBOARDING_ITEM_STATUS_LABELS[item.status]}
                        </span>
                      </div>

                      <DocumentViewer files={toDocumentFiles(item.valor)} />

                      {item.status === 'reprovado' && item.motivo_reprovacao && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                          Motivo: {item.motivo_reprovacao} — Instruções: {item.instrucoes_correcao}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={busyId === item.id || item.status === 'aprovado'}
                          onClick={() => handleAprovarItem(item)}
                        >
                          {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Check size={15} />}
                          Aprovar
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={busyId === item.id || item.status === 'reprovado'}
                          onClick={() => openReprovar(item)}
                        >
                          <X size={15} />
                          Reprovar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {itensEtapa.map((item) => {
              const analiseSpec = parseAnaliseChave(item.chave)
              const docsRelacionados = analiseSpec
                ? docsByAlvo.get(`${analiseSpec.tipoDocumento}:${analiseSpec.alvoTipo}:${analiseSpec.alvoValor}`) || []
                : []

              return (
                <div key={item.id} style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--brs-gray-900)' }}>{item.rotulo}</div>
                    <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[item.status]}`}>
                      {CORBAN_ONBOARDING_ITEM_STATUS_LABELS[item.status]}
                    </span>
                  </div>

                  {item.chave.startsWith('analise:conferencia:') ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-700)', display: 'grid', gap: '0.15rem' }}>
                      <div>Declarado: {(item.valor?.declarados || []).join(', ') || '—'}</div>
                      <div>Receita: {(item.valor?.receita || []).join(', ') || '—'}</div>
                    </div>
                  ) : (
                    <AnaliseDocSection
                      processoId={data.processo.id}
                      spec={analiseSpec}
                      docs={docsRelacionados}
                      onChanged={refresh}
                    />
                  )}

                  {item.status === 'reprovado' && item.motivo_reprovacao && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b91c1c' }}>
                      Motivo: {item.motivo_reprovacao} — Instruções: {item.instrucoes_correcao}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busyId === item.id || item.status === 'aprovado'}
                      onClick={() => handleAprovarItem(item)}
                    >
                      {busyId === item.id ? <Loader2 size={15} className="spinner" /> : <Check size={15} />}
                      Aprovar
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busyId === item.id || item.status === 'reprovado'}
                      onClick={() => openReprovar(item)}
                    >
                      <X size={15} />
                      Reprovar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)', marginBottom: '0.75rem' }}>Histórico</div>
        <div style={{ display: 'grid', gap: '0.4rem', maxHeight: 280, overflowY: 'auto' }}>
          {data.eventos.length === 0 ? (
            <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>Sem eventos registrados.</div>
          ) : (
            data.eventos.map((evento) => (
              <div key={evento.id} style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span>
                  {formatEventoDescricao(evento)}
                  {evento.actorNome ? ` — ${evento.actorNome}` : ''}
                </span>
                <span>{new Date(evento.created_at).toLocaleString('pt-BR')}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {reprovarItem && (
        <div className="modal-backdrop" onClick={() => setReprovarItem(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Reprovar item</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setReprovarItem(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Motivo <span className="required">*</span>
                </label>
                <input className="form-control" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Documento ilegível" />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Instruções de correção <span className="required">*</span>
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={instrucoes}
                  onChange={(e) => setInstrucoes(e.target.value)}
                  placeholder="O que o parceiro precisa reenviar/corrigir"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setReprovarItem(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={busyId === reprovarItem.id} onClick={handleConfirmarReprovacao}>
                {busyId === reprovarItem.id ? <Loader2 size={16} className="spinner" /> : <X size={16} />}
                Reprovar
              </button>
            </div>
          </div>
        </div>
      )}

      {editarItem && (
        <div className="modal-backdrop" onClick={() => setEditarItem(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Editar: {editarItem.rotulo}</h3>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setEditarItem(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Novo valor</label>
                {resolveChecklistFieldKind(editarItem.chave) === 'boolean' ? (
                  <select className="form-control" value={editarValor} onChange={(e) => setEditarValor(e.target.value)}>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                ) : resolveChecklistFieldKind(editarItem.chave) === 'date' ? (
                  <input
                    type="date"
                    className="form-control"
                    value={editarValor}
                    onChange={(e) => setEditarValor(e.target.value)}
                  />
                ) : (
                  <input className="form-control" value={editarValor} onChange={(e) => setEditarValor(e.target.value)} />
                )}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
                A edição fica registrada no histórico do processo com seu usuário, o valor anterior e o novo valor. O item
                volta para &quot;Pendente&quot; para uma nova aprovação.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setEditarItem(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={busyId === editarItem.id} onClick={handleSalvarEdicao}>
                {busyId === editarItem.id ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =========================================================================
// Bloco genérico: card de seção com "Editar"/"Aprovar seção"
// =========================================================================

function SecaoShell({
  titulo,
  allItems,
  bulkApprovableItems,
  aprovando,
  onAprovarSecao,
  children,
}: {
  titulo: string
  allItems: CorbanOnboardingItem[]
  bulkApprovableItems: CorbanOnboardingItem[]
  aprovando: boolean
  onAprovarSecao: () => void
  children: (modoEdicao: boolean) => ReactNode
}) {
  const [modoEdicao, setModoEdicao] = useState(false)
  const totalAprovados = allItems.filter((item) => item.status === 'aprovado').length
  const temReprovadoBulk = bulkApprovableItems.some((item) => item.status === 'reprovado')
  const todosAprovadosBulk = bulkApprovableItems.length > 0 && bulkApprovableItems.every((item) => item.status === 'aprovado')

  return (
    <div className="card" style={{ padding: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)' }}>
          {titulo}{' '}
          {allItems.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
              ({totalAprovados}/{allItems.length} aprovados)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {allItems.length > 0 && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setModoEdicao((m) => !m)}>
              <Edit2 size={15} />
              {modoEdicao ? 'Concluir edição' : 'Editar'}
            </button>
          )}
          {bulkApprovableItems.length > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={temReprovadoBulk || todosAprovadosBulk || aprovando}
              onClick={onAprovarSecao}
              title={temReprovadoBulk ? 'Corrija os campos reprovados desta seção antes de aprovar.' : undefined}
            >
              {aprovando ? <Loader2 size={15} className="spinner" /> : <Check size={15} />}
              Aprovar seção
            </button>
          )}
        </div>
      </div>
      {children(modoEdicao)}
    </div>
  )
}

// =========================================================================
// Campo simples do checklist (rótulo + flag de origem + valor)
// =========================================================================

function CampoChecklist({
  item,
  corbanData,
  modoEdicao,
  busyId,
  onAbrirEditar,
  onAbrirReprovar,
  semBorda,
}: {
  item: CorbanOnboardingItem
  corbanData: Record<string, any>
  modoEdicao: boolean
  busyId: string | null
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
  semBorda?: boolean
}) {
  const valorFormatado = formatChecklistItemValue(item.chave, item.valor)
  const multilinha = valorFormatado.includes('\n')
  const { provenancia, entry } = resolveItemProvenancia(item.chave, item.valor, corbanData)

  return (
    <div
      style={{
        gridColumn: multilinha ? '1 / -1' : undefined,
        paddingBottom: semBorda ? 0 : '0.55rem',
        borderBottom: semBorda ? 'none' : '1px solid var(--brs-gray-100)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '0.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {item.rotulo}
          </span>
          <span
            className={`badge ${CHECKLIST_PROVENANCIA_BADGE[provenancia]}`}
            style={{ fontSize: '0.6rem', padding: '0.05rem 0.35rem', whiteSpace: 'nowrap' }}
          >
            {CHECKLIST_PROVENANCIA_LABELS[provenancia]}
          </span>
        </div>
        {modoEdicao && (
          <span style={{ display: 'flex', gap: '0.3rem' }}>
            <button type="button" onClick={() => onAbrirEditar(item)} disabled={busyId === item.id} aria-label="Editar campo" title="Editar" style={iconBtnStyle}>
              <Edit2 size={12} />
            </button>
            <button
              type="button"
              onClick={() => onAbrirReprovar(item)}
              disabled={busyId === item.id || item.status === 'reprovado'}
              aria-label="Reprovar campo"
              title="Reprovar"
              style={iconBtnStyle}
            >
              <X size={12} />
            </button>
          </span>
        )}
      </div>

      <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--brs-gray-900)', whiteSpace: 'pre-line' }}>{valorFormatado}</div>

      {provenancia === 'consulta_api_alterado' && entry && (
        <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '0.1rem' }}>
          Valor da API: {formatChecklistItemValue(item.chave, entry.valor_api)}
        </div>
      )}

      {item.status === 'reprovado' && item.motivo_reprovacao && (
        <div style={{ marginTop: '0.2rem', fontSize: '0.72rem', color: '#b91c1c' }}>{item.motivo_reprovacao}</div>
      )}
    </div>
  )
}

/** Grade de campos (com agrupamento visual de endereço/banco) — usa `CampoChecklist` por dentro. */
function GradeCampos({
  items,
  corbanData,
  modoEdicao,
  busyId,
  onAbrirEditar,
  onAbrirReprovar,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  modoEdicao: boolean
  busyId: string | null
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
}) {
  const blocks = useMemo(() => groupChecklistItems(items), [items])
  if (items.length === 0) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem 1.5rem', alignItems: 'start' }}>
      {blocks.map((block) =>
        block.type === 'single' ? (
          <CampoChecklist
            key={block.item.id}
            item={block.item}
            corbanData={corbanData}
            modoEdicao={modoEdicao}
            busyId={busyId}
            onAbrirEditar={onAbrirEditar}
            onAbrirReprovar={onAbrirReprovar}
          />
        ) : (
          <div
            key={block.items.map((i) => i.id).join('-')}
            style={{
              gridColumn: block.items.length > 3 ? 'span 2' : undefined,
              border: '1px solid var(--brs-gray-200)',
              borderRadius: 8,
              padding: '0.7rem 0.85rem',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.55rem' }}>
              {block.rotulo}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.6rem 1rem' }}>
              {block.items.map((item) => (
                <CampoChecklist
                  key={item.id}
                  item={item}
                  corbanData={corbanData}
                  modoEdicao={modoEdicao}
                  busyId={busyId}
                  onAbrirEditar={onAbrirEditar}
                  onAbrirReprovar={onAbrirReprovar}
                  semBorda
                />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

// =========================================================================
// 1. Compliance — só exibição (o portal já bloqueou o envio sem aceite)
// =========================================================================

const COMPLIANCE_ITEMS: Array<{ chave: string; titulo: string }> = [
  { chave: 'compliance.policies', titulo: 'Aderência às Políticas Internas e Integridade' },
  { chave: 'compliance.anticorruption', titulo: 'Anticorrupção, Antissuborno e Relação com Agentes Públicos' },
  { chave: 'compliance.pld_ft', titulo: 'Prevenção à Lavagem de Dinheiro (PLD/FT) e Vedação a Fraudes' },
  { chave: 'compliance.infosec', titulo: 'Segurança da Informação, Uso de Credenciais e Vedação de Compartilhamento' },
  { chave: 'compliance.lgpd_client_data', titulo: 'Tratamento de Dados Pessoais (LGPD) e Origem dos Dados de Clientes' },
  { chave: 'compliance.whistleblower', titulo: 'Canal Oficial de Denúncias' },
  { chave: 'compliance.kyp', titulo: 'Autorização de Consulta (KYP / Background Check)' },
  { chave: 'compliance.legal_capacity', titulo: 'Capacidade e Representação Legal' },
]

function ComplianceSecao({ corbanData }: { corbanData: Record<string, any> }) {
  const pepStatus = corbanData?.compliance?.pep_status as string | undefined
  const isPep = pepStatus === 'pep'

  return (
    <div className="card" style={{ padding: '1.1rem' }}>
      <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)', marginBottom: '0.85rem' }}>{CHECKLIST_PORTAL_STEP_LABELS.compliance}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem 1.5rem' }}>
        {COMPLIANCE_ITEMS.map((it) => {
          const aceite = corbanData?.compliance?.[it.chave.replace('compliance.', '')]
          const aceito = aceite?.accepted === true
          return (
            <div key={it.chave} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
              <CheckCircle size={14} color={aceito ? '#15803d' : 'var(--brs-gray-300)'} />
              <span style={{ color: 'var(--brs-gray-700)' }}>{it.titulo}</span>
            </div>
          )
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
          <CheckCircle size={14} color={corbanData?.compliance?.bank_ownership?.accepted ? '#15803d' : 'var(--brs-gray-300)'} />
          <span style={{ color: 'var(--brs-gray-700)' }}>Titularidade da Conta Bancária</span>
        </div>
      </div>

      <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--brs-gray-100)' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.2rem' }}>
          Declaração sobre Pessoa Politicamente Exposta (PEP)
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: isPep ? '#9a6b1a' : 'var(--brs-gray-900)' }}>
          {pepStatus === 'pep'
            ? 'Declarou condição de PEP'
            : pepStatus === 'nao_pep'
              ? 'Nenhum PEP na estrutura'
              : '—'}
        </div>
        {isPep && (
          <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#9a6b1a', background: '#fdf6ec', border: '1px solid #eed9b0', borderRadius: 8, padding: '0.5rem 0.7rem' }}>
            ⚠ Necessário solicitar a Declaração de PEP específica ao parceiro.
          </div>
        )}
      </div>
    </div>
  )
}

// =========================================================================
// 2. Empresa
// =========================================================================

function EmpresaSecao({
  items,
  corbanData,
  busyId,
  aprovando,
  onAprovarSecao,
  onAprovarItem,
  onAbrirEditar,
  onAbrirReprovar,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  busyId: string | null
  aprovando: boolean
  onAprovarSecao: () => void
  onAprovarItem: (item: CorbanOnboardingItem) => void
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
}) {
  const master = corbanData?.master || {}
  const divergencias = getDivergenciasReceita(corbanData)
  const situacaoDivergente = divergencias.find((d) => d.tipo === 'situacao_cadastral')

  const cnaeItem = items.find((i) => i.chave === 'master.tem_cnae_corban')
  const camposItems = items.filter((i) => i.chave !== 'master.tem_cnae_corban')
  const itensContaveis = items.filter((i) => !itemDispensaAprovacao(i, corbanData))

  return (
    <SecaoShell titulo={CHECKLIST_PORTAL_STEP_LABELS.empresa} allItems={itensContaveis} bulkApprovableItems={itensContaveis} aprovando={aprovando} onAprovarSecao={onAprovarSecao}>
      {(modoEdicao) => (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {situacaoDivergente && (
            <div style={{ border: '1px solid #f0c4c4', background: '#fdf3f3', borderRadius: 8, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: '#a33' }}>
              {situacaoDivergente.descricao}
            </div>
          )}

          {master.person_type === 'PJ' && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
                Dados da Receita Federal (só exibição — não editáveis)
              </div>
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                <InfoRow label="Situação Cadastral" value={[master.situacao_cadastral, master.situacao_cadastral_data ? `desde ${formatChecklistItemValue('master.situacao_cadastral_data', master.situacao_cadastral_data)}` : ''].filter(Boolean).join(' — ')} />
                <InfoRow label="Estabelecimento" value={master.tipo_estabelecimento} />
                <InfoRow label="Porte" value={master.porte_empresa} />
                <InfoRow label="Capital social (RFB)" value={formatChecklistItemValue('master.capital_social_rfb', master.capital_social_rfb)} />
                <InfoRow label="CNAE principal" value={[master.cnae_main_code, master.cnae_main_desc].filter(Boolean).join(' — ')} />
                <InfoRow label="CNAEs secundários" value={Array.isArray(master.cnaes_secundarios) && master.cnaes_secundarios.length > 0 ? formatChecklistItemValue('master.cnaes_secundarios', master.cnaes_secundarios) : undefined} />
                <InfoRow label="Simples Nacional" value={master.simples_optante ? 'Optante' : 'Não optante'} />
                <InfoRow label="MEI" value={master.is_mei ? 'Optante' : 'Não optante'} />
                <InfoRow label="Inscrições estaduais" value={Array.isArray(master.inscricoes_estaduais) && master.inscricoes_estaduais.length > 0 ? formatChecklistItemValue('master.inscricoes_estaduais', master.inscricoes_estaduais) : undefined} />
                <InfoRow label="E-mail na Receita" value={corbanData?.contacts?.email_rfb} />
                <InfoRow label="Telefones na Receita" value={[corbanData?.contacts?.phone_rfb_1, corbanData?.contacts?.phone_rfb_2].filter(Boolean).map((p) => formatChecklistItemValue('contacts.phone_commercial', p)).join(' / ')} />
              </div>
            </div>
          )}

          {cnaeItem && <CnaeCampo item={cnaeItem} busyId={busyId} onAprovarItem={onAprovarItem} onAbrirReprovar={onAbrirReprovar} />}

          <GradeCampos items={camposItems} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />
        </div>
      )}
    </SecaoShell>
  )
}

/**
 * CNAE de correspondente bancário: única exceção do bloco Receita Federal que
 * sempre precisa de decisão explícita — por isso os botões ficam sempre
 * visíveis (não escondidos atrás do "Editar", diferente dos outros campos).
 */
function CnaeCampo({
  item,
  busyId,
  onAprovarItem,
  onAbrirReprovar,
}: {
  item: CorbanOnboardingItem
  busyId: string | null
  onAprovarItem: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
}) {
  const possui = item.valor === true
  return (
    <div
      style={{
        border: `1px solid ${possui ? '#bcd9bc' : '#eed9b0'}`,
        background: possui ? '#eef7ee' : '#fdf6ec',
        borderRadius: 8,
        padding: '0.75rem 0.9rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: possui ? '#2e7d32' : '#9a6b1a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Verificação obrigatória — Receita Federal
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: possui ? '#2e7d32' : '#9a6b1a' }}>
            {possui ? 'Possui CNAE de Correspondente Bancário (6619-3/02)' : 'Não possui o CNAE 6619-3/02 (correspondente bancário)'}
          </div>
        </div>
        <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[item.status]}`}>{CORBAN_ONBOARDING_ITEM_STATUS_LABELS[item.status]}</span>
      </div>

      {item.status === 'reprovado' && item.motivo_reprovacao && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#b91c1c' }}>{item.motivo_reprovacao}</div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={busyId === item.id || item.status === 'aprovado'} onClick={() => onAprovarItem(item)}>
          {busyId === item.id ? <Loader2 size={14} className="spinner" /> : <Check size={14} />}
          Aprovar
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busyId === item.id || item.status === 'reprovado'} onClick={() => onAbrirReprovar(item)}>
          <X size={14} />
          Reprovar
        </button>
      </div>
    </div>
  )
}

// =========================================================================
// 3. Comercial — campos informativos + Presença Digital (classificação própria)
// =========================================================================

function ComercialSecao({
  items,
  corbanData,
  busyId,
  onClassificar,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  busyId: string | null
  onClassificar: (item: CorbanOnboardingItem, classificacao: PresencaDigitalClassificacao, texto?: string) => void
}) {
  const commercial = corbanData?.commercial || {}
  const totalAprovados = items.filter((i) => i.status === 'aprovado').length

  return (
    <div className="card" style={{ padding: '1.1rem' }}>
      <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)', marginBottom: '0.85rem' }}>
        {CHECKLIST_PORTAL_STEP_LABELS.comercial}{' '}
        {items.length > 0 && (
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
            ({totalAprovados}/{items.length} classificados)
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: '0.25rem', marginBottom: '1rem' }}>
        <InfoRow label="Origem do Contato" value={commercial.origin} />
        <InfoRow label="Convênios e Produtos" value={Array.isArray(commercial.products) ? commercial.products.join(', ') : undefined} />
        <InfoRow label="Formato de Atendimento" value={Array.isArray(commercial.service_formats) ? commercial.service_formats.join(', ') : undefined} />
        <InfoRow label="Força de Vendas" value={commercial.sales_force} />
        <InfoRow label="Regiões de Atuação" value={Array.isArray(commercial.regions) ? commercial.regions.join(', ') : undefined} />
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
        Presença Digital — conferir cada canal informado (ausência também é informação)
      </div>
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {items.map((item) => (
          <PresencaDigitalCampo key={item.id} item={item} busyId={busyId} onClassificar={onClassificar} />
        ))}
      </div>
    </div>
  )
}

function PresencaDigitalCampo({
  item,
  busyId,
  onClassificar,
}: {
  item: CorbanOnboardingItem
  busyId: string | null
  onClassificar: (item: CorbanOnboardingItem, classificacao: PresencaDigitalClassificacao, texto?: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(String(item.valor?.texto ?? ''))
  const classificacaoAtual = item.valor?.classificacao as PresencaDigitalClassificacao | null

  const opcoes: PresencaDigitalClassificacao[] = ['verificado', 'nao_existe', 'fora_do_ar', 'inconsistente']

  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{item.rotulo}</div>
          {editando ? (
            <input
              className="form-control"
              style={{ marginTop: '0.2rem', fontSize: '0.82rem' }}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Não preenchido"
            />
          ) : (
            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: item.valor?.texto ? 'var(--brs-gray-900)' : 'var(--brs-gray-400)' }}>
              {item.valor?.texto || 'Não preenchido'}
            </div>
          )}
        </div>
        <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[item.status]}`}>{CORBAN_ONBOARDING_ITEM_STATUS_LABELS[item.status]}</span>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {opcoes.map((op) => (
          <button
            key={op}
            type="button"
            className="btn btn-sm"
            disabled={busyId === item.id}
            onClick={() => onClassificar(item, op, editando ? texto : undefined)}
            style={{
              background: classificacaoAtual === op ? (op === 'verificado' ? '#15803d' : '#b91c1c') : 'var(--brs-gray-100)',
              color: classificacaoAtual === op ? '#fff' : 'var(--brs-gray-600)',
              border: 'none',
            }}
          >
            {PRESENCA_DIGITAL_CLASSIFICACAO_LABELS[op]}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando((v) => !v)} disabled={busyId === item.id}>
          <Edit2 size={13} />
          {editando ? 'Cancelar edição' : 'Editar'}
        </button>
      </div>
    </div>
  )
}

// =========================================================================
// 4. Bancário
// =========================================================================

function BancarioSecao({
  items,
  corbanData,
  busyId,
  aprovando,
  onAprovarSecao,
  onAbrirEditar,
  onAbrirReprovar,
  onAvaliarPix,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  busyId: string | null
  aprovando: boolean
  onAprovarSecao: () => void
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
  onAvaliarPix: (item: CorbanOnboardingItem, respostas: { existe: boolean; pertenceCnpj: boolean; mesmaInstituicao: boolean }) => void
}) {
  const bank = corbanData?.bank || {}
  const pixItem = items.find((i) => isChavePixChave(i.chave))
  const camposItems = items.filter((i) => !isChavePixChave(i.chave))
  const itensContaveis = items.filter((i) => !itemDispensaAprovacao(i, corbanData))
  const camposContaveis = camposItems.filter((i) => !itemDispensaAprovacao(i, corbanData))

  return (
    <SecaoShell titulo={CHECKLIST_PORTAL_STEP_LABELS.bancario} allItems={itensContaveis} bulkApprovableItems={camposContaveis} aprovando={aprovando} onAprovarSecao={onAprovarSecao}>
      {(modoEdicao) => (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <InfoRow label="Periodicidade de Pagamento" value={bank.payment_period === 'diario' ? 'Pagamento Diário' : bank.payment_period === 'semanal' ? 'Pagamento Semanal' : bank.payment_period} />
            <InfoRow label="Ciência de NF / Regras Fiscais" value={corbanData?.compliance?.nf_choice === 'emitirei' ? 'Vai emitir Nota Fiscal' : corbanData?.compliance?.nf_choice === 'nao_emitirei' ? 'Não vai emitir Nota Fiscal' : undefined} />
          </div>

          <GradeCampos items={camposItems} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />

          {pixItem && <ChavePixCampo item={pixItem} busyId={busyId} onAvaliar={onAvaliarPix} />}
        </div>
      )}
    </SecaoShell>
  )
}

function ChavePixCampo({
  item,
  busyId,
  onAvaliar,
}: {
  item: CorbanOnboardingItem
  busyId: string | null
  onAvaliar: (item: CorbanOnboardingItem, respostas: { existe: boolean; pertenceCnpj: boolean; mesmaInstituicao: boolean }) => void
}) {
  const respostasAtuais = item.valor?.respostas as { existe: boolean; pertenceCnpj: boolean; mesmaInstituicao: boolean } | null
  const [existe, setExiste] = useState<boolean | null>(respostasAtuais?.existe ?? null)
  const [pertenceCnpj, setPertenceCnpj] = useState<boolean | null>(respostasAtuais?.pertenceCnpj ?? null)
  const [mesmaInstituicao, setMesmaInstituicao] = useState<boolean | null>(respostasAtuais?.mesmaInstituicao ?? null)

  const perguntas: Array<{ key: 'existe' | 'pertenceCnpj' | 'mesmaInstituicao'; label: string; value: boolean | null; set: (v: boolean) => void }> = [
    { key: 'existe', label: 'A chave existe no aplicativo do banco?', value: existe, set: setExiste },
    { key: 'pertenceCnpj', label: 'A chave pertence ao CNPJ cadastrado?', value: pertenceCnpj, set: setPertenceCnpj },
    { key: 'mesmaInstituicao', label: 'A chave é da mesma instituição financeira informada nos dados bancários?', value: mesmaInstituicao, set: setMesmaInstituicao },
  ]

  const podeConfirmar = existe !== null && pertenceCnpj !== null && mesmaInstituicao !== null

  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 8, padding: '0.8rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--brs-gray-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Chave PIX da Empresa</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{String(item.valor?.pix_key || '—')}</div>
        </div>
        <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[item.status]}`}>{CORBAN_ONBOARDING_ITEM_STATUS_LABELS[item.status]}</span>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-500)', marginBottom: '0.5rem' }}>
        Consulte a chave no aplicativo do banco antes de responder.
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {perguntas.map((p) => (
          <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--brs-gray-700)' }}>{p.label}</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className="btn btn-sm" onClick={() => p.set(true)} style={{ background: p.value === true ? '#15803d' : 'var(--brs-gray-100)', color: p.value === true ? '#fff' : 'var(--brs-gray-600)', border: 'none' }}>
                Sim
              </button>
              <button type="button" className="btn btn-sm" onClick={() => p.set(false)} style={{ background: p.value === false ? '#b91c1c' : 'var(--brs-gray-100)', color: p.value === false ? '#fff' : 'var(--brs-gray-600)', border: 'none' }}>
                Não
              </button>
            </div>
          </div>
        ))}
      </div>

      {item.status === 'reprovado' && item.motivo_reprovacao && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#b91c1c' }}>{item.motivo_reprovacao}</div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginTop: '0.6rem' }}
        disabled={!podeConfirmar || busyId === item.id}
        onClick={() => podeConfirmar && onAvaliar(item, { existe: existe!, pertenceCnpj: pertenceCnpj!, mesmaInstituicao: mesmaInstituicao! })}
      >
        {busyId === item.id ? <Loader2 size={14} className="spinner" /> : <Check size={14} />}
        Confirmar conferência
      </button>
    </div>
  )
}

// =========================================================================
// 5. Sociedade — sócios (PF/PJ) + administração + validação de capital
// =========================================================================

function SociedadeSecao({
  items,
  corbanData,
  busyId,
  aprovando,
  onAprovarSecao,
  onAbrirEditar,
  onAbrirReprovar,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  busyId: string | null
  aprovando: boolean
  onAprovarSecao: () => void
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
}) {
  const socios = getSocios(corbanData)
  const administracao = getAdministracao(corbanData)
  const capitalTotal = sumCapitalShare(corbanData)
  const capitalOk = Math.abs(capitalTotal - 100) <= 0.01

  if (socios.length === 0 && administracao.length === 0) return null

  const itensContaveis = items.filter((i) => !itemDispensaAprovacao(i, corbanData))

  return (
    <SecaoShell titulo={CHECKLIST_PORTAL_STEP_LABELS.sociedade} allItems={itensContaveis} bulkApprovableItems={itensContaveis} aprovando={aprovando} onAprovarSecao={onAprovarSecao}>
      {(modoEdicao) => (
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          {socios.length > 1 && (
            <div
              style={{
                padding: '0.6rem 0.9rem',
                borderRadius: 8,
                fontSize: '0.82rem',
                border: `1px solid ${capitalOk ? '#bcd9bc' : '#eed9b0'}`,
                background: capitalOk ? '#eef7ee' : '#fdf6ec',
                color: capitalOk ? '#2e7d32' : '#9a6b1a',
              }}
            >
              Capital distribuído: <strong>{capitalTotal}%</strong>
              {!capitalOk && ' — o quadro societário precisa totalizar 100%.'}
            </div>
          )}

          {socios.map((socio, index) => {
            const prefix = `socios.${index}`
            const socioItems = items.filter((i) => i.chave.startsWith(`${prefix}.`))
            const rotulo = index === 0 ? 'Sócio Principal' : `Sócio ${index + 1}`
            return (
              <div key={index}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--brs-navy)', marginBottom: '0.5rem' }}>
                  {rotulo} {socio.person_kind === 'PJ' ? '(Pessoa Jurídica)' : ''} {socio.name ? `— ${socio.name}` : ''}
                </div>
                <GradeCampos items={socioItems} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />
              </div>
            )
          })}

          {administracao.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
                Administração e Representação
              </div>
              {administracao.map((admin, index) => {
                const prefix = `administracao.${index}`
                const adminItems = items.filter((i) => i.chave.startsWith(`${prefix}.`))
                if (adminItems.length === 0) return null
                return (
                  <div key={index} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--brs-gray-700)', marginBottom: '0.4rem' }}>
                      {admin.name || `${admin.tipo} ${index + 1}`}
                    </div>
                    <GradeCampos items={adminItems} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </SecaoShell>
  )
}

// =========================================================================
// 6. Signatários
// =========================================================================

function SignatariosSecao({
  items,
  corbanData,
  busyId,
  aprovando,
  onAprovarSecao,
  onAbrirEditar,
  onAbrirReprovar,
}: {
  items: CorbanOnboardingItem[]
  corbanData: Record<string, any>
  busyId: string | null
  aprovando: boolean
  onAprovarSecao: () => void
  onAbrirEditar: (item: CorbanOnboardingItem) => void
  onAbrirReprovar: (item: CorbanOnboardingItem) => void
}) {
  const signatarios = getSignatarios(corbanData)
  const representante = signatarios.representante_cnpj?.[0] ? resolvePersonByCpf(corbanData, signatarios.representante_cnpj[0].cpf) : null
  const coobrigado1 = signatarios.coobrigado_solidario_1 ? resolvePersonByCpf(corbanData, signatarios.coobrigado_solidario_1.cpf) : null
  const coobrigado2Externo = signatarios.coobrigado_solidario_2?.fonte === 'pessoas'
  const coobrigado2 = signatarios.coobrigado_solidario_2 ? resolvePersonByCpf(corbanData, signatarios.coobrigado_solidario_2.cpf) : null

  const coobrigado2Items = coobrigado2Externo ? items.filter((i) => i.chave.startsWith('pessoas.')) : []
  const testemunhaItems = items.filter((i) => i.chave.startsWith('witness.'))
  const itensContaveis = items.filter((i) => !itemDispensaAprovacao(i, corbanData))

  return (
    <SecaoShell titulo={CHECKLIST_PORTAL_STEP_LABELS.signatarios} allItems={itensContaveis} bulkApprovableItems={itensContaveis} aprovando={aprovando} onAprovarSecao={onAprovarSecao}>
      {(modoEdicao) => (
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <InfoRow label="Representante da Empresa" value={representante ? `${representante.name} (já validado como ${representante.fonte === 'socio' ? 'sócio' : 'administração'} acima)` : '—'} />
            <InfoRow label="Coobrigado Solidário 1" value={coobrigado1 ? `${coobrigado1.name} (já validado acima)` : '—'} />
            {!coobrigado2Externo && (
              <InfoRow label="Coobrigado Solidário 2" value={coobrigado2 ? `${coobrigado2.name} (já validado acima)` : '—'} />
            )}
            <InfoRow label="Testemunha da BRS" value="Definida automaticamente na geração do contrato (Agente Corban)." />
          </div>

          {coobrigado2Externo && coobrigado2Items.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
                Coobrigado Solidário 2 (pessoa nova, fora da estrutura societária) {coobrigado2?.name ? `— ${coobrigado2.name}` : ''}
              </div>
              <GradeCampos items={coobrigado2Items} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />
            </div>
          )}

          {testemunhaItems.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
                Testemunha do Parceiro
              </div>
              <GradeCampos items={testemunhaItems} corbanData={corbanData} modoEdicao={modoEdicao} busyId={busyId} onAbrirEditar={onAbrirEditar} onAbrirReprovar={onAbrirReprovar} />
            </div>
          )}
        </div>
      )}
    </SecaoShell>
  )
}

// =========================================================================
// Etapa `analise` — upload/aprovação de documentos de análise (Serasa/CNPJ)
// =========================================================================

function AnaliseDocSection({
  processoId,
  spec,
  docs,
  onChanged,
}: {
  processoId: string
  spec: { tipoDocumento: 'serasa' | 'cartao_cnpj'; alvoTipo: 'cpf' | 'cnpj'; alvoValor: string } | null
  docs: DocAnaliseComUrl[]
  onChanged: () => Promise<void> | void
}) {
  const [uploading, setUploading] = useState(false)
  const [busyDocId, setBusyDocId] = useState<string | null>(null)

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !spec) return
    setUploading(true)
    const formData = new FormData()
    formData.set('file', file)
    formData.set('alvo_tipo', spec.alvoTipo)
    formData.set('alvo_valor', spec.alvoValor)
    formData.set('tipo_documento', spec.tipoDocumento)
    await uploadDocAnalise(processoId, formData)
    setUploading(false)
    await onChanged()
  }

  async function handleAvaliar(doc: DocAnaliseComUrl, status: 'aprovado' | 'reprovado') {
    setBusyDocId(doc.id)
    await avaliarDocAnalise(doc.id, { status })
    setBusyDocId(null)
    await onChanged()
  }

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {docs.map((doc) => (
        <div key={doc.id} style={{ border: '1px dashed var(--brs-gray-200)', borderRadius: 8, padding: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-700)' }}>{doc.file_name}</span>
            <span className={`badge ${CORBAN_ONBOARDING_ITEM_STATUS_BADGE[doc.status as keyof typeof CORBAN_ONBOARDING_ITEM_STATUS_BADGE] || 'badge-gray'}`}>
              {doc.status}
            </span>
          </div>
          {doc.signedUrl && <DocumentViewer files={[{ fileName: doc.file_name, url: doc.signedUrl }]} />}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={busyDocId === doc.id || doc.status === 'aprovado'} onClick={() => handleAvaliar(doc, 'aprovado')}>
              {busyDocId === doc.id ? <Loader2 size={14} className="spinner" /> : <Check size={14} />}
              Aprovar
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busyDocId === doc.id || doc.status === 'reprovado'} onClick={() => handleAvaliar(doc, 'reprovado')}>
              <X size={14} />
              Reprovar
            </button>
          </div>
        </div>
      ))}

      {spec && (
        <label className="btn btn-outline btn-sm" style={{ justifySelf: 'start', cursor: 'pointer' }}>
          {uploading ? <Loader2 size={15} className="spinner" /> : <UploadCloud size={15} />}
          Enviar documento
          <input type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
        </label>
      )}
    </div>
  )
}
