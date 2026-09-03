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

type Mensagem = { tipo: 'ok' | 'erro'; texto: string }

type Props = {
  etapa: string
  processo: Record<string, any>
  agente: Record<string, any>
  onRefresh: () => Promise<void>
  onMensagem: (m: Mensagem) => void
}

const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

function CampoCopiavel({ label, valor }: { label: string; valor: string }) {
  const [copiado, setCopiado] = useState(false)
  if (!valor) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px dashed var(--brs-gray-100)' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', color: 'var(--brs-gray-800)', wordBreak: 'break-word' }}>{valor}</span>
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
    </div>
  )
}

export default function EtapasFinaisPanel({ etapa, processo, agente, onRefresh, onMensagem }: Props) {
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
    return <EtapaArw processo={processo} agente={agente} corban={corban} busy={busy} rodar={rodar} />
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

function EtapaArw({
  processo,
  agente,
  corban,
  busy,
  rodar,
}: {
  processo: Record<string, any>
  agente: Record<string, any>
  corban: Record<string, any>
  busy: string | null
  rodar: (id: string, fn: () => Promise<{ success: boolean; error?: string; detalhe?: string }>) => Promise<void>
}) {
  const [arwCode, setArwCode] = useState(String(agente.arw_code || ''))
  const socio = corban?.socios?.[0] || {}
  const empresa = corban?.empresa || {}
  const banco = corban?.bank || corban?.bancario || {}

  const camposCopia: Array<[string, string]> = [
    ['Razão Social', String(empresa.razao_social || agente.name || '')],
    ['Nome Fantasia', String(empresa.nome_fantasia || '')],
    ['CNPJ/CPF', String(agente.cpf_cnpj || '')],
    ['Sócio principal', String(socio.nome || '')],
    ['CPF do sócio', String(socio.cpf || '')],
    ['E-mail', String(socio.email || corban?.contacts?.email_comissao || '')],
    ['WhatsApp', String(corban?.contacts?.phone_whatsapp || corban?.commercial?.whatsapp_atendimento || '')],
    ['CEP', String(empresa.cep || '')],
    ['Endereço', [empresa.logradouro, empresa.numero, empresa.complemento].filter(Boolean).join(', ')],
    ['Bairro / Cidade / UF', [empresa.bairro, empresa.cidade, empresa.uf].filter(Boolean).join(' / ')],
    ['Banco', String(banco.bank_name || banco.banco || '')],
    ['Agência / Conta', [banco.agency || banco.agencia, banco.account || banco.conta].filter(Boolean).join(' / ')],
    ['Chave PIX', String(banco.pix_key || banco.chave_pix || '')],
  ]

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
        Cadastre o parceiro no ARW copiando os campos abaixo (na ordem do cadastro do ARW). Depois, registre o retorno —
        o código ARW grava direto na aba Acesso do Agente Corban. A senha do ARW é colada no editor do agente
        (aba Acesso), que já sincroniza o login do portal.
      </p>
      <div className="card" style={{ padding: '0.9rem' }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--brs-gray-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Dados para o ARW (copiar/colar)
        </div>
        {camposCopia.map(([label, valor]) => (
          <CampoCopiavel key={label} label={label} valor={valor} />
        ))}
      </div>
      <div className="card" style={{ padding: '0.9rem' }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem', marginBottom: '0.6rem', color: 'var(--brs-gray-600)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Retorno do ARW
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={rotulo}>Código ARW *</label>
            <input className="form-control" style={{ width: 160 }} value={arwCode} onChange={(e) => setArwCode(e.target.value)} placeholder="ex.: DF3-4" />
          </div>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => rodar('salvar-arw', () => salvarRetornoArw(processo.id, { arw_code: arwCode }))}>
            {busy === 'salvar-arw' ? <Loader2 size={14} className="spinner" /> : <Check size={14} />} Salvar código
          </button>
          <a className="btn btn-ghost btn-sm" href={`/agente-corban/${agente.id}`} target="_blank" rel="noreferrer">
            Abrir editor do agente (aba Acesso: senha, gerente, tipo) →
          </a>
        </div>
      </div>
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || !arwCode.trim()} onClick={() => rodar('concluir', () => concluirEtapaArw(processo.id))}>
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
