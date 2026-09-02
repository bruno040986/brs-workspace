/**
 * Registro central das DIVISÕES da sidebar do Workspace (layout aprovado
 * 02/09/2026): substitui os cards da home. Cada divisão agrupa subsistemas;
 * a permissão governa grupo e item. Sub-itens contextuais (menus que antes
 * viviam nas sidebars locais de RH, Agente Corban, SCP, Central de
 * Integrações etc.) ficam aninhados no item do subsistema e só aparecem
 * quando a rota atual está dentro dele.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  BriefcaseBusiness,
  Cpu,
  FolderKanban,
  Settings2,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { EffectivePermission, PermissionRequirement } from '@/lib/auth/permissions'
import { hasAnyPermission } from '@/lib/auth/permissions'

export type NavSubItem = {
  label: string
  href: string
  /** requisitos: qualquer um libera (vazio = herda o do pai) */
  perms?: PermissionRequirement[]
}

export type NavItemDef = {
  label: string
  href: string
  perms?: PermissionRequirement[]
  soon?: boolean
  /** menus contextuais: só aparecem quando a rota atual está dentro do href */
  children?: NavSubItem[]
}

export type NavDivisao = {
  id: string
  label: string
  icon: LucideIcon
  itens: NavItemDef[]
}

const view = (resource: string): PermissionRequirement => ({ resource, action: 'can_view' })

