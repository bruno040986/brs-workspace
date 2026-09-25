'use client'

/**
 * Evidência de verificação externa (fatia 1 do plano v2, 25/09/2026).
 *
 * Bloco fixo "O que fazer / O que anexar" + lista dos prints/PDFs já anexados
 * (com data de captura, autor e hash SHA-256) + upload. Usado nos itens de
 * Presença Digital e Chave PIX. Para Serasa/Cartão CNPJ só as instruções
 * entram aqui — o anexo continua sendo o upload da Análise (`docs_analise`).
 */
import { useState, type ChangeEvent } from 'react'
import { Eye, EyeOff, Loader2, Trash2, UploadCloud } from 'lucide-react'
import DocumentViewer from './DocumentViewer'
import {
  EVIDENCIA_ACEITA,
  INSTRUCOES_EVIDENCIA,
  type CorbanOnboardingEvidencia,
  type EvidenciaTipo,
} from '@/lib/agente-corban-onboarding'
import { anexarEvidencia, removerEvidencia } from '../actions'

export type EvidenciaComUrl = CorbanOnboardingEvidencia & { signedUrl: string | null; autorNome: string | null }

export function InstrucoesEvidencia({ tipo }: { tipo: EvidenciaTipo }) {
  const i = INSTRUCOES_EVIDENCIA[tipo]
  return (
    <div style={{ background: 'var(--brs-gray-50, #f8fafc)', border: '1px solid var(--brs-gray-100)', borderRadius: 8, padding: '0.55rem 0.75rem', margin: '0.5rem 0', fontSize: '0.78rem', color: 'var(--brs-gray-700)' }}>
      <div style={{ fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)' }}>O que fazer</div>
      <ol style={{ margin: '0.2rem 0 0.4rem 1.1rem', padding: 0 }}>
        {i.fazer.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ol>
      <div style={{ fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--brs-gray-500)' }}>O que anexar</div>
      <div>{i.anexar}</div>
    </div>
  )
}

function tamanhoLegivel(bytes: number): string {
  if (!bytes) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function EvidenciasBloco({
  tipo,
  itemId,
  bloqueado,
  evidencias,
  onChanged,
  onErro,
}: {
  tipo: EvidenciaTipo
  itemId: string
  /** Item já aprovado: a evidência faz parte do registro e não sai mais. */
  bloqueado: boolean
  evidencias: EvidenciaComUrl[]
  onChanged: () => Promise<void> | void
  onErro: (texto: string) => void
}) {
  const [subindo, setSubindo] = useState(false)
  const [removendo, setRemovendo] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSubindo(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      const res = await anexarEvidencia(itemId, fd)
      if (!res.success) onErro(res.error)
      await onChanged()
    } finally {
      setSubindo(false)
    }
  }

  async function handleRemover(ev: EvidenciaComUrl) {
    if (!window.confirm(`Remover a evidência "${ev.file_name}"? O evento de remoção fica no histórico.`)) return
    setRemovendo(ev.id)
    try {
      const res = await removerEvidencia(ev.id)
      if (!res.success) onErro(res.error)
      await onChanged()
    } finally {
      setRemovendo(null)
    }
  }

  return (
    <div>
      <InstrucoesEvidencia tipo={tipo} />

      {evidencias.length > 0 && (
        <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.5rem' }}>
          {evidencias.map((ev) => (
            <div key={ev.id} style={{ border: '1px dashed var(--brs-gray-200)', borderRadius: 8, padding: '0.45rem 0.6rem', fontSize: '0.78rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--brs-gray-800)' }}>{ev.file_name}</span>
                <span style={{ color: 'var(--brs-gray-400)' }}>
                  {new Date(ev.capturado_em).toLocaleString('pt-BR')}
                  {ev.autorNome ? ` · ${ev.autorNome}` : ''}
                  {ev.tamanho_bytes ? ` · ${tamanhoLegivel(ev.tamanho_bytes)}` : ''}
                </span>
                <code title={`SHA-256 ${ev.hash_sha256}`} style={{ fontSize: '0.68rem', color: 'var(--brs-gray-400)' }}>
                  sha256 {ev.hash_sha256.slice(0, 12)}…
                </code>
                <span style={{ flex: 1 }} />
                {ev.signedUrl && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberta((a) => (a === ev.id ? null : ev.id))}>
                    {aberta === ev.id ? <EyeOff size={13} /> : <Eye size={13} />} {aberta === ev.id ? 'Fechar' : 'Ver'}
                  </button>
                )}
                {!bloqueado && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={removendo === ev.id} title="Remover evidência" onClick={() => handleRemover(ev)}>
                    {removendo === ev.id ? <Loader2 size={13} className="spinner" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
              {aberta === ev.id && ev.signedUrl && (
                <div style={{ marginTop: '0.4rem' }}>
                  <DocumentViewer files={[{ fileName: ev.file_name, url: ev.signedUrl }]} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <label className="btn btn-outline btn-sm" style={{ cursor: subindo ? 'wait' : 'pointer' }}>
        {subindo ? <Loader2 size={14} className="spinner" /> : <UploadCloud size={14} />}
        {evidencias.length ? 'Anexar outra evidência' : 'Anexar evidência'}
        <input type="file" accept={EVIDENCIA_ACEITA[tipo].join(',')} style={{ display: 'none' }} onChange={handleUpload} disabled={subindo} />
      </label>
    </div>
  )
}
