/**
 * Gestão de Leads — concentrador da divisão Comercial (aprovado 02/09/2026).
 * Tudo relacionado a leads mora aqui, independente do convênio: alocação
 * (AlvoConsig), importação de bases e ações manuais (que operam via Central
 * de Integrações, mas são trabalho de LEADS — a Tecnologia ficou só com a
 * parte técnica: saúde, eventos e erros das integrações).
 */
import Link from 'next/link'
import { Database, Megaphone, Rocket, UserCog, Users, FileSpreadsheet, GraduationCap } from 'lucide-react'
import { requireAnyPermission, getCurrentUserEffectivePermissions } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function GestaoLeadsPage() {
  try {
    await requireAnyPermission([
      { resource: 'alvoconsig-gestao', action: 'can_view' },
      { resource: 'central-integracoes', action: 'can_view' },
    ])
  } catch {
    redirect('/')
  }
  const permissions = await getCurrentUserEffectivePermissions()
  const veAlvo = hasPermission(permissions, 'alvoconsig-gestao', 'can_view')
  const veCentral = hasPermission(permissions, 'central-integracoes', 'can_view')

  const cards = [
    veAlvo && {
      href: '/alvoconsig',
      titulo: 'AlvoConsig — Visão Geral',
      desc: 'Painel da gestão de leads do pool WeSales.',
      Icone: Users,
    },
    veAlvo && {
      href: '/alvoconsig/alocacao',
      titulo: 'Alocação de Leads',
      desc: 'Entrega de leads do pool à carteira dos parceiros.',
      Icone: Megaphone,
    },
    veAlvo && {
      href: '/alvoconsig/importacoes',
      titulo: 'Importações',
      desc: 'Importação de margens, REFIN e demais bases do AlvoConsig.',
      Icone: FileSpreadsheet,
    },
    veCentral && {
      href: '/central-integracoes/bases',
      titulo: 'Importação de Bases (CLT)',
      desc: 'Upload de base do motor de crédito — vira tag e público de disparo.',
      Icone: Database,
    },
    veCentral && {
      href: '/central-integracoes/acoes',
      titulo: 'Ações Manuais',
      desc: 'Wizard de disparos: público por filtro, preview e job (CallFace, template WhatsApp).',
      Icone: Rocket,
    },
    veAlvo && {
      href: '/alvoconsig/contatos',
      titulo: 'Contatos',
      desc: 'Contatos e leads sincronizados.',
      Icone: UserCog,
    },
    veAlvo && {
      href: '/alvoconsig/certificacao',
      titulo: 'Certificação',
      desc: 'Certificação de parceiros para receber leads.',
      Icone: GraduationCap,
    },
  ].filter((c): c is Exclude<typeof c, false> => Boolean(c))

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.35rem' }}>Gestão de Leads</h1>
      <p style={{ color: 'var(--brs-gray-400)', fontSize: '0.88rem', margin: '0 0 1.4rem' }}>
        Tudo de leads num lugar só — alocação, importações, margens/REFIN e disparos, independente do convênio.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '0.9rem' }}>
        {cards.map(({ href, titulo, desc, Icone }) => (
          <Link
            key={href}
            href={href}
            className="card"
            style={{ padding: '1.1rem', textDecoration: 'none', color: 'var(--brs-gray-800)', display: 'block' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--brs-navy)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icone size={19} />
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{titulo}</strong>
            </div>
            <p style={{ margin: 0, color: 'var(--brs-gray-400)', fontSize: '0.8rem', lineHeight: 1.45 }}>{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
