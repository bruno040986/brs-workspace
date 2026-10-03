/** Funções puras de segurança da promoção (testadas em __tests__/seguranca.test.ts). */
import { telefoneParaE164Digitos } from './validacao.ts'

/** Cópia mascarada do texto para promocao_envios (o texto REAL segue para o engine). */
export function mascararTextoEnvio(tipo: string, texto: string): string {
  if (tipo === 'otp') return '[otp]'
  if (tipo.startsWith('link_numeros')) return texto.replace(/([?&]t=)[^\s&]+/g, '$1[token]')
  if (tipo === 'aviso_pagamento') return texto.replace(/(Chave Pix:).*/gi, '$1 [pix]')
  return texto
}

const MS_FIM_MINUTO = 59_999

export type EstadoCadastro = 'aberta' | 'encerrada' | 'nao_iniciada'

/** O campo fim_em tem precisão de minuto: vale até fim_em + 59,999 s. */
export function estadoCadastro(c: { inicio_em: string; fim_em: string }, agora: Date): EstadoCadastro {
  const t = agora.getTime()
  if (t < new Date(c.inicio_em).getTime()) return 'nao_iniciada'
  if (t > new Date(c.fim_em).getTime() + MS_FIM_MINUTO) return 'encerrada'
  return 'aberta'
}

export const campanhaAceitaCadastro = (c: { inicio_em: string; fim_em: string }, agora: Date): boolean => estadoCadastro(c, agora) === 'aberta'

/** Pix do indicador não pode ser o CPF ou o telefone do próprio indicado. */
export function pixDoIndicado(
  pix: { tipo: string; chave: string | null },
  indicado: { cpf: string; telefone: string },
): boolean {
  if (!pix.chave) return false
  if (pix.tipo === 'cpf') return pix.chave.replace(/\D/g, '') === indicado.cpf.replace(/\D/g, '')
  if (pix.tipo === 'telefone') {
    const a = telefoneParaE164Digitos(pix.chave)
    const b = telefoneParaE164Digitos(indicado.telefone)
    return Boolean(a && b && a === b)
  }
  return false
}

const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:.]{2,45})$/

/** x-vercel-forwarded-for > 1º de x-forwarded-for > x-real-ip; formato validado, máx. 45 chars. */
export function escolherIp(h: { get(nome: string): string | null }): string {
  const candidatos = [h.get('x-vercel-forwarded-for'), h.get('x-forwarded-for')?.split(',')[0], h.get('x-real-ip')]
  for (const c of candidatos) {
    const v = c?.trim()
    if (v && v.length <= 45 && IP_RE.test(v) && (v.includes('.') || v.includes(':'))) return v
  }
  return 'desconhecido'
}

/** Normaliza para o fim do minuto (segundos=59, ms=999); idempotente. Inválido → devolve como veio. */
export function fimDoMinuto(valor: string): string {
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return valor
  d.setUTCSeconds(59, 999)
  return d.toISOString()
}
