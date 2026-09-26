'use client'

/**
 * Etapas finais do processo de onboarding (fases C–D): Nuvidio · ARW ·
 * Contrato · Termo · Boas-vindas · Concluído. Renderizado pelo
 * ProcessoOnboardingClient quando a etapa selecionada não é
 * validação/análise. UI densa no padrão do resto do sistema.
 */
import { useRef, useState } from 'react'
import { Check, Copy, Loader2, Mail, MessageSquare, Send, Upload, Video } from 'lucide-react'
import {
  aprovarBoasVindas,
  aprovarLimiteOperacional,
  gerarConviteNuvidioOnboarding,
  concluirEtapaArw,
  concluirEtapaContrato,
  concluirEtapaNuvidio,
  concluirEtapaTermo,
  enviarConviteNuvidio,
  marcarDocumentoAssinado,
  prepararEnviarContrato,
  prepararEnviarTermo,
  salvarNuvidioLink,
  salvarRetornoArw,
  uploadPdfAssinado,
} from '../etapas-actions'
import { uploadDocAnalise } from '../actions'
import type { RetornoArw } from '../etapas-actions'
import { formatCpfOrCnpjDisplay, formatDateDisplay } from '@/lib/agente-corban'
import { getAdministracao, getSociosPF } from '@/lib/agente-corban-signatarios'
import { LIMITE_OPERACIONAL_PADRAO, type CatalogosArw } from '@/lib/agente-corban-onboarding'
import { maskPhone } from '@/lib/company-bank-accounts'
import { nomeComercial, opcoesComerciais, type ComercialCargo, type ComercialResumo } from '@/lib/comerciais-hierarquia'

type Mensagem = { tipo: 'ok' | 'erro'; texto: string }

type Props = {
  etapa: string
  processo: Record<string, any>
  agente: Record<string, any>
  comerciais: ComercialResumo[]
  catalogos: CatalogosArw
  onRefresh: () => Promise<void>
  onMensagem: (m: Mensagem) => void
}

const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

