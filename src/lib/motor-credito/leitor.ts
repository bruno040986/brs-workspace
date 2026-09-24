/**
 * Leitor incremental da API Kaizom (D5): SELECT por cursor `id` na
 * `consultas` → insert idempotente na staging `motor_credito_consultas` →
 * cursor só avança depois do insert. Lease de 4 min na própria linha de
 * config contra execução dupla (cron + "Ler agora"). Reler é sempre seguro:
 * `mysql_id` é unique e o insert ignora duplicata.
 *
 * Casamento do convênio (D2): `consultas.convenio` normalizado ×
 * `convenios.codigo_motor_credito`. Sem casamento, `convenio_id` fica nulo e
 * a revisão pede a escolha por lote.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { abrirConexao, identificadorSeguro, lerMotorCreditoConfigRow } from './mysql-client'
import { normalizarChave, normalizarConsulta } from './parser'
import type { LinhaConsultaNormalizada } from './tipos'

const LIMITE_POR_LEITURA = 500
const LEASE_MS = 4 * 60 * 1000

export type ResultadoLeitura = {
  lidas: number
  inseridas: number
  cursor: string | null
  pulado?: 'inativo' | 'lease' | 'nao_configurado'
}

export function linhaParaStaging(n: LinhaConsultaNormalizada, convenioId: string | null) {
  return {
    mysql_id: n.mysqlId,
    tarefa_id: n.tarefaId,
    cpf: n.cpf,
    nome: n.nome,
    matricula: n.matricula,
    convenio_externo: n.convenioExterno,
    convenio_id: convenioId,
    orgao: n.orgao,
    lotacao: n.lotacao,
    vinculo: n.vinculo,
    cargo: n.cargo,
    admissao: n.admissao,
    mes_referencia: n.mesReferencia,
    prox_folha: n.proxFolha,
    margem_novo_bruta: n.margens.novo.bruta,
    margem_novo_disp: n.margens.novo.disp,
    margem_rmc_bruta: n.margens.rmc.bruta,
    margem_rmc_disp: n.margens.rmc.disp,
    margem_rcc_bruta: n.margens.rcc.bruta,
    margem_rcc_disp: n.margens.rcc.disp,
    valor_margem: n.valorMargem,
    valor_disponivel: n.valorDisponivel,
    sucesso: n.sucesso,
    observacao: n.observacao,
    consultado_em: n.consultadoEm,
    dados_extras: n.dadosExtras,
    // D4: falha do lado deles OU CPF inválido → visível, nunca aprovável.
    status: n.sucesso && n.cpf ? 'pendente' : 'falha',
  }
}

/** Índice `codigo_motor_credito` normalizado → `convenios.id` (só ativos). */
export async function indiceConveniosKaizom(admin: Awaited<ReturnType<typeof createAdminClient>>): Promise<Map<string, string>> {
  const { data } = await admin.from('convenios').select('id, codigo_motor_credito').not('codigo_motor_credito', 'is', null).is('deleted_at', null)
  const mapa = new Map<string, string>()
  for (const c of (data || []) as Array<{ id: string; codigo_motor_credito: string }>) {
    const chave = normalizarChave(c.codigo_motor_credito)
    if (chave) mapa.set(chave, c.id)
  }
  return mapa
}

export async function lerConsultasKaizom(): Promise<ResultadoLeitura> {
  const admin = await createAdminClient()
  const cfg = await lerMotorCreditoConfigRow()
  if (!cfg?.host || !cfg.senha_enc) return { lidas: 0, inseridas: 0, cursor: null, pulado: 'nao_configurado' }
  if (!cfg.ativo) return { lidas: 0, inseridas: 0, cursor: cfg.cursor_valor, pulado: 'inativo' }

  // Lease atômico: só pega se ninguém segura ou se o lease venceu.
  const token = randomUUID()
  const agora = new Date()
  const { data: lease } = await admin
    .from('motor_credito_mysql_config')
    .update({ lease_ate: new Date(agora.getTime() + LEASE_MS).toISOString(), lease_por: token })
    .eq('id', 1)
    .or(`lease_ate.is.null,lease_ate.lt.${agora.toISOString()}`)
    .select('id')
  if (!lease?.length) return { lidas: 0, inseridas: 0, cursor: cfg.cursor_valor, pulado: 'lease' }

  let conn: Connection | null = null
  try {
    const cursorAtual = /^\d+$/.test(String(cfg.cursor_valor || '')) ? String(cfg.cursor_valor) : '0'
    const r = await abrirConexao()
    conn = r.conn
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${r.tabela}\` WHERE \`${identificadorSeguro('id', 'Coluna do cursor')}\` > ? ORDER BY id ASC LIMIT ${LIMITE_POR_LEITURA}`,
      [cursorAtual],
    )
    await conn.end().catch(() => {})
    conn = null

    if (!rows.length) {
      await admin.from('motor_credito_mysql_config').update({ ultima_leitura_em: agora.toISOString(), ultima_leitura_qtd: 0, lease_ate: null, lease_por: null }).eq('id', 1).eq('lease_por', token)
      return { lidas: 0, inseridas: 0, cursor: cursorAtual }
    }

    const indice = await indiceConveniosKaizom(admin)
    const linhas = rows.map((row) => {
      const n = normalizarConsulta(row as Record<string, unknown>)
      const convenioId = n.convenioExterno ? indice.get(normalizarChave(n.convenioExterno)) || null : null
      return linhaParaStaging(n, convenioId)
    })

    const { data: inseridasRows, error } = await admin
      .from('motor_credito_consultas')
      .upsert(linhas, { onConflict: 'mysql_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw error

    // Cursor só avança DEPOIS do insert bem-sucedido (D5).
    const novoCursor = String(linhas.reduce((max, l) => (l.mysql_id > max ? l.mysql_id : max), 0))
    await admin
      .from('motor_credito_mysql_config')
      .update({ cursor_coluna: 'id', cursor_valor: novoCursor, ultima_leitura_em: agora.toISOString(), ultima_leitura_qtd: linhas.length })
      .eq('id', 1)
    return { lidas: linhas.length, inseridas: inseridasRows?.length ?? 0, cursor: novoCursor }
  } finally {
    await conn?.end().catch(() => {})
    await admin.from('motor_credito_mysql_config').update({ lease_ate: null, lease_por: null }).eq('id', 1).eq('lease_por', token)
  }
}
