/**
 * `bancobrs.consultas` (linha cru do mysql2) → `LinhaConsultaNormalizada`.
 * Estrutura real do `dados_extras` no handoff §3.1: o nome vem em
 * `dados_extras.nome` (a coluna `nome` é NULL), as margens dos 3 produtos
 * vêm nos mapas `margem_bruta`/`margem_disponivel` com chave por produto
 * (com acento e espaço — comparar normalizado) e `valor_float`. Nunca usar
 * o bloco `exportador` (não traz o Cartão de Benefício).
 */
import { normalizeCpfCell } from '../alvoconsig/import.ts'
import type { LinhaConsultaNormalizada, MargemProduto } from './tipos'

/** trim + maiúsculas + sem acento + espaços colapsados — mesma regra do de-para `convenios.codigo_motor_credito`. */
export function normalizarChave(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const PRODUTO_POR_CHAVE: Record<string, 'novo' | 'rmc' | 'rcc'> = {
  'CONSIGNACOES FACULTATIVAS': 'novo',
  'CARTAO DE CREDITO': 'rmc',
  'CARTAO DE BENEFICIO': 'rcc',
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function texto(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

/** "dd/mm/aaaa" → "aaaa-mm-dd"; qualquer outra coisa → null. */
export function dataBrParaIso(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * `consultado_em` chega como texto "AAAA-MM-DD HH:MM:SS" (conexão com
 * `dateStrings`), no fuso do servidor MySQL da Kaizom — assumido
 * America/Sao_Paulo (-03:00). ponytail: conferir com uma linha real na
 * Etapa 3 (comparar com "detalhes da tarefa" no higienizador); se o servidor
 * deles for UTC, trocar o sufixo aqui.
 */
export function consultadoEmParaIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(v ?? ''))
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}-03:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function lerMapaMargem(mapa: unknown): Partial<Record<'novo' | 'rmc' | 'rcc', number | null>> {
  const out: Partial<Record<'novo' | 'rmc' | 'rcc', number | null>> = {}
  if (!mapa || typeof mapa !== 'object') return out
  for (const [chave, item] of Object.entries(mapa as Record<string, unknown>)) {
    const produto = PRODUTO_POR_CHAVE[normalizarChave(chave)]
    if (!produto) continue
    const valor = item && typeof item === 'object' ? (item as { valor_float?: unknown }).valor_float : item
    out[produto] = numero(valor)
  }
  return out
}

export function normalizarConsulta(row: Record<string, unknown>): LinhaConsultaNormalizada {
  let extras: Record<string, unknown> = {}
  const cru = row.dados_extras
  if (cru && typeof cru === 'object') extras = cru as Record<string, unknown>
  else if (typeof cru === 'string') {
    try { extras = JSON.parse(cru) } catch { extras = {} }
  }

  const bruta = lerMapaMargem(extras.margem_bruta)
  const disp = lerMapaMargem(extras.margem_disponivel)
  const produto = (p: 'novo' | 'rmc' | 'rcc'): MargemProduto => ({ bruta: bruta[p] ?? null, disp: disp[p] ?? null })

  return {
    mysqlId: Number(row.id),
    tarefaId: row.tarefa_id === null || row.tarefa_id === undefined ? null : Number(row.tarefa_id),
    convenioExterno: texto(row.convenio),
    cpf: normalizeCpfCell(row.cpf_consultado ?? extras.cpf),
    nome: texto(row.nome) ?? texto(extras.nome),
    matricula: texto(row.matricula) ?? texto(extras.identificacao),
    orgao: texto(extras.orgao),
    lotacao: texto(extras.lotacao),
    vinculo: texto(extras.vinculo),
    cargo: texto(extras.cargo),
    admissao: dataBrParaIso(extras.admissao),
    mesReferencia: texto(extras.mes_referencia),
    proxFolha: dataBrParaIso(extras.prox_folha),
    margens: { novo: produto('novo'), rmc: produto('rmc'), rcc: produto('rcc') },
    valorMargem: numero(row.valor_margem),
    valorDisponivel: numero(row.valor_disponivel),
    sucesso: Number(row.sucesso) === 1 || row.sucesso === true,
    observacao: texto(row.observacao),
    consultadoEm: consultadoEmParaIso(row.consultado_em),
    dadosExtras: extras,
  }
}
