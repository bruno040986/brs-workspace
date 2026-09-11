'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Sparkles } from 'lucide-react'
import FaqEditor, { type FaqContexto } from '@/components/faq/FaqEditor'
import { desvincularFaq, getFaqGeraisDisponiveis, vincularFaq, type FaqGrupoGeral } from '../../faq-actions'
import { getContagemSugestoesFaqPendentes } from '../../pesquisa-actions'
import type { ConvenioBc, FormaContratoAtiva, InstituicaoAtiva } from '../../bc-actions'

const ENTIDADE_TIPO_LABEL: Record<string, string> = {
  instituicao_financeira: 'Instituição Financeira',
  forma_contrato: 'Forma de Contrato',
  averbadora: 'Averbadora',
}

export default function FaqTab({
  convenioId,
  bc,
  instituicoesAtivas,
  formasAtivas,
  averbadoraId,
  averbadoraNome,
}: {
  convenioId: string
  bc: ConvenioBc
  instituicoesAtivas: InstituicaoAtiva[]
  formasAtivas: FormaContratoAtiva[]
  averbadoraId?: string | null
  averbadoraNome?: string | null
}) {
  const [sugestoesFaqPendentes, setSugestoesFaqPendentes] = useState(0)
  const [grupos, setGrupos] = useState<FaqGrupoGeral[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function loadGrupos() {
    setLoading(true)
    try {
      const res = await getFaqGeraisDisponiveis(convenioId)
      if (res.success) {
        const g = res.grupos || []
        setGrupos(g)
        const marcados = new Set<string>()
        for (const grupo of g) for (const item of grupo.itens) if (item.vinculada) marcados.add(item.id)
        setSelecionados(marcados)
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar FAQ geral.' })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGrupos()
    getContagemSugestoesFaqPendentes(convenioId).then(setSugestoesFaqPendentes).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioId])

  function toggle(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTodasDoGrupo(grupo: FaqGrupoGeral) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      const todasMarcadas = grupo.itens.every((i) => next.has(i.id))
      for (const item of grupo.itens) {
        if (todasMarcadas) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  async function salvarSelecao() {
    setSaving(true)
    setMessage(null)
    try {
      const todosIds = grupos.flatMap((g) => g.itens.map((i) => i.id))
      const paraVincular = todosIds.filter((id) => selecionados.has(id))
      const paraDesvincular = todosIds.filter(
        (id) => !selecionados.has(id) && grupos.some((g) => g.itens.some((i) => i.id === id && i.vinculada)),
      )

      const resultados = await Promise.all([
        paraVincular.length > 0 ? vincularFaq(convenioId, paraVincular) : Promise.resolve({ success: true }),
        ...paraDesvincular.map((id) => desvincularFaq(convenioId, id)),
      ])
      const erro = resultados.find((r: any) => !r.success) as { success: boolean; error?: string } | undefined
      if (erro) {
        setMessage({ type: 'error', text: erro.error || 'Erro ao salvar a seleção.' })
      } else {
        setMessage({ type: 'success', text: 'Seleção de FAQ geral salva.' })
        await loadGrupos()
      }
    } finally {
      setSaving(false)
    }
  }

  const contextos: FaqContexto[] = [
    ...(averbadoraId && averbadoraNome ? [{ tipo: 'averbadora' as const, id: averbadoraId, nome: averbadoraNome }] : []),
    ...bc.instituicoes.map((i) => ({
      tipo: 'instituicao_financeira' as const,
      id: i.financial_institution_id,
      nome: instituicoesAtivas.find((x) => x.id === i.financial_institution_id)?.name || '(instituição)',
    })),
    ...bc.formas.map((f) => ({
      tipo: 'forma_contrato' as const,
      id: f.forma_contrato_id,
      nome: formasAtivas.find((x) => x.id === f.forma_contrato_id)?.nome || '(forma)',
    })),
  ]

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <FaqEditor escopo="convenio" convenioId={convenioId} titulo="FAQ do Convênio" contextos={contextos} />

      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Importar FAQ Geral</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)', marginBottom: '0.75rem' }}>
          FAQs cadastradas como regra geral na averbadora, nas instituições vinculadas ou nas formas permitidas deste convênio.
        </div>

        {message && (
          <div
            style={{
              marginBottom: '0.75rem',
              padding: '0.6rem 0.8rem',
              borderRadius: 10,
              border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
              background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              color: message.type === 'success' ? '#065F46' : '#991B1B',
              display: 'flex',
              gap: '0.4rem',
              alignItems: 'center',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {message.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
          </div>
        ) : grupos.length === 0 ? (
          <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.85rem' }}>
            Nenhuma FAQ geral cadastrada nas entidades vinculadas a este convênio ainda.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {grupos.map((grupo) => (
              <div key={`${grupo.entidade_tipo}-${grupo.entidade_id}`} style={{ border: '1px solid var(--brs-gray-100)', borderRadius: 10, padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                    {ENTIDADE_TIPO_LABEL[grupo.entidade_tipo]} · {grupo.nome}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleTodasDoGrupo(grupo)}>
                    {grupo.itens.every((i) => selecionados.has(i.id)) ? 'Desmarcar todas' : `Importar todas de ${grupo.nome}`}
                  </button>
                </div>
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  {grupo.itens.map((item) => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <input type="checkbox" checked={selecionados.has(item.id)} onChange={() => toggle(item.id)} style={{ marginTop: '0.2rem' }} />
                      <span>
                        <strong>{item.pergunta}</strong> — {item.resposta.slice(0, 90)}
                        {item.resposta.length > 90 ? '…' : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-primary" onClick={salvarSelecao} disabled={saving}>
                {saving ? <Loader2 size={16} className="spinner" /> : null}
                Salvar Seleção
              </button>
            </div>
          </div>
        )}
      </div>

      {sugestoesFaqPendentes > 0 && (
        <a
          href={`/convenios/${convenioId}?aba=bc&sub=pesquisa`}
          className="card"
          style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', border: '1px solid var(--brs-gray-200)' }}
        >
          <Sparkles size={22} style={{ color: 'var(--brs-navy)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--brs-gray-900)' }}>
              {sugestoesFaqPendentes} sugestão(ões) de FAQ aguardando revisão
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>O Jarvis encontrou essas perguntas nos documentos pesquisados — revise na aba Pesquisa.</div>
          </div>
        </a>
      )}
    </div>
  )
}
