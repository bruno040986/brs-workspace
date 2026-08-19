'use client'

import { useEffect, useState } from 'react'
import { Plus, Info } from 'lucide-react'
import type { WizardState } from './wizard-types'
import { newKey } from './wizard-types'
import MessageBlockEditor from './MessageBlockEditor'
import { listWhatsappTemplatesForCampaign } from '../../actions'

export default function StepMessages({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const [scpTemplates, setScpTemplates] = useState<Array<{ id: string; name: string; body: string }>>([])

  useEffect(() => {
    listWhatsappTemplatesForCampaign().then((r) => { if (r.success) setScpTemplates(r.items) })
  }, [])

  const sample = state.recipients[0]?.variables || {}
  const sampleVars: Record<string, string> = { ...sample, nome: sample.nome ?? state.recipients[0]?.name ?? '', telefone: sample.telefone ?? state.recipients[0]?.phone ?? '' }

  function updateBlock(key: string, p: Partial<WizardState['blocks'][number]>) {
    patch({ blocks: state.blocks.map((b) => (b.key === key ? { ...b, ...p } : b)) })
  }
  function removeBlock(key: string) {
    if (state.blocks.length <= 1) return
    patch({ blocks: state.blocks.filter((b) => b.key !== key) })
  }
  function addBlock() {
    patch({ blocks: [...state.blocks, { key: newKey(), body: '', media: null, contact: null }] })
  }
  function duplicateBlock(key: string) {
    const src = state.blocks.find((b) => b.key === key)
    if (!src) return
    patch({ blocks: [...state.blocks, { ...src, key: newKey() }] })
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Info size={16} style={{ marginTop: 2 }} />
        <div style={{ fontSize: '0.85rem' }}>
          Cada <strong>bloco</strong> é uma variação da mensagem. Com a rotação ligada (passo 3), os destinatários recebem blocos alternados —
          a Z-API recomenda ao menos <strong>3 a 5 variações</strong> para reduzir risco de bloqueio. Use as variáveis para personalizar
          (ex.: <code>{'{{nome}}'}</code>). Formatação aceita pelo WhatsApp: <b>*negrito*</b>, <i>_itálico_</i>, <s>~tachado~</s> e <code>```mono```</code> — não existe sublinhado.
        </div>
      </div>

      {state.blocks.map((b, i) => (
        <MessageBlockEditor
          key={b.key}
          index={i}
          block={b}
          variables={state.variables}
          sampleVars={sampleVars}
          scpTemplates={scpTemplates}
          canRemove={state.blocks.length > 1}
          onChange={(p) => updateBlock(b.key, p)}
          onRemove={() => removeBlock(b.key)}
          onDuplicate={() => duplicateBlock(b.key)}
        />
      ))}

      <button type="button" className="btn btn-outline" onClick={addBlock} style={{ justifySelf: 'start' }}><Plus size={16} /> Adicionar bloco (variação)</button>
    </div>
  )
}
