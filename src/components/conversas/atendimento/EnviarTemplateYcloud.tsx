'use client'

import { useEffect, useMemo, useReducer, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import type { TemplateYcloud } from '@/lib/ycloud/leitura'
import { enviarTemplateYcloud, getTemplatesAprovadosConversa } from '@/lib/central-conversas/ycloud-conversa-actions'
import { estadoInicialEnvio, novoOperationId, reduzirEnvio, type AcaoEnvio, type EstadoEnvio } from '@/lib/central-conversas/envio-intencao'
import { motivoNaoSuportado, posicoesVariaveis, renderizarPrevia, variaveisFaltando, variaveisParaEnvio } from '@/lib/central-conversas/template-ycloud'

type Props = {
  instanciaId: string
  /** Conversa existente (destino resolvido no servidor) OU `telefone` (nova conversa). */
  conversationId?: number
  telefone?: string
  onFechar: () => void
  onEnviado: (conversationId: number | null) => void
}

const aviso = { fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 8px' } as const

/**
 * Seletor + envio de template (WhatsApp Oficial). Intenção de envio pela mesma
 * máquina do "Nova conversa": chave nasce 1× por intenção, incerto congela e só
 * repete com a mesma chave (ou "novo envio" com outra). Sem cálculo de janela/cobrança aqui.
 */
export default function EnviarTemplateYcloud({ instanciaId, conversationId, telefone, onFechar, onEnviado }: Props) {
  const [templates, setTemplates] = useState<TemplateYcloud[] | null>(null)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [tpl, setTpl] = useState<TemplateYcloud | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [estado, dispatch] = useReducer((s: EstadoEnvio, a: AcaoEnvio) => reduzirEnvio(s, a), { instanciaId, telefone: telefone || '', texto: '' }, estadoInicialEnvio)
  const { fase, mensagem } = estado
  const congelado = fase !== 'editando'

  useEffect(() => {
    let vivo = true
    void getTemplatesAprovadosConversa(instanciaId)
      .then((r) => {
        if (!vivo) return
        if (r.success) setTemplates(r.data || [])
        else setErroLista(r.error || 'Não foi possível carregar os templates.')
      })
      .catch(() => vivo && setErroLista('Não foi possível carregar os templates.'))
    return () => {
      vivo = false
    }
  }, [instanciaId])

  useEffect(() => {
    if (fase === 'concluido') onEnviado(estado.conversationId)
  }, [fase]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtrados = useMemo(() => (templates || []).filter((t) => t.nome.toLowerCase().includes(busca.trim().toLowerCase())), [templates, busca])
  const faltando = tpl ? variaveisFaltando(tpl.variaveis, valores) : []
  const previa = tpl ? renderizarPrevia(tpl.componentes, valores) : null

  async function enviar() {
    if (fase !== 'editando' && fase !== 'incerto') return
    let acao: AcaoEnvio
    let proximo: EstadoEnvio
    if (fase === 'incerto') {
      acao = { tipo: 'repetir' }
      proximo = reduzirEnvio(estado, acao)
    } else {
      if (!tpl || faltando.length) return dispatch({ tipo: 'erro', mensagem: 'Preencha todas as variáveis.' })
      const payload = { nome: tpl.nome, idioma: tpl.idioma, variaveis: variaveisParaEnvio(tpl.variaveis, valores) }
      const editar: AcaoEnvio = { tipo: 'editar', campos: { texto: JSON.stringify(payload) } }
      const comCampos = reduzirEnvio(estado, editar)
      acao = { tipo: 'enviar', chave: novoOperationId() }
      proximo = reduzirEnvio(comCampos, acao)
      dispatch(editar)
    }
    if (proximo.fase !== 'enviando' || !proximo.intencao) return
    dispatch(acao)
    const i = proximo.intencao
    let resultado
    try {
      resultado = await enviarTemplateYcloud({ conversationId, instanciaId: i.instanciaId, telefone: conversationId ? undefined : i.telefone, template: JSON.parse(i.texto), operationId: i.chave })
    } catch {
      resultado = { resultado: 'incerto' as const, mensagem: 'Não foi possível confirmar com o servidor (conexão ou erro inesperado).' }
    }
    dispatch({ tipo: 'resultado', resultado })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 400 }} data-brs-messenger-ignore-close="true">
      <div className="brs-messenger" style={{ width: 460, maxWidth: '94vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden' }} data-brs-messenger-ignore-close="true">
        <div className="brs-messenger-titlebar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Enviar template (WhatsApp Oficial)</span>
          <button type="button" onClick={onFechar} className="brs-messenger-toolbar-btn" aria-label="Fechar">
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--msn-surface)', overflowY: 'auto' }}>
          {!templates && !erroLista && (
            <div style={{ fontSize: 12, color: 'var(--msn-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Loader2 size={13} className="spinner" /> Carregando templates…
            </div>
          )}
          {erroLista && <div style={{ fontSize: 12, color: '#b91c1c' }}>{erroLista}</div>}
          {templates && templates.length === 0 && <div style={{ fontSize: 12, color: 'var(--msn-muted)' }}>Nenhum template aprovado nesta conta.</div>}
          {templates && templates.length > 0 && (
            <>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--msn-muted)' }} />
                <input className="brs-messenger-search-input" style={{ width: '100%', paddingLeft: 26 }} placeholder="Buscar template…" value={busca} disabled={congelado} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {filtrados.length === 0 && <div style={{ fontSize: 11, color: 'var(--msn-muted)' }}>Nenhum template com esse nome.</div>}
                {filtrados.map((t) => {
                  const motivo = motivoNaoSuportado(t.componentes)
                  const ativo = tpl?.nome === t.nome && tpl.idioma === t.idioma
                  return (
                    <button
                      key={`${t.nome}/${t.idioma}`}
                      type="button"
                      disabled={congelado || !!motivo}
                      title={motivo ? `Ainda não suportado nesta tela: ${motivo}` : undefined}
                      onClick={() => {
                        setTpl(t)
                        setValores({})
                      }}
                      style={{ textAlign: 'left', padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--msn-soft-border)', cursor: congelado || motivo ? 'default' : 'pointer', opacity: motivo ? 0.55 : 1, background: ativo ? 'var(--msn-item-active)' : 'var(--msn-surface)', color: 'var(--msn-text)' }}
                    >
                      <strong>{t.nome}</strong> <span style={{ opacity: 0.7 }}>· {t.idioma} · {t.categoria} · qualidade {t.qualidade}</span>
                      {motivo && <div style={{ fontSize: 11, color: '#92400e' }}>Ainda não suportado nesta tela: {motivo}</div>}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {tpl && previa && (
            <>
              {posicoesVariaveis(tpl.variaveis).map((p) => (
                <label key={p} style={{ fontSize: 12, fontWeight: 700, color: 'var(--msn-text)' }}>
                  Variável {`{{${p}}}`}
                  <input className="brs-messenger-profile-input" style={{ width: '100%', marginTop: 4 }} value={valores[p] || ''} disabled={congelado} onChange={(e) => setValores((v) => ({ ...v, [p]: e.target.value }))} />
                </label>
              ))}
              <div style={{ fontSize: 12.5, color: 'var(--msn-text)', background: 'var(--msn-surface-alt)', border: '1px solid var(--msn-soft-border)', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap' }}>
                {previa.header && <div style={{ fontWeight: 700 }}>{previa.header}</div>}
                <div>{previa.corpo}</div>
                {previa.rodape && <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>{previa.rodape}</div>}
                {previa.botoes.length > 0 && <div style={{ fontSize: 11, marginTop: 6 }}>{previa.botoes.map((b) => `[${b}]`).join(' ')}</div>}
              </div>
            </>
          )}

          {fase === 'editando' && mensagem && <div style={{ fontSize: 12, color: '#b91c1c' }}>{mensagem}</div>}
          {fase === 'incerto' && (
            <div style={aviso}>
              <strong>Envio não confirmado.</strong> {mensagem} Os campos ficam travados: confira se a mensagem apareceu na conversa. &quot;Repetir&quot; reaproveita a mesma chave e conteúdo; &quot;Novo envio&quot; usa outra chave.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" onClick={onFechar} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
              {fase === 'incerto' ? 'Fechar' : 'Cancelar'}
            </button>
            {fase === 'incerto' && (
              <button type="button" onClick={() => dispatch({ tipo: 'novoEnvio' })} className="brs-messenger-pill-btn" style={{ height: 28, padding: '0 12px' }}>
                Novo envio (outra chave)
              </button>
            )}
            <button type="button" onClick={() => void enviar()} disabled={fase === 'enviando' || (fase === 'editando' && (!tpl || faltando.length > 0))} className="brs-messenger-primary-button" style={{ padding: '6px 14px' }}>
              {fase === 'enviando' ? 'Enviando…' : fase === 'incerto' ? 'Repetir esta operação (mesma chave)' : 'Enviar template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
