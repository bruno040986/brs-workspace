/**
 * Leitura da configuração de etapa do Construtor de Processos (lógica pura).
 *
 * Descoberta do mapeamento real: as AÇÕES não moram em `stage.config` — moram
 * em `process.config.{documents,emails,whatsapp}[]`, cada item etiquetado com
 * `stage_key` (= id da etapa) e `trigger` ('on_enter' | 'on_exit' |
 * 'signature_link_ready' | 'manual'). A etapa só guarda `transitions` (nomes),
 * `is_terminal` e `sla_hours`.
 *
 * Este módulo traduz esse schema em "o que executar ao entrar na etapa X" e
 * "para qual etapa ir a seguir" — sem I/O, testável.
 */

export type StageConfig = {
  transitions?: string[]
  is_terminal?: boolean
  sla_hours?: number | null
}

export type StageModel = {
  id: string
  name: string
  position: number
  config?: StageConfig | null
}

export type ProcessConfigItem = {
  name?: string
  stage_key?: string
  stage_name?: string
  trigger?: string
  template_id?: string
  template_name?: string
  /** Referência ao template da Assinafy (decisão: etapa aponta pro template Assinafy). */
  assinafy_template_id?: string
  assinafy_template_name?: string
  placeholder_mapping?: Record<string, string>
  token_mapping?: Record<string, string>
  recipient_source?: string
  recipient_field?: string
  [key: string]: any
}

export type ProcessConfig = {
  documents?: ProcessConfigItem[]
  emails?: ProcessConfigItem[]
  whatsapp?: ProcessConfigItem[]
  process_fields?: ProcessConfigItem[]
  [key: string]: any
}

export type StageActions = {
  documents: ProcessConfigItem[]
  emails: ProcessConfigItem[]
  whatsapp: ProcessConfigItem[]
}

function normalizeTrigger(value: unknown): string {
  const t = String(value ?? '').trim()
  return t || 'on_enter'
}

/**
 * Seleciona os itens de ação (documentos/e-mails/whatsapp) de uma etapa para um
 * dado gatilho. Itens sem `trigger` contam como 'on_enter'.
 */
export function selectStageActions(
  processConfig: ProcessConfig | null | undefined,
  stageId: string,
  trigger = 'on_enter',
): StageActions {
  const cfg = processConfig || {}
  const wantedStage = String(stageId || '')
  const wantedTrigger = String(trigger || 'on_enter')

  const pick = (arr: ProcessConfigItem[] | undefined): ProcessConfigItem[] =>
    (Array.isArray(arr) ? arr : []).filter(
      (item) =>
        String(item?.stage_key || '') === wantedStage &&
        normalizeTrigger(item?.trigger) === wantedTrigger,
    )

  return {
    documents: pick(cfg.documents),
    emails: pick(cfg.emails),
    whatsapp: pick(cfg.whatsapp),
  }
}

/** Uma etapa tem ações de entrada para executar? */
export function hasEntryActions(actions: StageActions): boolean {
  return actions.documents.length + actions.emails.length + actions.whatsapp.length > 0
}

/**
 * Resolve a próxima etapa a partir da atual: usa `transitions` (por NOME) da
 * etapa; se vazio, cai para a próxima por `position`. Retorna null se terminal
 * ou sem destino.
 */
export function resolveNextStage(
  stages: StageModel[],
  currentStageId: string | null | undefined,
): StageModel | null {
  const list = [...(Array.isArray(stages) ? stages : [])].sort((a, b) => (a.position || 0) - (b.position || 0))
  if (list.length === 0) return null

  const currentIdx = list.findIndex((s) => String(s.id) === String(currentStageId))
  const current = currentIdx >= 0 ? list[currentIdx] : null

  if (current?.config?.is_terminal) return null

  const transitions = Array.isArray(current?.config?.transitions) ? current!.config!.transitions! : []
  if (transitions.length > 0) {
    const targetName = String(transitions[0] || '').trim().toLowerCase()
    const byName = list.find((s) => String(s.name || '').trim().toLowerCase() === targetName)
    if (byName) return byName
    // Nome de transição não encontrado → cai para a próxima por posição.
  }

  if (currentIdx >= 0) return list[currentIdx + 1] || null
  return list[0] // instância sem etapa → primeira
}
