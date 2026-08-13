'use server'

import { createClient } from '@supabase/supabase-js'
import { buildAgenteCorbanLegacyPersistenceRow } from '@/lib/agente-corban'
import { mapFormAnswersToSystemKeys, routeFormAnswersToCorbanData } from '@/lib/agente-corban-fields'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const ALLOWED_UPLOAD_MIME_TYPES: string[] = ['application/pdf', 'image/jpeg', 'image/png']

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// =========================================================================
// 1. Obter Formulário Ativo
// =========================================================================

export async function getActiveForm() {
  try {
    const { data, error } = await supabaseAdmin
      .from('partner_forms')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return { success: true, form: data }
  } catch (error: any) {
    console.error('Erro ao buscar formulário ativo:', error)
    return { success: false, error: error.message }
  }
}

export async function getFormBySlug(slug: string) {
  try {
    const normalized = String(slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!normalized) return { success: true, form: null }

    const { data, error } = await supabaseAdmin
      .from('partner_forms')
      .select('*')
      .eq('slug', normalized)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return { success: true, form: data }
  } catch (error: any) {
    console.error('Erro ao buscar formulário por slug:', error)
    return { success: false, error: error.message }
  }
}

// =========================================================================
// 1b. Obter Processo Público por Slug (o link público pertence ao processo)
// =========================================================================

export async function getPublicProcessBySlug(slug: string) {
  try {
    const normalized = String(slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!normalized) return { success: true, process: null, form: null }

    const { data: process, error: pErr } = await supabaseAdmin
      .from('process_models')
      .select('*')
      .eq('is_public', true)
      .eq('is_active', true)
      .eq('public_slug', normalized)
      .limit(1)
      .maybeSingle()

    if (pErr) throw pErr
    if (!process) return { success: true, process: null, form: null }

    let form: any = null
    if (process.form_id) {
      const { data: f, error: fErr } = await supabaseAdmin
        .from('partner_forms')
        .select('*')
        .eq('id', process.form_id)
        .limit(1)
        .maybeSingle()
      if (fErr) throw fErr
      form = f
    }

    return { success: true, process, form }
  } catch (error: any) {
    console.error('Erro ao buscar processo público por slug:', error)
    return { success: false, error: error.message, process: null, form: null }
  }
}

// =========================================================================
// 2. Fazer Upload de Arquivo
// =========================================================================

async function ensureBucketExists(bucketName: string) {
  try {
    const { data: bucket } = await supabaseAdmin.storage.getBucket(bucketName)

    if (!bucket) {
      const { error } = await supabaseAdmin.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: MAX_UPLOAD_BYTES,
        allowedMimeTypes: [...ALLOWED_UPLOAD_MIME_TYPES],
      })
      if (error) console.error('Erro ao criar bucket:', error)
      return
    }

    const shouldUpdate =
      bucket.public !== true ||
      bucket.file_size_limit !== MAX_UPLOAD_BYTES ||
      JSON.stringify(bucket.allowed_mime_types || []) !== JSON.stringify([...ALLOWED_UPLOAD_MIME_TYPES])

    if (shouldUpdate) {
      const { error } = await supabaseAdmin.storage.updateBucket(bucketName, {
        public: true,
        fileSizeLimit: MAX_UPLOAD_BYTES,
        allowedMimeTypes: [...ALLOWED_UPLOAD_MIME_TYPES],
      })
      if (error) console.error('Erro ao atualizar bucket:', error)
    }
  } catch (err) {
    console.error('Erro ao verificar/criar bucket:', err)
  }
}