function CampoCopiavel({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  const [copiado, setCopiado] = useState(false)
  const vazio = !String(valor || '').trim()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px dashed var(--brs-gray-100)' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>{label}</span>
      {vazio ? (
        <span style={{ fontSize: '0.76rem', color: 'var(--brs-gray-400)', fontStyle: 'italic' }}>não coletado no portal</span>
      ) : (
        <span style={{ fontSize: '0.82rem', color: 'var(--brs-gray-800)', wordBreak: 'break-word' }}>
          {valor}
          {nota ? <span style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', marginLeft: 6 }}>({nota})</span> : null}
        </span>
      )}
      {vazio ? (
        <span />
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          title="Copiar"
          onClick={() => {
            navigator.clipboard.writeText(valor)
            setCopiado(true)
            window.setTimeout(() => setCopiado(false), 1200)
          }}
        >
          {copiado ? <Check size={14} style={{ color: 'var(--brs-success)' }} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  )
}

export default function EtapasFinaisPanel({ etapa, processo, agente, comerciais, catalogos, onRefresh, onMensagem }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const corban: Record<string, any> = agente.corban_data || {}

  async function rodar(id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) {
    if (busy) return
    setBusy(id)
    try {
      const res = await fn()
      if (!res.success) onMensagem({ tipo: 'erro', texto: res.error || 'Falhou.' })
      else onMensagem({ tipo: 'ok', texto: (res as { detalhe?: string }).detalhe || 'Feito.' })
      await onRefresh()
    } finally {
      setBusy(null)
    }
  }

  // ------------------------------------------------------------------ NUVIDIO
  if (etapa === 'nuvidio') {
    return <EtapaNuvidio processo={processo} busy={busy} rodar={rodar} onRefresh={onRefresh} onMensagem={onMensagem} />
  }

  // ---------------------------------------------------------------------- ARW
  if (etapa === 'arw') {
    return <EtapaArw processo={processo} agente={agente} corban={corban} comerciais={comerciais} catalogos={catalogos} busy={busy} rodar={rodar} />
  }

  // ---------------------------------------------------------------- LIMITE
  if (etapa === 'limite') {
    return <EtapaLimite processo={processo} busy={busy} rodar={rodar} />
  }

  // ------------------------------------------------------------ CONTRATO/TERMO
  if (etapa === 'contrato' || etapa === 'termo') {
    const ehContrato = etapa === 'contrato'
    const statusAtual = ehContrato ? processo.contrato_status : processo.termo_status
    const docId = ehContrato ? processo.contrato_assinafy_document_id : processo.termo_assinafy_document_id
    return (
      <div style={{ display: 'grid', gap: '0.9rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
          {ehContrato
            ? 'Gera o contrato na Assinafy a partir do cadastro e envia os links de assinatura por e-mail e WhatsApp.'
            : 'O termo de usuário é disparado depois do contrato assinado (template próprio na Assinafy).'}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>
            Status:{' '}
            <span style={{ color: statusAtual === 'assinado' ? 'var(--brs-success)' : statusAtual ? '#d97706' : 'var(--brs-gray-400)' }}>
              {statusAtual || 'não preparado'}
            </span>
          </span>
          {docId && <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>doc Assinafy: {docId}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {!statusAtual || statusAtual === 'preparado' || statusAtual === 'pendente_contrato' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() =>
                rodar('enviar', () => (ehContrato ? prepararEnviarContrato(processo.id) : prepararEnviarTermo(processo.id)))
              }
            >
              {busy === 'enviar' ? <Loader2 size={14} className="spinner" /> : <Send size={14} />} Preparar e enviar {ehContrato ? 'contrato' : 'termo'}
            </button>
          ) : null}
          {statusAtual === 'enviado' && (
            <>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy !== null}
                onClick={() => rodar('reenviar', () => (ehContrato ? prepararEnviarContrato(processo.id) : prepararEnviarTermo(processo.id)))}
              >
                <Send size={14} /> Reenviar
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy !== null}
                title="Use se a assinatura foi confirmada fora do webhook"
                onClick={() => rodar('manual', () => marcarDocumentoAssinado(processo.id, ehContrato ? 'contrato' : 'termo'))}
              >
                <Check size={14} /> Marcar como assinado
              </button>
            </>
          )}
          {statusAtual === 'assinado' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => rodar('concluir', () => (ehContrato ? concluirEtapaContrato(processo.id) : concluirEtapaTermo(processo.id)))}
            >
              {busy === 'concluir' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Concluir etapa
            </button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
          A assinatura chega sozinha pelo webhook da Assinafy; o botão manual é o plano B.
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------- BOAS-VINDAS
  if (etapa === 'boas_vindas') {
    return <EtapaBoasVindas processo={processo} busy={busy} rodar={rodar} onMensagem={onMensagem} onRefresh={onRefresh} />
  }

  // ------------------------------------------------------------------ CONCLUÍDO
  if (etapa === 'concluido') {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--brs-gray-600)' }}>
        <div style={{ fontSize: '2rem' }}>🎉</div>
        <p style={{ fontWeight: 800, fontSize: '1rem', margin: '0.4rem 0' }}>Processo concluído!</p>
        <p style={{ fontSize: '0.82rem', color: 'var(--brs-gray-400)', margin: 0 }}>
          Boas-vindas enviadas. O parceiro segue a vida normal no cadastro do Agente Corban.
        </p>
      </div>
    )
  }

  return null
}

// ===========================================================================

function EtapaNuvidio({
  processo,
  busy,
  rodar,
  onRefresh,
  onMensagem,
}: {
  processo: Record<string, any>
  busy: string | null
  rodar: (id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) => Promise<void>
  onRefresh: () => Promise<void>
  onMensagem: (m: Mensagem) => void
}) {
  const [link, setLink] = useState(String(processo.nuvidio_link || ''))
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [subindo, setSubindo] = useState(false)

  async function subirVideo(files: FileList | null) {
    if (!files || !files[0] || subindo) return
    setSubindo(true)
    try {
      const fd = new FormData()
      fd.append('file', files[0])
      fd.append('alvo_tipo', 'processo')
      fd.append('alvo_valor', '')
      fd.append('tipo_documento', 'video_nuvidio')
      const res = await uploadDocAnalise(processo.id, fd)
      if (!res.success) onMensagem({ tipo: 'erro', texto: res.error })
      else onMensagem({ tipo: 'ok', texto: 'Vídeo salvo!' })
      await onRefresh()
    } finally {
      setSubindo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.9rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
        Validação por vídeo (manual, v1): cole o link da sala Nuvidio, envie o convite ao parceiro e, depois da
        chamada, suba o vídeo — ele conclui a etapa.
      </p>
      <div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy !== null}
          onClick={() => rodar('gerar', () => gerarConviteNuvidioOnboarding(processo.id))}
        >
          {busy === 'gerar' ? <Loader2 size={14} className="spinner" /> : <Video size={14} />} Gerar convite na Nuvidio
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', marginLeft: 8 }}>
          Cria o link via API com os dados do sócio (acompanhamento em Cadastros Recebidos › Nuvidio — Acompanhamento).
        </span>
      </div>
      <div>
        <label style={rotulo}>Link da sala Nuvidio (gerado ou colado manualmente)</label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input className="form-control" style={{ flex: 1, minWidth: 260 }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://atendimento.nuvidio.com/…" />
          <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => rodar('salvar-link', () => salvarNuvidioLink(processo.id, link))}>
            {busy === 'salvar-link' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Salvar
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null || !processo.nuvidio_link} onClick={() => rodar('email', () => enviarConviteNuvidio(processo.id, 'email'))}>
          <Mail size={14} /> Enviar por e-mail
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null || !processo.nuvidio_link} onClick={() => rodar('whats', () => enviarConviteNuvidio(processo.id, 'whatsapp'))}>
          <MessageSquare size={14} /> Enviar por WhatsApp
        </button>
      </div>
      <div>
        <label style={rotulo}>Vídeo da validação {processo.nuvidio_video_url ? '· salvo ✓' : ''}</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => subirVideo(e.target.files)} />
          <button type="button" className="btn btn-outline btn-sm" disabled={subindo} onClick={() => fileRef.current?.click()}>
            {subindo ? <Loader2 size={14} className="spinner" /> : <Video size={14} />} {processo.nuvidio_video_url ? 'Substituir vídeo' : 'Subir vídeo'}
          </button>
          {processo.nuvidio_video_url && <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>{String(processo.nuvidio_video_url).split('/').pop()}</span>}
        </div>
      </div>
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || !processo.nuvidio_video_url} onClick={() => rodar('concluir', () => concluirEtapaNuvidio(processo.id))}>
          {busy === 'concluir' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Concluir etapa
        </button>
      </div>
    </div>
  )
}

// ===========================================================================

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function EtapaLimite({
  processo,
  busy,
  rodar,
}: {
  processo: Record<string, any>
  busy: string | null
  rodar: (id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) => Promise<void>
}) {
  const [valor, setValor] = useState<number>(Number(processo.limite_operacional) || LIMITE_OPERACIONAL_PADRAO)
  const [justificativa, setJustificativa] = useState(String(processo.limite_justificativa || ''))
  const diferente = valor !== LIMITE_OPERACIONAL_PADRAO
  const podeAprovar = valor > 0 && (!diferente || justificativa.trim().length >= 10)
  return (
    <div style={{ display: 'grid', gap: '0.9rem', maxWidth: 640 }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
        Limite operacional que vai no contrato. O padrão é {brl.format(LIMITE_OPERACIONAL_PADRAO)}; valor diferente exige justificativa. Aumento
        depois do credenciamento é por aditivo, em processo próprio.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={rotulo}>Limite operacional (R$) *</label>
          <input
            className="form-control"
            type="number"
            min={1}
            step={1000}
            style={{ width: 220 }}
            value={valor}
            onChange={(e) => setValor(Number(e.target.value))}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', marginTop: 2 }}>{brl.format(valor || 0)}</div>
        </div>
        {diferente && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValor(LIMITE_OPERACIONAL_PADRAO)}>
            Voltar ao padrão
          </button>
        )}
      </div>
      {diferente && (
        <div>
          <label style={rotulo}>Justificativa * (fica no histórico)</label>
          <textarea className="form-control" rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: parceiro com carteira já ativa em outra promotora, aprovado pelo comercial em dd/mm." />
        </div>
      )}
      <div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy !== null || !podeAprovar}
          onClick={() => rodar('limite', () => aprovarLimiteOperacional(processo.id, { valor, justificativa }))}
        >
          {busy === 'limite' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Aprovar limite e seguir para o Contrato
        </button>
      </div>
    </div>
  )
}

// ===========================================================================

function EtapaArw({
  processo,
  agente,
  corban,
  comerciais,
  catalogos,
  busy,
  rodar,
}: {
  processo: Record<string, any>
  agente: Record<string, any>
  corban: Record<string, any>
  comerciais: ComercialResumo[]
  catalogos: CatalogosArw
  busy: string | null
  rodar: (id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) => Promise<void>
}) {
  // Espelho na ORDEM do cadastro do ARW (telas do Bruno, 25/09/2026):
  // Dados Pessoais → Contato → Sócios → Endereço → Bancários → Acesso.
  // Chaves do cadastro: master.* / contacts.* / socios.N.* / address.* / bank.*
  // (dicionário em src/lib/agente-corban-fields.ts). O que o portal não coleta
  // aparece como "não coletado no portal"; e-mail/telefone vazio repete o de
  // comissão/WhatsApp com a nota, porque o ARW exige todos preenchidos.
  const master: Record<string, any> = corban?.master || {}
  const contatos: Record<string, any> = corban?.contacts || {}
  const end: Record<string, any> = corban?.address || {}
  const banco: Record<string, any> = corban?.bank || {}
  const isPJ = (master.person_type || agente.person_type) === 'PJ'
  const socios = getSociosPF(corban)
  const principal = socios.find((s) => s.is_principal) || socios[0] || {}
  const representante = master.representante_legal || getAdministracao(corban)[0]?.name || principal.name || ''

  const doc = (v: unknown) => (v ? formatCpfOrCnpjDisplay(String(v)) : '')
  const data = (v: unknown) => (v ? formatDateDisplay(String(v)) : '')
  const emailComissao = String(contatos.email_comissao || '')
  const whatsapp = String(contatos.phone_whatsapp || '')
  const email = (v: unknown) => (v ? { valor: String(v) } : emailComissao ? { valor: emailComissao, nota: 'repete o e-mail de comissão' } : { valor: '' })
  const fone = (v: unknown) => (v ? { valor: maskPhone(String(v)) } : whatsapp ? { valor: maskPhone(whatsapp), nota: 'repete o WhatsApp' } : { valor: '' })

  const secoes: Array<{ titulo: string; campos: Array<{ label: string; valor: string; nota?: string }> }> = [
    {
      titulo: 'Dados Pessoais',
      campos: [
        { label: 'Tipo de Pessoa', valor: isPJ ? 'PESSOA JURÍDICA' : 'PESSOA FÍSICA' },
        { label: isPJ ? 'CNPJ' : 'CPF', valor: doc(agente.cpf_cnpj || master.cpf_cnpj) },
        { label: 'Nome', valor: String(master.name || agente.name || '') },
        ...(isPJ
          ? [
              { label: 'Razão Social', valor: String(master.name || agente.name || '') },
              { label: 'Nome Fantasia', valor: String(master.fantasy_name || master.name || agente.name || '') },
              { label: 'Representante Legal', valor: String(representante) },
            ]
          : []),
        { label: 'RG', valor: isPJ ? '' : String(master.rg || '') },
        { label: 'Data Emissão RG', valor: isPJ ? '' : data(master.rg_expedition_date) },
        { label: 'Órgão Emissão RG', valor: isPJ ? '' : String(master.rg_issuer || '') },
        { label: 'Estado Emissão RG', valor: isPJ ? '' : String(master.rg_state || '') },
        { label: 'Data Nascimento', valor: data(isPJ ? principal.birth_date : master.birth_date) },
      ],
    },
    {
      titulo: 'Dados de Contato',
      campos: [
        { label: 'Telefone Celular (WhatsApp)', ...fone(contatos.phone_whatsapp) },
        { label: 'WhatsApp Financeiro', ...fone(contatos.phone_whatsapp_financeiro) },
        { label: 'Telefone Comercial', ...fone(contatos.phone_commercial) },
        { label: 'Telefone Residencial', ...fone(contatos.phone_residential) },
        { label: 'Telefone Suporte', ...fone(contatos.phone_support) },
        { label: 'E-mail de Comissão', valor: emailComissao },
        { label: 'E-mail de Informe', ...email(contatos.email_informe) },
        { label: 'E-mail de Formalização', ...email(contatos.email_formalizacao) },
        { label: 'E-mail de Proposta', ...email(contatos.email_proposta) },
        { label: 'E-mail Mesa de Liberação', ...email(contatos.email_mesa_liberacao) },
        { label: 'E-mail Jurídico', ...email(contatos.email_juridico) },
        { label: 'E-mail Próprio Cunho', ...email(contatos.email_proprio_cunho) },
      ],
    },
    ...socios.map((s, i) => ({
      titulo: `Dados dos Sócios — Sócio ${i + 1}${s.is_principal ? ' (principal)' : ''}`,
      campos: [
        { label: 'CPF', valor: doc(s.cpf) },
        { label: 'Nome', valor: String(s.name || '') },
        { label: 'RG', valor: '' },
        {
          label: 'Endereço',
          valor: [
            s.residential_address_street,
            s.residential_address_number,
            s.residential_address_complement,
            s.residential_address_neighborhood,
            s.residential_address_city,
            s.residential_address_state,
            s.residential_cep,
          ]
            .filter(Boolean)
            .join(', '),
        },
      ],
    })),
    {
      titulo: 'Dados de Endereço',
      campos: [
        { label: 'CEP', valor: String(end.cep || '') },
        { label: 'Cidade', valor: String(end.address_city || '') },
        { label: 'Bairro', valor: String(end.address_neighborhood || '') },
        { label: 'Rua', valor: String(end.address_street || '') },
        { label: 'Estado', valor: String(end.address_state || '') },
        { label: 'Número', valor: String(end.address_number || '') },
        { label: 'Complemento', valor: String(end.address_complement || '') },
      ],
    },
    {
      titulo: 'Dados Bancários - Recebimento de Comissão',
      campos: [
        { label: 'Tipo de Recebimento', valor: String(banco.commission_receive_type || '') },
        { label: 'Banco', valor: [banco.bank_code, banco.bank_name].filter(Boolean).join(' - ') },
        { label: 'Agência', valor: String(banco.bank_agency || '') },
        { label: 'Conta', valor: String(banco.bank_account || '') },
        { label: 'Tipo de Conta', valor: String(banco.bank_account_type || '') },
        { label: 'Tipo de Chave PIX', valor: String(banco.pix_type || '') },
        { label: 'Chave PIX', valor: String(banco.pix_key || '') },
      ],
    },
  ]

  // Retorno do ARW: mesmos campos da aba Acesso do editor (senha continua lá).
  const [ret, setRet] = useState<{ [K in keyof RetornoArw]-?: string }>({
    arw_code: String(agente.arw_code || ''),
    filial: String(agente.filial || ''),
    nivel_acesso: String(agente.nivel_acesso || ''),
    tipo_agente: String(agente.tipo_agente || ''),
    superintendente_id: String(agente.superintendente_id || ''),
    supervisor_id: String(agente.supervisor_id || ''),
    gerente_id: String(agente.gerente_id || ''),
  })
  const patch = (p: Partial<typeof ret>) => setRet((c) => ({ ...c, ...p }))
  const catalogo = (rows: CatalogosArw['niveis_acesso'], atual: string) =>
    rows.filter((r) => r.is_active !== false || r.id === atual)
  const comercial = (campo: ComercialCargo, atual: string) => opcoesComerciais(comerciais, campo, atual || null)

  const selectStyle: React.CSSProperties = { minWidth: 220 }
  const campo = (label: string, children: React.ReactNode) => (
    <div>
      <label style={rotulo}>{label}</label>
      {children}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
        Cadastre o parceiro no ARW copiando os campos abaixo, na mesma ordem das telas do ARW. Depois registre o
        retorno: código e dados de acesso gravam direto na aba Acesso do Agente Corban. A senha do ARW é colada no
        editor do agente (aba Acesso), que já sincroniza o login do portal.
      </p>

      {secoes.map((secao) => (
        <div key={secao.titulo} className="card" style={{ padding: '0.9rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--brs-gray-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {secao.titulo}
          </div>
          {secao.campos.map((c) => (
            <CampoCopiavel key={`${secao.titulo}:${c.label}`} label={c.label} valor={c.valor} nota={c.nota} />
          ))}
        </div>
      ))}

      <div className="card" style={{ padding: '0.9rem' }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: '0.6rem', color: 'var(--brs-gray-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Retorno do ARW — Dados de Acesso
        </div>
        <div style={{ display: 'flex', gap: '0.6rem 1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {campo('Código ARW *', <input className="form-control" style={{ width: 160 }} value={ret.arw_code} onChange={(e) => patch({ arw_code: e.target.value })} placeholder="ex.: DF3-4" />)}
          {campo('Filial', <input className="form-control" style={{ width: 180 }} value={ret.filial} onChange={(e) => patch({ filial: e.target.value })} placeholder="ex.: MATRIZ" />)}
          {campo(
            'Nível de Acesso',
            <select className="form-control" style={selectStyle} value={ret.nivel_acesso} onChange={(e) => patch({ nivel_acesso: e.target.value })}>
              <option value="">Selecione</option>
              {catalogo(catalogos.niveis_acesso, ret.nivel_acesso).map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_active === false ? ' (Inativo)' : ''}</option>
              ))}
            </select>,
          )}
          {campo(
            'Tipo de Agente',
            <select className="form-control" style={selectStyle} value={ret.tipo_agente} onChange={(e) => patch({ tipo_agente: e.target.value })}>
              <option value="">Selecione</option>
              {catalogo(catalogos.tipos_agente, ret.tipo_agente).map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.is_active === false ? ' (Inativo)' : ''}</option>
              ))}
            </select>,
          )}
          {(
            [
              ['gerente_id', 'gerente', 'Gerente Comercial'],
              ['superintendente_id', 'superintendente', 'Superintendente'],
              ['supervisor_id', 'supervisor', 'Supervisor'],
            ] as Array<['gerente_id' | 'superintendente_id' | 'supervisor_id', ComercialCargo, string]>
          ).map(([key, cargo, label]) =>
            campo(
              label,
              <select className="form-control" style={selectStyle} value={ret[key]} onChange={(e) => patch({ [key]: e.target.value })}>
                <option value="">Selecione</option>
                {comercial(cargo, ret[key]).map((c) => (
                  <option key={c.id} value={c.id}>{nomeComercial(c)}</option>
                ))}
              </select>,
            ),
          )}
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--brs-gray-400)' }}>
          Superintendente, Supervisor e Gerente listam comerciais ativos com cargo igual ou superior ao do campo.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy !== null}
            onClick={() =>
              rodar('salvar-arw', () =>
                salvarRetornoArw(processo.id, {
                  ...ret,
                  superintendente_id: ret.superintendente_id || null,
                  supervisor_id: ret.supervisor_id || null,
                  gerente_id: ret.gerente_id || null,
                }),
              )
            }
          >
            {busy === 'salvar-arw' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Salvar retorno
          </button>
          <a className="btn btn-ghost btn-sm" href={`/agente-corban/${agente.id}`} target="_blank" rel="noreferrer">
            Abrir editor do agente (aba Acesso: senha) →
          </a>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy !== null || !String(agente.arw_code || '').trim()}
          title={!String(agente.arw_code || '').trim() ? 'Salve o código ARW antes de concluir' : undefined}
          onClick={() => rodar('concluir', () => concluirEtapaArw(processo.id))}
        >
          {busy === 'concluir' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Concluir etapa
        </button>
      </div>
    </div>
  )
}

