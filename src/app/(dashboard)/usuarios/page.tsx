'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Plus, Mail, X, Save, Loader2, Edit2, AlertCircle,
  User, Shield, Clock, ShieldCheck, UserPlus, Key, Trash2, AlertTriangle,
  UserX, UserCheck
} from 'lucide-react'
import type { UserProfile } from '@/types'
import { saveUserDirectly, saveProfile, getAccessData, getProfilePermissions, getUserPermissions, setUserActive } from './actions'

// Definição de horários padrão
const DEFAULT_SCHEDULES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((day, idx) => ({
  day_of_week: idx,
  enabled: idx < 5,
  start_time_1: '08:00',
  end_time_1: '12:00',
  start_time_2: '13:30',
  end_time_2: '18:00'
}))

// Definição dos módulos do sistema para a matriz hierárquica
const SYSTEM_MODULES = [
  // ==========================================================================
  // Árvore de permissões — ESPELHO do arranjo de divisões da sidebar
  // (src/lib/nav/divisoes.ts). REGRA (GRUPO.md): todo menu/subsistema novo ou
  // movido atualiza esta árvore na mesma entrega. Os ids NUNCA mudam (são as
  // chaves gravadas em profile_permissions/user_permissions) — só nome,
  // agrupamento e nível.
  // ==========================================================================

  // Geral do Workspace
  { id: 'cat-workspace', name: 'Workspace (geral)', isHeader: true, level: 0 },
  { id: 'workspace-agenda', name: 'Agenda & Tarefas (home)', parentId: 'cat-workspace', level: 1 },
  { id: 'workspace-ia', name: 'Jarvis — IA do Workspace (usar o chat)', parentId: 'cat-workspace', level: 1 },
  { id: 'sistema-mural-elogios', name: 'Mural de Elogios', parentId: 'cat-workspace', level: 1 },
  { id: 'sistema-ajuda', name: 'Ajuda', parentId: 'cat-workspace', level: 1 },

  // Divisão: Financeiro
  { id: 'cat-div-financeiro', name: 'Divisão: Financeiro', isHeader: true, level: 0 },
  { id: 'workspace-fin', name: 'Financeiro (divisão + links do setor)', parentId: 'cat-div-financeiro', level: 1 },
  { id: 'financeiro-conta-parceiros', name: 'Conta Virtual Parceiros', parentId: 'cat-div-financeiro', level: 1 },

  // Divisão: RH
  { id: 'cat-div-rh', name: 'Divisão: RH', isHeader: true, level: 0 },
  { id: 'workspace-rh', name: 'RH (divisão + links do setor)', parentId: 'cat-div-rh', level: 1 },
  { id: 'rh-painel', name: 'Painel de Controle RH', parentId: 'cat-div-rh', level: 1 },
  { id: 'rh-colaboradores', name: 'Colaboradores', parentId: 'rh-painel', level: 2 },
  { id: 'rh-importacoes', name: 'Importações', parentId: 'rh-painel', level: 2 },
  { id: 'rh-vale-transporte', name: 'Vale-Transporte', parentId: 'rh-painel', level: 2 },
  { id: 'rh-medidas-disciplinares', name: 'Medidas Disciplinares', parentId: 'rh-painel', level: 2 },
  { id: 'rh-motivos', name: 'Motivos', parentId: 'rh-painel', level: 2 },
  { id: 'rh-unidades', name: 'Unidades', parentId: 'rh-painel', level: 2 },
  { id: 'rh-relatorios', name: 'Relatórios', parentId: 'rh-painel', level: 2 },
  { id: 'rh-auditoria', name: 'Auditoria', parentId: 'rh-painel', level: 2 },

  // Divisão: Cadastros
  { id: 'cat-div-cadastros', name: 'Divisão: Cadastros', isHeader: true, level: 0 },
  { id: 'agente-corban', name: 'Agente Corban', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'agente-corban-cadastros-recebidos', name: 'Cadastros Recebidos', parentId: 'agente-corban', level: 2 },
  { id: 'agente-corban-niveis-acesso', name: 'Nível de Acesso', parentId: 'agente-corban', level: 2 },
  { id: 'agente-corban-tipos-agente', name: 'Tipo de Agente', parentId: 'agente-corban', level: 2 },
  { id: 'agente-corban-regras-fisico', name: 'Regra de Físico', parentId: 'agente-corban', level: 2 },
  { id: 'scp', name: 'SCP (legado — dentro do Agente Corban)', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'scp-crm', name: 'CRM Parceiros', parentId: 'scp', level: 2 },
  { id: 'scp-processos', name: 'Construtor de Processo', parentId: 'scp', level: 2 },
  { id: 'scp-construtor', name: 'Construtor de Formulário', parentId: 'scp', level: 2 },
  { id: 'scp-documentos', name: 'Modelos de Documentos', parentId: 'scp', level: 2 },
  { id: 'scp-emails', name: 'Modelos de E-mails', parentId: 'scp', level: 2 },
  { id: 'scp-whatsapp', name: 'Modelos de WhatsApp', parentId: 'scp', level: 2 },
  { id: 'sistema-config-instituicoes', name: 'Instituições Financeiras', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'workspace-convenios', name: 'Convênios', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'promotoras', name: 'Promotoras', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'comercial-estrutura', name: 'Comerciais (Estrutura Comercial)', parentId: 'cat-div-cadastros', level: 1 },
  { id: 'comercial-agentes', name: 'Agentes Comerciais', parentId: 'comercial-estrutura', level: 2 },

  // Divisão: Operacional
  { id: 'cat-div-operacional', name: 'Divisão: Operacional', isHeader: true, level: 0 },
  { id: 'workspace-ops', name: 'Operacional (divisão + links do setor)', parentId: 'cat-div-operacional', level: 1 },
  { id: 'operacional-nvti', name: 'Higienização de CPF (NVTI)', parentId: 'cat-div-operacional', level: 1 },
  { id: 'operacional-nvti-consumo', name: 'Consumo (todos os usuários)', parentId: 'operacional-nvti', level: 2 },
  { id: 'operacional-nvti-limites', name: 'Limites de Gasto', parentId: 'operacional-nvti', level: 2 },
  { id: 'sistema-config-credito', name: 'Comissionamento e Coeficientes (ARW)', parentId: 'cat-div-operacional', level: 1 },

  // Divisão: Comercial (Gestão de Leads)
  { id: 'cat-div-comercial', name: 'Divisão: Comercial — Gestão de Leads', isHeader: true, level: 0 },
  { id: 'workspace-com', name: 'Comercial (divisão + links do setor)', parentId: 'cat-div-comercial', level: 1 },
  { id: 'alvoconsig-gestao', name: 'AlvoConsig — Gestão de Leads', parentId: 'cat-div-comercial', level: 1 },
  { id: 'alvoconsig-certificacao', name: 'Certificação de Clientes', parentId: 'alvoconsig-gestao', level: 2 },

  // Divisão: Tecnologia
  { id: 'cat-div-tecnologia', name: 'Divisão: Tecnologia', isHeader: true, level: 0 },
  { id: 'workspace-tec', name: 'Tecnologia (divisão + links do setor)', parentId: 'cat-div-tecnologia', level: 1 },
  { id: 'central-integracoes', name: 'Integrações', parentId: 'cat-div-tecnologia', level: 1 },
  { id: 'helpdesk-abrir', name: 'HelpDesk (abrir e acompanhar tickets)', parentId: 'cat-div-tecnologia', level: 1 },
  { id: 'helpdesk-aprovar', name: 'Aprovar/rejeitar planos', parentId: 'helpdesk-abrir', level: 2 },

  // Divisão: Configurações
  { id: 'cat-div-configuracoes', name: 'Divisão: Configurações', isHeader: true, level: 0 },
  { id: 'conversas', name: 'Comunicação — Atendimento (BRS Messenger)', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'central-conversas', name: 'Comunicação — Canais, Instâncias e Grupos Internos', parentId: 'conversas', level: 2 },
  { id: 'comercial-disparo-whatsapp', name: 'Disparo de WhatsApp', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-comunicados', name: 'Comunicados (Editor)', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-usuarios-root', name: 'Usuários e Permissões', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-usuarios-cadastro', name: 'Cadastro de Usuários', parentId: 'sistema-usuarios-root', level: 2 },
  { id: 'sistema-usuarios-perfis', name: 'Perfis de Acesso', parentId: 'sistema-usuarios-root', level: 2 },
  { id: 'sistema-config-ia', name: 'IA do Workspace (configurar o Jarvis)', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-links', name: 'Links (gerenciar o menu da topbar)', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-config-root', name: 'Provedores e APIs', parentId: 'cat-div-configuracoes', level: 1 },
  { id: 'sistema-config-empresa', name: 'Cadastro da Empresa', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-comercial-tipos', name: 'Tipos de Comercial', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-setores', name: 'Setores', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-banners', name: 'Banners da Home', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-formas-recebimento', name: 'Formas de Recebimento', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-tipos-sistemas', name: 'Tipos de Sistemas', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-tipos-remuneracao', name: 'Tipos de Remuneração', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-email', name: 'API E-mail', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-whatsapp', name: 'API WhatsApp', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-assinatura', name: 'API Assinatura Eletrônica', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-google', name: 'Google', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-cpf', name: 'API CPF', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-nvti', name: 'API Nova Vida TI', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-gateways', name: 'Gateways de Pagamento', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-cnae', name: 'CNAE', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-ctn', name: 'CTN', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-nbs', name: 'NBS', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-nfse-emissao', name: 'Tipo de Emissão de NFSe', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-regimes-tributarios', name: 'Regimes Tributários', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-recalculo-tributario', name: 'Recálculo Tributário', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-quarkrh', name: 'API QuarkRH (em breve)', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-contaazul', name: 'API Conta Azul (em breve)', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-arw', name: 'API ARW (em breve)', parentId: 'sistema-config-root', level: 2 },
  { id: 'sistema-config-crm', name: 'API CRM (em breve)', parentId: 'sistema-config-root', level: 2 },

  // Setores dos Links da topbar (sem subsistema próprio no menu)
  { id: 'cat-links-setores', name: 'Links da Topbar — setores restantes', isHeader: true, level: 0 },
  { id: 'workspace-adm', name: 'Administrativo (links do setor)', parentId: 'cat-links-setores', level: 1 },
  { id: 'workspace-mkt', name: 'Marketing (links do setor)', parentId: 'cat-links-setores', level: 1 },
  { id: 'workspace-acc', name: 'Acessos (links do setor)', parentId: 'cat-links-setores', level: 1 },
]

export default function UsuariosPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'profiles'>('users')
  // Filtro de status: padrão só ATIVOS (decisão 02/09/2026)
  const [statusFilter, setStatusFilter] = useState<'ativos' | 'inativos' | 'todos'>('ativos')
  const [users, setUsers] = useState<UserProfile[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [commercialEntities, setCommercialEntities] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'perfis') setActiveTab('profiles')
  }, [])

  const formatCPF = (value: string) => {
    const digits = value.replace(/\D/g, '')
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1')
  }
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  
  // Estados para edição de Usuário
  const [editingUser, setEditingUser] = useState<any | null>(null)
  
  // Estados para edição de Perfil
  const [editingProfile, setEditingProfile] = useState<any>({
    name: '',
    permissions: SYSTEM_MODULES.map(m => ({
      resource_name: m.id,
      can_view: m.id === 'sistema-mural-elogios',
      can_include: false,
      can_edit: false,
      can_delete: false,
      can_activate_inactivate: false
    })),
    schedules: DEFAULT_SCHEDULES
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const result = await getAccessData()
    if (result.success) {
      setProfiles(result.profiles || [])
      setUsers(result.users || [])
      setCommercialEntities(result.commercialEntities || [])
      setEmployees(result.employees || [])
    } else {
      console.error('Erro ao buscar dados:', result.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // --- LÓGICA DE USUÁRIOS ---
  async function handleToggleUserActive(user: any) {
    const confirmText = user.active
      ? `Inativar o usuário "${user.name}"?\n\nEle perderá o acesso ao sistema e as entidades comerciais vinculadas a ele também serão inativadas.`
      : `Reativar o usuário "${user.name}"?\n\nEle voltará a ter acesso ao sistema. Entidades comerciais inativadas precisam ser reativadas manualmente em Cadastros Comerciais.`
    if (!confirm(confirmText)) return

    const result = await setUserActive(user.id, !user.active)
    if (result.success) {
      if (user.active && (result.inactivatedEntities || 0) > 0) {
        alert(`Usuário inativado. ${result.inactivatedEntities} entidade(s) comercial(is) vinculada(s) também foi(ram) inativada(s).`)
      }
      fetchData()
    } else {
      alert(result.error || 'Erro ao alterar o status do usuário.')
    }
  }

  // --- LÓGICA DE PERFIS ---
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const result = await saveProfile({
        id: editingProfile.id,
        name: editingProfile.name,
        permissions: editingProfile.permissions,
        schedules: editingProfile.schedules
      });

      if (!result.success) throw new Error(result.error || 'Erro ao salvar perfil');

      setIsProfileModalOpen(false)
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const getDescendantIds = (resId: string): string[] => {
    const descendants: string[] = []
    const queue = [resId]
    while (queue.length > 0) {
      const current = queue.shift()!
      const children = SYSTEM_MODULES.filter(m => m.parentId === current)
      for (const child of children) {
        descendants.push(child.id)
        queue.push(child.id)
      }
    }
    return descendants
  }

  const getAncestors = (resId: string): string[] => {
    const ancestors: string[] = []
    let current = SYSTEM_MODULES.find(m => m.id === resId)
    while (current && current.parentId) {
      const parentId = current.parentId
      ancestors.push(parentId)
      current = SYSTEM_MODULES.find(m => m.id === parentId)
    }
    return ancestors
  }

  const handleTogglePermission = (target: 'profile' | 'user', resourceId: string, field: string) => {
    if (target === 'profile') {
      const perms = [...(editingProfile.permissions || [])]
      let permIdx = perms.findIndex(p => p.resource_name === resourceId)
      if (permIdx < 0) {
        perms.push({
          resource_name: resourceId,
          can_view: false,
          can_include: false,
          can_edit: false,
          can_delete: false,
          can_activate_inactivate: false
        })
        permIdx = perms.length - 1
      }
      
      const nextValue = !perms[permIdx][field]
      perms[permIdx][field] = nextValue
      
      const descendants = getDescendantIds(resourceId)
      descendants.forEach(descId => {
        let dIdx = perms.findIndex(p => p.resource_name === descId)
        if (dIdx < 0) {
          perms.push({
            resource_name: descId,
            can_view: false,
            can_include: false,
            can_edit: false,
            can_delete: false,
            can_activate_inactivate: false
          })
          dIdx = perms.length - 1
        }
        perms[dIdx][field] = nextValue
      })

      if (nextValue) {
        const ancestors = getAncestors(resourceId)
        ancestors.forEach(ancId => {
          let aIdx = perms.findIndex(p => p.resource_name === ancId)
          if (aIdx < 0) {
            perms.push({
              resource_name: ancId,
              can_view: false,
              can_include: false,
              can_edit: false,
              can_delete: false,
              can_activate_inactivate: false
            })
            aIdx = perms.length - 1
          }
          perms[aIdx][field] = true
        })
      }
      
      setEditingProfile({ ...editingProfile, permissions: perms })
    } else {
      const perms = [...(editingUser?.permissions || [])]
      let permIdx = perms.findIndex(p => p.resource_name === resourceId)
      if (permIdx < 0) {
        perms.push({
          resource_name: resourceId,
          can_view: false,
          can_include: false,
          can_edit: false,
          can_delete: false,
          can_activate_inactivate: false
        })
        permIdx = perms.length - 1
      }
      
      const nextValue = !perms[permIdx][field]
      perms[permIdx][field] = nextValue
      
      const descendants = getDescendantIds(resourceId)
      descendants.forEach(descId => {
        let dIdx = perms.findIndex(p => p.resource_name === descId)
        if (dIdx < 0) {
          perms.push({
            resource_name: descId,
            can_view: false,
            can_include: false,
            can_edit: false,
            can_delete: false,
            can_activate_inactivate: false
          })
          dIdx = perms.length - 1
        }
        perms[dIdx][field] = nextValue
      })

      if (nextValue) {
        const ancestors = getAncestors(resourceId)
        ancestors.forEach(ancId => {
          let aIdx = perms.findIndex(p => p.resource_name === ancId)
          if (aIdx < 0) {
            perms.push({
              resource_name: ancId,
              can_view: false,
              can_include: false,
              can_edit: false,
              can_delete: false,
              can_activate_inactivate: false
            })
            aIdx = perms.length - 1
          }
          perms[aIdx][field] = true
        })
      }
      
      setEditingUser({ ...editingUser, permissions: perms })
    }
  }

  const toggleAllColumn = (field: string, target: 'profile' | 'user') => {
    if (target === 'profile') {
      const allSelected = SYSTEM_MODULES.every(m => {
        const p = editingProfile.permissions.find((p: any) => p.resource_name === m.id);
        return p?.[field];
      });
      const newPerms = SYSTEM_MODULES.map(m => ({
        resource_name: m.id,
        can_view: !allSelected,
        can_include: !allSelected,
        can_edit: !allSelected,
        can_delete: !allSelected,
        can_activate_inactivate: !allSelected
      }));
      setEditingProfile({ ...editingProfile, permissions: newPerms });
    } else {
      const allSelected = SYSTEM_MODULES.every(m => {
        const p = editingUser?.permissions?.find((p: any) => p.resource_name === m.id);
        return p?.[field];
      });
      const newPerms = SYSTEM_MODULES.map(m => ({
        resource_name: m.id,
        can_view: !allSelected,
        can_include: !allSelected,
        can_edit: !allSelected,
        can_delete: !allSelected,
        can_activate_inactivate: !allSelected
      }));
      setEditingUser({ ...editingUser, permissions: newPerms });
    }
  }

  const generateTempPassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
  }

  return (
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--brs-gray-800)', margin: 0 }}>
            Gestão de Acessos
          </h1>
          <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Controle usuários, perfis e permissões do sistema
          </p>
        </div>
        
        {activeTab === 'users' ? (
          <button className="btn btn-primary" onClick={() => { 
            setEditingUser({ 
              active: true,
              schedules: DEFAULT_SCHEDULES,
              permissions: []
            }); 
            setIsModalOpen(true); 
          }}>
            <UserPlus size={16} />
            Novo Usuário
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => { 
            setEditingProfile({
              name: '',
              permissions: SYSTEM_MODULES.map(m => ({
                resource_name: m.id,
                can_view: false,
                can_include: false,
                can_edit: false,
                can_delete: false,
                can_activate_inactivate: false
              })),
              schedules: DEFAULT_SCHEDULES
            }); 
            setIsProfileModalOpen(true); 
          }}>
            <Shield size={16} />
            Novo Perfil
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs-list" style={{ marginBottom: '2rem' }}>
        <button 
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <User size={18} /> Usuários
        </button>
        <button 
          className={`tab-btn ${activeTab === 'profiles' ? 'active' : ''}`}
          onClick={() => setActiveTab('profiles')}
        >
          <ShieldCheck size={18} /> Perfis de Acesso
        </button>
        {activeTab === 'users' && (
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ativos' | 'inativos' | 'todos')}
            style={{ marginLeft: 'auto', width: 'auto', minWidth: 160 }}
            title="Filtrar por status"
          >
            <option value="ativos">Somente ativos</option>
            <option value="inativos">Somente inativos</option>
            <option value="todos">Ativos e inativos</option>
          </select>
        )}
      </div>

      {activeTab === 'users' ? (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>CPF</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></td></tr>
                ) : users.filter((u: any) => statusFilter === 'todos' || (statusFilter === 'ativos' ? u.active !== false : u.active === false)).length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--brs-gray-400)' }}>Nenhum usuário encontrado</td></tr>
                ) : (
                  users
                    .filter((u: any) => statusFilter === 'todos' || (statusFilter === 'ativos' ? u.active !== false : u.active === false))
                    .map((user: any) => (
                    <tr key={user.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div className="user-avatar" style={{ width: '32px', height: '32px', overflow: 'hidden' }}>
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              user.name.charAt(0)
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{user.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace', color: 'var(--brs-gray-600)' }}>
                          {user.cpf ? formatCPF(user.cpf) : '-'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-navy">
                          {user.access_profiles?.name || user.role}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${user.active ? 'badge-success' : 'badge-gray'}`}>
                          {user.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 'calc(0.75rem + var(--brs-messenger-dock-reserve, 0px))' }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={async () => {
                          // Carregar permissões via Servidor
                          const result = await getUserPermissions(user.id)
                          const perms = result.success ? result.permissions : []
                          const scheds = result.success ? result.schedules : []

                          setEditingUser({
                            ...user,
                            permissions: perms || [],
                            schedules: (scheds?.length || 0) > 0 ? scheds : DEFAULT_SCHEDULES
                          });
                          setIsModalOpen(true);
                        }}>
                          <Edit2 size={16} />
                        </button>
                        <button
                          className={`btn btn-ghost btn-sm btn-icon ${user.active ? 'text-danger' : ''}`}
                          title={user.active ? 'Inativar usuário' : 'Reativar usuário'}
                          onClick={() => handleToggleUserActive(user)}
                        >
                          {user.active ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome do Perfil</th>
                  <th>Criado em</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></td></tr>
                ) : profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td style={{ fontWeight: 600 }}>{profile.name}</td>
                    <td>{new Date(profile.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right', paddingRight: 'calc(0.75rem + var(--brs-messenger-dock-reserve, 0px))' }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={async () => {
                        // Carregar permissões via Servidor
                        const result = await getProfilePermissions(profile.id)
                        const perms = result.success ? result.permissions : []
                        const scheds = result.success ? result.schedules : []
                        
                        const mergedPerms = SYSTEM_MODULES.map(m => {
                          const existing = (perms || []).find((p: any) => p.resource_name === m.id)
                          return existing || {
                            resource_name: m.id,
                            can_view: false,
                            can_include: false,
                            can_edit: false,
                            can_delete: false,
                            can_activate_inactivate: false
                          }
                        })

                        // Merge schedules with default to ensure all days exist
                        const mergedScheds = DEFAULT_SCHEDULES.map(ds => {
                          const existing = (scheds || []).find((s: any) => s.day_of_week === ds.day_of_week)
                          return existing || ds
                        })

                        setEditingProfile({ ...profile, permissions: mergedPerms, schedules: mergedScheds })
                        setIsProfileModalOpen(true)
                      }}>
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL DE PERFIL (Matriz de Permissões) */}
      {isProfileModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsProfileModalOpen(false)}>
          <div className="modal" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleSaveProfile}>
              <div className="modal-header">
                <h3 className="modal-title">{editingProfile.id ? 'Editar Perfil' : 'Novo Perfil de Acesso'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsProfileModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                {error && (
                  <div style={{ background: '#fee2e2', color: '#dc2626', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Shield size={16} />
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Nome do Perfil</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    placeholder="Ex: Supervisor Administrativo"
                    value={editingProfile.name}
                    onChange={e => setEditingProfile({ ...editingProfile, name: e.target.value })}
                    required
                  />
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <label className="form-label" style={{ marginBottom: '1rem', display: 'block' }}>Matriz de Permissões</label>
                  <div className="table-wrapper" style={{ border: '1px solid var(--brs-gray-100)', borderRadius: '8px' }}>
                    <table className="permissions-matrix">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Módulo / Recurso</th>
                          <th>Ver <input type="checkbox" onChange={() => toggleAllColumn('can_view', 'profile')} /></th>
                          <th>Incluir <input type="checkbox" onChange={() => toggleAllColumn('can_include', 'profile')} /></th>
                          <th>Editar <input type="checkbox" onChange={() => toggleAllColumn('can_edit', 'profile')} /></th>
                          <th>Excluir <input type="checkbox" onChange={() => toggleAllColumn('can_delete', 'profile')} /></th>
                          <th>Ativar/Inat. <input type="checkbox" onChange={() => toggleAllColumn('can_activate_inactivate', 'profile')} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {SYSTEM_MODULES.map((module) => {
                          const perm = editingProfile.permissions?.find((p: any) => p.resource_name === module.id) || {
                            can_view: false, can_include: false, can_edit: false, can_delete: false, can_activate_inactivate: false
                          };
                          
                          let rowStyle: React.CSSProperties = {};
                          let labelPrefix = '';
                          if (module.level === 0) {
                            rowStyle = {
                              backgroundColor: 'var(--brs-gray-50)',
                              fontWeight: 700,
                              color: 'var(--brs-navy)',
                              borderBottom: '2px solid var(--brs-gray-200)'
                            };
                          } else if (module.level === 1) {
                            rowStyle = {
                              fontWeight: 600,
                              backgroundColor: '#fff'
                            };
                          } else if (module.level === 2) {
                            rowStyle = {
                              color: 'var(--brs-gray-600)',
                              backgroundColor: '#fcfcfc'
                            };
                            labelPrefix = '↳ ';
                          }

                          return (
                            <tr key={module.id} style={rowStyle}>
                              <td style={{ 
                                paddingLeft: module.level === 0 ? '0.75rem' : module.level === 1 ? '1.75rem' : '2.75rem', 
                                textAlign: 'left' 
                              }}>
                                {labelPrefix}{module.name}
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_view} 
                                  onChange={() => handleTogglePermission('profile', module.id, 'can_view')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_include} 
                                  onChange={() => handleTogglePermission('profile', module.id, 'can_include')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_edit} 
                                  onChange={() => handleTogglePermission('profile', module.id, 'can_edit')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_delete} 
                                  onChange={() => handleTogglePermission('profile', module.id, 'can_delete')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_activate_inactivate} 
                                  onChange={() => handleTogglePermission('profile', module.id, 'can_activate_inactivate')} 
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ marginTop: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Clock size={18} color="var(--brs-navy)" />
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Horário de Acesso Permitido</h4>
                  </div>
                  <div className="schedule-grid">
                    {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((day, idx) => {
                      const sched = (editingProfile.schedules || DEFAULT_SCHEDULES).find((s: any) => s.day_of_week === idx) || DEFAULT_SCHEDULES[idx]
                      
                      const updateSched = (field: string, value: any) => {
                        const newScheds = [...(editingProfile.schedules || DEFAULT_SCHEDULES)]
                        const sIdx = newScheds.findIndex(s => s.day_of_week === idx)
                        if (sIdx >= 0) {
                          newScheds[sIdx] = { ...newScheds[sIdx], [field]: value }
                        } else {
                          newScheds.push({ ...DEFAULT_SCHEDULES[idx], [field]: value })
                        }
                        setEditingProfile({ ...editingProfile, schedules: newScheds })
                      }

                      return (
                        <div key={day} className="day-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                            <input 
                              type="checkbox" 
                              checked={sched.enabled} 
                              onChange={e => updateSched('enabled', e.target.checked)}
                            />
                            {day}
                          </div>
                          <div className="time-inputs">
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Entrada 1</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.start_time_1} 
                                onChange={e => updateSched('start_time_1', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Saída 1</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.end_time_1} 
                                onChange={e => updateSched('end_time_1', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Entrada 2</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.start_time_2} 
                                onChange={e => updateSched('start_time_2', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Saída 2</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.end_time_2} 
                                onChange={e => updateSched('end_time_2', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsProfileModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
                  Salvar Perfil
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE USUÁRIO (Cadastro Completo) */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              setError(null);
              try {
                // Mapear o cargo para um valor aceito pela constraint do banco (minúsculo)
                const rawRole = (editingUser.role || profiles.find(p => p.id === editingUser.profile_id)?.name || 'consulta').toLowerCase();
                // Se o cargo não for um dos padrões, podemos mapear para 'gestor' ou 'consulta' como fallback
                const validRoles = ['admin', 'rh', 'gestor', 'consulta'];
                const finalRole = validRoles.includes(rawRole) ? rawRole : 'gestor';

                const result = await saveUserDirectly({
                  ...editingUser,
                  role: finalRole,
                  cpf: editingUser.cpf?.replace(/\D/g, ''), // Salvar apenas números
                  permissions: editingUser.permissions || [],
                  schedules: editingUser.schedules || []
                });

                if (!result.success) throw new Error(result.error || 'Erro ao salvar usuário');

                setIsModalOpen(false);
                fetchData();
              } catch (err: any) {
                setError(err.message);
              } finally {
                setSaving(false);
              }
            }}>
              <div className="modal-header">
                <h3 className="modal-title">{editingUser?.id ? 'Editar Usuário' : 'Criar Novo Usuário'}</h3>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                {error && (
                  <div style={{ background: '#fee2e2', color: '#dc2626', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={16} />
                    {error}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '2rem' }}>
                  {/* Lado Esquerdo: Foto */}
                  <div style={{ textAlign: 'center' }}>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }} 
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          // Aqui depois implementaremos o upload para o Storage
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setEditingUser({ ...editingUser, avatar_url: event.target?.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <div 
                      className="user-avatar" 
                      style={{ width: '120px', height: '120px', fontSize: '2.5rem', margin: '0 auto 1rem', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {editingUser?.avatar_url ? (
                        <img src={editingUser.avatar_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <User size={48} />
                      )}
                      <div style={{ position: 'absolute', bottom: '0', right: '0', background: 'var(--brs-navy)', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
                        <Plus size={16} />
                      </div>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)' }}>FOTO DE PERFIL</p>
                  </div>

                  {/* Lado Direito: Dados */}
                  <div className="form-grid form-grid-2">
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label className="form-label">Vincular Colaborador (QuarkRH)</label>
                      <select 
                        className="form-control"
                        value={editingUser?.employee_id || ''}
                        onChange={(e) => {
                          const empId = e.target.value;
                          const emp = employees.find(x => x.id === empId);
                          setEditingUser({
                            ...editingUser,
                            employee_id: empId || null,
                            cpf: emp ? formatCPF(emp.cpf) : editingUser?.cpf || '',
                            name: emp ? emp.name : editingUser?.name || '',
                            birth_date: emp?.birth_date ? emp.birth_date : editingUser?.birth_date || ''
                          });
                        }}
                      >
                        <option value="">Nenhum colaborador vinculado...</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name} ({formatCPF(emp.cpf)})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Nome Completo</label>
                      <input type="text" className="form-control" value={editingUser?.name ?? ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">CPF</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="000.000.000-00" 
                        value={formatCPF(editingUser?.cpf ?? '')} 
                        onChange={e => {
                          const val = e.target.value;
                          const formatted = formatCPF(val);
                          const cleanCpf = formatted.replace(/\D/g, '');
                          const matchedEmp = employees.find(x => x.cpf.replace(/\D/g, '') === cleanCpf);
                          setEditingUser({
                            ...editingUser,
                            cpf: formatted,
                            employee_id: matchedEmp ? matchedEmp.id : null,
                            name: matchedEmp ? matchedEmp.name : editingUser?.name || '',
                            birth_date: matchedEmp?.birth_date ? matchedEmp.birth_date : editingUser?.birth_date || ''
                          });
                        }} 
                        required 
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">E-mail</label>
                      <input type="email" className="form-control" value={editingUser?.email ?? ''} onChange={e => setEditingUser({...editingUser, email: e.target.value})} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Data de Nascimento</label>
                      <input 
                        type="date" 
                        className="form-control" 
                        value={editingUser?.birth_date ?? ''} 
                        onChange={e => setEditingUser({...editingUser, birth_date: e.target.value})} 
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Perfil de Acesso</label>
                      <select 
                        className="form-control" 
                        value={editingUser?.profile_id || ''} 
                        onChange={async (e) => {
                          const profileId = e.target.value;
                          const profile = profiles.find(p => p.id === profileId);
                          // Carregar permissões e horários do perfil via Servidor
                          const result = await getProfilePermissions(profileId);
                          const perms = result.success ? result.permissions : [];
                          const scheds = result.success ? result.schedules : [];
                          
                          setEditingUser({
                            ...editingUser,
                            profile_id: profileId,
                            role: profile?.name,
                            permissions: perms || [],
                            schedules: (scheds?.length || 0) > 0 ? scheds : DEFAULT_SCHEDULES
                          });
                        }}
                        required
                      >
                        <option value="">Selecione um perfil...</option>
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Senha Provisória</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input type="text" className="form-control" value={editingUser?.temp_password || ''} readOnly />
                        <button type="button" className="btn btn-outline" onClick={() => setEditingUser({...editingUser, temp_password: generateTempPassword()})}>
                          <Key size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tempo de Sessão (Minutos)</label>
                      <input 
                        type="number" 
                        className="form-control" 
                        value={editingUser?.session_timeout ?? 15} 
                        onChange={e => setEditingUser({...editingUser, session_timeout: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cargo Comercial (SCP)</label>
                      <select
                        className="form-control"
                        value={editingUser?.commercial_role || ''}
                        onChange={e => setEditingUser({
                          ...editingUser,
                          commercial_role: e.target.value || null,
                          superintendente_id: null,
                          supervisor_id: null,
                          gerente_id: null
                        })}
                      >
                        <option value="">Nenhum (Administrativo / CLT)</option>
                        <option value="superintendente">Superintendente</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="gerente">Gerente Comercial</option>
                      </select>
                    </div>

                    {(editingUser?.commercial_role === 'supervisor' || editingUser?.commercial_role === 'gerente') && (
                      <div className="form-group">
                        <label className="form-label">Superintendente Responsável</label>
                        <select
                          className="form-control"
                          value={editingUser?.superintendente_id || ''}
                          onChange={e => setEditingUser({
                            ...editingUser,
                            superintendente_id: e.target.value || null,
                            supervisor_id: null,
                            gerente_id: null
                          })}
                        >
                          <option value="">Selecione...</option>
                          {commercialEntities
                            .filter(ent => ent.role === 'superintendente')
                            .map(ent => (
                              <option key={ent.id} value={ent.id}>{ent.name}</option>
                            ))
                          }
                        </select>
                      </div>
                    )}

                    {editingUser?.commercial_role === 'gerente' && (
                      <div className="form-group">
                        <label className="form-label">Supervisor Responsável</label>
                        <select
                          className="form-control"
                          value={editingUser?.supervisor_id || ''}
                          onChange={e => setEditingUser({
                            ...editingUser,
                            supervisor_id: e.target.value || null,
                            gerente_id: null
                          })}
                        >
                          <option value="">Selecione...</option>
                          {commercialEntities
                            .filter(ent => ent.role === 'supervisor' && (!editingUser.superintendente_id || ent.parent_id === editingUser.superintendente_id))
                            .map(ent => (
                              <option key={ent.id} value={ent.id}>{ent.name}</option>
                            ))
                          }
                        </select>
                      </div>
                    )}

                    {editingUser?.commercial_role === 'gerente' && (
                      <div className="form-group">
                        <label className="form-label">Vaga de Gerente Ocupada</label>
                        <select
                          className="form-control"
                          value={editingUser?.gerente_id || ''}
                          onChange={e => setEditingUser({
                            ...editingUser,
                            gerente_id: e.target.value || null
                          })}
                        >
                          <option value="">Selecione...</option>
                          {commercialEntities
                            .filter(ent => ent.role === 'gerente' && (!editingUser.supervisor_id || ent.parent_id === editingUser.supervisor_id))
                            .map(ent => (
                              <option key={ent.id} value={ent.id}>{ent.name}</option>
                            ))
                          }
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                {editingUser?.employee_id && (
                  <div style={{ marginTop: '1rem', background: '#F0FDF4', color: '#166534', padding: '0.75rem', borderRadius: '6px', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShieldCheck size={16} />
                    <span>Funcionário CLT vinculado de forma automática pelo CPF (QuarkRH)</span>
                  </div>
                )}

                <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={editingUser?.reset_on_first ?? true} onChange={e => setEditingUser({...editingUser, reset_on_first: e.target.checked})} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Exigir alteração de senha no primeiro acesso</span>
                </div>

                {/* Tabela de Permissões (Visualização/Edição de Exceção) */}
                <div style={{ marginTop: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Shield size={18} color="var(--brs-navy)" />
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Tabela de Permissões</h4>
                  </div>
                  <div className="table-wrapper" style={{ border: '1px solid var(--brs-gray-100)', borderRadius: '8px' }}>
                    <table className="permissions-matrix">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Tela / Recurso</th>
                          <th>Ver <input type="checkbox" onChange={() => toggleAllColumn('can_view', 'user')} /></th>
                          <th>Incluir <input type="checkbox" onChange={() => toggleAllColumn('can_include', 'user')} /></th>
                          <th>Editar <input type="checkbox" onChange={() => toggleAllColumn('can_edit', 'user')} /></th>
                          <th>Excluir <input type="checkbox" onChange={() => toggleAllColumn('can_delete', 'user')} /></th>
                          <th>Ativar/Inat. <input type="checkbox" onChange={() => toggleAllColumn('can_activate_inactivate', 'user')} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {SYSTEM_MODULES.map((module) => {
                          const permIdx = editingUser?.permissions?.findIndex((p: any) => p.resource_name === module.id);
                          const perm = permIdx >= 0 ? editingUser.permissions[permIdx] : {
                            can_view: false, can_include: false, can_edit: false, can_delete: false, can_activate_inactivate: false
                          };
                          
                          let rowStyle: React.CSSProperties = {};
                          let labelPrefix = '';
                          if (module.level === 0) {
                            rowStyle = {
                              backgroundColor: 'var(--brs-gray-50)',
                              fontWeight: 700,
                              color: 'var(--brs-navy)',
                              borderBottom: '2px solid var(--brs-gray-200)'
                            };
                          } else if (module.level === 1) {
                            rowStyle = {
                              fontWeight: 600,
                              backgroundColor: '#fff'
                            };
                          } else if (module.level === 2) {
                            rowStyle = {
                              color: 'var(--brs-gray-600)',
                              backgroundColor: '#fcfcfc'
                            };
                            labelPrefix = '↳ ';
                          }

                          return (
                            <tr key={module.id} style={rowStyle}>
                              <td style={{ 
                                paddingLeft: module.level === 0 ? '0.75rem' : module.level === 1 ? '1.75rem' : '2.75rem', 
                                textAlign: 'left' 
                              }}>
                                {labelPrefix}{module.name}
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_view} 
                                  onChange={() => handleTogglePermission('user', module.id, 'can_view')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_include} 
                                  onChange={() => handleTogglePermission('user', module.id, 'can_include')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_edit} 
                                  onChange={() => handleTogglePermission('user', module.id, 'can_edit')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_delete} 
                                  onChange={() => handleTogglePermission('user', module.id, 'can_delete')} 
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input 
                                  type="checkbox" 
                                  checked={perm.can_activate_inactivate} 
                                  onChange={() => handleTogglePermission('user', module.id, 'can_activate_inactivate')} 
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ marginTop: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Clock size={18} color="var(--brs-navy)" />
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Horário de Acesso Individual</h4>
                  </div>
                   <div className="schedule-grid">
                    {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((day, idx) => {
                      const sched = (editingUser?.schedules || DEFAULT_SCHEDULES).find((s: any) => s.day_of_week === idx) || DEFAULT_SCHEDULES[idx]
                      
                      const updateUserSched = (field: string, value: any) => {
                        const newScheds = [...(editingUser?.schedules || DEFAULT_SCHEDULES)]
                        const sIdx = newScheds.findIndex(s => s.day_of_week === idx)
                        if (sIdx >= 0) {
                          newScheds[sIdx] = { ...newScheds[sIdx], [field]: value }
                        } else {
                          newScheds.push({ ...DEFAULT_SCHEDULES[idx], [field]: value })
                        }
                        setEditingUser({ ...editingUser, schedules: newScheds })
                      }

                      return (
                        <div key={day} className="day-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                            <input 
                              type="checkbox" 
                              checked={sched.enabled} 
                              onChange={e => updateUserSched('enabled', e.target.checked)}
                            />
                            {day}
                          </div>
                          <div className="time-inputs">
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Entrada 1</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.start_time_1} 
                                onChange={e => updateUserSched('start_time_1', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Saída 1</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.end_time_1} 
                                onChange={e => updateUserSched('end_time_1', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Entrada 2</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.start_time_2} 
                                onChange={e => updateUserSched('start_time_2', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Saída 2</label>
                              <input 
                                type="time" 
                                className="form-control" 
                                value={sched.end_time_2} 
                                onChange={e => updateUserSched('end_time_2', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spinner" /> : <UserPlus size={16} />}
                  {editingUser?.id ? 'Salvar Alterações' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
