/**
 * Upload de base higienizada no motor de crédito (Vende.AI) para a Central de
 * Integrações.
 *
 * O Workspace só PARSEIA o arquivo (CSV/XLSX, com cabeçalho) e repassa as
 * linhas cruas em chunks para a Admin API do orquestrador
 * (/api/admin/upload: start -> rows -> finalize). As regras de negócio
 * (elegibilidade por simulação, tags gerenciadas) rodam lá, com o MESMO
 * código do import CLI. A base ganha a tag `base-<slug>` no WeSales e vira
 * público selecionável nas ações.
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { orchestratorFetch, OrchestratorApiError } from '@/lib/central/orchestrators'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_ROWS = 100_000
const CHUNK = 1000

function slugifyTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '') // BOM que o Excel/Vende.AI colocam no começo do arquivo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function isTextFile(name: string): boolean {
  return /\.(csv|txt)$/i.test(name)
}

/**
 * CSV/TXT: decodifica e detecta o delimitador (o export da Vende.AI costuma
 * vir com ";" — o leitor genérico trataria o cabeçalho inteiro como UMA
 * coluna, "CPF;Nome;Telefone…", e a coluna CPF "sumia"). XLSX: leitura direta.
 */
function readWorkbook(buffer: Buffer, fileName: string): XLSX.WorkBook {
  if (!isTextFile(fileName)) {
    return XLSX.read(buffer, { type: 'buffer', raw: false })
  }
  let text = buffer.toString('utf8')
  // Arquivo salvo em latin1/Windows-1252: o utf8 gera U+FFFD; refaz em latin1.
  if (text.includes('\uFFFD')) text = buffer.toString('latin1')
  text = text.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => firstLine.split(ch).length - 1
  const candidates: Array<[string, number]> = [[';', count(';')], [',', count(',')], ['\t', count('\t')]]
  candidates.sort((a, b) => b[1] - a[1])
  const delimiter = candidates[0][1] > 0 ? candidates[0][0] : ','
  // raw: true — CSV é texto: não deixar o leitor "adivinhar" tipos (data vira
  // número de série 31658.99, telefone perde zero à esquerda).
  return XLSX.read(text, { type: 'string', raw: true, FS: delimiter })
}

function parseRows(buffer: Buffer, fileName: string): Array<Record<string, string>> {
  const workbook = readWorkbook(buffer, fileName)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: isTextFile(fileName) })
  return rows.map((row) => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      const header = String(key).replace(/^\uFEFF/, '').trim()
      if (!header || header.startsWith('__EMPTY')) continue
      out[header] = String(value ?? '').trim()
    }
    return out
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'central-integracoes', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file')
    const slug = String(formData.get('orchestrator') || 'clt')
    const labelRaw = String(formData.get('label') || '').trim()

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Envie um arquivo CSV ou XLSX com cabeçalho.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo acima de 20MB.' }, { status: 400 })
    }
    if (!labelRaw) {
      return NextResponse.json({ error: 'Dê um nome para a base (vira a tag no WeSales).' }, { status: 400 })
    }
    const baseTag = `base-${slugifyTag(labelRaw)}`
    if (baseTag.length < 7) {
      return NextResponse.json({ error: 'Nome da base inválido — use letras e números.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let rows: Array<Record<string, string>>
    try {
      rows = parseRows(buffer, String(file.name || ''))
    } catch {
      return NextResponse.json({ error: 'Não foi possível ler o arquivo. Use CSV ou XLSX.' }, { status: 400 })
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Arquivo sem linhas de dados (o cabeçalho é obrigatório).' }, { status: 400 })
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `O arquivo tem ${rows.length.toLocaleString('pt-BR')} linhas — máximo ${MAX_ROWS.toLocaleString('pt-BR')}. Divida em arquivos menores.` },
        { status: 400 },
      )
    }

    const headers = Object.keys(rows[0])
    const hasCpf = headers.some((h) => normalizeHeader(h) === 'cpf')
    if (!hasCpf) {
      return NextResponse.json(
        { error: `Coluna "CPF" não encontrada. Colunas lidas (${headers.length}): ${headers.slice(0, 12).map((h) => `"${h}"`).join(', ')}. Se apareceu uma coluna só com ";" no meio, o arquivo está com um separador que não reconheci — me envie o cabeçalho.` },
        { status: 400 },
      )
    }

    const { jobId } = await orchestratorFetch<{ jobId: string }>(slug, '/api/admin/upload', {
      method: 'POST',
      body: {
        start: {
          label: `${labelRaw} (${file.name})`.slice(0, 200),
          baseTag,
          createdBy: user.email ?? user.id,
        },
      },
      timeoutMs: 30_000,
    })

    for (let i = 0; i < rows.length; i += CHUNK) {
      await orchestratorFetch(slug, '/api/admin/upload', {
        method: 'POST',
        body: { jobId, rows: rows.slice(i, i + CHUNK) },
        timeoutMs: 55_000,
      })
    }

    const done = await orchestratorFetch<{ total: number }>(slug, '/api/admin/upload', {
      method: 'POST',
      body: { jobId, finalize: true },
      timeoutMs: 30_000,
    })

    return NextResponse.json({ jobId, baseTag, total: done.total })
  } catch (error) {
    if (error instanceof OrchestratorApiError) {
      return NextResponse.json({ error: `[${error.slug}] ${error.message}` }, { status: 502 })
    }
    console.error('Erro no upload de base da central:', error)
    return NextResponse.json({ error: 'Erro inesperado ao enviar a base.' }, { status: 500 })
  }
}
