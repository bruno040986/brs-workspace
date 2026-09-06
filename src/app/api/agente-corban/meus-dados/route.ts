/**
 * Recorte seguro do Agente Corban pra tela "Meus Dados" do Portal Parceiro.
 * Autentica por token de serviço (PORTAL_SERVICE_TOKEN), fail-closed — quem
 * resolve QUAL agente_parceiro_id consultar é o Portal (via a sessão do
 * próprio parceiro logado), nunca esta rota. Nunca devolve
 * temporary_password/filial/nivel_acesso/tipo_agente/regra_fisico nem nada
 * de AlvoConsig (config do CRM interno) ou Consulta CPF.
 *
 * GET ?agenteParceiroId=<uuid> → 200 { dadosCadastrais, contato, bancarios, garantia, documentos }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { normalizeAgenteCorbanDraftFromRow } from '@/lib/agente-corban'
import { isPortalServiceAuthorized } from '@/lib/agente-corban/service-auth'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  if (!isPortalServiceAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const agenteParceiroId = request.nextUrl.searchParams.get('agenteParceiroId') || ''
  if (!UUID_RE.test(agenteParceiroId)) {
    return NextResponse.json({ error: 'Informe "agenteParceiroId" (uuid) na query.' }, { status: 400 })
  }

  const admin = await createAdminClient()
  const { data: row, error } = await admin
    .from('agentes_parceiros')
    .select(
      `*,
      superintendente:superintendente_id ( id, name ),
      supervisor:supervisor_id ( id, name ),
      gerente:gerente_id ( id, name )`
    )
    .eq('id', agenteParceiroId)
    .maybeSingle()

  if (error) {
    console.error('[agente-corban/meus-dados] falha ao consultar:', error)
    return NextResponse.json({ error: 'Falha ao consultar o cadastro.' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const draft = normalizeAgenteCorbanDraftFromRow(row)
  const commercialNome = (v: unknown) => (v && typeof v === 'object' ? (v as { name?: string }).name ?? null : null)

  return NextResponse.json({
    dadosCadastrais: {
      personType: draft.person_type,
      cpfCnpj: draft.cpf_cnpj,
      name: draft.name,
      fantasyName: draft.fantasy_name,
      dataAbertura: draft.data_abertura,
      situacaoCadastral: draft.situacao_cadastral,
      porteEmpresa: draft.porte_empresa,
      naturezaJuridica: draft.natureza_juridica,
      cnaeMainCode: draft.cnae_main_code,
      cnaeMainDesc: draft.cnae_main_desc,
      representanteLegal: draft.representante_legal,
      rg: draft.rg,
      birthDate: draft.birth_date,
      gender: draft.gender,
      endereco: {
        cep: draft.cep,
        logradouro: draft.address_street,
        numero: draft.address_number,
        complemento: draft.address_complement,
        bairro: draft.address_neighborhood,
        cidade: draft.address_city,
        uf: draft.address_state,
      },
      socios: (draft.socios ?? []).map((s) => ({
        cpf: s.cpf,
        name: s.name,
        birthDate: s.birth_date,
        companyRole: s.company_role,
        phone: s.phone,
        email: s.email,
      })),
      arwCode: draft.arw_code,
      superintendente: commercialNome((row as Record<string, unknown>).superintendente),
      supervisor: commercialNome((row as Record<string, unknown>).supervisor),
      gerente: commercialNome((row as Record<string, unknown>).gerente),
    },
    contato: {
      phoneWhatsapp: draft.phone_whatsapp,
      phoneWhatsappFinanceiro: draft.phone_whatsapp_financeiro,
      phoneCommercial: draft.phone_commercial,
      phoneSupport: draft.phone_support,
      emailComissao: draft.email_comissao,
      emailFinanceiro: draft.email_financeiro,
      emailInforme: draft.email_informe,
      emailJuridico: draft.email_juridico,
      emailMesaLiberacao: draft.email_mesa_liberacao,
    },
    bancarios: {
      commissionReceiveType: draft.commission_receive_type,
      commissionLojaPercent: draft.commission_loja_percent,
      bankCode: draft.bank_code,
      bankName: draft.bank_name,
      bankAgency: draft.bank_agency,
      bankAccount: draft.bank_account,
      bankAccountType: draft.bank_account_type,
      pixType: draft.pix_type,
      pixKey: draft.pix_key,
      paymentPeriod: draft.payment_period,
    },
    // Só valor de garantia + produção mensal — o objeto bruto pode carregar
    // avalistas/testemunha, que o parceiro NÃO deve ver aqui.
    garantia: (() => {
      const g = (draft.garantia ?? {}) as Record<string, unknown>
      const producao = Array.isArray(g.producao) ? (g.producao as Array<Record<string, unknown>>) : []
      return {
        valorGarantia: g.valor_garantia ?? null,
        producao: producao.map((p) => ({ mes: String(p?.mes ?? ''), valor: Number(p?.valor ?? 0) })),
      }
    })(),
    documentos: {
      contractPdfUrl: draft.contract_pdf_url,
      officialDocumentUrl: draft.official_document_url,
      bankProofUrl: draft.bank_proof_url,
      addressProofUrl: draft.address_proof_url,
      primarySocioDocumentUrl: draft.primary_socio_document_url,
      secondarySocioDocumentUrl: draft.secondary_socio_document_url,
      frontPhotoUrl: draft.front_photo_url,
      internalPhotoUrl: draft.internal_photo_url,
    },
  })
}
