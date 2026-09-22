'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/server'

export type SubsistemaAgenda = 'colaborador' | 'if' | 'corban' | 'promotora' | 'comercial'

export const SUBSISTEMAS_AGENDA: Array<{ id: SubsistemaAgenda; rotulo: string; icone: string }> = [
  { id: 'colaborador', rotulo: 'Colaboradores', icone: 'User' },
  { id: 'if', rotulo: 'Instituições Financeiras', icone: 'Building2' },
  { id: 'corban', rotulo: 'Agente Corban', icone: 'Handshake' },
  { id: 'promotora', rotulo: 'Promotoras', icone: 'Building' },
  { id: 'comercial', rotulo: 'Comerciais', icone: 'Briefcase' },
]

export type ItemAgendaWorkspace = {
  id: string
  nome: string
  subsistema: SubsistemaAgenda
  rotuloSubsistema: string
  whatsapp: string | null
  email: string | null
  fotoUrl: string | null
  cargoOuEmpresa: string | null
  colaboradorUsuarioId?: string
}

export async function getAgendaWorkspace(filtros?: { subsistema?: SubsistemaAgenda | 'todos'; busca?: string }): Promise<{
  success: true
  itens: ItemAgendaWorkspace[]
  total: number
} | {
  success: false
  error: string
}> {
  try {
    const user = await requireCurrentUser()
    if (!user) throw new Error('Não autenticado.')
    const admin = await createAdminClient()
    const busca = String(filtros?.busca || '').trim().toLowerCase()
    const subFiltro = filtros?.subsistema && filtros.subsistema !== 'todos' ? filtros.subsistema : null

    const lista: ItemAgendaWorkspace[] = []

    // 1. Colaboradores / Equipe (users)
    if (!subFiltro || subFiltro === 'colaborador') {
      try {
        const { data: usuarios } = await admin
          .from('users')
          .select('id, name, nome_exibicao, email, avatar_url, active')
          .eq('active', true)
          .order('name')

        for (const u of usuarios || []) {
          const nome = String(u.nome_exibicao || u.name || '')
          lista.push({
            id: `colab_${u.id}`,
            nome,
            subsistema: 'colaborador',
            rotuloSubsistema: 'Colaborador',
            whatsapp: null,
            email: u.email ? String(u.email) : null,
            fotoUrl: u.avatar_url ? String(u.avatar_url) : null,
            cargoOuEmpresa: 'Equipe Workspace',
            colaboradorUsuarioId: String(u.id),
          })
        }
      } catch (err) {
        console.warn('Erro ao buscar usuários para agenda:', err)
      }
    }

    // 2. Instituições Financeiras (financial_institutions)
    if (!subFiltro || subFiltro === 'if') {
      try {
        const { data: ifs } = await admin
          .from('financial_institutions')
          .select('id, name, logo_url')
          .eq('is_active', true)
          .is('deleted_at', null)

        let contatosIf: any[] | null = null
        try {
          const res = await admin
            .from('if_contatos')
            .select('id, financial_institution_id, nome, cargo, whatsapp, email')
          contatosIf = res.data
        } catch {
          contatosIf = null
        }

        if (contatosIf && contatosIf.length > 0) {
          const mapIfs = new Map((ifs || []).map((i: any) => [String(i.id), i]))
          for (const c of contatosIf) {
            const parentIf = mapIfs.get(String(c.financial_institution_id))
            lista.push({
              id: `if_c_${c.id}`,
              nome: String(c.nome || parentIf?.name || 'Contato IF'),
              subsistema: 'if',
              rotuloSubsistema: 'Instituição Financeira',
              whatsapp: c.whatsapp ? String(c.whatsapp) : null,
              email: c.email ? String(c.email) : null,
              fotoUrl: parentIf?.logo_url ? String(parentIf.logo_url) : null,
              cargoOuEmpresa: [c.cargo, parentIf?.name].filter(Boolean).join(' · ') || 'Instituição Financeira',
            })
          }
        } else {
          for (const i of ifs || []) {
            lista.push({
              id: `if_${i.id}`,
              nome: String(i.name),
              subsistema: 'if',
              rotuloSubsistema: 'Instituição Financeira',
              whatsapp: null,
              email: null,
              fotoUrl: i.logo_url ? String(i.logo_url) : null,
              cargoOuEmpresa: 'Instituição Financeira',
            })
          }
        }
      } catch (err) {
        console.warn('Erro ao buscar IFs para agenda:', err)
      }
    }

    // 3. Agentes Corban / Parceiros (agentes_parceiros)
    if (!subFiltro || subFiltro === 'corban') {
      try {
        const { data: corbans } = await admin
          .from('agentes_parceiros')
          .select('id, name, fantasy_name, phone, responsible_name, logo_url')

        let contatosCorban: any[] | null = null
        try {
          const res = await admin
            .from('agente_parceiro_contatos')
            .select('id, agente_parceiro_id, nome, cargo, whatsapp, email')
          contatosCorban = res.data
        } catch {
          contatosCorban = null
        }

        if (contatosCorban && contatosCorban.length > 0) {
          const mapCorbans = new Map((corbans || []).map((c: any) => [String(c.id), c]))
          for (const c of contatosCorban) {
            const parentCorban = mapCorbans.get(String(c.agente_parceiro_id))
            const empresa = parentCorban?.fantasy_name || parentCorban?.name || 'Agente Corban'
            lista.push({
              id: `corban_c_${c.id}`,
              nome: String(c.nome || 'Contato Corban'),
              subsistema: 'corban',
              rotuloSubsistema: 'Agente Corban',
              whatsapp: c.whatsapp ? String(c.whatsapp) : null,
              email: c.email ? String(c.email) : null,
              fotoUrl: parentCorban?.logo_url ? String(parentCorban.logo_url) : null,
              cargoOuEmpresa: [c.cargo, empresa].filter(Boolean).join(' · '),
            })
          }
        } else {
          for (const c of corbans || []) {
            const nomeEmpresa = String(c.fantasy_name || c.name || 'Agente Corban')
            const nomeContato = c.responsible_name ? String(c.responsible_name) : nomeEmpresa
            lista.push({
              id: `corban_${c.id}`,
              nome: nomeContato,
              subsistema: 'corban',
              rotuloSubsistema: 'Agente Corban',
              whatsapp: c.phone ? String(c.phone) : null,
              email: null,
              fotoUrl: c.logo_url ? String(c.logo_url) : null,
              cargoOuEmpresa: c.responsible_name ? `Responsável · ${nomeEmpresa}` : 'Agente Corban',
            })
          }
        }
      } catch (err) {
        console.warn('Erro ao buscar Corbans para agenda:', err)
      }
    }

    // 4. Promotoras
    if (!subFiltro || subFiltro === 'promotora') {
      try {
        let promotoras: any[] | null = null
        try {
          const res = await admin
            .from('promotoras')
            .select('id, razao_social, nome_fantasia, telefone, email, logo_url')
          promotoras = res.data
        } catch {
          promotoras = null
        }

        let contatosPromotora: any[] | null = null
        try {
          const res = await admin
            .from('promotora_contatos')
            .select('id, promotora_id, nome, cargo, whatsapp, email')
          contatosPromotora = res.data
        } catch {
          contatosPromotora = null
        }

        if (contatosPromotora && contatosPromotora.length > 0) {
          const mapProm = new Map((promotoras || []).map((p: any) => [String(p.id), p]))
          for (const c of contatosPromotora) {
            const parentProm = mapProm.get(String(c.promotora_id))
            const empresa = parentProm?.nome_fantasia || parentProm?.razao_social || 'Promotora'
            lista.push({
              id: `prom_c_${c.id}`,
              nome: String(c.nome || 'Contato Promotora'),
              subsistema: 'promotora',
              rotuloSubsistema: 'Promotora',
              whatsapp: c.whatsapp ? String(c.whatsapp) : null,
              email: c.email ? String(c.email) : null,
              fotoUrl: parentProm?.logo_url ? String(parentProm.logo_url) : null,
              cargoOuEmpresa: [c.cargo, empresa].filter(Boolean).join(' · '),
            })
          }
        } else if (promotoras) {
          for (const p of promotoras) {
            const nomeEmpresa = String(p.nome_fantasia || p.razao_social || 'Promotora')
            lista.push({
              id: `prom_${p.id}`,
              nome: nomeEmpresa,
              subsistema: 'promotora',
              rotuloSubsistema: 'Promotora',
              whatsapp: p.telefone ? String(p.telefone) : null,
              email: p.email ? String(p.email) : null,
              fotoUrl: p.logo_url ? String(p.logo_url) : null,
              cargoOuEmpresa: 'Promotora',
            })
          }
        }
      } catch (err) {
        console.warn('Erro ao buscar promotoras para agenda:', err)
      }
    }

    // 5. Comerciais
    if (!subFiltro || subFiltro === 'comercial') {
      try {
        let comerciais: any[] | null = null
        try {
          const res = await admin
            .from('commercial_entities')
            .select('id, name, fantasy_name, phone, whatsapp, email, logo_url')
          comerciais = res.data
        } catch {
          comerciais = null
        }

        if (comerciais && comerciais.length > 0) {
          for (const c of comerciais) {
            const nome = String(c.fantasy_name || c.name || 'Comercial')
            lista.push({
              id: `com_${c.id}`,
              nome,
              subsistema: 'comercial',
              rotuloSubsistema: 'Comercial',
              whatsapp: c.whatsapp || c.phone ? String(c.whatsapp || c.phone) : null,
              email: c.email ? String(c.email) : null,
              fotoUrl: c.logo_url ? String(c.logo_url) : null,
              cargoOuEmpresa: 'Entidade Comercial',
            })
          }
        } else {
          let convenios: any[] | null = null
          try {
            const res = await admin
              .from('convenios')
              .select('id, nome, whatsapp_comercial')
            convenios = res.data
          } catch {
            convenios = null
          }

          for (const c of convenios || []) {
            if (c.whatsapp_comercial) {
              lista.push({
                id: `conv_${c.id}`,
                nome: String(c.nome),
                subsistema: 'comercial',
                rotuloSubsistema: 'Comercial',
                whatsapp: String(c.whatsapp_comercial),
                email: null,
                fotoUrl: null,
                cargoOuEmpresa: 'Entidade Comercial',
              })
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao buscar comerciais para agenda:', err)
      }
    }

    let resultado = lista
    if (busca) {
      resultado = lista.filter((item) => {
        const n = item.nome.toLowerCase()
        const c = (item.cargoOuEmpresa || '').toLowerCase()
        const w = (item.whatsapp || '').replace(/\D/g, '')
        const e = (item.email || '').toLowerCase()
        const digitosBusca = busca.replace(/\D/g, '')
        return (
          n.includes(busca) ||
          c.includes(busca) ||
          e.includes(busca) ||
          (digitosBusca.length >= 3 && w.includes(digitosBusca))
        )
      })
    }

    resultado.sort((a, b) => a.nome.localeCompare(b.nome))

    return {
      success: true,
      itens: resultado,
      total: resultado.length,
    }
  } catch (error: any) {
    console.error('Erro ao buscar Agenda do Workspace:', error)
    return { success: false, error: error.message || 'Falha ao carregar a Agenda.' }
  }
}
