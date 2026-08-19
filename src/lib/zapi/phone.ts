/**
 * Normalização de telefones brasileiros para o formato da Z-API:
 * DDI + DDD + número, só dígitos (ex.: 5511999998888).
 *
 * Isomórfico (sem imports de servidor) — usado no wizard (validação no cliente)
 * e no worker.
 */

export function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * Normaliza para 55 + DDD (2) + número (8 ou 9). Retorna null se inválido.
 *
 * Regras:
 * - remove máscara e "+";
 * - remove 0 à esquerda (operadora/discagem);
 * - 10 ou 11 dígitos → prefixa 55;
 * - 12 ou 13 dígitos começando com 55 → aceita;
 * - DDD entre 11 e 99; número não pode começar com 0.
 */
export function normalizeBrPhone(raw: unknown): string | null {
  let d = onlyDigits(raw)
  if (!d) return null
  // Remove zeros de discagem à esquerda (0xx, 00 55…)
  d = d.replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  if (!(d.length === 12 || d.length === 13)) return null
  if (!d.startsWith('55')) return null
  const ddd = Number(d.slice(2, 4))
  if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return null
  const local = d.slice(4)
  if (local.startsWith('0')) return null
  // Celular com 9 dígitos precisa começar com 9; fixo com 8 dígitos começa com 2-5.
  if (local.length === 9 && local[0] !== '9') return null
  return d
}

export function isValidBrPhone(raw: unknown): boolean {
  return normalizeBrPhone(raw) !== null
}

/** Formata 5511999998888 → +55 (11) 99999-8888 para exibição. */
export function formatBrPhone(normalized: string | null | undefined): string {
  const d = onlyDigits(normalized)
  if (!d) return ''
  const withoutDdi = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
  const ddd = withoutDdi.slice(0, 2)
  const local = withoutDdi.slice(2)
  if (local.length === 9) return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
  if (local.length === 8) return `+55 (${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`
  return `+${d}`
}

/** Mascara para exibição em listas (oculta o meio): +55 (11) 9••••-8888 */
export function maskBrPhoneForList(normalized: string | null | undefined): string {
  const pretty = formatBrPhone(normalized)
  return pretty.replace(/(\d)(\d{3,4})(-)/, (_m, a, mid, dash) => `${a}${'•'.repeat(mid.length)}${dash}`)
}
