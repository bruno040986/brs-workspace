'use client'

import { useEffect, useState } from 'react'
import { 
  Users, AlertTriangle, TrendingUp, FileText, 
  Clock, CheckCircle, Calendar,
  Megaphone, ChevronRight, X, ExternalLink,
  ShieldCheck, Briefcase, Banknote, Monitor, Key, Loader2, UserCircle2,
  Bus, BarChart3, ShoppingCart, Cpu
} from 'lucide-react'
import { getLinksBySector } from './links/actions'
import { getMyEffectivePermissions, getMyHubContext } from '@/lib/auth/actions'
import {
  hasAnyPermission,
  hasPermission as permissionAllows,
  type EffectivePermission,
} from '@/lib/auth/permissions'
import PraiseBoard from './_components/PraiseBoard'
import HubBannerCarousel from './_components/HubBannerCarousel'
import { AgendaComponent } from './theme/AgendaComponent'
import { ComunicadosBoardWidget } from '@/components/comunicados/ComunicadosBoardWidget'

export default function HubPage() {
  const [activeSector, setActiveSector] = useState<string | null>(null)
  const [sectorLinks, setSectorLinks] = useState<any[]>([])
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null)

  const [userName, setUserName] = useState<string>('')
  const [greeting, setGreeting] = useState<string>('Bom dia')
  const [formattedDate, setFormattedDate] = useState<string>('')
  const [birthdays, setBirthdays] = useState<any[]>([])

  const [permissions, setPermissions] = useState<EffectivePermission[]>([])
  const [loadingPerms, setLoadingPerms] = useState(true)

  const praiseTabParam = searchParams?.get('praiseTab')
  const initialPraiseTab =
    praiseTabParam === 'send' || praiseTabParam === 'received' || praiseTabParam === 'feed'
      ? (praiseTabParam as 'feed' | 'send' | 'received')
      : undefined
  const focusPraiseId = searchParams?.get('praiseId') || undefined

  useEffect(() => {
    setSearchParams(new URLSearchParams(window.location.search))
  }, [])

  useEffect(() => {
    // 1. Saudação dinâmica baseada na hora
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) {
      setGreeting('Bom dia')
    } else if (hour >= 12 && hour < 18) {
      setGreeting('Boa tarde')
    } else {
      setGreeting('Boa noite')
    }

    // Formatar data com ano e Title Case nas palavras principais
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    }
    const dateStr = new Date().toLocaleDateString('pt-BR', options)
    const words = dateStr.split(' ').map(word => {
      if (word.length > 2) {
        return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-')
      }
      return word
    }).join(' ')
    setFormattedDate(words.charAt(0).toUpperCase() + words.slice(1))

    // 2. Buscar o primeiro nome e permissões do usuário logado
    async function fetchHubData() {
      try {
        const [hubContext, permsResult] = await Promise.all([
          getMyHubContext(),
          getMyEffectivePermissions(),
        ])

        if (hubContext.success) {
          setUserName(hubContext.userName || '')

          const today = new Date()
          today.setHours(0, 0, 0, 0)
          const todayYear = today.getFullYear()

          const months = [
            'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
          ]

          const withDaysUntil = (hubContext.birthdays || [])
            .map((u: any) => {
              const dateParts = String(u.birth_date || '').split('-')
              const bDay = parseInt(dateParts[2] || '0', 10)
              const bMonth = parseInt(dateParts[1] || '0', 10)
              if (!bDay || !bMonth) return null

              let nextBirthday = new Date(todayYear, bMonth - 1, bDay)
              nextBirthday.setHours(0, 0, 0, 0)
              if (nextBirthday < today) {
                nextBirthday = new Date(todayYear + 1, bMonth - 1, bDay)
              }

              const diffMs = nextBirthday.getTime() - today.getTime()
              const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24))

              let dayLabel = bDay + ' de ' + months[bMonth - 1]
              if (daysUntil === 0) dayLabel = 'Hoje'
              if (daysUntil === 1) dayLabel = 'Amanha'

              return {
                name: u.name,
                avatar_url: u.avatar_url || null,
                day: dayLabel,
                daysUntil,
                bDay,
                bMonth
              }
            })
            .filter((u: any) => u && u.daysUntil <= 60)
            .sort((a: any, b: any) => a.daysUntil - b.daysUntil)

          setBirthdays(withDaysUntil)
        }

        if (permsResult.success) {
          setPermissions(permsResult.permissions || [])
        }
      } catch (err) {
        console.error('Erro ao carregar contexto do hub:', err)
      } finally {
        setLoadingPerms(false)
      }
    }
    fetchHubData()
  }, [])

  useEffect(() => {
    const sector = searchParams?.get('sector')
    if (!sector || loadingPerms) return
    handleSelectSector(sector)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loadingPerms, permissions])

  const handleSelectSector = async (sectorId: string) => {
    if (loadingPerms || !permissionAllows(permissions, `workspace-${sectorId}`)) {
      setActiveSector(null)
      setSectorLinks([])
      return
    }

    setActiveSector(sectorId)
    setLoadingLinks(true)
    const result = await getLinksBySector(sectorId)
    if (result.success) {
      setSectorLinks(result.data || [])
    }
    setLoadingLinks(false)
  }

  const canView = (resourceId: string): boolean => {
    if (loadingPerms) return false
    return permissionAllows(permissions, resourceId)
  }

  const sectors = [
    { 
      id: 'adm', 
      name: 'Administrativo', 
      icon: UserCircle2, 
      color: 'adm',
      links: [
        { label: 'Documentos da Empresa', href: 'https://drive.google.com/drive/folders/1VLre1sfTrywcZUwt1Q1_zdeXVyMFjhKu?usp=sharing', external: true },
        { label: 'Documentos do Sócio', href: 'https://drive.google.com/drive/folders/1PSvm8lQABhusuOuMSgB0SHM3U-iUcl5Y?usp=sharing', external: true },
        { label: 'Correios', href: 'https://empresas.correios.com.br/#/login', external: true },
      ]
    },
    { 
      id: 'fin', 
      name: 'Financeiro', 
      icon: Banknote, 
      color: 'fin',
      links: [
        { label: 'Conta Virtual Parceiros', href: '/financeiro/conta-parceiros' },
        { label: 'Conta Azul', href: 'https://login.contaazul.com/#/', external: true },
        { label: 'BluePay', href: 'https://app.bluepaysolutions.com.br/auth/users/sign_in?_gl=1*3n59ks*_gcl_au*MTQyNTExODg5Ny4xNzQxNjE0Nzky*_ga*Mzc0NjY5NTMzLjE3NDE2MTQ3OTE.*_ga_3GXPGWJ0SL*czE3NDc2NTY1NjckbzMkZzEkdDE3NDc2NTgzMzAkajAkbDAkaDA&utm_source=site&utm_medium=menu&utm_campaign=inb', external: true },
        { label: 'Portal Nacional da NFSe', href: 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional', external: true },
        { label: 'Reembolsos', href: '#', disabled: true },
        { label: 'Planilhas de Conversão de Dados', href: 'https://drive.google.com/drive/folders/1fbp8SneQfQ4wjE0gsBFPpF2n1Gf4BcEU?usp=sharing', external: true },
        { label: 'Conciliação Diária de Recebimentos', href: '#', disabled: true },
        { label: 'Manual de Rotinas Financeiras', href: '#', disabled: true },
        { label: 'Portho Contabilidade', href: 'https://vip.acessorias.com/porthocontabil', external: true },
      ]
    },
    { 
      id: 'rh', 
      name: 'RH', 
      icon: Users, 
      color: 'rh',
      links: [
        { label: 'Painel de Controle RH', href: '/rh' },
        { label: 'QuarkRH Gestão', href: 'https://rh-colaborador.quark.tec.br/', external: true },
        { label: 'QuarkRH Portal do Colaborador', href: 'https://rh-colaborador.quark.tec.br/', external: true },
        { label: 'Canal de Denúncias Anônimas', href: 'https://rh-colaborador.quark.tec.br/app/colaborador/denuncia/cadastrar', external: true },
        { label: 'Regimento Interno', href: 'https://drive.google.com/drive/folders/1cbLHQJdTUMOQkPS91YTXP4Ul_KL_Ib4H?usp=sharing', external: true },
        { label: 'Quadro de Cargos e Salários', href: 'https://docs.google.com/spreadsheets/d/1NzUXmVycP4jZ6-IVlNe839nzODsy5vJ7/edit?usp=sharing&ouid=102020987086611987742&rtpof=true&sd=true', external: true },
        { label: 'Portho Contabilidade', href: 'https://vip.acessorias.com/porthocontabil', external: true },
      ]
    },
    { 
      id: 'ops', 
      name: 'Operacional', 
      icon: Monitor, 
      color: 'ops',
      links: [
        { label: 'Sistema de Cadastro de Parceiros (SCP)', href: '/rh/parceiros' },
        { label: 'Links de Bancos', href: '#', disabled: true },
        { label: 'Instituições Financeiras', href: '/instituicoes-financeiras' },
        { label: 'Convênios', href: '/convenios' },
        { label: 'Comissionamento (ARW)', href: '/comissionamento' },
        { label: 'Coeficientes Financeiros', href: '/coeficientes' },
        { label: 'Link de Averbadores', href: '#', disabled: true },
        { label: 'Agente Corban', href: '/agente-corban' },
        { label: 'Promotoras', href: '/promotoras' },
        { label: 'Higienização de CPF NVTI', href: '/higienizacao-nvti' },
        { label: 'Manual de Rotinas Operacionais', href: '#', disabled: true },
        { label: 'Propostas Digitadas Internamente', href: '#', disabled: true },
        { label: 'Logins e Acessos Criados', href: '#', disabled: true },
        { label: 'Assinafy', href: 'https://www.assinafy.com.br/', external: true },
        { label: 'Sistema ARW', href: 'https://brspromotora.arwconsig.com.br/', external: true },
        { label: 'Nuvidio Gestão', href: 'https://empresa.nuvidio.com/login', external: true },
        { label: 'Nuvidio Atendimento', href: 'https://atendimento.nuvidio.com/login', external: true },
        { label: 'Digisac', href: 'https://brspromotora.digisac.chat/login', external: true },
        { label: 'Lemit', href: 'https://lemitti.com/', external: true },
      ]
    },
    { 
      id: 'mkt', 
      name: 'Marketing', 
      icon: Megaphone, 
      color: 'mkt',
      links: [
        { label: 'BRS Promotora', href: 'https://drive.google.com/drive/folders/15gePuWUSUQpDPG-0MVLjbw3TsBu0hD3Z?usp=sharing', external: true },
        { label: 'BRS Gestão', href: 'https://drive.google.com/drive/folders/17Zo6_d-1Q9z-If3boE_ln2fAB07j54OP?usp=sharing', external: true },
        { label: 'Logotipo de Instituições Financeiras', href: 'https://drive.google.com/drive/folders/1Q74oHJKsj6kWGGsesHqMHV5uuZbO_rNZ?usp=sharing', external: true },
        { label: 'Instagram', href: 'https://www.instagram.com/brspromotora', external: true },
        { label: 'Facebook', href: 'https://www.facebook.com/brspromotora', external: true },
        { label: 'Solicitar Arte', href: '#', disabled: true },
        { label: 'Sugerir Conteúdo', href: '#', disabled: true },
      ]
    },
    { 
      id: 'com', 
      name: 'Comercial', 
      icon: Briefcase, 
      color: 'com',
      links: [
        { label: 'Cadastros Comerciais', href: '/rh/parceiros/config/comercial' },
        { label: 'AlvoConsig — Gestão de Leads', href: '/alvoconsig' },
        { label: 'Disparo de WhatsApp', href: '/disparo-whatsapp' },
        { label: 'Higienização de CPF NVTI', href: '/higienizacao-nvti' },
        { label: 'Visão do Gerente', href: '#', disabled: true },
        { label: 'Visão do Supervisor', href: '#', disabled: true },
        { label: 'Visão do Superintendente', href: '#', disabled: true },
        { label: 'Mailing Higienizado Drive', href: 'https://drive.google.com/drive/folders/1iIT-CtmzHwtYfeFzPFNNCTjI6YrCaYEz?usp=drive_link', external: true },
        { label: 'Promosys', href: 'https://www.promosysweb.com/apex/f?p=101:LOGIN_DESKTOP:2083723502586:::::', external: true },
        { label: 'Sistema de Mailing', href: '#', disabled: true },
        { label: 'Reembolso Comercial', href: '#', disabled: true },
        { label: 'BRS Ajuda', href: '#', disabled: true },
        { label: 'Negociações', href: '#', disabled: true },
        { label: 'Fechamento Mensal', href: '#', disabled: true },
      ]
    },
    { 
      id: 'tec', 
      name: 'Tecnologia', 
      icon: Cpu, 
      color: 'tec',
      links: [
        { label: 'Central de Integrações', href: '/central-integracoes' },
        { label: 'Central de Atendimento', href: '/central-conversas' },
        { label: 'WeSales', href: 'https://app.wesales.com.br/', external: true },
        { label: 'CallFace', href: 'https://app.callface.ai/', external: true },
        { label: 'Vende.AI', href: 'https://ia.vendeaitecnologia.com.br/', external: true },
        { label: 'Vercel', href: 'https://vercel.com/', external: true },
        { label: 'Supabase', href: 'https://supabase.com/dashboard', external: true },
      ]
    },
    { 
      id: 'acc', 
      name: 'Acessos', 
      icon: Key, 
      color: 'acc',
      links: [
        { label: 'Cofre de Senhas', href: '#', disabled: true },
      ]
    }
  ]

  const allowedSectors = sectors
    .filter(sec => canView(`workspace-${sec.id}`))
    .map(sec => ({
      ...sec,
      links: sec.links.filter(link => {
        if (link.href === '/rh') {
          return canView('rh-painel')
        }
        if (link.href === '/rh/parceiros') {
          return canView('scp-crm')
        }
        if (link.href === '/agente-corban') {
          return canView('agente-corban')
        }
        if (link.href === '/disparo-whatsapp') {
          return canView('comercial-disparo-whatsapp')
        }
        if (link.href === '/higienizacao-nvti') {
          return canView('operacional-nvti')
        }
        if (link.href === '/central-integracoes') {
          return canView('central-integracoes')
        }
        if (link.href === '/central-conversas') {
          return canView('central-conversas')
        }
        if (link.href === '/rh/parceiros/config/comercial') {
          return hasAnyPermission(permissions, [
            { resource: 'comercial-agentes' },
            { resource: 'comercial-estrutura' },
          ])
        }
        return true
      })
    }))

  return (
    <div className="hub-container">
      <div className="hub-layout">
        {/* Coluna Principal */}
        <div className="hub-main">
          
          {/* Saudação e Widget de Tempo nativo via iframe com srcDoc isolado */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--brs-gray-800)', margin: 0 }}>
                {greeting}, {userName || 'Usuário'}!
              </h1>
              <p style={{ color: 'var(--brs-gray-400)', fontSize: '1rem', marginTop: '0.5rem' }}>
                {formattedDate || 'Carregando data...'}
              </p>
            </div>

            {/* Renderização 100% nativa em sandbox isolada, eliminando conflitos e perdas de nós DOM no React */}
            <iframe
              className="hub-weather"
              srcDoc={`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { margin: 0; padding: 0; overflow: hidden; background: transparent; font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div id="ww_eee39f6fea6fe" v='1.3' loc='auto' a='{"t":"horizontal","lang":"pt","sl_lpl":1,"ids":[],"font":"Arial","sl_ics":"one_a","sl_sot":"celsius","cl_bkg":"image","cl_font":"#FFFFFF","cl_cloud":"#FFFFFF","cl_persp":"#81D4FA","cl_sun":"#FFC107","cl_moon":"#FFC107","cl_thund":"#FF5722"}'>
      Mais previsões: <a href="https://tempolongo.com/lisboa_tempo_25_dias/" id="ww_eee39f6fea6fe_u" target="_blank">Previsão do tempo em Lisboa</a>
    </div>
    <script async src="https://app3.weatherwidget.org/js/?id=ww_eee39f6fea6fe"></script>
  </body>
</html>`}
              style={{ minWidth: '320px', maxWidth: '450px', flex: 1, height: '190px', border: 'none', borderRadius: '12px', overflow: 'hidden' }}
              title="Previsão do Tempo"
            />
          </div>

        <HubBannerCarousel />

        {/* Widget de Google Agenda */}
        <div className="widget-card">
          <div className="widget-header">
            <h3 className="widget-title">
              <Calendar size={18} style={{ color: 'var(--brs-navy)' }} />
              Google Agenda
            </h3>
          </div>
          <div className="widget-content" style={{ padding: '1rem' }}>
            <AgendaComponent />
          </div>
        </div>

        {/* Grid de Setores ou Detalhe do Setor */}
        {!activeSector ? (
          <div className="hub-sections-grid">
            {allowedSectors.map((sector) => (
              <div 
                key={sector.id} 
                className="sector-card"
                onClick={() => handleSelectSector(sector.id)}
              >
                <div className={`sector-icon ${sector.color}`}>
                  <sector.icon size={24} />
                </div>
                <h3 className="sector-title">{sector.name}</h3>
                <div className="sector-action">
                  Acessar Portal <ChevronRight size={16} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ animation: 'slideIn 0.3s ease' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className={`sector-icon ${allowedSectors.find(s => s.id === activeSector)?.color}`} style={{ marginBottom: 0 }}>
                  {allowedSectors.find(s => s.id === activeSector)?.icon && (
                    <div style={{ color: 'inherit' }}>
                      {/* @ts-ignore */}
                      {(() => { const Icon = allowedSectors.find(s => s.id === activeSector)!.icon; return <Icon size={24} /> })()}
                    </div>
                  )}
                </div>
                <h2 className="card-title" style={{ margin: 0 }}>Portal {allowedSectors.find(s => s.id === activeSector)?.name}</h2>
              </div>
              <button 
                className="icon-button" 
                onClick={() => setActiveSector(null)}
                style={{ background: 'var(--brs-gray-50)' }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="card-body">
              {loadingLinks ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Loader2 className="spinner" />
                  <p style={{ marginTop: '0.5rem', color: 'var(--brs-gray-400)', fontSize: '0.875rem' }}>Buscando ferramentas...</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                  {/* Links Fixos (Base) */}
                   {allowedSectors.find(s => s.id === activeSector)?.links.map((link) => {
                     if (link.disabled) {
                       return (
                         <div 
                           key={link.label}
                           className="sector-card"
                           title="Em Breve Será Implementado"
                           style={{ padding: '1.25rem', textAlign: 'center', opacity: 0.6, cursor: 'not-allowed', background: 'var(--brs-gray-50)' }}
                         >
                           <div style={{ fontWeight: 600, color: 'var(--brs-gray-400)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                             🚫 {link.label}
                           </div>
                         </div>
                       )
                     }
                    return (
                      <a 
                        key={link.label} 
                        href={link.href} 
                        target={link.external ? '_blank' : '_self'}
                        className="sector-card"
                        style={{ padding: '1.25rem', textAlign: 'center', textDecoration: 'none' }}
                      >
                        <div style={{ fontWeight: 600, color: 'var(--brs-gray-800)' }}>{link.label}</div>
                        {link.external && <div style={{ fontSize: '0.7rem', color: 'var(--brs-gray-400)' }}>Externo <ExternalLink size={10} /></div>}
                      </a>
                    )
                  })}

                  {/* Links Dinâmicos do Banco */}
                  {sectorLinks.map((link) => (
                    <a 
                      key={link.id} 
                      href={link.url} 
                      target={link.is_external ? '_blank' : '_self'}
                      className="sector-card"
                      style={{ padding: '1.25rem', textAlign: 'center', textDecoration: 'none', borderColor: 'var(--brs-gold)' }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--brs-gray-800)' }}>{link.label}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--brs-gold)', fontWeight: 600 }}>Ferramenta Setorial</div>
                    </a>
                  ))}

                  {sectorLinks.length === 0 && !allowedSectors.find(s => s.id === activeSector)?.links.length && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--brs-gray-400)' }}>
                      Nenhuma ferramenta cadastrada para este setor.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Coluna Lateral (Widgets) */}
      <div className="hub-sidebar">
        
        <ComunicadosBoardWidget />

        <PraiseBoard initialTab={initialPraiseTab} focusPraiseId={focusPraiseId} />

        {/* Widget de Próximos Aniversariantes */}
        <div className="widget-card">
          <div className="widget-header">
            <h3 className="widget-title">
              <Calendar size={18} style={{ color: 'var(--brs-gold)' }} />
              Próximos Aniversariantes
            </h3>
          </div>
          <div className="widget-content">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {birthdays.length > 0 ? (
                birthdays.map((person: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--brs-navy)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      border: person.daysUntil === 0 ? '3px solid var(--brs-gold)' : '2px solid var(--brs-gray-100)'
                    }}>
                      {person.avatar_url ? (
                        <img
                          src={person.avatar_url}
                          alt={person.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        person.name.charAt(0)
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--brs-gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.name.split(' ')[0]}</div>
                      <div style={{ fontSize: '0.8rem', color: person.daysUntil === 0 ? 'var(--brs-gold)' : 'var(--brs-gray-400)', fontWeight: person.daysUntil <= 1 ? 700 : 400 }}>{person.day}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--brs-gray-400)', fontSize: '0.8125rem' }}>
                  Nenhum aniversariante nos próximos 60 dias.
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
    </div>
  )
}
