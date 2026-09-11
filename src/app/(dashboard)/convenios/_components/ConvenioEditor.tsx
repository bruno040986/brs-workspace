'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  BookOpen,
  Briefcase,
  Building2,
  CheckCircle,
  ChevronLeft,
  FileStack,
  FileText,
  Landmark,
  Loader2,
  MessageCircleQuestion,
  Save,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react'
import { maskCep, maskCnpj, onlyDigits } from '@/lib/company-bank-accounts'
import { normalizeCnpjWsCompleto } from '@/lib/cnpj-consulta'
import { normalizarUrl } from '@/lib/url-site'
import { getAverbadorasAtivas, getTiposAutenticacaoAtivos, type Averbadora, type TipoAutenticacao } from '../../averbadoras/actions'
import { getConvenio, saveConvenio, type ConvenioRecord } from '../actions'
import {
  getOrgaos,
  getOrgaosAtivos,
  getPublicosAtivos,
  getTiposAtivos,
  type OrgaoEmpregador,
  type PublicoAtendido,
  type TipoConvenio,
} from '../cadastros-actions'
import { getConvenioBc, getFormasContratoAtivas, getInstituicoesAtivas, type ConvenioBc, type FormaContratoAtiva, type InstituicaoAtiva } from '../bc-actions'
import DocumentosLista from './bc/DocumentosLista'
import FaqTab from './bc/FaqTab'
import FormasTab from './bc/FormasTab'
import InstituicoesTab from './bc/InstituicoesTab'
import OrgaosRestricoesTab from './bc/OrgaosRestricoesTab'
import PesquisaTab from './bc/PesquisaTab'
import PublicoTab from './bc/PublicoTab'

type AbaPrincipal = 'dados' | 'bc'
type SubAbaBc = 'pesquisa' | 'publico' | 'formas' | 'instituicoes' | 'orgaos' | 'decretos' | 'faq' | 'documentos'

type FeedbackMessage = { type: 'success' | 'error'; text: string }

