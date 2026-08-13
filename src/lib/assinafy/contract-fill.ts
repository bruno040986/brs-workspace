/**
 * Preenchimento de contrato a partir de dados reais do Agente Corban.
 *
 * Recebe o `corban_data` de um parceiro + os campos de um template da Assinafy,
 * e produz os `editor_fields` (field_id → valor), lendo cada valor pelo caminho
 * canônico do dicionário. É a ponte final: entidade → contrato preenchido.
 *
 * A Assinafy exige valor para TODOS os campos do editor, então campos mapeados
 * sem dado real recebem um placeholder (e são reportados como "faltando"), e
 * campos não reconhecidos recebem placeholder (reportados como "não mapeados").
 */

import { getFieldByKey, getValueAtPath } from '../agente-corban-fields'
import { canonicalKeyForAssinafyField } from './contract-mapping'

export type TemplateFieldLike = {
  id?: string
  field_id?: string
  label?: string
  name?: string
  type?: string
}

export type BuildEditorFieldsResult = {
  editorFields: Array<{ field_id: string; value: string }>
  /** Campos preenchidos com dado real da entidade. */
  filled: Array<{ name: string; canonicalKey: string; value: string }>
  /** Campos mapeados, mas sem dado real no corban_data (foram ao placeholder). */
  missing: Array<{ name: string; canonicalKey: string }>
  /** Campos do template que não batem com o mapa do contrato. */
  unmapped: string[]
}

/**
 * Monta os editor_fields a partir do corban_data e dos campos do template.
 * `emptyPlaceholder` é usado quando não há valor real (mantém o campo não-vazio,
 * exigência da Assinafy).
 */
export function buildContractEditorFields(
  corbanData: Record<string, any> | null | undefined,
  templateFields: TemplateFieldLike[],
  emptyPlaceholder = '—',
): BuildEditorFieldsResult {
  const seen = new Set<string>()
  const editorFields: Array<{ field_id: string; value: string }> = []
  const filled: Array<{ name: string; canonicalKey: string; value: string }> = []
  const missing: Array<{ name: string; canonicalKey: string }> = []
  const unmapped: string[] = []

  for (const field of Array.isArray(templateFields) ? templateFields : []) {
    const name = String(field?.label || field?.name || '')
    const fieldId = String(field?.field_id || field?.id || '')
    if (!fieldId || seen.has(fieldId)) continue
    seen.add(fieldId)

    const key = canonicalKeyForAssinafyField(name)
    if (!key) {
      if (name) unmapped.push(name)
      editorFields.push({ field_id: fieldId, value: emptyPlaceholder })
      continue
    }

    const def = getFieldByKey(key)
    const rawValue = def ? getValueAtPath(corbanData, def.path) : undefined
    const value = rawValue === null || rawValue === undefined ? '' : String(rawValue)

    if (value.trim()) {
      editorFields.push({ field_id: fieldId, value })
      filled.push({ name, canonicalKey: key, value })
    } else {
      editorFields.push({ field_id: fieldId, value: emptyPlaceholder })
      missing.push({ name, canonicalKey: key })
    }
  }

  return { editorFields, filled, missing, unmapped }
}
