'use client'

import { useEffect, useState } from 'react'
import { inspectAssinafyTemplates } from '../../actions'
import { FileText, Loader2, RefreshCw, AlertCircle, Users, Tag } from 'lucide-react'

type TemplateRole = { id: string; name: string }
type TemplateField = { id: string; field_id: string; label: string; type: string }
type AssinafyTemplateView = {
  id: string
  name: string
  roles: TemplateRole[]
  fields: TemplateField[]
}

/**
 * Modelos de Documento — catálogo (read-only) dos templates da Assinafy.
 *
 * Decisão de arquitetura: com a Opção A (template hospedado na Assinafy), o
 * contrato e seus campos vivem lá. Esta tela apenas LISTA os templates e seus
 * papéis/campos; o Construtor de Processos escolhe um destes por documento,
 * permitindo reuso do mesmo modelo em fluxos diferentes.
 */
export default function DocumentTemplatesPage() {
  const [templates, setTemplates] = useState<AssinafyTemplateView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await inspectAssinafyTemplates()
    if (res.success) {
      setTemplates((res.templates || []) as AssinafyTemplateView[])
    } else {
      setError(res.error || 'Não foi possível carregar os templates da Assinafy.')
      setTemplates([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
            Modelos de Documento
          </h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0', maxWidth: 720 }}>
            Templates de contrato hospedados na Assinafy. O Construtor de Processos escolhe um destes por
            documento — assim o mesmo modelo pode ser reutilizado em fluxos diferentes. Para criar ou editar
            um template (campos e posições), use o painel da Assinafy.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {loading ? <Loader2 size={16} className="spinner" /> : <RefreshCw size={16} />}
          Atualizar
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', borderRadius: 8, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem' }}>
          <AlertCircle size={20} />
          <span style={{ fontSize: '0.875rem' }}>{error} <span style={{ color: 'var(--brs-gray-500)' }}>(Verifique a configuração em API Assinatura Eletrônica.)</span></span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={28} className="spinner" style={{ color: 'var(--brs-navy)' }} />
        </div>
      ) : templates && templates.length === 0 && !error ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--brs-gray-500)' }}>
          <FileText size={32} style={{ margin: '0 auto 0.75rem', color: 'var(--brs-gray-300)' }} />
          Nenhum template cadastrado na Assinafy ainda. Crie um no painel da Assinafy e ele aparecerá aqui.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {(templates || []).map((tpl) => (
            <div key={tpl.id} className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <div style={{ background: 'rgba(59,130,246,0.1)', color: '#3B82F6', padding: '0.45rem', borderRadius: 8 }}>
                  <FileText size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)' }}>{tpl.name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>{tpl.id}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.8rem', color: 'var(--brs-gray-700)', marginBottom: '0.4rem' }}>
                    <Users size={14} /> Papéis de assinatura ({tpl.roles?.length || 0})
                  </div>
                  {(tpl.roles || []).map((r) => (
                    <div key={r.id} style={{ fontSize: '0.78rem', color: 'var(--brs-gray-600)' }}>
                      • {r.name} <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-400)', fontSize: '0.7rem' }}>{r.id}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.8rem', color: 'var(--brs-gray-700)', marginBottom: '0.4rem' }}>
                    <Tag size={14} /> Campos preenchidos ({tpl.fields?.length || 0})
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {(tpl.fields || []).map((f, i) => (
                      <div key={`${f.field_id}-${i}`} style={{ fontSize: '0.78rem', color: 'var(--brs-gray-600)' }}>
                        • {f.label || '(sem nome)'} <span style={{ color: 'var(--brs-gray-400)' }}>[{f.type || 'text'}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
