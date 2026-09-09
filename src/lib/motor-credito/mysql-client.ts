/**
 * Motor de crédito (convênios públicos) — leitura direta do MySQL do
 * fornecedor (base `bancobrs`, tabela `consultas`), no lugar do Excel que
 * hoje alimenta o import de margem em `alvoconsig/importacoes`. Fase 1
 * (08/09/2026): só credencial + teste de conexão + exploração do schema
 * (DESCRIBE + amostra), pra eu mapear as colunas reais antes de escrever a
 * sincronização de verdade.
 *
 * Rede: por decisão do Bruno, o fornecedor libera QUALQUER IP de origem — o
 * usuário `integracaobrs` deve ficar restrito a `SELECT` só na tabela
 * `consultas` do lado deles (não é algo que a gente controle daqui). Sem
 * isso, não faz sentido abrir esse MySQL pra internet.
 *
 * Credencial cifrada no cofre (mesma CRM_CREDENTIALS_KEY de Quark/Nuvidio/
 * IF-Crédito) — nunca chega ao navegador. Conexão nova por chamada (padrão
 * serverless: sem pool persistente entre invocações do Vercel).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { createConnection } from 'mysql2/promise'
import { createAdminClient } from '@/lib/supabase/server'
import { cifrarTexto, decifrarTexto } from '@/lib/central-conversas/cofre'

export type MotorCreditoConfigPublica = {
  host: string
  porta: number
  banco: string
  tabela: string
  usuario: string
  temSenha: boolean
  ativo: boolean
  cursorColuna: string | null
  cursorValor: string | null
  atualizadoEm: string | null
}

type ConfigRow = {
  id: number
  host: string
  porta: number
  banco: string
  tabela: string
  usuario: string
  senha_enc: string | null
  cursor_coluna: string | null
  cursor_valor: string | null
  ativo: boolean
  updated_at: string | null
}

export async function lerMotorCreditoConfigRow(): Promise<ConfigRow | null> {
  const admin = await createAdminClient()
  const { data, error } = await admin.from('motor_credito_mysql_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (String(error.message || '').includes('motor_credito_mysql_config')) return null
    throw error
  }
  return (data as ConfigRow | null) || null
}

export async function lerMotorCreditoConfigPublica(): Promise<MotorCreditoConfigPublica> {
  const row = await lerMotorCreditoConfigRow()
  return {
    host: row?.host || '',
    porta: row?.porta || 3306,
    banco: row?.banco || '',
    tabela: row?.tabela || 'consultas',
    usuario: row?.usuario || '',
    temSenha: Boolean(row?.senha_enc),
    ativo: row?.ativo !== false,
    cursorColuna: row?.cursor_coluna || null,
    cursorValor: row?.cursor_valor || null,
    atualizadoEm: row?.updated_at || null,
  }
}

export async function salvarMotorCreditoConfig(input: {
  host: string
  porta: number
  banco: string
  tabela: string
  usuario: string
  senha?: string
  ativo: boolean
  updatedBy: string
}): Promise<void> {
  const admin = await createAdminClient()
  const atual = await lerMotorCreditoConfigRow()
  const { error } = await admin.from('motor_credito_mysql_config').upsert(
    {
      id: 1,
      host: input.host.trim(),
      porta: Math.round(input.porta) || 3306,
      banco: input.banco.trim(),
      tabela: input.tabela.trim() || 'consultas',
      usuario: input.usuario.trim(),
      senha_enc: input.senha?.trim() ? cifrarTexto(input.senha.trim()) : atual?.senha_enc || null,
      ativo: input.ativo,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

/** Nome de coluna/tabela só pode ir direto na query (mysql2 não parametriza identificador) depois de validado assim — sem isso, injeção via `tabela` salva na config. */
function identificadorSeguro(nome: string, rotulo: string): string {
  const limpo = String(nome || '').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(limpo)) throw new Error(`${rotulo} inválido: só letras, números e _ (recebido: "${nome}").`)
  return limpo
}