// ===========================================================================

function EtapaBoasVindas({
  processo,
  busy,
  rodar,
  onMensagem,
  onRefresh,
}: {
  processo: Record<string, any>
  busy: string | null
  rodar: (id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) => Promise<void>
  onMensagem: (m: Mensagem) => void
  onRefresh: () => Promise<void>
}) {
  const contratoRef = useRef<HTMLInputElement | null>(null)
  const termoRef = useRef<HTMLInputElement | null>(null)
  const [subindo, setSubindo] = useState<string | null>(null)

  async function subirPdf(tipo: 'contrato' | 'termo', files: FileList | null) {
    if (!files || !files[0] || subindo) return
    setSubindo(tipo)
    try {
      const fd = new FormData()
      fd.append('file', files[0])
      const res = await uploadPdfAssinado(processo.id, tipo, fd)
      if (!res.success) onMensagem({ tipo: 'erro', texto: res.error })
      else onMensagem({ tipo: 'ok', texto: `PDF do ${tipo} salvo.` })
      await onRefresh()
    } finally {
      setSubindo(null)
    }
  }

  const item = (label: string, ok: boolean, extra?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
      <span style={{ color: ok ? 'var(--brs-success)' : '#d97706', fontWeight: 800 }}>{ok ? '✓' : '•'}</span>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {extra && <span style={{ color: 'var(--brs-gray-400)', fontSize: '0.72rem' }}>{extra}</span>}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: '0.9rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
        Validação final: confira assinaturas e vídeo, anexe os PDFs assinados e aprove — o parceiro recebe as
        boas-vindas por e-mail e WhatsApp e o processo é concluído.
      </p>
      <div className="card" style={{ padding: '0.9rem', display: 'grid', gap: '0.5rem' }}>
        {item('Contrato assinado', processo.contrato_status === 'assinado')}
        {item('Termo assinado', processo.termo_status === 'assinado')}
        {item('Vídeo Nuvidio salvo', Boolean(processo.nuvidio_video_url))}
        {item('PDF do contrato anexado', Boolean(processo.contrato_pdf_assinado_url), String(processo.contrato_pdf_assinado_url || '').split('/').pop())}
        {item('PDF do termo anexado', Boolean(processo.termo_pdf_assinado_url), String(processo.termo_pdf_assinado_url || '').split('/').pop())}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input ref={contratoRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => subirPdf('contrato', e.target.files)} />
        <input ref={termoRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => subirPdf('termo', e.target.files)} />
        <button type="button" className="btn btn-outline btn-sm" disabled={subindo !== null} onClick={() => contratoRef.current?.click()}>
          {subindo === 'contrato' ? <Loader2 size={14} className="spinner" /> : <Upload size={14} />} PDF do contrato assinado
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={subindo !== null} onClick={() => termoRef.current?.click()}>
          {subindo === 'termo' ? <Loader2 size={14} className="spinner" /> : <Upload size={14} />} PDF do termo assinado
        </button>
      </div>
      <div>
        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => rodar('aprovar', () => aprovarBoasVindas(processo.id))}>
          {busy === 'aprovar' ? <Loader2 size={16} className="spinner" /> : <Check size={16} />} Aprovar e enviar boas-vindas 🎉
        </button>
      </div>
    </div>
  )
}
