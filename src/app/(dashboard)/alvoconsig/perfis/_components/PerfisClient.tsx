'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Save, ShieldCheck } from 'lucide-react'
import { PERMISSOES_CRM } from '@/lib/alvoconsig/permissoes-crm'
import { getPerfisCrm, salvarPerfisCrm, type PerfilCrmItem } from '../../perfis-actions'

type Message = { type: 'success' | 'error'; text: string } | null

type PerfilEdit = Omit<PerfilCrmItem, 'permissoes'> & { permissoes: Set<string> }

const GRUPOS = Array.from(new Set(PERMISSOES_CRM.map((p) => p.grupo)))

export default function PerfisClient() {
  const [perfis, setPerfis] = useState<PerfilEdit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await getPerfisCrm()
      if (res.success) {
        setPerfis((res.perfis || []).map((p) => ({ ...p, permissoes: new Set(p.permissoes) })))
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar os perfis.' })
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(t)
  }, [message])

  const permissoesPorGrupo = useMemo(
    () => GRUPOS.map((grupo) => ({ grupo, itens: PERMISSOES_CRM.filter((p) => p.grupo === grupo) })),
    [],
  )

  function updatePerfil(id: string, fn: (p: PerfilEdit) => PerfilEdit) {
    setPerfis((prev) => prev.map((p) => (p.id === id ? fn(p) : p)))
  }

  function togglePermissao(perfilId: string, chave: string, checked: boolean) {
    updatePerfil(perfilId, (p) => {
      const next = new Set(p.permissoes)
      if (checked) next.add(chave)
      else next.delete(chave)
      return { ...p, permissoes: next }
    })
  }

  function toggleGrupo(perfilId: string, grupo: string, checked: boolean) {
    const chaves = PERMISSOES_CRM.filter((p) => p.grupo === grupo).map((p) => p.chave)
    updatePerfil(perfilId, (p) => {
      const next = new Set(p.permissoes)
      for (const c of chaves) {
        if (checked) next.add(c)
        else next.delete(c)
      }
      return { ...p, permissoes: next }
    })
  }

  function grupoMarcado(perfil: PerfilEdit, grupo: string) {
    const chaves = PERMISSOES_CRM.filter((p) => p.grupo === grupo).map((p) => p.chave)
    return chaves.every((c) => perfil.permissoes.has(c))
  }

  async function handleSalvar() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await salvarPerfisCrm(
        perfis.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, permissoes: Array.from(p.permissoes) })),
      )
      if (res.success) {
        setMessage({ type: 'success', text: 'Perfis salvos. A matriz vale para todos os parceiros.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar os perfis.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brs-gray-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} />
          Perfis de Usuário do CRM
        </div>
        <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.9rem', marginTop: '0.25rem', maxWidth: 900 }}>
          As chaves de permissão são fixas no código do CRM AlvoConsig (é o que o sistema sabe proteger). O que se edita
          aqui é a matriz perfil → permissões: quais chaves cada perfil (Master, Operacional, Atendente) recebe. A matriz é
          global — vale para todos os parceiros de uma vez. Perfis do sistema não podem ser renomeados; a descrição pode.
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '0.875rem 1rem', borderRadius: 10, marginBottom: '1rem',
            border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            background: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: message.type === 'success' ? '#065F46' : '#991B1B',
            display: 'flex', gap: '0.5rem', alignItems: 'center',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
        </div>
      ) : perfis.length === 0 ? (
        <div className="card" style={{ padding: '1.25rem', color: 'var(--brs-gray-500)' }}>
          Nenhum perfil global encontrado em <code>crm_perfis</code>.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 320 }}>Permissão</th>
                {perfis.map((perfil) => (
                  <th key={perfil.id} style={{ verticalAlign: 'top', minWidth: 200 }}>
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                      {perfil.sistema ? (
                        <span style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{perfil.nome}</span>
                      ) : (
                        <input
                          className="form-control"
                          style={{ fontWeight: 700 }}
                          value={perfil.nome}
                          placeholder="Nome do perfil"
                          onChange={(e) => updatePerfil(perfil.id, (p) => ({ ...p, nome: e.target.value }))}
                        />
                      )}
                      <textarea
                        className="form-control"
                        rows={3}
                        style={{ fontSize: '0.78rem', fontWeight: 400, resize: 'vertical' }}
                        value={perfil.descricao ?? ''}
                        placeholder="Descrição"
                        onChange={(e) => updatePerfil(perfil.id, (p) => ({ ...p, descricao: e.target.value }))}
                      />
                      <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--brs-gray-400)' }}>
                        {perfil.usuarios.toLocaleString('pt-BR')} usuário(s)
                        {perfil.usuarios > 0 ? ` em ${perfil.parceiros.toLocaleString('pt-BR')} parceiro(s)` : ''}
                        {perfil.sistema ? ' · sistema' : ''}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissoesPorGrupo.map(({ grupo, itens }) => (
                <GrupoRows
                  key={grupo}
                  grupo={grupo}
                  itens={itens}
                  perfis={perfis}
                  grupoMarcado={grupoMarcado}
                  toggleGrupo={toggleGrupo}
                  togglePermissao={togglePermissao}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && perfis.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="button" className="btn btn-outline" onClick={loadData} disabled={saving}>
            Descartar alterações
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSalvar} disabled={saving}>
            {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            Salvar perfis
          </button>
        </div>
      )}
    </div>
  )
}

function GrupoRows({
  grupo,
  itens,
  perfis,
  grupoMarcado,
  toggleGrupo,
  togglePermissao,
}: {
  grupo: string
  itens: ReadonlyArray<{ chave: string; rotulo: string }>
  perfis: PerfilEdit[]
  grupoMarcado: (perfil: PerfilEdit, grupo: string) => boolean
  toggleGrupo: (perfilId: string, grupo: string, checked: boolean) => void
  togglePermissao: (perfilId: string, chave: string, checked: boolean) => void
}) {
  return (
    <>
      <tr style={{ background: 'var(--brs-gray-50, #F9FAFB)' }}>
        <td style={{ fontWeight: 800, color: 'var(--brs-gray-800)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.04em' }}>
          {grupo}
        </td>
        {perfis.map((perfil) => (
          <td key={perfil.id} style={{ textAlign: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: 'var(--brs-gray-500)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={grupoMarcado(perfil, grupo)}
                onChange={(e) => toggleGrupo(perfil.id, grupo, e.target.checked)}
                title={`Marcar/desmarcar todas de ${grupo} para ${perfil.nome}`}
              />
              todas
            </label>
          </td>
        ))}
      </tr>
      {itens.map((item) => (
        <tr key={item.chave}>
          <td>
            <div style={{ fontWeight: 500, color: 'var(--brs-gray-800)' }}>{item.rotulo}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--brs-gray-400)', fontFamily: 'monospace' }}>{item.chave}</div>
          </td>
          {perfis.map((perfil) => (
            <td key={perfil.id} style={{ textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={perfil.permissoes.has(item.chave)}
                onChange={(e) => togglePermissao(perfil.id, item.chave, e.target.checked)}
                aria-label={`${item.rotulo} — ${perfil.nome}`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
