'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Plus, Target, UserCheck, UserX } from 'lucide-react'
import {
  criarMasterAlvoconsig,
  getAlvoconsigConfig,
  salvarAlvoconsigConfig,
  setUsuarioCrmAtivo,
} from '../alvoconsig-actions'

type UsuarioCrm = {
  id: string
  nome: string
  email: string
  papel: 'master' | 'atendente'
  ativo: boolean
  created_at: string
}

type ConfigCrm = {
  habilitado: boolean
  max_atendentes: number
  habilitado_em: string | null
} | null

type Message = { type: 'success' | 'error'; text: string } | null

export default function AlvoconsigTab({ agenteParceiroId }: { agenteParceiroId: string }) {
  const [carregando, setCarregando] = useState(true)
  const [config, setConfig] = useState<ConfigCrm>(null)
  const [usuarios, setUsuarios] = useState<UsuarioCrm[]>([])
  const [message, setMessage] = useState<Message>(null)

  const [habilitado, setHabilitado] = useState(false)
  const [maxAtendentes, setMaxAtendentes] = useState('10')
  const [salvandoConfig, setSalvandoConfig] = useState(false)

  const [masterNome, setMasterNome] = useState('')
  const [masterEmail, setMasterEmail] = useState('')
  const [masterSenha, setMasterSenha] = useState('')
  const [criandoMaster, setCriandoMaster] = useState(false)
  const [busyUsuarioId, setBusyUsuarioId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setCarregando(true)
    try {
      const res = await getAlvoconsigConfig(agenteParceiroId)
      if (res.success) {
        setConfig((res.config || null) as ConfigCrm)
        setUsuarios((res.usuarios || []) as UsuarioCrm[])
        setHabilitado(res.config?.habilitado === true)
        setMaxAtendentes(String(res.config?.max_atendentes ?? 10))
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
      })
      if (res.success) {
        setMessage({ type: 'success', text: habilitado ? 'CRM AlvoConsig habilitado para este parceiro.' : 'CRM AlvoConsig desabilitado.' })
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao salvar.' })
      }
    } finally {
      setSalvandoConfig(false)
    }
  }

  async function handleCriarMaster(e: React.FormEvent) {
    e.preventDefault()
    setCriandoMaster(true)
    setMessage(null)
    try {
      const res = await criarMasterAlvoconsig({
        agenteParceiroId,
        nome: masterNome,
        email: masterEmail,
        senha: masterSenha,
      })
      if (res.success) {
        setMessage({ type: 'success', text: 'Usuário master vinculado. Ele acessa o CRM pelo card AlvoConsig no Portal Parceiro.' })
        setMasterNome('')
        setMasterEmail('')
        setMasterSenha('')
        await loadData()
      } else {
        setMessage({ type: 'error', text: res.error || 'Erro ao criar o master.' })
      }
    } finally {
      setCriandoMaster(false)
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

  const masters = usuarios.filter((usuario) => usuario.papel === 'master')
  const atendentes = usuarios.filter((usuario) => usuario.papel === 'atendente')

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--brs-gray-900)' }}>
        <Target size={18} />
        CRM AlvoConsig
      </div>
      <div style={{ color: 'var(--brs-gray-500)', fontSize: '0.875rem', marginTop: '-0.5rem' }}>
        Habilitado, o card do CRM aparece no Portal Parceiro deste parceiro e o master pode criar atendentes dentro do CRM.
        Desabilitado, o parceiro não vê o AlvoConsig.
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

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap', padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600, color: 'var(--brs-gray-800)' }}>
          <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} />
          CRM habilitado para este parceiro
        </label>
        <div className="form-group" style={{ width: 180, margin: 0 }}>
          <label className="form-label">Máx. de atendentes</label>
          <input type="number" min={0} max={500} className="form-control" value={maxAtendentes} onChange={(e) => setMaxAtendentes(e.target.value)} />
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
      </div>

      <div style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
        <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem' }}>Usuário Master</div>
        {masters.length > 0 && (
          <table className="data-table" style={{ marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {masters.map((usuario) => (
                <tr key={usuario.id}>
                  <td style={{ fontWeight: 600 }}>{usuario.nome}</td>
                  <td>{usuario.email}</td>
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
        )}

        <form onSubmit={handleCriarMaster} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 200, margin: 0 }}>
            <label className="form-label">Nome <span className="required">*</span></label>
            <input type="text" className="form-control" required value={masterNome} onChange={(e) => setMasterNome(e.target.value)} />
          </div>
          <div className="form-group" style={{ minWidth: 240, margin: 0 }}>
            <label className="form-label">E-mail <span className="required">*</span></label>
            <input type="email" className="form-control" required value={masterEmail} onChange={(e) => setMasterEmail(e.target.value)} />
          </div>
          <div className="form-group" style={{ minWidth: 200, margin: 0 }}>
            <label className="form-label">Senha provisória</label>
            <input
              type="text"
              className="form-control"
              placeholder="Vazio = vincular login existente"
              value={masterSenha}
              onChange={(e) => setMasterSenha(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={criandoMaster}>
            {criandoMaster ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />}
            Vincular master
          </button>
        </form>
        <div style={{ fontSize: '0.78rem', color: 'var(--brs-gray-400)', marginTop: '0.5rem' }}>
          Com senha: cria o login (o master troca a senha no primeiro acesso). Sem senha: vincula um login já existente do portal.
        </div>
      </div>

      {atendentes.length > 0 && (
        <div style={{ padding: '1rem', border: '1px solid var(--brs-gray-200)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--brs-gray-800)', marginBottom: '0.75rem' }}>
            Atendentes criados pelo master ({atendentes.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {atendentes.map((usuario) => (
                <tr key={usuario.id}>
                  <td>{usuario.nome}</td>
                  <td>{usuario.email}</td>
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