function capitalizar(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export default function ConvenioEditor({ convenioId, isNew = false }: { convenioId?: string; isNew?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [abaAtiva, setAbaAtiva] = useState<AbaPrincipal>(searchParams?.get('aba') === 'bc' ? 'bc' : 'dados')
  const [subAba, setSubAba] = useState<SubAbaBc>((searchParams?.get('sub') as SubAbaBc) || 'pesquisa')

  const [dados, setDados] = useState<Partial<ConvenioRecord> | null>(null)
  const [bc, setBc] = useState<ConvenioBc | null>(null)
  const [tipos, setTipos] = useState<TipoConvenio[]>([])
  const [averbadoras, setAverbadoras] = useState<Averbadora[]>([])
  const [tiposAutenticacao, setTiposAutenticacao] = useState<TipoAutenticacao[]>([])
  const [publicosAtivos, setPublicosAtivos] = useState<PublicoAtendido[]>([])
  const [formasAtivas, setFormasAtivas] = useState<FormaContratoAtiva[]>([])
  const [instituicoesAtivas, setInstituicoesAtivas] = useState<InstituicaoAtiva[]>([])
  const [orgaosAtivos, setOrgaosAtivos] = useState<OrgaoEmpregador[]>([])
  const [orgaosTodos, setOrgaosTodos] = useState<OrgaoEmpregador[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [message, setMessage] = useState<FeedbackMessage | null>(null)

  async function loadOrgaos(id: string) {
    const [ativos, todosRes] = await Promise.all([getOrgaosAtivos(id), getOrgaos(id)])
    setOrgaosAtivos(ativos)
    setOrgaosTodos(todosRes.success ? todosRes.items || [] : [])
  }

  async function reloadBc() {
    if (!convenioId) return
    const res = await getConvenioBc(convenioId)
    if (res.success) setBc(res.bc || null)
    await loadOrgaos(convenioId)
  }

  async function loadAll() {
    setLoading(true)
    setMessage(null)
    try {
      const [tiposRes, averbadorasRes, tiposAutRes, publicosRes, formasRes, instRes] = await Promise.all([
        getTiposAtivos(),
        getAverbadorasAtivas(),
        getTiposAutenticacaoAtivos(),
        getPublicosAtivos(),
        getFormasContratoAtivas(),
        getInstituicoesAtivas(),
      ])
      setTipos(tiposRes)
      setAverbadoras(averbadorasRes)
      setTiposAutenticacao(tiposAutRes)
      setPublicosAtivos(publicosRes)
      setFormasAtivas(formasRes)
      setInstituicoesAtivas(instRes)

      if (isNew) {
        setDados({
          nome: '',
          nome_reduzido: '',
          codigo: '',
          tipo_convenio_id: '',
          cnpj: '',
          razao_social: '',
          cidade: '',
          uf: '',
          cep: '',
          logradouro: '',
          numero: '',
          complemento: '',
          bairro: '',
          averbadora_id: '',
          site_averbador: '',
          tipo_autenticacao_id: '',
        })
      } else if (convenioId) {
        const [convRes, bcRes] = await Promise.all([getConvenio(convenioId), getConvenioBc(convenioId)])
        if (convRes.success) setDados(convRes.item)
        else setMessage({ type: 'error', text: convRes.error || 'Erro ao carregar o convênio.' })
        if (bcRes.success) setBc(bcRes.bc || null)
        await loadOrgaos(convenioId)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao carregar dados.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioId, isNew])

  const esferaDoTipo = useMemo(() => {
    const t = tipos.find((x) => x.id === dados?.tipo_convenio_id)
    return t?.esfera_nome || ''
  }, [tipos, dados?.tipo_convenio_id])

  const averbadorasParaSelect = useMemo(() => {
    const id = dados?.averbadora_id
    if (!id || averbadoras.some((a) => a.id === id)) return averbadoras
    return [...averbadoras, { id, nome: dados?.averbadora_nome || '(averbadora inativa)', cnpj: '', razao_social: '', site_institucional: null, is_active: false }]
  }, [averbadoras, dados?.averbadora_id, dados?.averbadora_nome])

  const tiposAutenticacaoParaSelect = useMemo(() => {
    const id = dados?.tipo_autenticacao_id
    if (!id || tiposAutenticacao.some((t) => t.id === id)) return tiposAutenticacao
    return [...tiposAutenticacao, { id, tipo: '(tipo inativo)', vigencia_horas: 0, is_active: false }]
  }, [tiposAutenticacao, dados?.tipo_autenticacao_id])

  function handleAverbadoraChange(averbadoraId: string) {
    setDados((prev) => {
      if (!prev) return prev
      if (!averbadoraId) return { ...prev, averbadora_id: '', site_averbador: '', tipo_autenticacao_id: '' }
      const jaTinhaSite = String(prev.site_averbador || '').trim()
      const averbadora = averbadoras.find((a) => a.id === averbadoraId)
      return { ...prev, averbadora_id: averbadoraId, site_averbador: jaTinhaSite || averbadora?.site_institucional || '' }
    })
  }

  function handleSiteAverbadorBlur() {
    if (!dados?.site_averbador?.trim()) return
    try {
      const normalizada = normalizarUrl(dados.site_averbador)
      setDados((prev) => (prev ? { ...prev, site_averbador: normalizada } : prev))
    } catch {
      // deixa como digitado — o erro real aparece ao tentar salvar
    }
  }

  async function fillByCnpj() {
    if (!dados) return
    const cnpj = onlyDigits(dados.cnpj || '')
    if (cnpj.length !== 14) {
      setMessage({ type: 'error', text: 'Informe um CNPJ válido para consulta.' })
      return
    }
    setConsultandoCnpj(true)
    try {
      const res = await fetch(`/api/cnpjws/cnpj/${cnpj}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.razao_social) throw new Error(data?.error || data?.message || 'CNPJ não encontrado.')
      const rica = normalizeCnpjWsCompleto(data)
      // CNPJ.ws é a fonte primária do endereçamento: sobrescreve o que vier
      // preenchido, porque é o dado oficial da Receita para aquele CNPJ.
      setDados((prev) =>
        prev
          ? {
              ...prev,
              cnpj,
              razao_social: rica.razao_social || prev.razao_social,
              logradouro: rica.logradouro || prev.logradouro,
              numero: rica.numero || prev.numero,
              complemento: rica.complemento || prev.complemento,
              bairro: rica.bairro || prev.bairro,
              cidade: rica.cidade || prev.cidade,
              uf: rica.uf || prev.uf,
              cep: rica.cep || prev.cep,
            }
          : prev,
      )
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Falha ao consultar o CNPJ.' })
    } finally {
      setConsultandoCnpj(false)
    }
  }

  // Fallback do CEP: quando o CEP é digitado/editado à mão (sem passar pelo
  // CNPJ.ws), o ViaCEP completa só os campos que estiverem VAZIOS — nunca
  // sobrescreve o que veio da Receita nem o que a pessoa digitou.
  async function fillByCep() {
    if (!dados) return
    const cep = onlyDigits(dados.cep || '')
    if (cep.length !== 8) return
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data?.erro) return
      setDados((prev) =>
        prev
          ? {
              ...prev,
              logradouro: prev.logradouro?.trim() ? prev.logradouro : data?.logradouro || '',
              complemento: prev.complemento?.trim() ? prev.complemento : data?.complemento || '',
              bairro: prev.bairro?.trim() ? prev.bairro : data?.bairro || '',
              cidade: prev.cidade?.trim() ? prev.cidade : data?.localidade || '',
              uf: prev.uf?.trim() ? prev.uf : data?.uf || '',
            }
          : prev,
      )
    } catch {
      // silencioso — endereço é opcional
    }
  }

  async function handleSaveDados(e: React.FormEvent) {
    e.preventDefault()
    if (!dados?.nome?.trim() || !dados?.nome_reduzido?.trim()) {
      setMessage({ type: 'error', text: 'Nome e nome reduzido são obrigatórios.' })
      return
    }
    if (!dados?.tipo_convenio_id) {
      setMessage({ type: 'error', text: 'Selecione o tipo de convênio.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveConvenio({
        id: dados.id,
        nome: String(dados.nome || ''),
        nome_reduzido: String(dados.nome_reduzido || ''),
        codigo: String(dados.codigo || ''),
        tipo_convenio_id: String(dados.tipo_convenio_id || ''),
        cnpj: String(dados.cnpj || ''),
        razao_social: String(dados.razao_social || ''),
        cidade: String(dados.cidade || ''),
        uf: String(dados.uf || ''),
        cep: String(dados.cep || ''),
        logradouro: String(dados.logradouro || ''),
        numero: String(dados.numero || ''),
        complemento: String(dados.complemento || ''),
        bairro: String(dados.bairro || ''),
        averbadora_id: dados.averbadora_id || null,
        site_averbador: dados.site_averbador || null,
        tipo_autenticacao_id: dados.tipo_autenticacao_id || null,
      })
      if (res.success) {
        // Salvou o cadastro básico → volta para a listagem (a Base de
        // Conhecimento se preenche depois, entrando pelo Editar). Em convênio
        // novo usa replace para o "voltar" do navegador não cair num /novo já
        // submetido, o que geraria cadastro duplicado.
        if (dados.id) router.push('/convenios')
        else router.replace('/convenios')
        return
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar o convênio.' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Erro ao salvar o convênio.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading || !dados) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
        </div>
      </div>
    )
  }

  const bcHabilitada = !!dados.id

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Landmark size={18} />
            {dados.id ? dados.nome || 'Convênio' : 'Novo Convênio'}
          </div>
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Dados básicos obrigatórios + Base de Conhecimento (opcional) para o agente de IA.
          </div>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => router.push('/convenios')}>
          <ChevronLeft size={16} />
          Voltar
        </button>
      </div>

      {message && (
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
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" className={`btn ${abaAtiva === 'dados' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setAbaAtiva('dados')}>
          <Building2 size={15} />
          Dados Básicos
        </button>
        <button
          type="button"
          className={`btn ${abaAtiva === 'bc' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => bcHabilitada && setAbaAtiva('bc')}
          disabled={!bcHabilitada}
          title={bcHabilitada ? undefined : 'Salve os dados básicos primeiro'}
        >
          <BookOpen size={15} />
          Base de Conhecimento
        </button>
      </div>

      {abaAtiva === 'dados' && (
        <form onSubmit={handleSaveDados}>
          <div className="card" style={{ padding: '1.25rem' }}>
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label className="form-label">Nome do Convênio <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-control"
                  required
                  placeholder="Ex.: Prefeitura Municipal de Mesquita"
                  value={dados.nome || ''}
                  onChange={(e) => setDados({ ...dados, nome: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Nome Reduzido <span className="required">*</span></label>
                <input
                  type="text"
                  className="form-control"
                  required
                  placeholder="Ex.: Pref. Mesquita/RJ, IPERJ..."
                  value={dados.nome_reduzido || ''}
                  onChange={(e) => setDados({ ...dados, nome_reduzido: e.target.value })}
                />
              </div>
            </div>

            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
              {dados.id && (
                <div className="form-group">
                  <label className="form-label">Código do Sistema</label>
                  <input type="text" className="form-control" disabled value={dados.codigo_sistema || ''} style={{ fontFamily: 'monospace' }} />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Código ARW</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Se já cadastrado no ARW"
                  value={dados.codigo || ''}
                  onChange={(e) => setDados({ ...dados, codigo: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Tipo de Convênio <span className="required">*</span></label>
                <select className="form-control" required value={dados.tipo_convenio_id || ''} onChange={(e) => setDados({ ...dados, tipo_convenio_id: e.target.value })}>
                  <option value="">Selecione…</option>
                  {tipos.map((t) => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Esfera</label>
                <input type="text" className="form-control" disabled value={capitalizar(esferaDoTipo) || '—'} title="A esfera vem do tipo de convênio." />
              </div>
            </div>
            {tipos.length === 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>
                Nenhum tipo de convênio cadastrado ainda. Crie em <strong>Convênios › Tipos de Convênio</strong>.
              </div>
            )}

            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--brs-gray-100)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                Dados fiscais (opcional)
              </div>
              <div className="form-group">
                <label className="form-label">CNPJ</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="00.000.000/0000-00"
                    value={maskCnpj(dados.cnpj || '')}
                    onChange={(e) => setDados({ ...dados, cnpj: onlyDigits(e.target.value) })}
                    onBlur={() => onlyDigits(dados.cnpj || '').length === 14 && fillByCnpj()}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-outline btn-sm" onClick={fillByCnpj} disabled={consultandoCnpj}>
                    {consultandoCnpj ? <Loader2 size={15} className="spinner" /> : 'Buscar'}
                  </button>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label className="form-label">Razão Social</label>
                <input type="text" className="form-control" value={dados.razao_social || ''} onChange={(e) => setDados({ ...dados, razao_social: e.target.value })} />
              </div>
              <div className="form-grid form-grid-3" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">CEP</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="00000-000"
                    value={maskCep(dados.cep || '')}
                    onChange={(e) => setDados({ ...dados, cep: onlyDigits(e.target.value) })}
                    onBlur={() => onlyDigits(dados.cep || '').length === 8 && fillByCep()}
                  />
                  <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--brs-gray-500)' }}>
                    Completa os campos vazios abaixo (ViaCEP).
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Logradouro</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Rua, avenida, praça..."
                    value={dados.logradouro || ''}
                    onChange={(e) => setDados({ ...dados, logradouro: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Número</label>
                  <input type="text" className="form-control" value={dados.numero || ''} onChange={(e) => setDados({ ...dados, numero: e.target.value })} />
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Complemento</label>
                  <input
                    type="text"
                    className="form-control"
                    value={dados.complemento || ''}
                    onChange={(e) => setDados({ ...dados, complemento: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Bairro</label>
                  <input type="text" className="form-control" value={dados.bairro || ''} onChange={(e) => setDados({ ...dados, bairro: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Cidade</label>
                  <input type="text" className="form-control" value={dados.cidade || ''} onChange={(e) => setDados({ ...dados, cidade: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">UF</label>
                  <input type="text" className="form-control" maxLength={2} value={dados.uf || ''} onChange={(e) => setDados({ ...dados, uf: e.target.value.toUpperCase() })} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--brs-gray-100)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brs-gray-500)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                Averbadora (opcional)
              </div>
              <div className="form-group">
                <label className="form-label">Averbadora</label>
                <select className="form-control" value={dados.averbadora_id || ''} onChange={(e) => handleAverbadoraChange(e.target.value)}>
                  <option value="">Sem averbadora</option>
                  {averbadorasParaSelect.map((a) => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              </div>
              {dados.averbadora_id && (
                <div className="form-grid form-grid-2" style={{ marginTop: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Site Averbador</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Ex.: formosa.neoconsig.com.br"
                      value={dados.site_averbador || ''}
                      onChange={(e) => setDados({ ...dados, site_averbador: e.target.value })}
                      onBlur={handleSiteAverbadorBlur}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo de Autenticação</label>
                    <select className="form-control" value={dados.tipo_autenticacao_id || ''} onChange={(e) => setDados({ ...dados, tipo_autenticacao_id: e.target.value })}>
                      <option value="">Selecione…</option>
                      {tiposAutenticacaoParaSelect.map((t) => (
                        <option key={t.id} value={t.id}>{t.tipo}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
              Salvar
            </button>
          </div>
        </form>
      )}

      {abaAtiva === 'bc' && bc && dados.id && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {[
              { key: 'pesquisa', label: 'Pesquisa (Jarvis)', icon: Sparkles },
              { key: 'publico', label: 'Público', icon: Users },
              { key: 'formas', label: 'Formas & Margens', icon: FileText },
              { key: 'instituicoes', label: 'Instituições', icon: Landmark },
              { key: 'orgaos', label: 'Órgãos / Restrições', icon: Briefcase },
              { key: 'decretos', label: 'Decretos', icon: ScrollText },
              { key: 'faq', label: 'FAQ', icon: MessageCircleQuestion },
              { key: 'documentos', label: 'Documentos', icon: FileStack },
            ].map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`btn ${subAba === tab.key ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSubAba(tab.key as SubAbaBc)}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {subAba === 'pesquisa' && (
            <PesquisaTab
              convenioId={dados.id}
              formasAtivas={formasAtivas}
              publicosAtivos={publicosAtivos}
              instituicoesAtivas={instituicoesAtivas}
              onSaved={reloadBc}
            />
          )}
          {subAba === 'publico' && <PublicoTab convenioId={dados.id} bc={bc} publicosAtivos={publicosAtivos} onSaved={reloadBc} />}
          {subAba === 'formas' && <FormasTab convenioId={dados.id} bc={bc} formasAtivas={formasAtivas} onSaved={reloadBc} />}
          {subAba === 'instituicoes' && (
            <InstituicoesTab
              convenioId={dados.id}
              bc={bc}
              formasAtivas={formasAtivas}
              instituicoesAtivas={instituicoesAtivas}
              publicosAtivos={publicosAtivos}
              orgaosAtivos={orgaosAtivos}
              onSaved={reloadBc}
              onOrgaoCriado={() => dados.id && loadOrgaos(dados.id)}
            />
          )}
          {subAba === 'orgaos' && <OrgaosRestricoesTab convenioId={dados.id} bc={bc} orgaosTodos={orgaosTodos} instituicoesAtivas={instituicoesAtivas} />}
          {subAba === 'decretos' && <DocumentosLista convenioId={dados.id} tipo="decreto" titulo="Decretos" />}
          {subAba === 'faq' && (
            <FaqTab
              convenioId={dados.id}
              bc={bc}
              instituicoesAtivas={instituicoesAtivas}
              formasAtivas={formasAtivas}
              averbadoraId={dados.averbadora_id}
              averbadoraNome={dados.averbadora_nome}
            />
          )}
          {subAba === 'documentos' && <DocumentosLista convenioId={dados.id} tipo="outro" titulo="Outros Documentos" />}
        </div>
      )}
    </div>
  )
}
