/**
 * Números de WhatsApp digitados/colados (W3, lote 2): separa por vírgula, ponto e vírgula, espaço
 * ou quebra de linha; guarda só dígitos; exige ao menos 8 dígitos; sem duplicados.
 * Tradução do status por membro devolvido pelo engine ao adicionar participantes.
 */

/** Vírgula, ponto e vírgula e quebra de linha sempre separam; espaço só separa depois de 10+ dígitos (senão é formatação: "61 99999-1234"). */
function pedacos(texto: string): string[] {
  const saida: string[] = []
  let atual = ''
  const digitos = (t: string) => t.replace(/\D/g, '').length
  for (const c of String(texto || '')) {
    if (c === ',' || c === ';' || c === '\n' || c === '\r' || (c === ' ' && digitos(atual) >= 10)) {
      if (atual.trim()) saida.push(atual.trim())
      atual = ''
    } else atual += c
  }
  if (atual.trim()) saida.push(atual.trim())
  return saida
}

export function separarNumeros(texto: string): { validos: string[]; invalidos: string[] } {
  const validos: string[] = []
  const invalidos: string[] = []
  for (const bruto of pedacos(texto)) {
    const digitos = bruto.replace(/\D/g, '')
    if (digitos.length >= 8 && digitos.length <= 15) {
      if (!validos.includes(digitos)) validos.push(digitos)
    } else invalidos.push(bruto)
  }
  return { validos, invalidos }
}

/** O último caractere digitado é separador? (vírgula, ponto e vírgula, Enter, ou espaço depois de 10+ dígitos) — então o que veio antes vira badge. */
export function terminouNumero(texto: string): boolean {
  const t = String(texto || '')
  const ult = t.slice(-1)
  return ult === ',' || ult === ';' || ult === '\n' || (ult === ' ' && t.replace(/\D/g, '').length >= 10)
}

const MOTIVO_STATUS: Record<string, string> = {
  '403': 'não pôde ser adicionado (a privacidade do contato exige convite)',
  '408': 'saiu do grupo há pouco tempo',
  '409': 'já está no grupo',
  '404': 'número sem WhatsApp',
  '401': 'sem permissão para adicionar',
}

/** Só as linhas que NÃO deram certo (status diferente de 200), em texto para o atendente. */
export function falhasDeParticipantes(resultado: Array<{ jid: string; status: string }>): string[] {
  return resultado
    .filter((r) => r.status !== '200')
    .map((r) => `+${String(r.jid).replace(/@.*$/, '')}: ${MOTIVO_STATUS[r.status] || `recusado pelo WhatsApp (código ${r.status})`}`)
}