export async function uploadPartnerFile(
  cpfCnpj: string,
  fileName: string,
  base64Data: string
) {
  try {
    const bucketName = 'partner-documents'

    const mimeType = getMimeType(fileName)
    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
      return { success: false, error: 'Formato inválido. Envie PDF, JPG ou PNG.' }
    }

    await ensureBucketExists(bucketName)

    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      return { success: false, error: 'Arquivo excede o tamanho máximo de 5MB.' }
    }

    const cleanedCpfCnpj = cpfCnpj.replace(/\D/g, '')
    const filePath = `${cleanedCpfCnpj}/${Date.now()}_${fileName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true
      })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(filePath)

    return { success: true, publicUrl }
  } catch (error: any) {
    console.error('Erro no upload do arquivo do parceiro:', error)
    return { success: false, error: error.message }
  }
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf': return 'application/pdf'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    default: return 'application/octet-stream'
  }
}

// =========================================================================
// 3. Enviar Registro de Parceiro
// =========================================================================

/**
 * Traduz as respostas do formulário para os caminhos canônicos de `corban_data`.
 *
 * As respostas chegam indexadas pela chave do campo (`field.key`); o vínculo com
 * a entidade está no `system_key` declarado no schema do formulário. Por isso a
 * tradução acontece aqui no servidor, que tem acesso ao schema pelo `form_id`.
 *
 * Aditivo por design: `additional_data` continua recebendo todas as respostas
 * cruas, então nenhum dado se perde enquanto a migração para o dicionário acontece.
 * Se o formulário não for encontrado, devolve `corban_data` intacto em vez de falhar —
 * um cadastro de parceiro nunca deve ser perdido por causa do roteamento.
 */
async function applyCanonicalFieldRouting(
  formId: string | undefined,
  answersByFieldKey: Record<string, any> | undefined,
  baseCorbanData: Record<string, any>,
): Promise<Record<string, any>> {
  const answers = answersByFieldKey || {}
  if (!formId || Object.keys(answers).length === 0) return baseCorbanData

  try {
    const { data: form, error } = await supabaseAdmin
      .from('partner_forms')
      .select('schema')
      .eq('id', formId)
      .maybeSingle()

    if (error || !form) {
      console.warn('Roteamento canônico ignorado: formulário não encontrado.', formId)
      return baseCorbanData
    }

    const schema = Array.isArray((form as any).schema) ? (form as any).schema : []
    const answersBySystemKey = mapFormAnswersToSystemKeys(schema, answers)

    if (Object.keys(answersBySystemKey).length === 0) return baseCorbanData

    const routed = routeFormAnswersToCorbanData(answersBySystemKey, baseCorbanData)

    if (routed.unmappedKeys.length > 0) {
      console.warn(
        'system_keys sem correspondência no dicionário canônico:',
        routed.unmappedKeys.join(', '),
      )
    }

    return routed.corbanData
  } catch (err: any) {
    console.error('Falha no roteamento canônico de campos:', err?.message)
    return baseCorbanData
  }
}

export async function submitPartnerRegistration(payload: {
  process_slug?: string
  form_id: string
  person_type: 'PF' | 'PJ'
  cpf_cnpj: string
  name: string
  fantasy_name?: string
  representante_legal?: string
  rg?: string
  rg_expedition_date?: string
  rg_issuer?: string
  rg_state?: string
  birth_date?: string
  gender?: string
  
  // Endereço
  cep?: string
  address_street?: string
  address_number?: string
  address_complement?: string
  address_neighborhood?: string
  address_city?: string
  address_state?: string
  
  // Contatos
  phone_whatsapp: string
  phone_whatsapp_financeiro?: string
  phone_commercial?: string
  phone_residential?: string
  phone_support?: string
  email_comissao: string
  email_informe?: string
  email_formalizacao?: string
  email_proposta?: string
  email_mesa_liberacao?: string
  email_juridico?: string
  email_proprio_cunho?: string
  
  // Dados Bancários
  commission_receive_type?: string
  bank_code?: string
  bank_name?: string
  bank_agency?: string
  bank_account?: string
  bank_account_type?: string
  pix_type?: string
  pix_key?: string
  
  // Respostas Dinâmicas Extras
  additional_data?: any
}) {
  try {
    const now = new Date().toISOString()

    const processSlugRaw = String(payload.process_slug || '').trim()
    const normalizedProcessSlug = processSlugRaw
      ? processSlugRaw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      : ''

    const cpfCnpjClean = String(payload.cpf_cnpj || '').trim()
    const partnerInsertBase = buildAgenteCorbanLegacyPersistenceRow(
      {
        form_id: payload.form_id,
        person_type: payload.person_type,
        cpf_cnpj: cpfCnpjClean,
        name: payload.name,
        fantasy_name: payload.fantasy_name,
        representante_legal: payload.representante_legal,
        rg: payload.rg,
        rg_expedition_date: payload.rg_expedition_date,
        rg_issuer: payload.rg_issuer,
        rg_state: payload.rg_state,
        birth_date: payload.birth_date,
        gender: payload.gender,
        cep: payload.cep,
        address_street: payload.address_street,
        address_number: payload.address_number,
        address_complement: payload.address_complement,
        address_neighborhood: payload.address_neighborhood,
        address_city: payload.address_city,
        address_state: payload.address_state,
        phone_whatsapp: payload.phone_whatsapp,
        phone_whatsapp_financeiro: payload.phone_whatsapp_financeiro,
        phone_commercial: payload.phone_commercial,
        phone_residential: payload.phone_residential,
        phone_support: payload.phone_support,
        email_comissao: payload.email_comissao,
        email_informe: payload.email_informe,
        email_formalizacao: payload.email_formalizacao,
        email_proposta: payload.email_proposta,
        email_mesa_liberacao: payload.email_mesa_liberacao,
        email_juridico: payload.email_juridico,
        email_proprio_cunho: payload.email_proprio_cunho,
        commission_receive_type: payload.commission_receive_type,
        bank_code: payload.bank_code,
        bank_name: payload.bank_name,
        bank_agency: payload.bank_agency,
        bank_account: payload.bank_account,
        bank_account_type: payload.bank_account_type,
        pix_type: payload.pix_type,
        pix_key: payload.pix_key,
        additional_data: payload.additional_data ?? {},
      },
    )

    const partnerInsert: Record<string, any> = {
      ...partnerInsertBase,
      created_at: now,
      updated_at: now,
      status: 'novo',
    }

    partnerInsert.corban_data = await applyCanonicalFieldRouting(
      payload.form_id,
      payload.additional_data,
      (partnerInsertBase as any).corban_data || {},
    )

    let partner: any = null

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('agentes_parceiros')
      .insert(partnerInsert)
      .select()
      .maybeSingle()

    if (insertErr) {
      // cpf_cnpj é UNIQUE; se já existir, reutiliza o parceiro e atualiza dados "não vazios".
      if ((insertErr as any)?.code === '23505') {
        const { data: existing, error: eErr } = await supabaseAdmin
          .from('agentes_parceiros')
          .select('*')
          .eq('cpf_cnpj', cpfCnpjClean)
          .limit(1)
          .maybeSingle()
        if (eErr) throw eErr
        if (!existing) throw insertErr

        const updateData: Record<string, any> = { updated_at: now }
        for (const [k, v] of Object.entries(partnerInsert)) {
          if (k === 'created_at' || k === 'status') continue
          if (v === undefined || v === null) continue
          if (typeof v === 'string' && v.trim() === '') continue
          updateData[k] = v
        }

        // Merge de additional_data (não apaga chaves existentes quando o payload vier parcial)
        const nextAdditional = { ...(existing as any).additional_data, ...(payload.additional_data || {}) }
        updateData.additional_data = nextAdditional

        try {
          const mergedLegacy = buildAgenteCorbanLegacyPersistenceRow(
            {
              form_id: payload.form_id,
              person_type: payload.person_type,
              cpf_cnpj: cpfCnpjClean,
              name: payload.name,
              fantasy_name: payload.fantasy_name,
              representante_legal: payload.representante_legal,
              rg: payload.rg,
              rg_expedition_date: payload.rg_expedition_date,
              rg_issuer: payload.rg_issuer,
              rg_state: payload.rg_state,
              birth_date: payload.birth_date,
              gender: payload.gender,
              cep: payload.cep,
              address_street: payload.address_street,
              address_number: payload.address_number,
              address_complement: payload.address_complement,
              address_neighborhood: payload.address_neighborhood,
              address_city: payload.address_city,
              address_state: payload.address_state,
              phone_whatsapp: payload.phone_whatsapp,
              phone_whatsapp_financeiro: payload.phone_whatsapp_financeiro,
              phone_commercial: payload.phone_commercial,
              phone_residential: payload.phone_residential,
              phone_support: payload.phone_support,
              email_comissao: payload.email_comissao,
              email_informe: payload.email_informe,
              email_formalizacao: payload.email_formalizacao,
              email_proposta: payload.email_proposta,
              email_mesa_liberacao: payload.email_mesa_liberacao,
              email_juridico: payload.email_juridico,
              email_proprio_cunho: payload.email_proprio_cunho,
              commission_receive_type: payload.commission_receive_type,
              bank_code: payload.bank_code,
              bank_name: payload.bank_name,
              bank_agency: payload.bank_agency,
              bank_account: payload.bank_account,
              bank_account_type: payload.bank_account_type,
              pix_type: payload.pix_type,
              pix_key: payload.pix_key,
              additional_data: nextAdditional,
            },
            (existing as any).corban_data || {},
          )
          updateData.corban_data = mergedLegacy.corban_data
        } catch {
          updateData.corban_data = (partnerInsertBase as any).corban_data || {}
        }

        // Reenvio: as respostas canônicas são aplicadas sobre o corban_data já existente,
        // preservando o que o backoffice preencheu e o que veio do ARW.
        updateData.corban_data = await applyCanonicalFieldRouting(
          payload.form_id,
          payload.additional_data,
          updateData.corban_data || {},
        )

        const { data: updated, error: uErr } = await supabaseAdmin
          .from('agentes_parceiros')
          .update(updateData)
          .eq('id', (existing as any).id)
          .select()
          .maybeSingle()
        if (uErr) throw uErr
        partner = updated || existing
      } else {
        throw insertErr
      }
    } else {
      partner = inserted
    }

    // Se a origem é um processo público, cria uma instância (card) para este parceiro e salva snapshot.
    if (normalizedProcessSlug) {
      const { data: process, error: pErr } = await supabaseAdmin
        .from('process_models')
        .select('*')
        .eq('is_public', true)
        .eq('is_active', true)
        .eq('public_slug', normalizedProcessSlug)
        .limit(1)
        .maybeSingle()

      if (pErr) throw pErr

      if (process?.id) {
        const entry = process.entry_config || {}
        const dedupeEnabled = entry?.dedupe?.enabled !== false
        const identifierKey = String(entry?.identifier_field_key || '').trim()
        const identifierMask = String(entry?.identifier_mask || '').trim()
        const identifierRaw = identifierKey ? (payload.additional_data?.[identifierKey] ?? '') : (payload.cpf_cnpj ?? '')

        let identifierValue = String(identifierRaw ?? '').trim()
        if (identifierMask === 'cnpj' || identifierMask === 'cpf' || identifierMask === 'cep') {
          identifierValue = identifierValue.replace(/\\D/g, '')
        } else if (identifierMask === 'email') {
          identifierValue = identifierValue.toLowerCase()
        }

        if (!identifierValue) identifierValue = String(payload.cpf_cnpj || '').replace(/\\D/g, '')

        if (dedupeEnabled && identifierValue) {
          const { data: existingInst } = await supabaseAdmin
            .from('process_instances')
            .select('id')
            .eq('process_id', process.id)
            .eq('identifier_value', identifierValue)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle()
          if (existingInst?.id) {
            return {
              success: false,
              error:
                entry?.dedupe?.message ||
                'Já existe um processo ativo com este identificador. Finalize ou arquive o card antes de enviar novamente.',
            }
          }
        }

        const { data: st, error: sErr } = await supabaseAdmin
          .from('process_stage_models')
          .select('id')
          .eq('process_id', process.id)
          .order('position', { ascending: true })
          .limit(1)
        if (sErr) throw sErr
        const initialStageId = (st as any[])?.[0]?.id || null

        const { data: inst, error: iErr } = await supabaseAdmin
          .from('process_instances')
          .insert({
            process_id: process.id,
            partner_id: partner?.id || null,
            identifier_value: identifierValue,
            status: 'active',
            current_stage_id: initialStageId,
            created_at: now,
            updated_at: now,
          })
          .select('id')
          .maybeSingle()

        if (iErr) {
          if ((iErr as any)?.code === '23505') {
            return {
              success: false,
              error:
                entry?.dedupe?.message ||
                'Já existe um processo ativo com este identificador. Finalize ou arquive o card antes de enviar novamente.',
            }
          }
          throw iErr
        }

        if (inst?.id) {
          const snapshotPayload: any = { ...(payload as any) }
          delete snapshotPayload.process_slug
          const { error: snapErr } = await supabaseAdmin
            .from('process_instance_form_snapshots')
            .insert({
              instance_id: inst.id,
              form_id: payload.form_id,
              payload: snapshotPayload,
            })
          if (snapErr) throw snapErr

          // Motor: entrar na etapa inicial dispara as ações de entrada dela.
          if (initialStageId) {
            try {
              const { enqueueJob, buildDedupeKey } = await import('@/lib/scp-engine')
              await enqueueJob({
                kind: 'enter_stage',
                instanceId: inst.id,
                dedupeKey: buildDedupeKey('enter', inst.id, initialStageId),
                payload: { stage_id: initialStageId },
              })
            } catch (engineErr: any) {
              console.warn('Não foi possível enfileirar enter_stage inicial:', engineErr?.message)
            }
          }
        }
      }
    }

    return { success: true, partner }
  } catch (error: any) {
    console.error('Erro ao salvar cadastro do parceiro:', error)
    return { success: false, error: error.message }
  }
}
