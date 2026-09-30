/**
 * Regras puras do vínculo IF ↔ promotora na config fiscal (sem dependências
 * de runtime — testável com node --test). Imports só de tipo.
 */
import type { FiscalPagador, FiscalVinculoTipo, PromotoraFiscalConfiguration } from './promotoras.ts'
import type { InstituicaoFinancialConfiguration } from './financial-institutions.ts'

/** 'YYYY-MM-DD' de hoje em America/Sao_Paulo — usado pra vigência (ativa/inativa) das configs fiscais. */
export function todaySaoPauloISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Vigente = já começou e ainda não terminou, na data de referência (padrão: hoje em SP). */
export function isFiscalConfigVigente(
  config: { effective_from: string; effective_to: string | null },
  todayISO: string = todaySaoPauloISO(),
): boolean {
  if (config.effective_from && config.effective_from > todayISO) return false
  if (config.effective_to && config.effective_to < todayISO) return false
  return true
}

/** Vigência aberta (effective_to vazio) conta como indo até o infinito. */
export function fiscalVigenciasOverlap(
  a: { effective_from: string; effective_to: string | null },
  b: { effective_from: string; effective_to: string | null },
): boolean {
  const aFrom = a.effective_from || '0000-01-01'
  const aTo = a.effective_to || '9999-12-31'
  const bFrom = b.effective_from || '0000-01-01'
  const bTo = b.effective_to || '9999-12-31'
  return aFrom <= bTo && bFrom <= aTo
}

/** Pares de configs com a MESMA chave (groupKeyFn) cuja vigência se sobrepõe. */
export function findFiscalOverlaps<T extends { effective_from: string; effective_to: string | null }>(
  configs: T[],
  groupKeyFn: (config: T) => string,
): Array<{ a: T; b: T }> {
  const overlaps: Array<{ a: T; b: T }> = []
  for (let i = 0; i < configs.length; i++) {
    for (let j = i + 1; j < configs.length; j++) {
      if (groupKeyFn(configs[i]) !== groupKeyFn(configs[j])) continue
      if (fiscalVigenciasOverlap(configs[i], configs[j])) overlaps.push({ a: configs[i], b: configs[j] })
    }
  }
  return overlaps
}

export type LegacyVinculo = {
  vinculo_tipo: FiscalVinculoTipo
  promotora_id: string
  promotora_name: string
  promotora_logo_url: string
}

export type FiscalVinculoDerivado = {
  vinculo_tipo: Exclude<FiscalVinculoTipo, ''>
  promotora_id: string
  promotora_name: string
  promotora_logo_url: string
  pagador: FiscalPagador | undefined
}

/**
 * Vínculo/promotora/pagador efetivos de uma config fiscal de IF.
 * Sem vinculo_tipo (dado antigo): herda da config financeira antiga de mesmo
 * tipo de remuneração; senão 'direto'. Direto => pagador 'if' e sem promotora;
 * sub_zero => pagador 'promotora'; grade/indicado => pagador explícito (só
 * assume 'if' na migração de dado antigo — config nova sem escolha fica
 * indefinida e a validação do servidor exige a escolha).
 */
export function deriveFiscalVinculo(
  fiscal: Pick<PromotoraFiscalConfiguration, 'remuneration_type_id' | 'vinculo_tipo' | 'promotora_id' | 'promotora_name' | 'promotora_logo_url' | 'pagador'>,
  legacyByRemunerationType: Map<string, LegacyVinculo>,
): FiscalVinculoDerivado {
  const explicito = !!fiscal.vinculo_tipo
  let vinculo: FiscalVinculoTipo = fiscal.vinculo_tipo || ''
  let promotora = {
    id: fiscal.promotora_id || '',
    name: fiscal.promotora_name || '',
    logo: fiscal.promotora_logo_url || '',
  }
  if (!vinculo) {
    const legacy = legacyByRemunerationType.get(fiscal.remuneration_type_id)
    if (legacy?.vinculo_tipo) {
      vinculo = legacy.vinculo_tipo
      promotora = { id: legacy.promotora_id, name: legacy.promotora_name, logo: legacy.promotora_logo_url }
    } else {
      vinculo = 'direto'
    }
  }
  if (vinculo === 'direto') {
    return { vinculo_tipo: 'direto', promotora_id: '', promotora_name: '', promotora_logo_url: '', pagador: 'if' }
  }
  const pagador: FiscalPagador | undefined =
    vinculo === 'sub_zero' ? 'promotora' : fiscal.pagador || (explicito ? undefined : 'if')
  return {
    vinculo_tipo: vinculo as Exclude<FiscalVinculoTipo, ''>,
    promotora_id: promotora.id,
    promotora_name: promotora.name,
    promotora_logo_url: promotora.logo,
    pagador,
  }
}

/** Config financeira sem referência à fiscal é associada à fiscal de mesmo tipo de remuneração. */
export function resolveFiscalConfigId(
  financial: { fiscal_config_id?: string; remuneration_type_id: string },
  fiscalConfigs: Array<{ id: string; remuneration_type_id: string }>,
): string {
  if (financial.fiscal_config_id) return financial.fiscal_config_id
  return fiscalConfigs.find((f) => f.remuneration_type_id === financial.remuneration_type_id)?.id || ''
}

