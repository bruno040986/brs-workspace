'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, KeyRound, Loader2, Target, UserCheck, UserX } from 'lucide-react'
import { getAlvoconsigConfig, salvarAlvoconsigConfig, setUsuarioCrmAtivo } from '../alvoconsig-actions'

type UsuarioCrm = {
  id: string
  nome: string
  email: string
  papel: 'master' | 'operacional' | 'atendente'
  ativo: boolean
  created_at: string
}

const PERFIL_NOME: Record<string, string> = { master: 'Master', operacional: 'Operacional', atendente: 'Atendente' }

function nomePerfil(papel: string) {
  return PERFIL_NOME[papel] ?? papel
}

type ConfigCrm = {
  habilitado: boolean
  max_atendentes: number
  max_instancias_receptivas: number
  max_instancias_disparo: number
  disparo_min_instancias: number
  disparo_min_templates_por_instancia: number
  habilitado_em: string | null
} | null

type Message = { type: 'success' | 'error'; text: string } | null

export default function AlvoconsigTab({ agenteParceiroId }: { agenteParceiroId: string }) {
  const [carregando, setCarregando] = useState(true)
  const [config, setConfig] = useState<ConfigCrm>(null)
  const [usuarios, setUsuarios] = useState<UsuarioCrm[]>([])
  const [arwCode, setArwCode] = useState('')
  const [loginProvisionado, setLoginProvisionado] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const [habilitado, setHabilitado] = useState(false)
  const [maxAtendentes, setMaxAtendentes] = useState('10')
  const [maxReceptivas, setMaxReceptivas] = useState('2')
  const [maxDisparo, setMaxDisparo] = useState('10')
  const [minInstancias, setMinInstancias] = useState('3')
  const [minTemplates, setMinTemplates] = useState('3')
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [busyUsuarioId, setBusyUsuarioId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await getAlvoconsigConfig(agenteParceiroId)
      if (res.success) {
        setConfig((res.config || null) as ConfigCrm)
        setUsuarios((res.usuarios || []) as UsuarioCrm[])
        setArwCode(String(res.arwCode || ''))
        setLoginProvisionado(res.loginProvisionado === true)
        setHabilitado(res.config?.habilitado === true)
        setMaxAtendentes(String(res.config?.max_atendentes ?? 10))
        setMaxReceptivas(String(res.config?.max_instancias_receptivas ?? 2))
        setMaxDisparo(String(res.config?.max_instancias_disparo ?? 10))
        setMinInstancias(String(res.config?.disparo_min_instancias ?? 3))
        setMinTemplates(String(res.config?.disparo_min_templates_por_instancia ?? 3))
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao carregar a configuração.' })
      }
    } finally {
      setCarregando(false)
    }
  }, [agenteParceiroId])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function handleSalvarConfig() {
    setSalvandoConfig(true)
    setMessage(null)
    try {
      const res = await salvarAlvoconsigConfig({
        agenteParceiroId,
        habilitado,
        maxAtendentes: Number.parseInt(maxAtendentes, 10) || 0,
        maxInstanciasReceptivas: Number.parseInt(maxReceptivas, 10),
        maxInstanciasDisparo: Number.parseInt(maxDisparo, 10),
        disparoMinInstancias: Number.parseInt(minInstancias, 10),
        disparoMinTemplatesPorInstancia: Number.parseInt(minTemplates, 10),
      })
      if (res.success) {
        setMessage({
          type: 'success',
          text: habilitado
            ? 'AlvoConsig habilitado — o master é o próprio acesso do parceiro (mesmo login do ARW e do portal).'
            : 'AlvoConsig desabilitado para este parceiro.',
        })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      }
    } finally {
      setSalvandoConfig(false)
    }
  }

  async function handleToggleUsuario(usuario: UsuarioCrm) {
    setBusyUsuarioId(usuario.id)
    setMessage(null)
    try {
      const res = await setUsuarioCrmAtivo(usuario.id, !usuario.ativo)
      if (res.success) await loadData()
      else setMessage({ type: 'error', text: res.error || 'Erro ao alterar o usuário.' })
    } finally {
      setBusyUsuarioId(null)
    }
  }

  if (carregando) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--brs-navy)' }} />
      </div>
    )
  }

  const master = usuarios.find((usuario) => usuario.papel === 'master') || null
  const demaisUsuarios = usuarios.filter((usuario) => usuario.papel !== 'master')

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
        <Target size={18} />
        CRM AlvoConsig
      </div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.875rem', marginTop: '-0.5rem' }}>
        Habilitado, o card do CRM aparece no Portal Parceiro deste parceiro. O acesso master é o
        próprio login do parceiro (aba Acesso — mesma credencial do ARW e do portal); os demais usuários
        são criados pelo master dentro do CRM, com perfil Operacional ou Atendente (matriz em AlvoConsig › Perfis de Usuário).
      </div>

      {message && (
        <div
          style={{
            padding: '0.875rem 1rem', borderRadius: 10,
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

      {!loginProvisionado && (
        <div style={{ padding: '0.875rem 1rem', borderRadius: 10, border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <KeyRound size={18} />
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            {arwCode
              ? `O login do parceiro (código ${arwCode.toUpperCase()}) ainda não foi provisionado — conclua o acesso antes de habilitar o AlvoConsig.`
              : 'Preencha o Código ARW na aba Acesso e provisione o login do parceiro antes de habilitar o AlvoConsig.'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap', padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600, color: 'var(--brs-gray-800)' }}>
          <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} />
          CRM habilitado para este parceiro
        </label>
        <div className="form-group" style={{ width: 150, margin: 0 }}>
          <label className="form-label">Máx. de usuários</label>
          <input type="number" min={0} max={500} className="form-control" value={maxAtendentes} onChange={(e) => setMaxAtendentes(e.target.value)} />
        </div>
        <div className="form-group" style={{ width: 160, margin: 0 }}>
          <label className="form-label">Máx. números receptivos</label>
          <input type="number" min={0} max={20} className="form-control" value={maxReceptivas} onChange={(e) => setMaxReceptivas(e.target.value)} />
        </div>
        <div className="form-group" style={{ width: 160, margin: 0 }}>
          <label className="form-label">Máx. números de disparo</label>
          <input type="number" min={0} max={50} className="form-control" value={maxDisparo} onChange={(e) => setMaxDisparo(e.target.value)} />
        </div>
        <div className="form-group" style={{ width: 180, margin: 0 }}>
          <label className="form-label">Mín. números p/ habilitar disparo</label>
          <input type="number" min={1} max={50} className="form-control" value={minInstancias} onChange={(e) => setMinInstancias(e.target.value)} />
        </div>
        <div className="form-group" style={{ width: 160, margin: 0 }}>
          <label className="form-label">Mín. templates por número</label>
          <input type="number" min={1} max={20} className="form-control" value={minTemplates} onChange={(e) => setMinTemplates(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" onClick={handleSalvarConfig} disabled={salvandoConfig}>
          {salvandoConfig ? <Loader2 size={16} className="spinner" /> : null}
          Salvar configuração
        </button>
        {config?.habilitado_em && (
          <span style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)' }}>
            Habilitado em {new Date(config.habilitado_em).toLocaleDateString('pt-BR')}
          </span>
        )}
        <p style={{ width: '100%', margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>
          Mín. números e mín. templates definem quando o parceiro pode criar campanha de Disparo de WhatsApp Não Oficial.
          Ex.: 3 e 3 = precisa de 3 números conectados e 9 templates.
        </p>
      </div>

      {master && (
        <div style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.5rem' }}>Acesso Master</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{master.nome}</span>
            <span className="badge badge-gray">{nomePerfil(master.papel)}</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--brs-gray-500)' }}>
              usa o login do parceiro (código {arwCode ? arwCode.toUpperCase() : '-'})
            </span>
            <span className={`badge ${master.ativo ? 'badge-success' : 'badge-gray'}`}>
              {master.ativo ? 'Ativo' : 'Inativo'}
            </span>
            <button
              type="button"
              className={`btn btn-sm ${master.ativo ? 'btn-outline' : 'btn-primary'}`}
              onClick={() => handleToggleUsuario(master)}
              disabled={busyUsuarioId === master.id}
            >
              {busyUsuarioId === master.id ? <Loader2 size={14} className="spinner" /> : master.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
              {master.ativo ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        </div>
      )}

      {demaisUsuarios.length > 0 && (
        <div style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem' }}>
            Usuários criados pelo master ({demaisUsuarios.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {demaisUsuarios.map((usuario) => (
                <tr key={usuario.id}>
                  <td>{usuario.nome}</td>
                  <td>{usuario.email}</td>
                  <td>{nomePerfil(usuario.papel)}</td>
                  <td>
                    <span className={`badge ${usuario.ativo ? 'badge-success' : 'badge-gray'}`}>
                      {usuario.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${usuario.ativo ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => handleToggleUsuario(usuario)}
                      disabled={busyUsuarioId === usuario.id}
                    >
                      {busyUsuarioId === usuario.id ? <Loader2 size={14} className="spinner" /> : usuario.ativo ? <UserX size={14} /> : <UserCheck size={14} />}
                      {usuario.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