export const NAV_DIVISOES: NavDivisao[] = [
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: Banknote,
    itens: [
      { label: 'Conta Virtual Parceiros', href: '/financeiro/conta-parceiros', perms: [view('financeiro-conta-parceiros')] },
      { label: 'Reembolsos', href: '#reembolsos', soon: true, perms: [view('financeiro-conta-parceiros')] },
    ],
  },
  {
    id: 'rh',
    label: 'RH',
    icon: Users,
    itens: [
      {
        label: 'Painel de Controle RH',
        href: '/rh',
        perms: [view('rh-painel'), view('rh-colaboradores')],
        children: [
          { label: 'Colaboradores', href: '/rh/colaboradores', perms: [view('rh-colaboradores')] },
          { label: 'Importações', href: '/rh/importacoes', perms: [view('rh-importacoes')] },
          { label: 'Vale-Transporte', href: '/rh/vale-transporte', perms: [view('rh-vale-transporte')] },
          { label: 'Medidas Disciplinares', href: '/rh/medidas-disciplinares', perms: [view('rh-medidas-disciplinares')] },
          { label: 'Motivos', href: '/rh/motivos', perms: [view('rh-motivos')] },
          { label: 'Unidades', href: '/rh/unidades', perms: [view('rh-unidades')] },
          { label: 'Relatórios', href: '/rh/relatorios', perms: [view('rh-relatorios')] },
          { label: 'Auditoria', href: '/rh/auditoria', perms: [view('rh-auditoria')] },
        ],
      },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: FolderKanban,
    itens: [
      {
        label: 'Agente Corban',
        href: '/agente-corban',
        perms: [view('agente-corban')],
        children: [
          { label: 'Cadastros Recebidos', href: '/agente-corban/cadastros-recebidos', perms: [view('agente-corban-cadastros-recebidos')] },
          { label: 'Nível de Acesso', href: '/agente-corban/niveis-acesso', perms: [view('agente-corban-niveis-acesso')] },
          { label: 'Tipo de Agente', href: '/agente-corban/tipos-agente', perms: [view('agente-corban-tipos-agente')] },
          { label: 'Regra de Físico', href: '/agente-corban/regras-fisico', perms: [view('agente-corban-regras-fisico')] },
        ],
      },
      {
        label: 'SCP (legado)',
        href: '/rh/parceiros',
        perms: [view('scp-crm')],
        children: [
          { label: 'Construtor de Processo', href: '/rh/parceiros/config/processos', perms: [view('scp-processos')] },
          { label: 'Construtor de Formulário', href: '/rh/parceiros/config/formularios', perms: [view('scp-construtor')] },
          { label: 'Modelos de Documentos', href: '/rh/parceiros/config/documentos', perms: [view('scp-documentos')] },
          { label: 'Modelos de E-mails', href: '/rh/parceiros/config/emails', perms: [view('scp-emails')] },
          { label: 'Modelos de WhatsApp', href: '/rh/parceiros/config/whatsapp', perms: [view('scp-whatsapp')] },
        ],
      },
      { label: 'Instituições Financeiras', href: '/instituicoes-financeiras', perms: [view('sistema-config-instituicoes')] },
      { label: 'Convênios', href: '/convenios', perms: [view('workspace-convenios')] },
      { label: 'Promotoras', href: '/promotoras', perms: [view('promotoras')] },
      { label: 'Averbadoras', href: '#averbadoras', soon: true, perms: [view('sistema-config-instituicoes')] },
      {
        label: 'Cadastros Comerciais',
        href: '/rh/parceiros/config/comercial',
        perms: [view('comercial-agentes'), view('comercial-estrutura')],
        children: [
          { label: 'Preview Real', href: '/rh/parceiros/config/comercial/seletor' },
          { label: 'Links do Cartão Digital', href: '/rh/parceiros/config/comercial/links-cartao-digital' },
          { label: 'Tabela de Locação de Veículo', href: '/rh/parceiros/config/comercial/tabela-locacao-veiculo', perms: [view('comercial-estrutura')] },
        ],
      },
    ],
  },
  {
    id: 'operacional',
    label: 'Operacional',
    icon: BriefcaseBusiness,
    itens: [
      { label: 'Higienização de CPF', href: '/higienizacao-nvti', perms: [view('operacional-nvti')] },
      { label: 'Coeficientes Financeiros', href: '/coeficientes', perms: [view('sistema-config-credito')] },
      {
        label: 'Disparo de WhatsApp',
        href: '/disparo-whatsapp',
        perms: [view('comercial-disparo-whatsapp')],
        children: [
          { label: 'Nova Campanha', href: '/disparo-whatsapp/nova' },
          { label: 'Opt-outs', href: '/disparo-whatsapp/optouts' },
        ],
      },
      {
        label: 'Comissionamento',
        href: '/comissionamento',
        perms: [view('sistema-config-credito')],
        children: [
          { label: 'Tabelas de Comissão', href: '/comissionamento/tabelas' },
          { label: 'Prazos Comissão', href: '/comissionamento/prazos' },
          { label: 'Spreads', href: '/comissionamento/spreads' },
          { label: 'Formas de Contrato', href: '/comissionamento/formas-contrato' },
          { label: 'Tipos de Formalização', href: '/comissionamento/tipos-formalizacao' },
          { label: 'Importar Planilha', href: '/comissionamento/importar' },
        ],
      },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    icon: TrendingUp,
    itens: [
      {
        label: 'Gestão de Leads',
        href: '/gestao-leads',
        perms: [view('alvoconsig-gestao'), view('central-integracoes')],
        children: [
          { label: 'AlvoConsig — Visão Geral', href: '/alvoconsig', perms: [view('alvoconsig-gestao')] },
          { label: 'Importações', href: '/alvoconsig/importacoes', perms: [view('alvoconsig-gestao')] },
          { label: 'Alocação de Leads', href: '/alvoconsig/alocacao', perms: [view('alvoconsig-gestao')] },
          { label: 'Certificação', href: '/alvoconsig/certificacao', perms: [view('alvoconsig-certificacao')] },
          { label: 'Contatos', href: '/alvoconsig/contatos', perms: [view('alvoconsig-gestao')] },
          { label: 'Perfis de Usuário', href: '/alvoconsig/perfis', perms: [view('alvoconsig-gestao')] },
          { label: 'Ações Manuais', href: '/central-integracoes/acoes', perms: [view('central-integracoes')] },
          { label: 'Importação de Bases', href: '/central-integracoes/bases', perms: [view('central-integracoes')] },
        ],
      },
    ],
  },
  {
    id: 'tecnologia',
    label: 'Tecnologia',
    icon: Cpu,
    itens: [
      {
        label: 'Central de Integrações',
        href: '/central-integracoes',
        perms: [view('central-integracoes')],
        children: [
          { label: 'Orquestrador CLT', href: '/central-integracoes/orquestradores/clt' },
          { label: 'Sistemas', href: '/central-integracoes/sistemas' },
          { label: 'Monitoramento', href: '/central-integracoes/monitoramento' },
        ],
      },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings2,
    itens: [
      {
        label: 'Central de Atendimento',
        href: '/central-conversas',
        perms: [view('central-conversas')],
        children: [
          { label: 'Canais', href: '/central-conversas/canais' },
          { label: 'Grupos Internos', href: '/central-conversas/grupos' },
          { label: 'Atendimento (tela cheia)', href: '/conversas', perms: [view('conversas')] },
          { label: 'Comunicados', href: '/comunicados', perms: [view('sistema-comunicados')] },
          { label: 'Banners da Home', href: '/rh/parceiros/config/provedores/banners', perms: [view('sistema-config-banners')] },
        ],
      },
      { label: 'Usuários e Permissões', href: '/usuarios', perms: [view('sistema-usuarios-cadastro'), view('sistema-usuarios-root')] },
      { label: 'Provedores e APIs', href: '/rh/parceiros/config/provedores/empresas', perms: [view('sistema-config-empresa')] },
      { label: 'IA do Workspace', href: '/ia-workspace', perms: [view('sistema-config-ia')] },
    ],
  },
]

export function itemVisivel(perms: EffectivePermission[], item: NavItemDef | NavSubItem, herdados?: PermissionRequirement[]): boolean {
  const req = item.perms && item.perms.length ? item.perms : herdados
  if (!req || !req.length) return true
  return hasAnyPermission(perms, req)
}

export function divisaoVisivel(perms: EffectivePermission[], d: NavDivisao): boolean {
  return d.itens.some((i) => itemVisivel(perms, i))
}

/** A divisão "dona" da rota atual (para abrir o acordeão sozinha). */
export function divisaoDaRota(pathname: string): string | null {
  let melhor: { id: string; tamanho: number } | null = null
  for (const d of NAV_DIVISOES) {
    for (const item of d.itens) {
      const hrefs = [item.href, ...(item.children || []).map((c) => c.href)]
      for (const href of hrefs) {
        if (!href.startsWith('/')) continue
        if (pathname === href || pathname.startsWith(`${href}/`)) {
          if (!melhor || href.length > melhor.tamanho) melhor = { id: d.id, tamanho: href.length }
        }
      }
    }
  }
  return melhor?.id || null
}
