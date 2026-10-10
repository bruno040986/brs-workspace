/** Validações puras de cadastro (CONTRATO §3.2). Sem I/O. */
import type { PixTipo } from './tipos.ts'

export function somenteDigitos(v: string): string {
  return String(v ?? '').replace(/\D/g, '')
}

/** 11 dígitos, rejeita sequências repetidas, confere os 2 DVs (mod 11). */
export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number) => {
    let soma = 0
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** 10 ou 11 dígitos (DDD 11–99); com 11 dígitos o 3º tem de ser 9 (celular). Aceita prefixo 55. */
export function telefoneBrValido(telefone: string): boolean {
  let d = somenteDigitos(telefone)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return false
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11 || ddd > 99) return false
  if (d.length === 11 && d[2] !== '9') return false
  if (/^(\d)\1+$/.test(d.slice(2))) return false
  return true
}

/** → '55' + DDD + número (sem '+'), ou null se inválido. */
export function telefoneParaE164Digitos(telefone: string): string | null {
  if (!telefoneBrValido(telefone)) return null
  let d = somenteDigitos(telefone)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  return `55${d}`
}

/** Datas em YYYY-MM-DD; compara por calendário, sem fuso. */
export function maiorDe18(dataNascimento: string, hoje: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return false
  const [an, mn, dn] = dataNascimento.split('-').map(Number)
  const [ah, mh, dh] = hoje.split('-').map(Number)
  let idade = ah - an
  if (mh < mn || (mh === mn && dh < dn)) idade -= 1
  return idade >= 18
}

export const MSG_NASCIMENTO = 'Informe sua data de nascimento (você precisa ter 18 anos ou mais).'

/** Nascimento obrigatório do servidor: AAAA-MM-DD real, passado e >= 18 anos. */
export function validarNascimento(raw: unknown, hoje: string): string | null {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '1900-01-01' || v > hoje) return null
  if (new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return null
  return maiorDe18(v, hoje) ? v : null
}

/** Contato achado só por telefone (pode ser outra pessoa): grava nascimento apenas se o contato não tem. */
export function decidirNascimentoNoContato(existenteDob: unknown, informado: string): 'gravar' | 'manter' | 'divergente' {
  const e = typeof existenteDob === 'string' ? existenteDob.trim().slice(0, 10) : ''
  if (!e) return 'gravar'
  return e === informado ? 'manter' : 'divergente'
}

/** ≥ 2 palavras, ≥ 5 caracteres, só letras (com acento), espaços, apóstrofo e hífen. */
export function nomeCompletoValido(nome: string): boolean {
  const n = String(nome ?? '').trim().replace(/\s+/g, ' ')
  if (n.length < 5) return false
  if (!/^[\p{L}][\p{L}' -]*$/u.test(n)) return false
  return n.split(' ').filter(Boolean).length >= 2
}

export function pixValido(tipo: PixTipo, chave: string | null): boolean {
  const c = String(chave ?? '').trim()
  switch (tipo) {
    case 'cpf':
      return cpfValido(c)
    case 'telefone':
      return telefoneBrValido(c)
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) && c.length <= 254
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)
    case 'dados_bancarios':
      return true // banco/agência/conta são checados pelo chamador (e pelo check do banco)
    default:
      return false
  }
}

/** "Não encontrei meu convênio": trim, sem HTML/controles, espaços colapsados, até 120. Vazio/curto → null. */
export function textoConvenioLivre(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return t.length >= 2 ? t : null
}