async function abrirConexao(): Promise<{ conn: Connection; tabela: string }> {
  const row = await lerMotorCreditoConfigRow()
  if (!row?.host || !row.senha_enc) throw new Error('Motor de crédito (MySQL) não configurado (Provedores e APIs › Motor de Crédito).')
  const tabela = identificadorSeguro(row.tabela || 'consultas', 'Nome da tabela')
  const conn = await createConnection({
    host: row.host,
    port: row.porta || 3306,
    database: row.banco,
    user: row.usuario,
    password: decifrarTexto(row.senha_enc),
    connectTimeout: 8000,
    // TCP puro: o fornecedor não expôs TLS pra essa integração até aqui.
    // Se eles ligarem SSL/TLS depois, ajusta pra ssl: { rejectUnauthorized: true }.
  })
  return { conn, tabela }
}

export async function testarConexaoMotorCredito(): Promise<{ ok: boolean; detalhe: string }> {
  let conn: Connection | null = null
  try {
    const r = await abrirConexao()
    conn = r.conn
    await conn.query('SELECT 1')
    const [linhas] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM \`${r.tabela}\``)
    const total = Array.isArray(linhas) && linhas[0] ? Number(linhas[0].total) : null
    return { ok: true, detalhe: `Conectado. Tabela "${r.tabela}"${total !== null ? ` tem ${total.toLocaleString('pt-BR')} linha(s).` : '.'}` }
  } catch (err) {
    return { ok: false, detalhe: mensagemErroMysql(err) }
  } finally {
    await conn?.end().catch(() => {})
  }
}

export type ColunaDescricao = { field: string; type: string; nullable: string; key: string; default: string | null; extra: string }

/** DESCRIBE da tabela configurada — pra eu mapear as colunas reais antes de escrever o parser de margem. */
export async function descreverTabelaMotorCredito(): Promise<ColunaDescricao[]> {
  let conn: Connection | null = null
  try {
    const { conn: c, tabela } = await abrirConexao()
    conn = c
    const [linhas] = await conn.query<RowDataPacket[]>(`DESCRIBE \`${tabela}\``)
    return linhas.map((l) => ({
      field: String(l.Field),
      type: String(l.Type),
      nullable: String(l.Null),
      key: String(l.Key || ''),
      default: l.Default === null || l.Default === undefined ? null : String(l.Default),
      extra: String(l.Extra || ''),
    }))
  } finally {
    await conn?.end().catch(() => {})
  }
}

/** Amostra das últimas linhas (sem ORDER BY — ainda não sei qual coluna é o cursor/data). Só pra inspeção manual, nunca pro sync de verdade. */
export async function amostrarLinhasMotorCredito(limite = 5): Promise<Record<string, unknown>[]> {
  let conn: Connection | null = null
  try {
    const { conn: c, tabela } = await abrirConexao()
    conn = c
    const n = Math.min(Math.max(Math.round(limite) || 5, 1), 20)
    const [linhas] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${tabela}\` LIMIT ${n}`)
    return linhas as unknown as Record<string, unknown>[]
  } finally {
    await conn?.end().catch(() => {})
  }
}

function mensagemErroMysql(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'ECONNREFUSED') return 'Conexão recusada — confira host/porta e se o MySQL aceita conexões externas.'
  if (code === 'ETIMEDOUT' || code === 'ENETUNREACH') return 'Sem resposta do host (timeout) — confira se o IP/porta estão certos e se o firewall do fornecedor libera esta origem.'
  if (code === 'ER_ACCESS_DENIED_ERROR') return 'Usuário ou senha recusados pelo MySQL.'
  if (code === 'ER_BAD_DB_ERROR') return 'Banco de dados não existe (confira o nome).'
  if (code === 'ER_NO_SUCH_TABLE') return 'Tabela não existe nesse banco (confira o nome da tabela).'
  return err instanceof Error ? err.message : 'Falha na conexão com o MySQL.'
}
