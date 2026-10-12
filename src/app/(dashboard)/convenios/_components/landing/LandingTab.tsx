'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  getConvenioConteudoSite,
  listarFaqBase,
  marcarConvenioConteudoSiteRevisado,
  publishConvenioConteudoSite,
  salvarSlugPublicoConvenio,
  saveConvenioConteudoSiteDraft,
  unpublishConvenioConteudoSite,
  type ConvenioConteudoSiteInfo,
  type ConvenioConteudoSiteRecord,
  type FaqBaseItem,
} from '../../site-actions'
import { getDadosLanding } from '../../landing-actions'
import { gerarLinkPreview } from '@/app/(dashboard)/convenios/preview-actions'
import { FAQ_MAX } from '@/lib/convenios-publico/snapshot'
import { preencherLanding, type DadosConvenioLanding } from '@/lib/convenios-landing/preencher'
import {
  PUBLICOS_DESTAQUE_MAX,
  PUBLICO_DESTAQUE_TEXTO_MAX,
  PUBLICO_DESTAQUE_TITULO_MAX,
  type CtaTipoDestino,
  type EvidenciaItem,
  type FaqItem,
  type PublicoDestaque,
  type SecaoKey,
  type VantagemItem,
} from '@/lib/site-builder/conteudo-publico'
import FotoUpload from './FotoUpload'
import PreviewPainel from './PreviewPainel'

type Msg = { type: 'success' | 'error'; text: string } | null
type Acao = 'salvar' | 'revisar' | 'publicar' | 'retirar' | 'slug' | 'preview'

const VANTAGENS_MAX = 12
const FAQ_LANDING_MAX = 25
// Item novo entra no site sem passos extras: confirmado + regra bancária (ajustável em "Avançado" do item).
const EVIDENCIA_PADRAO: EvidenciaItem = { fonte: null, consultado_em: null, situacao: 'confirmado', natureza: 'regra_bancaria' }
const NOME_SECAO: Record<SecaoKey, string> = {
  hero: 'Topo',
  resumo: 'Sobre o convênio',
  vantagens: 'Vantagens',
  publicos: 'Públicos em destaque',
  faq: 'Perguntas frequentes',
  cta: 'Botão de WhatsApp',
  seo: 'SEO (metadados)',
}
const ESFERA: Record<string, string> = { municipal: 'Municipal', estadual: 'Estadual', federal: 'Federal', inss: 'INSS', outro: 'Outra' }
const pct = (n: number) => `${String(n).replace('.', ',')}%`

