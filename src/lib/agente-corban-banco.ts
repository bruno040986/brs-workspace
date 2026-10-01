/**
 * Valor do item da Chave PIX. O item nasce como {pix_type,pix_key,respostas}, mas a
 * correção do parceiro (RPC) grava texto puro, e o spread desse texto já gerou
 * objetos {"0":"6","1":"6",...} — ambos os casos são lidos aqui.
 */
export function lerValorChavePix(valor: unknown): { pix_type?: unknown; pix_key: string; respostas?: unknown } {
  if (typeof valor === 'string') return { pix_key: valor }
  if (!valor || typeof valor !== 'object') return { pix_key: '' }
  const { pix_type, pix_key, respostas, ...resto } = valor as Record<string, unknown>
  const chaveSpread = Object.keys(resto)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => String(resto[k]))
    .join('')
  return { pix_type, pix_key: typeof pix_key === 'string' && pix_key ? pix_key : chaveSpread, respostas }
}

/**
 * Dados bancários vigentes: a correção do parceiro chega primeiro nos itens de
 * validação, então eles têm precedência sobre `corban_data.bank` (que pode ter
 * sido regravado com valores antigos).
 */
export function bancoVigente(
  bank: Record<string, any>,
  itens: Array<{ etapa: string; chave: string; valor: unknown }>,
): Record<string, any> {
  const vigente = { ...bank }
  for (const chave of ['bank_code', 'bank_name', 'bank_agency', 'bank_account']) {
    const v = itens.find((i) => i.etapa === 'validacao' && i.chave === `bank.${chave}`)?.valor
    if (typeof v === 'string' && v.trim()) vigente[chave] = v
  }
  const pix = itens.find((i) => i.etapa === 'validacao' && i.chave === 'bank.pix_key')
  if (pix) {
    const { pix_type, pix_key } = lerValorChavePix(pix.valor)
    if (pix_key) {
      // sem pix_type no item, o tipo antigo só vale se a chave não mudou
      vigente.pix_type = typeof pix_type === 'string' && pix_type ? pix_type : pix_key === bank.pix_key ? bank.pix_type : ''
      vigente.pix_key = pix_key
    }
  }
  return vigente
}
