/** Máscaras e formatação para exibição pública (CONTRATO §3.7). Puro. */
import type { PixTipo } from './tipos.ts'

/** '12345678901' → '*23.***.890-**' (padrão X00.XXX.000-00 do regulamento). */
export function mascararCpf(cpf: string): string {
  const d = String(cpf ?? '').replace(/\D/g, '').padStart(11, '*').slice(-11)
  return `*${d.slice(1, 3)}.***.${d.slice(6, 9)}-**`
}

export function formatarCpf(cpf: string): string {
  const d = String(cpf ?? '').replace(/\D/g, '').slice(0, 11)
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** '5561999990000' → '(61) *****-0000'. Aceita com ou sem 55. */
export function mascararTelefone(telefone: string): string {
  let d = String(telefone ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return '***'
  const ddd = d.slice(0, 2)
  const meio = '*'.repeat(d.length - 6)
  return `(${ddd}) ${meio}-${d.slice(-4)}`
}

/** '5561999990000' → '(61) 99999-0000'. */
export function formatarTelefone(telefone: string): string {
  let d = String(telefone ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return telefone
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`
}

export function mascararPix(tipo: PixTipo, chave: string | null): string {
  const c = String(chave ?? '')
  switch (tipo) {
    case 'cpf':
      return mascararCpf(c)
    case 'telefone':
      return mascararTelefone(c)
    case 'email': {
      const [u = '', dom = ''] = c.split('@')
      return `${u.slice(0, 1)}***@${dom}`
    }
    case 'aleatoria':
      return `****-…-${c.slice(-4)}`
    case 'dados_bancarios':
      return `conta ***${c.slice(-2)}`
    default:
      return '***'
  }
}

/** 123456 → 'R$ 1.234,56' */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** 123456 → '1.234,56' (sem símbolo — a mensagem M6 já traz "R$"). */
export function formatarValor(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** '41356863000183' → '41.356.863/0001-83' */
export function formatarCnpj(cnpj: string): string {
  const d = String(cnpj ?? '').replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** 'Maria da Silva Souza' → 'Maria S.' */
export function nomeCurto(nome: string): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length < 2) return partes[0] ?? ''
  return `${partes[0]} ${partes[partes.length - 1][0].toUpperCase()}.`
}

/** '2026-11-10' → '10/11/2026' */
export function formatarDataBr(dataIso: string): string {
  const [a, m, d] = dataIso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