export default function LandingTab({ convenioId }: { convenioId: string; convenioNome?: string }) {
  const [dados, setDados] = useState<ConvenioConteudoSiteRecord | null>(null)
  const [info, setInfo] = useState<ConvenioConteudoSiteInfo | null>(null)
  const [carregando, setCarregando] = useState(true)
  // Edição local não salva: bloqueia revisar/publicar (eles valem para o que está no banco).
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<Acao | null>(null)
  const [message, setMessage] = useState<Msg>(null)
  const [slugInput, setSlugInput] = useState('')
  const [faqBase, setFaqBase] = useState<FaqBaseItem[] | null>(null)
  const [faqBaseErro, setFaqBaseErro] = useState<string | null>(null)
  const [conv, setConv] = useState<DadosConvenioLanding | null>(null)
  const [convErro, setConvErro] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; n: number } | null>(null)

  useEffect(() => {
    let vivo = true
    getConvenioConteudoSite(convenioId).then((res) => {
      if (!vivo) return
      if (res.success && res.item) {
        setDados(res.item)
        setInfo(res.info ?? null)
        setSlugInput(res.info?.slugPublico ?? '')
      } else setMessage({ type: 'error', text: res.error || 'Erro ao carregar a landing page.' })
      setCarregando(false)
    })
    listarFaqBase(convenioId).then((res) => {
      if (!vivo) return
      if (res.success) setFaqBase(res.items ?? [])
      else setFaqBaseErro(res.error || 'Erro ao carregar o FAQ da Base de Conhecimento.')
    })
    getDadosLanding(convenioId).then((res) => {
      if (!vivo) return
      if (res.success && res.dados) setConv(res.dados)
      else setConvErro(res.error || 'Erro ao carregar os dados do convênio.')
    })
    return () => {
      vivo = false
    }
  }, [convenioId])

  function editar(patch: Partial<ConvenioConteudoSiteRecord>) {
    setDados((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
  }

  async function rodar(acao: Acao, fn: () => Promise<void>) {
    setBusy(acao)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Erro inesperado.' })
    } finally {
      setBusy(null)
    }
  }

  // Link novo a cada abertura/salvamento: renova a validade e recarrega o iframe.
  async function carregarPreview() {
    const res = await gerarLinkPreview(convenioId)
    if (res.success) setPreview((p) => ({ url: res.data.url, n: (p?.n ?? 0) + 1 }))
    else setMessage({ type: 'error', text: res.error || 'Erro ao gerar o preview.' })
  }

  const salvar = () =>
    rodar('salvar', async () => {
      if (!dados) return
      const res = await saveConvenioConteudoSiteDraft(dados)
      if (!res.success || !res.item) {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o rascunho.' })
        return
      }
      setDados({ ...dados, ...res.item })
      setDirty(false)
      setInfo((prev) => (prev ? { ...prev, revisadoPorNome: null } : prev))
      setMessage({ type: 'success', text: 'Rascunho salvo. Confira no preview e marque como revisado para publicar.' })
      if (preview) await carregarPreview()
    })

  const verPreview = () =>
    rodar('preview', async () => {
      if (!dados?.id) {
        setMessage({ type: 'error', text: 'Salve o rascunho antes de ver o preview.' })
        return
      }
      await carregarPreview()
    })

  const revisar = () =>
    rodar('revisar', async () => {
      if (!dados?.id || !dados.updated_at) return
      const res = await marcarConvenioConteudoSiteRevisado(convenioId, dados.id, dados.updated_at)
      if (res.success && res.item) {
        setDados({ ...dados, ...res.item })
        setInfo((prev) => (prev ? { ...prev, revisadoPorNome: res.revisadoPorNome ?? null } : prev))
        setMessage({ type: 'success', text: 'Marcado como revisado. Já pode publicar.' })
      } else setMessage({ type: 'error', text: res.error || 'Erro ao marcar como revisado.' })
    })

  const publicar = () =>
    rodar('publicar', async () => {
      if (!dados?.id || !dados.updated_at) return
      const res = await publishConvenioConteudoSite(convenioId, dados.id, dados.updated_at)
      if (res.success && res.item) {
        const item = res.item
        setDados({ ...dados, ...item })
        setInfo((prev) =>
          prev ? { ...prev, publicado: { versao: item.versao, publicadoEm: item.published_at ?? null, publicadoPorNome: res.publicadoPorNome ?? null } } : prev,
        )
        setMessage({ type: 'success', text: `Landing page publicada (versão ${item.versao}).` })
      } else setMessage({ type: 'error', text: res.error || 'Erro ao publicar.' })
    })

  const retirar = () => {
    if (!confirm('Retirar esta landing page do ar? Para republicar, será preciso salvar uma versão nova, revisá-la e publicar.')) return
    return rodar('retirar', async () => {
      const res = await unpublishConvenioConteudoSite(convenioId)
      if (res.success) {
        setDados((prev) => (prev ? { ...prev, is_publicado: false } : prev))
        setInfo((prev) => (prev ? { ...prev, publicado: null } : prev))
        setMessage({ type: 'success', text: 'Landing page retirada do ar.' })
      } else setMessage({ type: 'error', text: res.error || 'Erro ao retirar do ar.' })
    })
  }

  const salvarSlug = () =>
    rodar('slug', async () => {
      const res = await salvarSlugPublicoConvenio(convenioId, slugInput || null)
      if (res.success) {
        setSlugInput(res.slugPublico ?? '')
        setInfo((prev) => (prev ? { ...prev, slugPublico: res.slugPublico ?? null } : prev))
        setMessage({ type: 'success', text: 'Endereço público salvo.' })
      } else setMessage({ type: 'error', text: res.error || 'Erro ao salvar o endereço público.' })
    })

  function preencher() {
    if (!dados || !conv) return
    const { valor, preenchidos } = preencherLanding(dados, conv)
    if (!preenchidos.length) {
      setMessage({ type: 'success', text: 'Nada a preencher: os campos já têm conteúdo. Apague um campo para gerá-lo de novo.' })
      return
    }
    setDados(valor)
    setDirty(true)
    setMessage({ type: 'success', text: `Preenchido: ${preenchidos.join(', ')}. Revise os textos e salve o rascunho.` })
  }

  if (carregando || !dados) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        {carregando ? <Loader2 className="spinner" size={24} style={{ margin: '0 auto' }} /> : <Aviso msg={message} />}
      </div>
    )
  }

  // ---- listas ----
  const setVantagem = (i: number, patch: Partial<VantagemItem>) => editar({ vantagens: dados.vantagens.map((v, j) => (j === i ? { ...v, ...patch } : v)) })
  const setFaq = (i: number, patch: Partial<FaqItem>) => editar({ faqs: dados.faqs.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const setPublico = (i: number, patch: Partial<PublicoDestaque>) =>
    editar({ publicos_destaque: dados.publicos_destaque.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const nomePublico = (id: string) => conv?.publicos.find((p) => p.id === id)?.nome
  const publicosLivres = (conv?.publicos ?? []).filter((p) => !dados.publicos_destaque.some((d) => d.publico_id === p.id))

  function moverSecao(i: number, delta: number) {
    const ordem = [...dados!.secoes_ordem]
    ;[ordem[i], ordem[i + delta]] = [ordem[i + delta], ordem[i]]
    editar({ secoes_ordem: ordem })
  }

  // Mesma regra da publicação: base não ocultada + perguntas da landing confirmadas.
  const faqBaseVisiveis = (faqBase ?? []).filter((f) => !dados.faq_ocultas.includes(f.id))
  const faqLandingConfirmadas = dados.faqs.filter((f) => f.situacao === 'confirmado').length
  const faqTotal = faqBaseVisiveis.length + faqLandingConfirmadas

  // ---- estado do fluxo ----
  const salvo = !!dados.id && !dirty
  const podeRevisar = salvo && !!dados.is_draft && dados.pendente_revisao_humana
  const podePublicar = salvo && !!dados.is_draft && !dados.pendente_revisao_humana
  const proximoPasso = dirty
    ? 'Você tem alterações não salvas: clique em Salvar rascunho.'
    : !dados.id
      ? 'Preencha os campos (ou use Preencher automaticamente) e salve o rascunho.'
      : !dados.is_draft
        ? 'Esta versão já foi publicada. Para mudar a página, edite e salve um novo rascunho.'
        : dados.pendente_revisao_humana
          ? 'Confira em Ver preview e clique em Marcar como revisado.'
          : 'Revisado. Clique em Publicar landing page.'
  const bloqueio = (pode: boolean, motivo: string) => (pode ? undefined : motivo)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 820, margin: '0 auto', width: '100%' }}>
      {/* Barra de ações: sempre visível */}
      <div
        className="card"
        style={{
          position: 'sticky',
          top: 'var(--header-height, 0px)',
          zIndex: 20,
          padding: '0.75rem 1rem',
          display: 'grid',
          gap: '0.5rem',
          background: 'var(--brs-surface)',
          boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={salvar} disabled={!!busy}>
            {busy === 'salvar' ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar rascunho
          </button>
          <button type="button" className="btn btn-outline" onClick={verPreview} disabled={!!busy} title={bloqueio(!!dados.id, 'Salve o rascunho antes')}>
            {busy === 'preview' ? <Loader2 size={16} className="spinner" /> : <Eye size={16} />}
            Ver preview
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={revisar}
            disabled={!!busy || !podeRevisar}
            title={bloqueio(podeRevisar, dirty ? 'Salve o rascunho antes' : 'Não há rascunho salvo pendente de revisão')}
          >
            {busy === 'revisar' ? <Loader2 size={16} className="spinner" /> : <ShieldCheck size={16} />}
            Marcar como revisado
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={publicar}
            disabled={!!busy || !podePublicar}
            title={bloqueio(podePublicar, dirty ? 'Salve o rascunho antes' : 'O rascunho salvo precisa ser revisado antes')}
          >
            {busy === 'publicar' ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
            Publicar landing page
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
          <span className={`badge ${dados.is_publicado ? 'badge-success' : 'badge-gray'}`}>
            {dados.is_publicado ? `No ar · versão ${dados.versao}` : `Rascunho · versão ${dados.versao}`}
          </span>
          {dados.is_draft && dados.id && (
            <span className={`badge ${dados.pendente_revisao_humana ? 'badge-warning' : 'badge-info'}`}>
              {dados.pendente_revisao_humana ? 'Aguardando revisão' : `Revisado${info?.revisadoPorNome ? ` por ${info.revisadoPorNome}` : ''}`}
            </span>
          )}
          {dirty && <span className="badge badge-warning">Alterações não salvas</span>}
          {!dados.is_publicado && info?.publicado && <span className="badge badge-success">No ar: versão {info.publicado.versao}</span>}
          <span style={{ color: 'var(--brs-gray-600)' }}>{proximoPasso}</span>
        </div>
        <Aviso msg={message} />
      </div>

      {/* Preencher automaticamente */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 260px', fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>
          <strong style={{ color: 'var(--brs-gray-800)' }}>Comece rápido:</strong> gera título, textos, vantagens e públicos em destaque a partir dos dados do convênio. Só preenche o
          que estiver vazio.
        </div>
        <button type="button" className="btn btn-outline" onClick={preencher} disabled={!conv} title={convErro ?? undefined}>
          <Sparkles size={16} />
          Preencher automaticamente
        </button>
      </div>

      {/* 1. Topo */}
      <Secao n={1} titulo="Topo" ajuda="A primeira coisa que o visitante vê.">
        <Campo rotulo="Foto de destaque" grupo>
          <FotoUpload convenioId={convenioId} url={dados.imagem_destaque_url} onChange={(url) => editar({ imagem_destaque_url: url })} />
        </Campo>
        {dados.imagem_destaque_url && (
          <Campo rotulo="Descreva a foto em poucas palavras" dica="Lida por leitores de tela. Ex.: Prédio da prefeitura de Mesquita.">
            <input className="form-control" maxLength={200} value={dados.imagem_destaque_alt || ''} onChange={(e) => editar({ imagem_destaque_alt: e.target.value })} />
          </Campo>
        )}
        <Campo rotulo="Título" contador={[dados.titulo_destaque.length, 200]}>
          <input className="form-control" maxLength={200} placeholder="Ex.: Consignado Prefeitura de Mesquita" value={dados.titulo_destaque} onChange={(e) => editar({ titulo_destaque: e.target.value })} />
        </Campo>
        <Campo rotulo="Subtítulo" contador={[dados.subtitulo.length, 300]}>
          <input className="form-control" maxLength={300} value={dados.subtitulo} onChange={(e) => editar({ subtitulo: e.target.value })} />
        </Campo>
      </Secao>

      {/* 2. Sobre o convênio */}
      <Secao n={2} titulo="Sobre o convênio">
        <Campo rotulo="Texto de apresentação" contador={[dados.resumo_publico.length, 2000]}>
          <textarea className="form-control" rows={4} maxLength={2000} value={dados.resumo_publico} onChange={(e) => editar({ resumo_publico: e.target.value })} />
        </Campo>
        <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.875rem', background: 'var(--brs-gray-50)', display: 'grid', gap: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.85rem' }}>Dados do cadastro (somente leitura)</strong>
            <a href="?aba=bc&sub=publico" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink size={14} /> Editar na Base de Conhecimento
            </a>
          </div>
          {convErro && <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>{convErro}</div>}
          {!conv && !convErro && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Carregando...</div>}
          {conv && (
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem 1rem', margin: 0, fontSize: '0.85rem' }}>
              <Dado rotulo="Esfera" valor={conv.esfera ? ESFERA[conv.esfera] ?? conv.esfera : null} />
              <Dado rotulo="UF / cidade" valor={[conv.uf, conv.cidade].filter(Boolean).join(' · ') || null} />
              <Dado rotulo="Órgão" valor={conv.orgao} />
              <Dado rotulo="Teto de margem" valor={conv.teto_margem != null ? pct(conv.teto_margem) : null} />
              <Dado rotulo="Margens por forma" valor={conv.formas.map((f) => (f.margem != null ? `${f.nome}: ${pct(f.margem)}` : f.nome)).join(' · ') || null} />
              <Dado
                rotulo="Prazos"
                valor={conv.prazo_max ? (conv.prazo_min ? `${conv.prazo_min} a ${conv.prazo_max} meses` : `até ${conv.prazo_max} meses`) : null}
              />
              <Dado rotulo="Públicos atendidos" valor={conv.publicos.map((p) => p.nome).join(' · ') || null} />
            </dl>
          )}
          <div className="form-hint" style={{ margin: 0 }}>
            Nome, esfera, UF, públicos e formas de contratação vão para a página como estão no cadastro.
          </div>
        </div>
      </Secao>

      {/* 3. Públicos em destaque */}
      <Secao n={3} titulo="Públicos em destaque" ajuda={`Um card por público, com foto e texto curto (até ${PUBLICOS_DESTAQUE_MAX}).`}>
        {conv && conv.publicos.length === 0 && (
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-600)' }}>Cadastre os públicos na Base de Conhecimento (aba Público) para destacá-los aqui.</div>
        )}
        {dados.publicos_destaque.map((p, i) => {
          const nome = nomePublico(p.publico_id)
          return (
            <Item key={p.publico_id} titulo={nome ?? 'Público fora do convênio'} onRemover={() => editar({ publicos_destaque: dados.publicos_destaque.filter((_, j) => j !== i) })}>
              {!nome && conv && <div style={{ fontSize: '0.8rem', color: '#b45309' }}>Este público não está mais no convênio e não aparecerá no site.</div>}
              <Campo rotulo="Título curto" contador={[p.titulo.length, PUBLICO_DESTAQUE_TITULO_MAX]}>
                <input className="form-control" maxLength={PUBLICO_DESTAQUE_TITULO_MAX} value={p.titulo} onChange={(e) => setPublico(i, { titulo: e.target.value })} />
              </Campo>
              <Campo rotulo="Texto" contador={[p.texto.length, PUBLICO_DESTAQUE_TEXTO_MAX]}>
                <textarea className="form-control" rows={3} maxLength={PUBLICO_DESTAQUE_TEXTO_MAX} value={p.texto} onChange={(e) => setPublico(i, { texto: e.target.value })} />
              </Campo>
              <Campo rotulo="Foto" grupo>
                <FotoUpload convenioId={convenioId} url={p.imagem_url} altura={150} onChange={(url) => setPublico(i, { imagem_url: url })} />
              </Campo>
            </Item>
          )
        })}
        {publicosLivres.length > 0 && dados.publicos_destaque.length < PUBLICOS_DESTAQUE_MAX && (
          <select
            className="form-control"
            value=""
            aria-label="Adicionar público em destaque"
            onChange={(e) => {
              const p = publicosLivres.find((x) => x.id === e.target.value)
              if (p) editar({ publicos_destaque: [...dados.publicos_destaque, { publico_id: p.id, titulo: p.nome.slice(0, PUBLICO_DESTAQUE_TITULO_MAX), texto: '', imagem_url: null }] })
            }}
          >
            <option value="">+ Adicionar público em destaque...</option>
            {publicosLivres.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        )}
      </Secao>

      {/* 4. Vantagens */}
      <Secao n={4} titulo="Vantagens" ajuda="Cards curtos. Não cite banco: as vantagens valem para o convênio.">
        {dados.vantagens.map((v, i) => (
          <Item key={i} titulo={`Vantagem ${i + 1}`} pendente={v.situacao !== 'confirmado'} onRemover={() => editar({ vantagens: dados.vantagens.filter((_, j) => j !== i) })}>
            <Campo rotulo="Título">
              <input className="form-control" maxLength={120} value={v.titulo} onChange={(e) => setVantagem(i, { titulo: e.target.value })} />
            </Campo>
            <Campo rotulo="Texto">
              <textarea className="form-control" rows={2} maxLength={600} value={v.descricao} onChange={(e) => setVantagem(i, { descricao: e.target.value })} />
            </Campo>
            <AvancadoItem item={v} onChange={(patch) => setVantagem(i, patch)} />
          </Item>
        ))}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ justifySelf: 'start' }}
          disabled={dados.vantagens.length >= VANTAGENS_MAX}
          onClick={() => editar({ vantagens: [...dados.vantagens, { titulo: '', descricao: '', ...EVIDENCIA_PADRAO }] })}
        >
          <Plus size={14} /> Adicionar vantagem
        </button>
      </Secao>

      {/* 5. FAQ */}
      <Secao n={5} titulo="Perguntas frequentes">
        <div style={{ fontSize: '0.8rem', color: faqTotal > FAQ_MAX ? '#dc2626' : 'var(--brs-gray-600)' }}>
          {faqBaseVisiveis.length} da base + {faqLandingConfirmadas} da landing serão publicadas
          {faqTotal > FAQ_MAX ? ` — passa do máximo de ${FAQ_MAX}; a publicação será bloqueada.` : ` (máx. ${FAQ_MAX}).`}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.875rem' }}>Da Base de Conhecimento ({faqBase?.length ?? 0})</strong>
          <a href="?aba=bc&sub=faq" target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            <ExternalLink size={14} /> Editar na Base de Conhecimento
          </a>
        </div>
        {faqBaseErro && <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>{faqBaseErro}</div>}
        {!faqBaseErro && faqBase === null && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Carregando...</div>}
        {faqBase?.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Nenhuma pergunta ativa na Base de Conhecimento deste convênio.</div>}
        {faqBase?.map((f) => {
          const mostrar = !dados.faq_ocultas.includes(f.id)
          return (
            <div key={f.id} style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid var(--brs-gray-200)', opacity: mostrar ? 1 : 0.55 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {f.pergunta}
                  {f.importada && <span style={{ marginLeft: 6, fontSize: '0.7rem', fontWeight: 500, color: 'var(--brs-gray-600)' }}>(regra geral importada)</span>}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={mostrar}
                    onChange={() => editar({ faq_ocultas: mostrar ? [...dados.faq_ocultas, f.id] : dados.faq_ocultas.filter((x) => x !== f.id) })}
                  />
                  Mostrar
                </label>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)', marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>{f.resposta}</div>
            </div>
          )
        })}
        <strong style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Só desta landing ({dados.faqs.length})</strong>
        {dados.faqs.map((f, i) => (
          <Item key={i} titulo={`Pergunta ${i + 1}`} pendente={f.situacao !== 'confirmado'} onRemover={() => editar({ faqs: dados.faqs.filter((_, j) => j !== i) })}>
            <Campo rotulo="Pergunta">
              <input className="form-control" maxLength={300} value={f.pergunta} onChange={(e) => setFaq(i, { pergunta: e.target.value })} />
            </Campo>
            <Campo rotulo="Resposta">
              <textarea className="form-control" rows={3} maxLength={2000} value={f.resposta} onChange={(e) => setFaq(i, { resposta: e.target.value })} />
            </Campo>
            <AvancadoItem item={f} onChange={(patch) => setFaq(i, patch)} />
          </Item>
        ))}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ justifySelf: 'start' }}
          disabled={dados.faqs.length >= FAQ_LANDING_MAX}
          onClick={() => editar({ faqs: [...dados.faqs, { pergunta: '', resposta: '', ...EVIDENCIA_PADRAO }] })}
        >
          <Plus size={14} /> Adicionar pergunta
        </button>
      </Secao>

      {/* 6. Botão */}
      <Secao n={6} titulo="Botão de WhatsApp" ajuda="O botão de contato que aparece na página.">
        <Campo rotulo="Texto do botão" contador={[dados.cta_texto_botao.length, 60]}>
          <input className="form-control" maxLength={60} value={dados.cta_texto_botao} onChange={(e) => editar({ cta_texto_botao: e.target.value })} />
        </Campo>
        <Campo rotulo="O botão leva para">
          <select className="form-control" value={dados.cta_tipo_destino || 'whatsapp'} onChange={(e) => editar({ cta_tipo_destino: e.target.value as CtaTipoDestino })}>
            <option value="whatsapp">WhatsApp (padrão)</option>
            <option value="simulador">Simulador da página</option>
            <option value="formulario">Formulário da página</option>
            <option value="url_customizada">Um link (https://)</option>
          </select>
        </Campo>
        {(dados.cta_tipo_destino === 'url_customizada' || dados.cta_tipo_destino === 'link_externo') && (
          <Campo rotulo="Link">
            <input className="form-control" placeholder="https://..." value={dados.cta_link_destino || ''} onChange={(e) => editar({ cta_link_destino: e.target.value })} />
          </Campo>
        )}
      </Secao>

      {/* 7. Avançado */}
      <details className="card" style={{ padding: '1rem 1.25rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Avançado: SEO, seções, endereço público</summary>
        <div style={{ display: 'grid', gap: '1.25rem', marginTop: '1rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>SEO (Google)</strong>
            <Campo rotulo="Meta title" contador={[(dados.meta_title || '').length, 70]}>
              <input className="form-control" maxLength={70} value={dados.meta_title || ''} onChange={(e) => editar({ meta_title: e.target.value })} />
            </Campo>
            <Campo rotulo="Meta description" contador={[(dados.meta_description || '').length, 170]}>
              <textarea className="form-control" rows={2} maxLength={170} value={dados.meta_description || ''} onChange={(e) => editar({ meta_description: e.target.value })} />
            </Campo>
            <Campo rotulo="Palavras-chave (separadas por vírgula)">
              <input className="form-control" value={dados.keywords || ''} onChange={(e) => editar({ keywords: e.target.value })} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>Chamada alternativa do topo (opcional)</strong>
            <Campo rotulo="Headline" dica="Vazio: o site usa o título.">
              <input className="form-control" maxLength={200} value={dados.hero_headline || ''} onChange={(e) => editar({ hero_headline: e.target.value })} />
            </Campo>
            <Campo rotulo="Sub-headline" dica="Vazio: o site usa o subtítulo.">
              <input className="form-control" maxLength={300} value={dados.hero_subheadline || ''} onChange={(e) => editar({ hero_subheadline: e.target.value })} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gap: '0.4rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>Ordem e visibilidade das seções</strong>
            {dados.secoes_ordem.map((s, i) => {
              const visivel = dados.secoes_visibilidade?.[s] !== false
              return (
                <div
                  key={s}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', border: '1px solid var(--brs-gray-200)', borderRadius: 6 }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', opacity: visivel ? 1 : 0.6 }}>
                    <input type="checkbox" checked={visivel} onChange={() => editar({ secoes_visibilidade: { ...dados.secoes_visibilidade, [s]: !visivel } })} />
                    {i + 1}. {NOME_SECAO[s] ?? s}
                  </label>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button type="button" className="btn btn-outline btn-sm" aria-label="Subir" onClick={() => moverSecao(i, -1)} disabled={i === 0}>
                      <ArrowUp size={12} />
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" aria-label="Descer" onClick={() => moverSecao(i, 1)} disabled={i === dados.secoes_ordem.length - 1}>
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>Endereço público (slug)</strong>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="form-control"
                style={{ flex: '1 1 200px', maxWidth: 320, fontFamily: 'monospace' }}
                placeholder="ex.: prefeitura-mesquita"
                value={slugInput}
                maxLength={63}
                onChange={(e) => setSlugInput(e.target.value.toLowerCase())}
              />
              <button type="button" className="btn btn-outline btn-sm" onClick={salvarSlug} disabled={!!busy || (slugInput || '') === (info?.slugPublico || '')}>
                {busy === 'slug' && <Loader2 size={14} className="spinner" />}
                Salvar endereço
              </button>
            </div>
            <div className="form-hint" style={{ margin: 0 }}>
              Letras minúsculas, números e hífen. Só pode ser trocado com a página fora do ar. Obrigatório para publicar.
            </div>
          </div>

          {info?.publicado && (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <strong style={{ fontSize: '0.875rem' }}>Retirar do ar</strong>
              <div className="form-hint" style={{ margin: 0 }}>
                No ar: versão {info.publicado.versao}
                {info.publicado.publicadoPorNome ? `, publicada por ${info.publicado.publicadoPorNome}` : ''}
                {info.publicado.publicadoEm ? ` em ${new Date(info.publicado.publicadoEm).toLocaleString('pt-BR')}` : ''}.
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: 'start', color: '#dc2626' }} onClick={retirar} disabled={!!busy}>
                {busy === 'retirar' && <Loader2 size={14} className="spinner" />}
                Retirar landing page do ar
              </button>
            </div>
          )}
        </div>
      </details>

      {preview && (
        <PreviewPainel
          url={preview.url}
          chave={preview.n}
          dirty={dirty}
          recarregando={busy === 'preview' || busy === 'salvar'}
          onRecarregar={verPreview}
          onFechar={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function Aviso({ msg }: { msg: Msg }) {
  if (!msg) return null
  const ok = msg.type === 'success'
  return (
    <div
      role={ok ? 'status' : 'alert'}
      style={{
        padding: '0.6rem 0.8rem',
        borderRadius: 8,
        border: `1px solid ${ok ? '#a7f3d0' : '#fecaca'}`,
        background: ok ? '#ecfdf5' : '#fef2f2',
        color: ok ? '#065f46' : '#991b1b',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.85rem',
        fontWeight: 500,
      }}
    >
      {ok ? <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> : <AlertTriangle size={16} style={{ flexShrink: 0 }} />}
      <span>{msg.text}</span>
    </div>
  )
}

function Secao({ n, titulo, ajuda, children }: { n: number; titulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <section className="card" style={{ padding: '1.25rem', display: 'grid', gap: '0.875rem' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>
          <span style={{ color: 'var(--brs-gray-400)', marginRight: 6 }}>{n}.</span>
          {titulo}
        </h3>
        {ajuda && <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-600)', marginTop: 2 }}>{ajuda}</div>}
      </div>
      {children}
    </section>
  )
}

/** `grupo`: o filho tem vários controles (ex.: upload), então não envolve com <label>. */
function Campo({ rotulo, dica, contador, grupo, children }: { rotulo: string; dica?: string; contador?: [number, number]; grupo?: boolean; children: ReactNode }) {
  const Tag = grupo ? 'div' : 'label'
  return (
    <Tag className="form-group" style={{ display: 'grid', gap: '0.25rem', margin: 0 }}>
      <span className="form-label" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', margin: 0 }}>
        {rotulo}
        {contador && (
          <span style={{ fontWeight: 400, fontSize: '0.75rem', color: contador[0] > contador[1] * 0.9 ? '#b45309' : 'var(--brs-gray-400)' }}>
            {contador[0]}/{contador[1]}
          </span>
        )}
      </span>
      {children}
      {dica && <span className="form-hint" style={{ margin: 0 }}>{dica}</span>}
    </Tag>
  )
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt style={{ fontSize: '0.75rem', color: 'var(--brs-gray-600)' }}>{rotulo}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{valor || <span style={{ fontWeight: 400, color: 'var(--brs-gray-400)' }}>não informado</span>}</dd>
    </div>
  )
}

function Item({ titulo, pendente, onRemover, children }: { titulo: string; pendente?: boolean; onRemover: () => void; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--brs-gray-200)', borderRadius: 10, padding: '0.875rem', display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.85rem' }}>{titulo}</strong>
          {pendente && <span className="badge badge-warning">Não aparece no site: situação pendente (ver Avançado)</span>}
        </div>
        <button type="button" className="btn btn-outline btn-sm" style={{ color: '#dc2626' }} onClick={onRemover} aria-label={`Remover ${titulo}`}>
          <Trash2 size={14} />
        </button>
      </div>
      {children}
    </div>
  )
}

/** Evidência do item (contrato público v1). Situação diferente de "confirmado" = fora do site. */
function AvancadoItem({ item, onChange }: { item: EvidenciaItem; onChange: (patch: Partial<EvidenciaItem>) => void }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--brs-gray-600)' }}>Avançado (fonte, data, situação, natureza)</summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          className="form-control"
          placeholder="Fonte (texto ou https://)"
          aria-label="Fonte"
          value={item.fonte || ''}
          onChange={(e) => onChange({ fonte: e.target.value || null })}
        />
        <input
          type="date"
          className="form-control"
          aria-label="Consultado em"
          title="Consultado em"
          value={item.consultado_em || ''}
          onChange={(e) => onChange({ consultado_em: e.target.value || null })}
        />
        <select
          className="form-control"
          aria-label="Situação"
          value={item.situacao === 'confirmado' ? 'confirmado' : 'pendente'}
          onChange={(e) => onChange({ situacao: e.target.value as 'confirmado' | 'pendente' })}
        >
          <option value="confirmado">Confirmado (aparece no site)</option>
          <option value="pendente">Pendente (não aparece)</option>
        </select>
        <select
          className="form-control"
          aria-label="Natureza"
          value={item.natureza || ''}
          onChange={(e) => onChange({ natureza: (e.target.value || null) as EvidenciaItem['natureza'] })}
        >
          <option value="">Natureza: não informada</option>
          <option value="norma_oficial">Norma oficial</option>
          <option value="regra_bancaria">Regra bancária</option>
        </select>
      </div>
    </details>
  )
}
