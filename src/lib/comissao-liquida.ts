/**
 * Imposto para o cálculo da COMISSÃO LÍQUIDA (Comissionamento/ARW).
 *
 * Fonte: a configuração tributária da Instituição Financeira marcada com
 * `usar_para_comissao` (flag exclusiva). Regra do Bruno (23/08/2026):
 * - ISS (seção 1) entra sempre que habilitado — não tem creditamento;
 * - Retenções da seção 4 entram sempre que habilitadas (valor do override
 *   quando customizado, senão o da figura) — retidos por exigência fiscal/IF;
 * - Impostos com creditamento (PIS/COFINS da seção 2, CBS/IBS da seção 3)
 *   NUNCA entram — no Lucro Real os créditos cobrem o débito;
 * - Ajuste adicional opcional (arredondamento/custo % não-tributário).
 *
 * O total é gravado como cache em financial_institutions.imposto_comissao_percent
 * a cada salvamento da instituição — consumidores (prévia do Prazo Comissão,
 * fechamentos futuros) leem só a coluna.
 */

import { percentSequenceToNumber } from '@/lib/tax-regimes'
import type { PromotoraFiscalConfiguration } from '@/lib/promotoras'

const RETENCAO_KEYS = ['irpj', 'csll', 'pis', 'cofins', 'ibs', 'cbs'] as const
const RETENCAO_LABELS: Record<(typeof RETENCAO_KEYS)[number], string> = {
  irpj: 'IRPJ retido',
  csll: 'CSLL retido',
  pis: 'PIS retido',
  cofins: 'COFINS retido',
  ibs: 'IBS retido',
  cbs: 'CBS retido',
}

export type ImpostoComissaoItem = { label: string; percent: number }

export type ImpostoComissaoResultado = {
  itens: ImpostoComissaoItem[]
  ajustePercent: number
  totalPercent: number
}

export function calcularImpostoComissao(config: PromotoraFiscalConfiguration): ImpostoComissaoResultado {
  const itens: ImpostoComissaoItem[] = []
  const snapshotConfig = (config.figure_snapshot as any)?.config || {}

  const iss = snapshotConfig?.section_1?.iss
  if (iss?.enabled) {
    itens.push({ label: 'ISS', percent: percentSequenceToNumber(String(iss.value || '')) })
  }

  const section4 = snapshotConfig?.section_4 || {}
  for (const key of RETENCAO_KEYS) {
    const campo = section4?.[key]
    if (!campo?.enabled) continue
    const override = config.retention_overrides?.[key]
    const valor = override?.custom ? String(override.value || '') : String(campo.value || '')
    itens.push({ label: RETENCAO_LABELS[key], percent: percentSequenceToNumber(valor) })
  }

  const ajustePercent = percentSequenceToNumber(String(config.comissao_ajuste_adicional || ''))
  const soma = itens.reduce((total, item) => total + item.percent, 0) + ajustePercent

  return {
    itens,
    ajustePercent,
    totalPercent: Math.round(soma * 1000) / 1000,
  }
}

export function encontrarConfigComissao(
  configurations: PromotoraFiscalConfiguration[] | null | undefined,
): PromotoraFiscalConfiguration | null {
  return (configurations || []).find((config) => config.usar_para_comissao === true) || null
}

/** Total (%) a gravar no cache imposto_comissao_percent; null = não configurado. */
export function impostoComissaoDaInstituicao(
  configurations: PromotoraFiscalConfiguration[] | null | undefined,
): number | null {
  const config = encontrarConfigComissao(configurations)
  if (!config) return null
  return calcularImpostoComissao(config).totalPercent
}
