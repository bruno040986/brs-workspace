'use client'

/**
 * Nuvidio › Templates — mensagens de envio do link por WhatsApp/e-mail,
 * separadas por destino (parceiro/cliente), com a instância Z-API de cada
 * template. Variáveis: {{nome_cliente}}, {{link}}, {{proposta}}, {{valor}},
 * {{parceiro}}, {{instituicao}}, {{convenio}}, {{cpf}}.
 */
import { useEffect, useState } from 'react'
import { FileText, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  excluirNuvidioTemplate,
  listarNuvidioTemplates,
  salvarNuvidioTemplate,
  type NuvidioTemplateRow,
} from '@/lib/nuvidio/convites-actions'
import NuvidioLogo from '../_components/NuvidioLogo'

const VAZIO: Partial<NuvidioTemplateRow> & { nome: string; canal: 'whatsapp' | 'email'; destino: 'parceiro' | 'cliente'; corpo: string } = {
  nome: '',
  canal: 'whatsapp',
  destino: 'cliente',
  assunto: '',
  corpo: 'Olá, {{nome_cliente}}! Sua confirmação por vídeo da proposta {{proposta}} está pronta. Acesse: {{link}}',
  instancia_zapi_id: null,
  is_active: true,
}

export default function NuvidioTemplatesPage() {
  const [rows, setRows] = useState<NuvidioTemplateRow[]>([])
  const [instancias, setInstancias] = useState<Array<{ id: string; name: string }>>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<typeof VAZIO | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    const res = await listarNuvidioTemplates()
    if (!res.success) setErro(res.error || 'Erro ao carregar.')
    else {
      setRows(res.data || [])
      setInstancias(res.instancias || [])
    }
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
  }, [])

  async function salvar() {
    if (!editando || salvando) return
    if (!editando.nome.trim() || !editando.corpo.trim()) return setErro('Nome e corpo são obrigatórios.')
    setSalvando(true)
    setErro('')
    const res = await salvarNuvidioTemplate(editando)
    setSalvando(false)
    if (!res.success) return setErro(res.error)
    setEditando(null)
    await carregar()
  }

  async function excluir(row: NuvidioTemplateRow) {
    if (!window.confirm(`Excluir o template "${row.nome}"?`)) return
    const res = await excluirNuvidioTemplate(row.id)
    if (!res.success) setErro(res.error)
    await carregar()
  }

  const rotulo: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--brs-gray-600)', display: 'block', marginBottom: '0.3rem' }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <NuvidioLogo sufixo="— Templates" />
        </h1>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditando({ ...VAZIO })}>
          <Plus size={15} /> Novo Template
        </button>
      </div>

      {erro && <div className="card" style={{ padding: '0.8rem 1rem', borderLeft: '4px solid var(--brs-danger)', marginBottom: '1rem', color: 'var(--brs-danger)', fontWeight: 600 }}>{erro}</div>}

      {carregando ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {rows.map((t) => (
            <div key={t.id} className="card" style={{ padding: '0.9rem 1rem', display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                  {t.nome}
                  <span style={{ marginLeft: 8, fontSize: '0.65rem', fontWeight: 700, background: t.canal === 'whatsapp' ? '#25D366' : 'var(--brs-info)', color: '#fff', borderRadius: 99, padding: '0.14rem 0.5rem' }}>
                    {t.canal} → {t.destino}
                  </span>
                  {!t.is_active && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--brs-gray-400)' }}>inativo</span>}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--brs-gray-400)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{t.corpo.slice(0, 180)}{t.corpo.length > 180 ? '…' : ''}</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditando({ ...t })}><Pencil size={15} /></button>
              <button className="btn btn-ghost btn-icon" onClick={() => excluir(t)}><Trash2 size={15} style={{ color: 'var(--brs-danger)' }} /></button>
            </div>
          ))}
          {rows.length === 0 && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--brs-gray-400)' }}>Nenhum template. Crie o primeiro — sugestão: um por canal × destino.</div>}
        </div>
      )}

      {editando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: 'min(620px, 100%)', maxHeight: '90dvh', overflow: 'auto', padding: '1.1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.9rem' }}>
              <strong>{editando.id ? 'Editar' : 'Novo'} Template</strong>
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setEditando(null)}><X size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.7rem' }}>
              <div>
                <label style={rotulo}>Nome *</label>
                <input className="form-control" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
              </div>
              <div>
                <label style={rotulo}>Canal</label>
                <select className="form-control" value={editando.canal} onChange={(e) => setEditando({ ...editando, canal: e.target.value as 'whatsapp' | 'email' })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                </select>
              </div>
              <div>
                <label style={rotulo}>Destino</label>
                <select className="form-control" value={editando.destino} onChange={(e) => setEditando({ ...editando, destino: e.target.value as 'parceiro' | 'cliente' })}>
                  <option value="cliente">Cliente</option>
                  <option value="parceiro">Parceiro</option>
                </select>
              </div>
            </div>
            {editando.canal === 'email' && (
              <div style={{ marginTop: '0.7rem' }}>
                <label style={rotulo}>Assunto</label>
                <input className="form-control" value={editando.assunto || ''} onChange={(e) => setEditando({ ...editando, assunto: e.target.value })} />
              </div>
            )}
            {editando.canal === 'whatsapp' && (
              <div style={{ marginTop: '0.7rem' }}>
                <label style={rotulo}>Instância Z-API</label>
                <select className="form-control" value={editando.instancia_zapi_id || ''} onChange={(e) => setEditando({ ...editando, instancia_zapi_id: e.target.value || null })}>
                  <option value="">Padrão do sistema</option>
                  {instancias.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ marginTop: '0.7rem' }}>
              <label style={rotulo}>Corpo *</label>
              <textarea className="form-control" rows={5} value={editando.corpo} onChange={(e) => setEditando({ ...editando, corpo: e.target.value })} />
              <p style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)', margin: '0.35rem 0 0' }}>
                Variáveis: {'{{nome_cliente}} {{link}} {{proposta}} {{valor}} {{parceiro}} {{instituicao}} {{convenio}} {{cpf}}'}
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, marginTop: '0.7rem' }}>
              <input type="checkbox" checked={editando.is_active !== false} onChange={(e) => setEditando({ ...editando, is_active: e.target.checked })} /> Ativo
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
