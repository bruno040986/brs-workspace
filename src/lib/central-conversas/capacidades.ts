/**
 * Mapa central de capacidades por provedor (ADR-7, docs/YCLOUD-F0-CONTRATOS).
 * Puro (sem imports de servidor). A UI esconde a ação que o provedor não suporta.
 * baileys/zapi refletem o comportamento anterior à YCloud.
 */
export type ProvedorChat = 'baileys' | 'zapi' | 'ycloud'

export interface CapacidadesProvedor {
  enviaTexto: boolean
  enviaMidia: boolean
  reacoes: boolean
  respostaCitada: boolean
  mencoes: boolean
  marcaLido: boolean
  digitando: boolean
  grupos: boolean
  /** Inicia conversa fora de resposta (ycloud: só via template). */
  novaConversa: boolean
  templates: boolean
  janela24h: boolean
  custoPorMensagem: boolean
}

// baileys/zapi: a UI anterior mostrava tudo para ambos (o engine recusa o que o
// provedor não faz, ex.: grupos só Baileys), então o mapa preserva isso.
const LEGADO = { enviaTexto: true, enviaMidia: true, reacoes: true, respostaCitada: true, mencoes: true, marcaLido: true, digitando: true, novaConversa: true, templates: false, janela24h: false, custoPorMensagem: false }

export const CAPACIDADES: Record<ProvedorChat, CapacidadesProvedor> = {
  baileys: { ...LEGADO, grupos: true },
  zapi: { ...LEGADO, grupos: false },
  ycloud: { enviaTexto: true, enviaMidia: true, reacoes: false, respostaCitada: true, mencoes: false, marcaLido: true, digitando: true, grupos: false, novaConversa: true, templates: true, janela24h: true, custoPorMensagem: true },
}

export const capacidadesDe = (p: string | null | undefined): CapacidadesProvedor => CAPACIDADES[(p as ProvedorChat) in CAPACIDADES ? (p as ProvedorChat) : 'baileys']

export const ROTULO_PROVEDOR: Record<ProvedorChat, string> = { baileys: 'Baileys', zapi: 'Z-API', ycloud: 'WhatsApp Oficial' }
