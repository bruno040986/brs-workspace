/**
 * Geração de contrato para um parceiro — caminho de produção reutilizável.
 *
 * Usada tanto pelo motor (handler generate_document ao entrar na etapa) quanto
 * por disparo manual do operador. Preenche o template da Assinafy com o
 * corban_data real do parceiro, cria os signatários e o pedido de assinatura, e
 * persiste o documento vinculado à instância do processo (para o webhook/
 * reconciliação avançarem a etapa quando assinado).
 *
 * Apenas back-end. Resolução de signatários é INTERIM (C2a): usa o e-mail real
 * do sócio/parceiro quando disponível; a resolução completa por papel
 * (BRS/gerente/testemunha via company_profiles) fica para o C2b.
 */

import { AssinafyClient } from './client'
import { buildContractEditorFields } from './contract-fill'
import { getAssinafyConfig } from './config'
import { recordAssinafyDocument } from './documents'

export type GenerateContractInput = {
  partnerId: string
  /** Nome (ou parte) do template na Assinafy. Vem da config da etapa (assinafy_template_name). */
  templateName?: string
  /** Instância do processo — vincula o documento para o avanço automático. */
  processInstanceId?: string | null
  /** E-mail de fallback para papéis sem contato resolvido (ex.: sandbox/teste). */
  fallbackEmail?: string
}

export type GenerateContractResult = {
  ok: boolean
  error?: string
  documentId?: string
  status?: string
  signingUrls?: Array<{ signer_id: string; url: string }>
  filled?: Array<{ name: string; canonicalKey: string; value: string }>
  missing?: Array<{ name: string; canonicalKey: string }>
  unmapped?: string[]
}

function extractTemplateFields(template: any): any[] {
  if (Array.isArray(template?.fields)) return template.fields
  if (Array.isArray(template?.pages)) return template.pages.flatMap((p: any) => (Array.isArray(p?.fields) ? p.fields : []))
  return []
}

/**
 * Resolve o e-mail de um papel a partir do corban_data (interim C2a).
 * Papel do sócio/contratado → e-mail do sócio principal; demais → fallback.
 */
function resolveRoleEmail(roleName: string, corbanData: any, fallbackEmail: string): string {
  const name = String(roleName || '').toLowerCase()
  const socioEmail = String(corbanData?.socios?.[0]?.email || '').trim()
  const comissaoEmail = String(corbanData?.contacts?.email_comissao || '').trim()
  if (/contratado|s[oó]cio|agente/.test(name)) {
    return socioEmail || comissaoEmail || fallbackEmail
  }
  return fallbackEmail || comissaoEmail || socioEmail
}

export async function generateContractForPartner(input: GenerateContractInput): Promise<GenerateContractResult> {
  try {
    if (!input.partnerId) return { ok: false, error: 'partnerId ausente' }

    const { createAdminClient } = await import('@/lib/supabase/server')
    const supabase = await createAdminClient()

    const { data: partner, error: pErr } = await supabase
      .from('agentes_parceiros')
      .select('*')
      .eq('id', input.partnerId)
      .maybeSingle()
    if (pErr) throw pErr
    if (!partner) return { ok: false, error: 'Parceiro não encontrado' }

    const { normalizeAgenteCorbanDraftFromRow } = await import('@/lib/agente-corban')
    const corbanData = normalizeAgenteCorbanDraftFromRow(partner as any).corban_data || {}

    const client = await AssinafyClient.fromActiveConfig()

    // Template da Assinafy pela referência da etapa (ou o único disponível).
    const templates = await client.listTemplates()
    const wanted = String(input.templateName || '').trim().toLowerCase()
    const template =
      (wanted ? templates.find((t: any) => String(t?.name || '').toLowerCase().includes(wanted)) : null) ||
      templates[templates.length - 1]
    if (!template) return { ok: false, error: 'Template da Assinafy não encontrado' }

    const { editorFields, filled, missing, unmapped } = buildContractEditorFields(corbanData, extractTemplateFields(template))

    // Papéis de assinatura (exclui o preparador/editor).
    const allRoles: any[] = Array.isArray((template as any).roles) ? (template as any).roles : []
    const signingRoles = allRoles.filter((r: any) => !/preparador|editor|template/i.test(String(r?.name || '')))
    if (signingRoles.length === 0) return { ok: false, error: 'Template sem papéis de assinatura' }

    const fallbackEmail = String(input.fallbackEmail || corbanData?.contacts?.email_comissao || '').trim()
    const usedEmails = new Set<string>()
    const signers: Array<{ role_id: string; id: string; verification_method: 'Email'; notification_methods: ['Email']; step: number }> = []

    for (const role of signingRoles) {
      let email = resolveRoleEmail(String(role?.name || ''), corbanData, fallbackEmail)
      // Garante e-mail único por signatário (Assinafy exige) via alias.
      if (email && usedEmails.has(email.toLowerCase())) {
        const [local, domain] = email.split('@')
        if (local && domain) email = `${local}+${signers.length + 1}@${domain}`
      }
      if (email) usedEmails.add(email.toLowerCase())

      const signer = await client.findOrCreateSigner({
        full_name: `${String(role?.name || 'Signatário').slice(0, 40)}`,
        email: email || fallbackEmail,
      })
      signers.push({
        role_id: String(role.id),
        id: String((signer as any)?.id || ''),
        verification_method: 'Email',
        notification_methods: ['Email'],
        step: 1,
      })
    }

    const partnerName = String((partner as any).name || corbanData?.master?.name || 'Parceiro')
    const doc = await client.createDocumentFromTemplate(String((template as any).id), {
      signers,
      editor_fields: editorFields,
      name: `Contrato — ${partnerName}`,
    })

    const documentId = String((doc as any)?.id || '')
    const signingUrls = (doc as any)?.assignment?.signing_urls || []

    const cfg = await getAssinafyConfig()
    await recordAssinafyDocument({
      documentId,
      partnerId: input.partnerId,
      processInstanceId: input.processInstanceId || null,
      templateId: String((template as any).id || ''),
      templateName: String((template as any).name || ''),
      environment: cfg?.environment,
      status: String((doc as any)?.status || ''),
      signers,
      signingUrls,
    })

    return { ok: true, documentId, status: String((doc as any)?.status || ''), signingUrls, filled, missing, unmapped }
  } catch (error: any) {
    console.error('Erro ao gerar contrato do parceiro (lib):', error?.message)
    return { ok: false, error: error?.message }
  }
}
