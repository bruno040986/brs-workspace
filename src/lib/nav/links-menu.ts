'use server'

/**
 * Dropdown "Links" da topbar (layout aprovado 02/09/2026): fonte única dos
 * links externos que antes viviam espalhados nos cards da home. Junta:
 * 1. o catálogo fixo por setor (o que era hardcoded nos cards);
 * 2. os links cadastrados em banco (`sector_links`, tela /links);
 * 3. os sistemas das fichas de Instituições Financeiras e Promotoras
 *    (aba "Sistemas" de cada cadastro — entra sozinho, sem lista duplicada).
 * Permissão por setor: `workspace-<id>`, como era nos cards.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser, getEffectivePermissionsForUser } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/permissions'
import { normalizeSystems } from '@/lib/promotoras'

export type LinkMenuItem = { label: string; href: string; external: boolean }
export type LinkMenuGroup = { id: string; label: string; itens: LinkMenuItem[] }

const CATALOGO_FIXO: Array<{ id: string; label: string; itens: LinkMenuItem[] }> = [
  {
    id: 'adm',
    label: 'Administrativo',
    itens: [
      { label: 'Documentos da Empresa', href: 'https://drive.google.com/drive/folders/1VLre1sfTrywcZUwt1Q1_zdeXVyMFjhKu?usp=sharing', external: true },
      { label: 'Documentos do Sócio', href: 'https://drive.google.com/drive/folders/1PSvm8lQABhusuOuMSgB0SHM3U-iUcl5Y?usp=sharing', external: true },
      { label: 'Correios', href: 'https://empresas.correios.com.br/#/login', external: true },
    ],
  },
  {
    id: 'fin',
    label: 'Financeiro',
    itens: [
      { label: 'Conta Azul', href: 'https://login.contaazul.com/#/', external: true },
      { label: 'BluePay', href: 'https://app.bluepaysolutions.com.br/auth/users/sign_in', external: true },
      { label: 'Portal Nacional da NFSe', href: 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional', external: true },
      { label: 'Planilhas de Conversão de Dados', href: 'https://drive.google.com/drive/folders/1fbp8SneQfQ4wjE0gsBFPpF2n1Gf4BcEU?usp=sharing', external: true },
      { label: 'Portho Contabilidade', href: 'https://vip.acessorias.com/porthocontabil', external: true },
    ],
  },
  {
    id: 'rh',
    label: 'RH',
    itens: [
      { label: 'QuarkRH Gestão', href: 'https://rh-colaborador.quark.tec.br/', external: true },
      { label: 'QuarkRH Portal do Colaborador', href: 'https://rh-colaborador.quark.tec.br/', external: true },
      { label: 'Canal de Denúncias Anônimas', href: 'https://rh-colaborador.quark.tec.br/app/colaborador/denuncia/cadastrar', external: true },
      { label: 'Regimento Interno', href: 'https://drive.google.com/drive/folders/1cbLHQJdTUMOQkPS91YTXP4Ul_KL_Ib4H?usp=sharing', external: true },
      { label: 'Quadro de Cargos e Salários', href: 'https://docs.google.com/spreadsheets/d/1NzUXmVycP4jZ6-IVlNe839nzODsy5vJ7/edit?usp=sharing&ouid=102020987086611987742&rtpof=true&sd=true', external: true },
    ],
  },
  {
    id: 'ops',
    label: 'Operacional',
    itens: [
      { label: 'Sistema ARW', href: 'https://brspromotora.arwconsig.com.br/', external: true },
      { label: 'Assinafy', href: 'https://www.assinafy.com.br/', external: true },
      { label: 'Nuvidio Gestão', href: 'https://empresa.nuvidio.com/login', external: true },
      { label: 'Nuvidio Atendimento', href: 'https://atendimento.nuvidio.com/login', external: true },
      { label: 'Digisac', href: 'https://brspromotora.digisac.chat/login', external: true },
      { label: 'Lemit', href: 'https://lemitti.com/', external: true },
    ],
  },
  {
    id: 'com',
    label: 'Comercial',
    itens: [
      { label: 'Promosys', href: 'https://www.promosysweb.com/apex/f?p=101:LOGIN_DESKTOP:2083723502586:::::', external: true },
      { label: 'Mailing Higienizado (Drive)', href: 'https://drive.google.com/drive/folders/1iIT-CtmzHwtYfeFzPFNNCTjI6YrCaYEz?usp=drive_link', external: true },
    ],
  },
  {
    id: 'mkt',
    label: 'Marketing',
    itens: [
      { label: 'Drive BRS Promotora', href: 'https://drive.google.com/drive/folders/15gePuWUSUQpDPG-0MVLjbw3TsBu0hD3Z?usp=sharing', external: true },
      { label: 'Drive BRS Gestão', href: 'https://drive.google.com/drive/folders/17Zo6_d-1Q9z-If3boE_ln2fAB07j54OP?usp=sharing', external: true },
      { label: 'Logotipos de Instituições', href: 'https://drive.google.com/drive/folders/1Q74oHJKsj6kWGGsesHqMHV5uuZbO_rNZ?usp=sharing', external: true },
      { label: 'Instagram', href: 'https://www.instagram.com/brspromotora', external: true },
      { label: 'Facebook', href: 'https://www.facebook.com/brspromotora', external: true },
    ],
  },
  {
    id: 'tec',
    label: 'Tecnologia',
    itens: [
      { label: 'WeSales', href: 'https://app.wesales.com.br/', external: true },
      { label: 'CallFace', href: 'https://app.callface.ai/', external: true },
      { label: 'Vende.AI', href: 'https://ia.vendeaitecnologia.com.br/', external: true },
      { label: 'Vercel', href: 'https://vercel.com/', external: true },
      { label: 'Supabase', href: 'https://supabase.com/dashboard', external: true },
    ],
  },
]

export async function getWorkspaceLinksMenu(): Promise<{ success: boolean; groups?: LinkMenuGroup[]; error?: string }> {
  try {
    const user = await requireCurrentUser()
    const permissions = await getEffectivePermissionsForUser(user.id)
    const admin = await createAdminClient()

    const podeSetor = (id: string) => hasPermission(permissions, `workspace-${id}`, 'can_view')

    const grupos: LinkMenuGroup[] = []

    // 1+2. Catálogo fixo + links de banco por setor
    const setoresVisiveis = CATALOGO_FIXO.filter((g) => podeSetor(g.id))
    const { data: dbLinks } = await admin
      .from('sector_links')
      .select('sector_id, label, url, is_external')
      .order('label')
    const dbPorSetor = new Map<string, LinkMenuItem[]>()
    for (const row of dbLinks || []) {
      const arr = dbPorSetor.get(String(row.sector_id)) || []
      arr.push({ label: String(row.label || ''), href: String(row.url || ''), external: row.is_external !== false })
      dbPorSetor.set(String(row.sector_id), arr)
    }

    for (const g of setoresVisiveis) {
      const extras = (dbPorSetor.get(g.id) || []).filter((e) => e.href)
      const vistos = new Set(g.itens.map((i) => i.href))
      const itens = [...g.itens, ...extras.filter((e) => !vistos.has(e.href))]
      if (itens.length) grupos.push({ id: g.id, label: g.label, itens })
    }

    // 3. Sistemas das fichas (aba Sistemas), só ativos e com URL
    if (hasPermission(permissions, 'sistema-config-instituicoes', 'can_view')) {
      const { data: ifs } = await admin
        .from('financial_institutions')
        .select('name, systems, is_active')
        .is('deleted_at', null)
      const itens: LinkMenuItem[] = []
      for (const inst of ifs || []) {
        if (inst.is_active === false) continue
        for (const sys of normalizeSystems(inst.systems)) {
          if (!sys.is_active || !sys.url) continue
          itens.push({ label: `${inst.name}${sys.descricao ? ` — ${sys.descricao}` : ''}`, href: sys.url, external: true })
        }
      }
      if (itens.length) grupos.push({ id: 'sistemas-if', label: 'Instituições Financeiras — Sistemas', itens })
    }

    if (hasPermission(permissions, 'promotoras', 'can_view')) {
      const { data: promotoras } = await admin.from('promotoras').select('name, systems, is_active')
      const itens: LinkMenuItem[] = []
      for (const pr of promotoras || []) {
        if (pr.is_active === false) continue
        for (const sys of normalizeSystems(pr.systems)) {
          if (!sys.is_active || !sys.url) continue
          itens.push({ label: `${pr.name}${sys.descricao ? ` — ${sys.descricao}` : ''}`, href: sys.url, external: true })
        }
      }
      if (itens.length) grupos.push({ id: 'sistemas-promotoras', label: 'Promotoras — Sistemas', itens })
    }

    return { success: true, groups: grupos }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao carregar links.' }
  }
}
