'use client'

import { useState, useEffect } from 'react'
import {
  Save,
  Send,
  Eye,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Link2,
  HelpCircle,
  Layers,
  X,
  Loader2,
  Image as ImageIcon,
  CheckSquare,
  Square,
} from 'lucide-react'
import {
  getConvenioConteudoSite,
  marcarConvenioConteudoSiteRevisado,
  publishConvenioConteudoSite,
  salvarSlugPublicoConvenio,
  saveConvenioConteudoSiteDraft,
  unpublishConvenioConteudoSite,
  type ConvenioConteudoSiteInfo,
  type ConvenioConteudoSiteRecord,
} from '../site-actions'
import {
  interpolarTexto,
  type EvidenciaItem,
  type FaqItem,
  type VantagemItem,
  type SecaoKey,
  type CtaTipoDestino,
} from '@/lib/site-builder/conteudo-publico'

type Props = {
  convenioId: string
  convenioNome?: string
}

export default function SiteTab({ convenioId, convenioNome }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  const [dados, setDados] = useState<ConvenioConteudoSiteRecord | null>(null)
  const [info, setInfo] = useState<ConvenioConteudoSiteInfo | null>(null)
  // Edição local não salva: bloqueia revisar/publicar (eles valem para o que está no banco).
  const [dirty, setDirty] = useState(false)
  const [slugInput, setSlugInput] = useState('')

  function editar(next: ConvenioConteudoSiteRecord) {
    setDados(next)
    setDirty(true)
  }
  const [showPreview, setShowPreview] = useState(false)

  // Dados Fictícios de Parceiro para Teste de Preview de Interpolação
  const contextoMock = {
    nome_parceiro: 'VidaCred Soluções Financeiras',
    whatsapp: '(11) 99887-6655',
    email: 'contato@vidacred.com.br',
    cidade: 'São Paulo',
    uf: 'SP',
    cnpj_cpf: '12.345.678/0001-90',
  }

  useEffect(() => {
    let ativo = true
    getConvenioConteudoSite(convenioId).then((res) => {
      if (!ativo) return
      if (res.success && res.item) {
        setDados(res.item)
        setInfo(res.info ?? null)
        setSlugInput(res.info?.slugPublico ?? '')
        setDirty(false)
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar conteúdo do site.' })
      }
      setLoading(false)
    })
    return () => {
      ativo = false
    }
  }, [convenioId])

  async function handleSaveDraft() {
    if (!dados) return
    setSaving(true)
    setMessage(null)
    const res = await saveConvenioConteudoSiteDraft(dados)
    if (res.success && res.item) {
      setDados({ ...dados, ...res.item })
      setDirty(false)
      setInfo((prev) => (prev ? { ...prev, revisadoPorNome: null } : prev))
      setMessage({ type: 'success', text: 'Rascunho salvo. Ele precisa ser revisado antes de publicar.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar conteúdo.' })
    }
    setSaving(false)
  }

  async function handleReview() {
    if (!dados?.id || !dados.updated_at) return
    setSaving(true)
    setMessage(null)
    const res = await marcarConvenioConteudoSiteRevisado(convenioId, dados.id, dados.updated_at)
    if (res.success && res.item) {
      setDados({ ...dados, ...res.item })
      setInfo((prev) => (prev ? { ...prev, revisadoPorNome: res.revisadoPorNome ?? null } : prev))
      setMessage({ type: 'success', text: 'Conteúdo marcado como revisado.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao marcar como revisado.' })
    }
    setSaving(false)
  }

  async function handlePublish() {
    if (!dados?.id || !dados.updated_at) return
    setPublishing(true)
    setMessage(null)
    const res = await publishConvenioConteudoSite(convenioId, dados.id, dados.updated_at)
    if (res.success && res.item) {
      setDados({ ...dados, ...res.item })
      setInfo((prev) =>
        prev
          ? { ...prev, publicado: { versao: res.item!.versao, publicadoEm: res.item!.published_at ?? null, publicadoPorNome: res.publicadoPorNome ?? null } }
          : prev,
      )
      setMessage({ type: 'success', text: `Versão v${res.item.versao} publicada.` })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao publicar.' })
    }
    setPublishing(false)
  }

  async function handleUnpublish() {
    if (!dados || !confirm('Tem certeza que deseja retirar esta página do ar? Ela deixará de ser exibida nos sites públicos.')) return
    setSaving(true)
    const res = await unpublishConvenioConteudoSite(convenioId)
    if (res.success) {
      setDados((prev) => (prev ? { ...prev, is_publicado: false } : prev))
      setInfo((prev) => (prev ? { ...prev, publicado: null } : prev))
      setMessage({ type: 'success', text: 'Conteúdo do convênio retirado do ar com sucesso.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao retirar do ar.' })
    }
    setSaving(false)
  }

  async function handleSaveSlug() {
    setSaving(true)
    setMessage(null)
    const res = await salvarSlugPublicoConvenio(convenioId, slugInput || null)
    if (res.success) {
      setSlugInput(res.slugPublico ?? '')
      setInfo((prev) => (prev ? { ...prev, slugPublico: res.slugPublico ?? null } : prev))
      setMessage({ type: 'success', text: 'Slug público salvo.' })
    } else {
      setMessage({ type: 'error', text: res.error || 'Erro ao salvar o slug.' })
    }
    setSaving(false)
  }

  // Manipulação de Seções & Visibilidade
  function moveSection(index: number, direction: 'up' | 'down') {
    if (!dados) return
    const newOrdem = [...dados.secoes_ordem]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newOrdem.length) return
    const temp = newOrdem[index]
    newOrdem[index] = newOrdem[targetIndex]
    newOrdem[targetIndex] = temp
    editar({ ...dados, secoes_ordem: newOrdem })
  }

  function toggleSectionVisibility(secaoKey: SecaoKey) {
    if (!dados) return
    const currentVis = dados.secoes_visibilidade || {}
    editar({
      ...dados,
      secoes_visibilidade: {
        ...currentVis,
        [secaoKey]: currentVis[secaoKey] === false ? true : false,
      },
    })
  }

  // Vantagens
  function addVantagem() {
    if (!dados) return
    editar({
      ...dados,
      vantagens: [...dados.vantagens, { titulo: 'Nova Vantagem', descricao: 'Descrição detalhada do benefício', icone: 'CheckCircle' }],
    })
  }

  function updateVantagem(idx: number, field: keyof VantagemItem, val: string) {
    if (!dados) return
    const list = [...dados.vantagens]
    list[idx] = { ...list[idx], [field]: val === '' && field in EVIDENCIA_VAZIA ? null : val }
    editar({ ...dados, vantagens: list })
  }

  function removeVantagem(idx: number) {
    if (!dados) return
    editar({ ...dados, vantagens: dados.vantagens.filter((_, i) => i !== idx) })
  }

  // FAQs
  function addFaq() {
    if (!dados) return
    editar({
      ...dados,
      faqs: [...dados.faqs, { pergunta: 'Pergunta frequente?', resposta: 'Resposta explicativa clara.' }],
    })
  }

  function updateFaq(idx: number, field: keyof FaqItem, val: string) {
    if (!dados) return
    const list = [...dados.faqs]
    list[idx] = { ...list[idx], [field]: val === '' && field in EVIDENCIA_VAZIA ? null : val }
    editar({ ...dados, faqs: list })
  }

  function removeFaq(idx: number) {
    if (!dados) return
    editar({ ...dados, faqs: dados.faqs.filter((_, i) => i !== idx) })
  }

  if (loading || !dados) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <Loader2 className="spinner" size={24} style={{ margin: '0 auto', color: 'var(--brs-navy)' }} />
        <div style={{ marginTop: '0.5rem', color: 'var(--brs-gray-500)' }}>Carregando editor de site...</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Banner de Controle e Status de Publicação */}
      <div
        className="card"
        style={{
          padding: '1.25rem',
          background: dados.is_publicado ? 'linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)' : '#fafafa',
          borderLeft: `4px solid ${dados.is_publicado ? '#16a34a' : '#ca8a04'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '0.2rem 0.6rem',
                borderRadius: 99,
                background: dados.is_publicado ? '#dcfce7' : '#fef9c3',
                color: dados.is_publicado ? '#15803d' : '#a16207',
              }}
            >
              {dados.is_publicado ? `Publicado (Versão ${dados.versao})` : `Rascunho (Versão ${dados.versao})`}
            </span>
            {dados.pendente_revisao_humana && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#c2410c', background: '#ffedd5', padding: '0.2rem 0.6rem', borderRadius: 99 }}>
                Pendente de Revisão Humana
              </span>
            )}
            {dirty && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a16207', background: '#fef9c3', padding: '0.2rem 0.6rem', borderRadius: 99 }}>
                Alterações não salvas
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {!dados.pendente_revisao_humana && dados.revisado_em && (
              <span>
                Revisado por {info?.revisadoPorNome || 'usuário removido'} em {new Date(dados.revisado_em).toLocaleString('pt-BR')}
              </span>
            )}
            {info?.publicado ? (
              <span>
                No ar: publicado por {info.publicado.publicadoPorNome || 'usuário removido'}
                {info.publicado.publicadoEm ? ` em ${new Date(info.publicado.publicadoEm).toLocaleString('pt-BR')}` : ''} (v{info.publicado.versao})
              </span>
            ) : (
              <span>Nenhuma versão no ar.</span>
            )}
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--brs-gray-900)', marginTop: '0.35rem' }}>
            Site Builder & Landing Page do Convênio: {convenioNome || 'Convênio'}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--brs-gray-500)' }}>
            Configure seções, textos, imagens, vantagens, FAQs e SEO compartilhados entre os parceiros autorizados.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => setShowPreview(true)}>
            <Eye size={16} />
            Preview Fictício
          </button>
          <button type="button" className="btn btn-outline" onClick={handleSaveDraft} disabled={saving || publishing}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar Rascunho
          </button>
          {dados.is_draft && dados.id && dados.pendente_revisao_humana && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleReview}
              disabled={saving || publishing || dirty}
              title={dirty ? 'Salve o rascunho antes de revisar' : 'Confirma que você revisou o rascunho salvo'}
            >
              <ShieldCheck size={16} />
              Marcar como revisado
            </button>
          )}
          {info?.publicado && (
            <button type="button" className="btn btn-outline" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={handleUnpublish} disabled={saving}>
              Retirar do Ar
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={publishing || saving || dirty || !dados.id || !dados.is_draft || dados.pendente_revisao_humana}
            title={
              dirty
                ? 'Salve o rascunho antes de publicar'
                : dados.pendente_revisao_humana
                  ? 'O rascunho precisa ser revisado antes de publicar'
                  : !dados.is_draft
                    ? 'Edite e salve um novo rascunho para publicar'
                    : undefined
            }
          >
            {publishing ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
            Publicar v{dados.versao}
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '0.875rem 1rem',
            borderRadius: 8,
            border: `1px solid ${message.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
            background: message.type === 'success' ? '#ecfdf5' : '#fef2f2',
            color: message.type === 'success' ? '#065f46' : '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Endereço público e regras de publicação (contrato v1) */}
      <div className="card" style={{ padding: '1rem', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-700)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Link2 size={14} color="#0284c7" />
          Slug público (/api/convenios/publico/v1/&lt;slug&gt;)
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-control"
            style={{ maxWidth: 320, fontFamily: 'monospace' }}
            placeholder="ex.: governo-go"
            value={slugInput}
            maxLength={63}
            pattern="[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?"
            onChange={(e) => setSlugInput(e.target.value.toLowerCase())}
          />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleSaveSlug}
            disabled={saving || (slugInput || '') === (info?.slugPublico || '')}
          >
            Salvar slug
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>
          No conteúdo público só entram vantagens e FAQs com situação &quot;confirmado&quot;. Textos com variáveis {'{{...}}'} bloqueiam a publicação.
        </div>
      </div>

      {/* Grade de Edição Principal */}
      <div className="form-grid form-grid-2">
        {/* Lado Esquerdo: Headlines, Imagens, Textos e SEO */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.5rem' }}>
            Textos Principais & Headlines
          </div>

          <div className="form-group">
            <label className="form-label">Título Destaque</label>
            <input
              type="text"
              className="form-control"
              value={dados.titulo_destaque}
              onChange={(e) => editar({ ...dados, titulo_destaque: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Subtítulo</label>
            <input
              type="text"
              className="form-control"
              value={dados.subtitulo}
              onChange={(e) => editar({ ...dados, subtitulo: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Resumo Público</label>
            <textarea
              className="form-control"
              rows={3}
              value={dados.resumo_publico}
              onChange={(e) => editar({ ...dados, resumo_publico: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Headline da Seção Hero</label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex.: Empréstimo Consignado {{nome_parceiro}}"
              value={dados.hero_headline || ''}
              onChange={(e) => editar({ ...dados, hero_headline: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Sub-headline da Seção Hero</label>
            <input
              type="text"
              className="form-control"
              placeholder="Ex.: Atendimento em {{cidade}}/{{uf}}"
              value={dados.hero_subheadline || ''}
              onChange={(e) => editar({ ...dados, hero_subheadline: e.target.value })}
            />
          </div>

          {/* Imagem de Destaque */}
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.5rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ImageIcon size={16} />
            Imagem de Destaque / Hero
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">URL da Imagem (HTTPS)</label>
              <input
                type="text"
                className="form-control"
                placeholder="https://exemplo.com/banner.jpg"
                value={dados.imagem_destaque_url || ''}
                onChange={(e) => editar({ ...dados, imagem_destaque_url: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Texto Alternativo (Alt Text)</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex.: Banner ilustrativo do convênio INSS"
                value={dados.imagem_destaque_alt || ''}
                onChange={(e) => editar({ ...dados, imagem_destaque_alt: e.target.value })}
              />
            </div>
          </div>

          {/* CTA & Destinos */}
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.5rem', marginTop: '1rem' }}>
            Chamada para Ação (CTA) & Destinos Tipados
          </div>

          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="form-label">Texto do Botão CTA</label>
              <input
                type="text"
                className="form-control"
                value={dados.cta_texto_botao}
                onChange={(e) => editar({ ...dados, cta_texto_botao: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Destino</label>
              <select
                className="form-control"
                value={dados.cta_tipo_destino || 'whatsapp'}
                onChange={(e) => editar({ ...dados, cta_tipo_destino: e.target.value as CtaTipoDestino })}
              >
                <option value="whatsapp">WhatsApp Direct (Default)</option>
                <option value="simulador">Simulador Embutido (#simulador)</option>
                <option value="formulario">Formulário de Proposta (#formulario)</option>
                <option value="url_customizada">URL Customizada Externo/Interno</option>
              </select>
            </div>
          </div>

          {dados.cta_tipo_destino === 'url_customizada' && (
            <div className="form-group">
              <label className="form-label">URL de Destino Customizada</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ex.: https://meusite.com.br/simular"
                value={dados.cta_link_destino || ''}
                onChange={(e) => editar({ ...dados, cta_link_destino: e.target.value })}
              />
            </div>
          )}

          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', borderBottom: '1px solid var(--brs-gray-100)', paddingBottom: '0.5rem', marginTop: '1rem' }}>
            Metadados de SEO
          </div>

          <div className="form-group">
            <label className="form-label">Meta Title</label>
            <input
              type="text"
              className="form-control"
              value={dados.meta_title || ''}
              onChange={(e) => editar({ ...dados, meta_title: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Meta Description</label>
            <textarea
              className="form-control"
              rows={2}
              value={dados.meta_description || ''}
              onChange={(e) => editar({ ...dados, meta_description: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Palavras-chave (separadas por vírgula)</label>
            <input
              type="text"
              className="form-control"
              value={dados.keywords || ''}
              onChange={(e) => editar({ ...dados, keywords: e.target.value })}
            />
          </div>
        </div>

        {/* Lado Direito: Ordem & Visibilidade das Seções + Vantagens */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Ordenação e Visibilidade de Seções */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={16} />
              Ordem & Visibilidade das Seções na Landing Page
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {dados.secoes_ordem.map((secaoKey, idx) => {
                const isVisible = (dados.secoes_visibilidade || {})[secaoKey] !== false
                return (
                  <div
                    key={secaoKey}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem 0.75rem',
                      background: isVisible ? '#f8fafc' : '#f1f5f9',
                      borderRadius: 6,
                      border: `1px solid ${isVisible ? '#e2e8f0' : '#cbd5e1'}`,
                      opacity: isVisible ? 1 : 0.65,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => toggleSectionVisibility(secaoKey)}>
                      {isVisible ? <CheckSquare size={16} color="#0284c7" /> : <Square size={16} color="#94a3b8" />}
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase', color: isVisible ? '#334155' : '#64748b' }}>
                        {idx + 1}. {secaoKey}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => moveSection(idx, 'up')}
                        disabled={idx === 0}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => moveSection(idx, 'down')}
                        disabled={idx === dados.secoes_ordem.length - 1}
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Lista de Vantagens */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)' }}>
                Destaques & Vantagens ({dados.vantagens.length})
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={addVantagem}>
                <Plus size={14} /> Adicionar
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {dados.vantagens.map((item, idx) => (
                <div key={idx} style={{ padding: '0.75rem', background: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Título da vantagem"
                      value={item.titulo}
                      onChange={(e) => updateVantagem(idx, 'titulo', e.target.value)}
                      style={{ fontWeight: 600 }}
                    />
                    <button type="button" className="btn btn-outline btn-sm" style={{ color: '#dc2626' }} onClick={() => removeVantagem(idx)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="Descrição da vantagem"
                    value={item.descricao}
                    onChange={(e) => updateVantagem(idx, 'descricao', e.target.value)}
                  />
                  <CamposEvidencia item={item} onChange={(campo, val) => updateVantagem(idx, campo, val)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Seção Completa de FAQs */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HelpCircle size={16} />
            Perguntas Frequentes (FAQs Central) ({dados.faqs.length})
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={addFaq}>
            <Plus size={14} /> Nova Pergunta
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {dados.faqs.map((faq, idx) => (
            <div key={idx} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Pergunta"
                  value={faq.pergunta}
                  onChange={(e) => updateFaq(idx, 'pergunta', e.target.value)}
                  style={{ fontWeight: 600 }}
                />
                <button type="button" className="btn btn-outline btn-sm" style={{ color: '#dc2626' }} onClick={() => removeFaq(idx)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea
                className="form-control"
                rows={2}
                placeholder="Resposta"
                value={faq.resposta}
                onChange={(e) => updateFaq(idx, 'resposta', e.target.value)}
              />
              <CamposEvidencia item={faq} onChange={(campo, val) => updateFaq(idx, campo, val)} />
            </div>
          ))}
        </div>
      </div>

      {/* Modal / Drawer de Preview Dinâmico (E6) */}
      {showPreview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 850,
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#0f172a',
                color: '#ffffff',
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Preview Dinâmico do Conteúdo Renderizado (E6)</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  Respeitando a ordem configurada: [{dados.secoes_ordem.join(', ')}] | Contexto Fictício: {contextoMock.nome_parceiro}
                </div>
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ color: '#ffffff', borderColor: '#334155' }} onClick={() => setShowPreview(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#f8fafc' }}>
              {dados.secoes_ordem.map((secaoKey) => {
                if (dados.secoes_visibilidade && dados.secoes_visibilidade[secaoKey] === false) {
                  return null
                }
                switch (secaoKey) {
                  case 'hero':
                    return (
                      <div key="hero" style={{ padding: '2rem', background: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)', borderRadius: 12, color: '#ffffff', textAlign: 'center' }}>
                        {dados.imagem_destaque_url && (
                          <div style={{ marginBottom: '1rem' }}>
                            <img
                              src={dados.imagem_destaque_url}
                              alt={dados.imagem_destaque_alt || 'Imagem Destaque Hero'}
                              style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, margin: '0 auto' }}
                            />
                          </div>
                        )}
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                          {interpolarTexto(dados.hero_headline || dados.titulo_destaque, contextoMock)}
                        </h1>
                        <p style={{ fontSize: '0.95rem', color: '#93c5fd', marginBottom: '1.5rem' }}>
                          {interpolarTexto(dados.hero_subheadline || dados.subtitulo, contextoMock)}
                        </p>
                        <button type="button" className="btn btn-primary" style={{ background: '#2563eb', border: 'none', padding: '0.75rem 1.5rem', fontSize: '0.95rem', fontWeight: 700 }}>
                          {interpolarTexto(dados.cta_texto_botao, contextoMock)}
                        </button>
                      </div>
                    )
                  case 'resumo':
                    return (
                      <div key="resumo" style={{ padding: '1.5rem', background: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
                          {interpolarTexto(dados.titulo_destaque, contextoMock)}
                        </h2>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', marginBottom: '0.75rem' }}>
                          {interpolarTexto(dados.subtitulo, contextoMock)}
                        </h4>
                        <p style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.6 }}>
                          {interpolarTexto(dados.resumo_publico, contextoMock)}
                        </p>
                      </div>
                    )
                  case 'vantagens':
                    return (
                      <div key="vantagens">
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginBottom: '1rem' }}>Por que contratar conosco?</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                          {dados.vantagens.map((v, i) => (
                            <div key={i} style={{ padding: '1rem', background: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', marginBottom: '0.25rem' }}>
                                {interpolarTexto(v.titulo, contextoMock)}
                              </div>
                              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                {interpolarTexto(v.descricao, contextoMock)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  case 'faq':
                    return (
                      <div key="faq">
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginBottom: '1rem' }}>Dúvidas Frequentes</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {dados.faqs.map((faq, i) => (
                            <div key={i} style={{ padding: '1rem', background: '#ffffff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a', marginBottom: '0.25rem' }}>
                                {interpolarTexto(faq.pergunta, contextoMock)}
                              </div>
                              <div style={{ fontSize: '0.825rem', color: '#475569' }}>
                                {interpolarTexto(faq.resposta, contextoMock)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  case 'cta':
                    return (
                      <div key="cta" style={{ padding: '2rem', background: '#0284c7', borderRadius: 12, color: '#ffffff', textAlign: 'center' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                          Pronto para simular seu crédito?
                        </h3>
                        <p style={{ fontSize: '0.9rem', color: '#e0f2fe', marginBottom: '1.25rem' }}>
                          Fale agora com a {contextoMock.nome_parceiro} em {contextoMock.cidade}/{contextoMock.uf}.
                        </p>
                        <button type="button" className="btn" style={{ background: '#ffffff', color: '#0284c7', fontWeight: 800, padding: '0.75rem 1.5rem', borderRadius: 6 }}>
                          {interpolarTexto(dados.cta_texto_botao, contextoMock)} ({dados.cta_tipo_destino || 'whatsapp'})
                        </button>
                      </div>
                    )
                  case 'seo':
                    return (
                      <div key="seo" style={{ padding: '1rem', background: '#ffffff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Preview do Resultado em Motores de Busca:</div>
                        <div style={{ fontSize: '1.1rem', color: '#1a0dab', textDecoration: 'underline', fontWeight: 600 }}>
                          {interpolarTexto(dados.meta_title || dados.titulo_destaque, contextoMock)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#006621', marginTop: '0.1rem' }}>
                          https://parceiro.alvoconsig.com.br/convenio/...
                        </div>
                        <div style={{ fontSize: '0.825rem', color: '#545454', marginTop: '0.25rem' }}>
                          {interpolarTexto(dados.meta_description || dados.resumo_publico, contextoMock)}
                        </div>
                      </div>
                    )
                  default:
                    return null
                }
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const EVIDENCIA_VAZIA: Required<EvidenciaItem> = { fonte: null, consultado_em: null, situacao: null, natureza: null }

/** Evidência do item (contrato público v1), em uma linha. Sem situação = pendente = fora do conteúdo público. */
function CamposEvidencia({ item, onChange }: { item: EvidenciaItem; onChange: (campo: keyof EvidenciaItem, val: string) => void }) {
  const estilo = { fontSize: '0.75rem', padding: '0.25rem 0.4rem', height: 'auto' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.4rem', marginTop: '0.4rem' }}>
      <input
        type="text"
        className="form-control"
        style={estilo}
        placeholder="Fonte (texto ou https://)"
        value={item.fonte || ''}
        onChange={(e) => onChange('fonte', e.target.value)}
      />
      <input
        type="date"
        className="form-control"
        style={estilo}
        title="Consultado em"
        value={item.consultado_em || ''}
        onChange={(e) => onChange('consultado_em', e.target.value)}
      />
      <select className="form-control" style={estilo} title="Situação" value={item.situacao === 'confirmado' ? 'confirmado' : ''} onChange={(e) => onChange('situacao', e.target.value)}>
        <option value="">Pendente</option>
        <option value="confirmado">Confirmado</option>
      </select>
      <select className="form-control" style={estilo} title="Natureza" value={item.natureza || ''} onChange={(e) => onChange('natureza', e.target.value)}>
        <option value="">Natureza —</option>
        <option value="norma_oficial">Norma oficial</option>
        <option value="regra_bancaria">Regra bancária</option>
      </select>
    </div>
  )
}