/** Pagador = promotora: some conta, forma de recebimento, valor mínimo e tarifa (mantém prazo de repasse e frequência). */
export function sanitizeFinancialConfigForPagador(
  config: InstituicaoFinancialConfiguration,
  pagador: FiscalPagador | undefined,
): InstituicaoFinancialConfiguration {
  if (pagador !== 'promotora') return config
  return {
    ...config,
    conta_bancaria_index: '',
    forma_recebimento_id: '',
    direct: {
      ...config.direct,
      valor_minimo_enabled: false,
      valor_minimo_pagto: '',
      tarifa_enabled: false,
      tarifa_tipo: 'R$',
      tarifa_valor_real: '',
      tarifa_valor_percentual: '',
    },
    indirect: {
      ...config.indirect,
      valor_minimo_saque: '',
      tarifa_tipo: 'R$',
      tarifa_valor_real: '',
      tarifa_valor_percentual: '',
    },
  }
}

export function pagadorLabel(pagador: FiscalPagador | undefined) {
  return pagador === 'promotora' ? 'Promotora' : pagador === 'if' ? 'Instituição financeira' : ''
}

/** Rótulo da config fiscal no financeiro: "Comissão à Vista — Direto" / "Bônus — TN Promotora (paga a promotora)". */
export function fiscalConfigOptionLabel(
  c: Pick<PromotoraFiscalConfiguration, 'remuneration_type_name' | 'vinculo_tipo' | 'promotora_name' | 'pagador'>,
): string {
  const rem = c.remuneration_type_name || 'Sem tipo de remuneração'
  if (!c.vinculo_tipo || c.vinculo_tipo === 'direto') return `${rem} — Direto`
  const promotora = c.promotora_name || 'Promotora não selecionada'
  const sufixo = c.pagador === 'promotora' ? ' (paga a promotora)' : c.pagador === 'if' ? ' (paga a IF)' : ''
  return `${rem} — ${promotora}${sufixo}`
}

/** Payload cru do cliente: vínculo e tipo de remuneração precisam vir explícitos (herança só vale na leitura do banco). */
export function validarFiscalCru(configs: Array<{ vinculo_tipo?: string; remuneration_type_id?: string }> | null | undefined): string[] {
  const erros: string[] = []
  ;(configs || []).forEach((c, i) => {
    if (!c?.vinculo_tipo) erros.push(`Informe o Tipo de Vínculo na Configuração Tributária ${i + 1}.`)
    if (!c?.remuneration_type_id) erros.push(`Informe o Tipo de Remuneração na Configuração Tributária ${i + 1}.`)
  })
  return erros
}

/** Sanitiza (forma curta) só quando o pagador 'promotora' veio explícito; dado antigo migrado em memória não perde o fiscal. */
export function pagadorExplicitoPromotora(raw: { pagador?: string } | null | undefined): boolean {
  return raw?.pagador === 'promotora'
}

/** Erros de validação do fiscal da IF (vínculo, promotora, pagador e sobreposição de vigência). */
export function validateFiscalVinculos(configs: PromotoraFiscalConfiguration[]): string[] {
  const erros: string[] = []
  configs.forEach((c, i) => {
    const n = i + 1
    if (!c.vinculo_tipo) erros.push(`Informe o Tipo de Vínculo na Configuração Tributária ${n}.`)
    else if (c.vinculo_tipo !== 'direto' && !c.promotora_id) erros.push(`Selecione a Promotora na Configuração Tributária ${n}.`)
    if ((c.vinculo_tipo === 'sub_grade' || c.vinculo_tipo === 'sub_indicado') && !c.pagador) {
      erros.push(`Informe quem paga a remuneração na Configuração Tributária ${n}.`)
    }
  })
  findFiscalOverlaps(configs, (c) => `${c.remuneration_type_id}::${c.promotora_id || ''}`).forEach(({ a, b }) => {
    erros.push(
      `Vigências sobrepostas para "${a.remuneration_type_name || 'remuneração'}"${a.promotora_name ? ` / ${a.promotora_name}` : ''}: ` +
        `${a.effective_from || 'sem início'}–${a.effective_to || 'aberta'} e ${b.effective_from || 'sem início'}–${b.effective_to || 'aberta'}.`,
    )
  })
  return erros
}

export type FonteImposto =
  | { tipo: 'nenhuma'; config: null }
  | { tipo: 'if'; config: PromotoraFiscalConfiguration }
  | { tipo: 'promotora'; config: PromotoraFiscalConfiguration | null }

/**
 * Qual config alimenta imposto_comissao_percent da IF: a marcada "usar para
 * comissão" da IF (pagador 'if') ou, se paga pela promotora, a marcada E
 * vigente da promotora (null = pendência, grava NULL).
 */
export function escolherFonteImposto(
  ifConfigs: PromotoraFiscalConfiguration[] | null | undefined,
  promotoraConfigs: (promotoraId: string) => PromotoraFiscalConfiguration[] | null | undefined,
  todayISO: string = todaySaoPauloISO(),
): FonteImposto {
  const marcadas = (ifConfigs || []).filter((c) => c.usar_para_comissao === true)
  const marcada = marcadas.find((c) => isFiscalConfigVigente(c, todayISO)) || marcadas[0]
  if (!marcada) return { tipo: 'nenhuma', config: null }
  if (marcada.pagador !== 'promotora') return { tipo: 'if', config: marcada }
  const daPromotora = (promotoraConfigs(marcada.promotora_id || '') || []).find(
    (c) => c.usar_para_comissao === true && isFiscalConfigVigente(c, todayISO),
  )
  return { tipo: 'promotora', config: daPromotora || null }
}

