/**
 * Servidor MCP do módulo Projetos (JSON-RPC 2.0 à mão, Streamable HTTP sem
 * sessão, respostas JSON). A rota /api/projetos/mcp/[token] autentica o agente
 * e entrega cada mensagem para `responderMcp`.
 *
 * Por que sem @modelcontextprotocol/sdk: o servidor é pequeno (initialize,
 * ping, tools/list, tools/call) e o SDK traria dependência nova (+ zod) para
 * algo que cabe neste arquivo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import * as svc from './service'
import { ehPrioridade, ehTarefaStatus } from './puro'
import {
  MENSAGEM_TIPO_LABEL,
  PROJETO_STATUS_LABEL,
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type Mensagem,
  type ProjetoDetalhe,
  type ProjetoResumo,
} from './tipos'

export const MCP_PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05']

type JsonRpcId = string | number | null
type JsonRpcMsg = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }
type JsonRpcResp = { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } }
type Args = Record<string, unknown>
type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }

const INSTRUCOES = [
  'Você está conectado ao módulo Projetos do BRS Workspace como uma IA participante.',
  'Projetos têm código PRJ-<n> e tarefas T-<n>. Comece com listar_projetos e ler_projeto.',
  'Se você for a IA redatora do projeto, registre a escrita técnica com registrar_escrita_tecnica.',
  'Ideias e análises: contribuir. Tarefas: criar_tarefa / atualizar_tarefa.',
  'Antes de encerrar uma conversa com o Bruno sobre um projeto, registre o que foi conversado e decidido com registrar_conversa_direta.',
].join(' ')

const codigo = { type: 'string', description: 'Código do projeto, ex.: "PRJ-3".' }
const tarefaNumero = { type: 'integer', minimum: 1, description: 'Número da tarefa (o n de T-n). Omita para falar do projeto inteiro.' }
const conteudo = { type: 'string', description: 'Texto em markdown.' }

export const MCP_TOOLS = [
  {
    name: 'listar_projetos',
    description: 'Lista os projetos do BRS Workspace: código, título, status, IA redatora, participantes e contagem de tarefas.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ler_projeto',
    description:
      'Lê um projeto completo: objetivo, ideia principal, escrita técnica, participantes, tarefas, últimas 50 mensagens e commits ligados. Use antes de contribuir.',
    inputSchema: { type: 'object', properties: { codigo }, required: ['codigo'] },
  },
  {
    name: 'listar_mensagens',
    description: 'Lista mensagens da linha do tempo de um projeto (ou de uma tarefa), da mais antiga para a mais nova.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo,
        tarefaNumero,
        desde: { type: 'string', description: 'Só mensagens a partir desta data/hora ISO 8601, ex.: "2026-10-09T12:00:00Z".' },
        limite: { type: 'integer', minimum: 1, maximum: 500, description: 'Máximo de mensagens (padrão 100).' },
      },
      required: ['codigo'],
    },
  },
  {
    name: 'registrar_escrita_tecnica',
    description:
      'Grava a escrita técnica do projeto (documento técnico completo, substitui a versão anterior). Só a IA redatora do projeto pode usar. Se o projeto estiver em "Escrita técnica", ele avança para "Brainstorm".',
    inputSchema: { type: 'object', properties: { codigo, conteudo: { ...conteudo, description: 'Escrita técnica completa em markdown.' } }, required: ['codigo', 'conteudo'] },
  },
  {
    name: 'contribuir',
    description: 'Adiciona uma contribuição (ideia, análise, sugestão, revisão) ao brainstorm do projeto ou de uma tarefa.',
    inputSchema: { type: 'object', properties: { codigo, tarefaNumero, conteudo }, required: ['codigo', 'conteudo'] },
  },
  {
    name: 'registrar_conversa_direta',
    description:
      'Registra no projeto o resumo do que o Bruno conversou diretamente com você fora do Workspace (pedidos, decisões, próximos passos). Use ao final de cada conversa sobre o projeto.',
    inputSchema: { type: 'object', properties: { codigo, tarefaNumero, conteudo: { ...conteudo, description: 'Resumo objetivo da conversa e das decisões, em markdown.' } }, required: ['codigo', 'conteudo'] },
  },
  {
    name: 'criar_tarefa',
    description: 'Cria uma tarefa no projeto. Devolve o número (T-n).',
    inputSchema: {
      type: 'object',
      properties: {
        codigo,
        titulo: { type: 'string', description: 'Título curto da tarefa.' },
        descricao: { type: 'string', description: 'Detalhes, critérios de aceite (markdown).' },
        responsavelSlug: { type: 'string', description: 'Slug da IA responsável (veja listar_agentes), ex.: "codex".' },
        prioridade: { type: 'string', enum: ['baixa', 'media', 'alta'] },
        prazo: { type: 'string', description: 'Data AAAA-MM-DD.' },
      },
      required: ['codigo', 'titulo'],
    },
  },
  {
    name: 'atualizar_tarefa',
    description: 'Atualiza uma tarefa: status, responsável e/ou um comentário (o comentário entra na linha do tempo da tarefa).',
    inputSchema: {
      type: 'object',
      properties: {
        codigo,
        numero: { type: 'integer', minimum: 1, description: 'Número da tarefa (o n de T-n).' },
        status: { type: 'string', enum: ['pendente', 'em_andamento', 'bloqueado', 'em_revisao', 'concluido'] },
        responsavelSlug: { type: 'string', description: 'Slug da IA responsável; string vazia remove o responsável.' },
        comentario: { type: 'string', description: 'Comentário em markdown.' },
      },
      required: ['codigo', 'numero'],
    },
  },
  {
    name: 'listar_agentes',
    description: 'Lista as IAs cadastradas (slug e nome), para preencher responsavelSlug.',
    inputSchema: { type: 'object', properties: {} },
  },
]

export const MCP_TOOLS_LEITURA = new Set(['listar_projetos', 'ler_projeto', 'listar_mensagens', 'listar_agentes'])

// ---------------------------------------------------------------------------
// Formatação (markdown curto para a IA)
// ---------------------------------------------------------------------------

const nomes = (as: Agente[]) => as.map((a) => `${a.nome} (${a.slug})`).join(', ') || '—'

function linhaResumo(p: ProjetoResumo): string {
  return `- **${p.codigo}** ${p.titulo} — ${PROJETO_STATUS_LABEL[p.status]} · redator: ${p.redator?.nome || '—'} · participantes: ${nomes(p.participantes)} · tarefas: ${p.tarefasConcluidas}/${p.totalTarefas}`
}

function linhaMensagem(m: Mensagem): string {
  const onde = m.tarefaNumero ? ` [T-${m.tarefaNumero}]` : ''
  return `- ${m.createdAt} · ${m.autorNome} (${MENSAGEM_TIPO_LABEL[m.tipo]})${onde}: ${m.conteudo}`
}

function textoProjeto(p: ProjetoDetalhe): string {
  const tarefas = p.tarefas.map(
    (t) =>
      `- T-${t.numero} ${t.titulo} — ${TAREFA_STATUS_LABEL[t.status]} · ${TAREFA_PRIORIDADE_LABEL[t.prioridade]}${t.responsavel ? ` · ${t.responsavel.nome}` : ''}${t.prazo ? ` · prazo ${t.prazo}` : ''}${t.descricao ? `\n  ${t.descricao.replace(/\n/g, '\n  ')}` : ''}`,
  )
  const commits = p.commits.map((c) => `- ${c.repo}@${c.sha.slice(0, 7)}${c.tarefaNumero ? ` [T-${c.tarefaNumero}]` : ''} ${c.mensagem.split('\n')[0]}`)
  return [
    `# ${p.codigo} — ${p.titulo}`,
    `Status: ${PROJETO_STATUS_LABEL[p.status]} · Redator: ${p.redator ? `${p.redator.nome} (${p.redator.slug})` : '—'} · Participantes: ${nomes(p.participantes)}`,
    `## Objetivo\n${p.objetivo}`,
    `## Ideia principal\n${p.ideiaPrincipal}`,
    `## Escrita técnica\n${p.escritaTecnica || '(ainda não registrada)'}`,
    `## Tarefas\n${tarefas.join('\n') || '(nenhuma)'}`,
    `## Últimas mensagens\n${p.mensagens.map(linhaMensagem).join('\n') || '(nenhuma)'}`,
    `## Commits\n${commits.join('\n') || '(nenhum)'}`,
  ].join('\n\n')
}

// ---------------------------------------------------------------------------
// Execução das tools
// ---------------------------------------------------------------------------

const ok = (text: string, structuredContent?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(structuredContent ? { structuredContent } : {}),
})

function arg(a: Args, nome: string, obrigatorio = false): string | undefined {
  const v = a[nome]
  if (v == null || v === '') {
    if (obrigatorio) throw new Error(`Parâmetro obrigatório ausente: ${nome}.`)
    return undefined
  }
  return String(v)
}

function numArg(a: Args, nome: string, obrigatorio = false): number | undefined {
  const v = arg(a, nome, obrigatorio)
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error(`Parâmetro ${nome} deve ser um inteiro positivo.`)
  return n
}

async function slugParaId(admin: SupabaseClient, slug: string | undefined): Promise<string | null | undefined> {
  if (slug === undefined) return undefined
  if (!slug.trim()) return null
  const a = (await svc.listarAgentes(admin)).find((x) => x.slug === slug.trim())
  if (!a) throw new Error(`IA "${slug}" não encontrada. Use listar_agentes para ver os slugs.`)
  return a.id
}

async function executarTool(admin: SupabaseClient, agente: Agente, nome: string, a: Args): Promise<ToolResult> {
  const autor = { agenteId: agente.id }
  switch (nome) {
    case 'listar_projetos': {
      const ps = await svc.listarProjetos(admin)
      const projetos = ps.map((p) => ({
        codigo: p.codigo,
        titulo: p.titulo,
        status: p.status,
        redator: p.redator?.slug || null,
        participantes: p.participantes.map((x) => x.slug),
        totalTarefas: p.totalTarefas,
        tarefasConcluidas: p.tarefasConcluidas,
      }))
      return ok(ps.map(linhaResumo).join('\n') || 'Nenhum projeto cadastrado.', { projetos })
    }
    case 'ler_projeto': {
      const p = await svc.lerProjeto(admin, arg(a, 'codigo', true)!, { limiteMensagens: 50 })
      return ok(textoProjeto(p), { projeto: p })
    }
    case 'listar_mensagens': {
      const ms = await svc.listarMensagens(admin, arg(a, 'codigo', true)!, {
        tarefaNumero: numArg(a, 'tarefaNumero'),
        desde: arg(a, 'desde'),
        limite: numArg(a, 'limite'),
      })
      return ok(ms.map(linhaMensagem).join('\n') || 'Nenhuma mensagem.', { mensagens: ms })
    }
    case 'registrar_escrita_tecnica': {
      const r = await svc.registrarEscritaTecnica(admin, arg(a, 'codigo', true)!, arg(a, 'conteudo', true)!, autor)
      return ok(`Escrita técnica registrada em ${r.codigo}. Status atual: ${PROJETO_STATUS_LABEL[r.status]}.`)
    }
    case 'contribuir':
    case 'registrar_conversa_direta': {
      const r = await svc.registrarMensagem(
        admin,
        {
          codigo: arg(a, 'codigo', true)!,
          tarefaNumero: numArg(a, 'tarefaNumero'),
          tipo: nome === 'contribuir' ? 'contribuicao' : 'registro_direto',
          conteudo: arg(a, 'conteudo', true)!,
        },
        autor,
      )
      return ok(`${nome === 'contribuir' ? 'Contribuição' : 'Conversa direta'} registrada em ${r.codigo}.`)
    }
    case 'criar_tarefa': {
      const prioridade = arg(a, 'prioridade')
      if (prioridade !== undefined && !ehPrioridade(prioridade)) throw new Error('Prioridade inválida: use baixa, media ou alta.')
      const r = await svc.criarTarefa(
        admin,
        {
          codigo: arg(a, 'codigo', true)!,
          titulo: arg(a, 'titulo', true)!,
          descricao: arg(a, 'descricao'),
          responsavelAgenteId: await slugParaId(admin, arg(a, 'responsavelSlug')),
          prioridade,
          prazo: arg(a, 'prazo'),
        },
        autor,
      )
      return ok(`Tarefa T-${r.numero} criada em ${r.codigo}.`, { codigo: r.codigo, numero: r.numero })
    }
    case 'atualizar_tarefa': {
      const status = arg(a, 'status')
      if (status !== undefined && !ehTarefaStatus(status)) {
        throw new Error('Status inválido: use pendente, em_andamento, bloqueado, em_revisao ou concluido.')
      }
      const numero = numArg(a, 'numero', true)!
      const responsavelSlug = typeof a.responsavelSlug === 'string' ? a.responsavelSlug : undefined
      const r = await svc.atualizarTarefa(
        admin,
        {
          codigo: arg(a, 'codigo', true)!,
          numero,
          status,
          responsavelAgenteId: await slugParaId(admin, responsavelSlug),
          comentario: arg(a, 'comentario'),
        },
        autor,
      )
      return ok(`Tarefa T-${numero} de ${r.codigo} atualizada.`)
    }
    case 'listar_agentes': {
      const ags = (await svc.listarAgentes(admin)).filter((x) => x.ativo).map((x) => ({ slug: x.slug, nome: x.nome }))
      return ok(ags.map((x) => `- ${x.slug}: ${x.nome}`).join('\n'), { agentes: ags })
    }
  }
  throw new Error(`Tool desconhecida: ${nome}`)
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

const erro = (id: JsonRpcId, code: number, message: string): JsonRpcResp => ({ jsonrpc: '2.0', id, error: { code, message } })

/** Responde UMA mensagem JSON-RPC. Notificação (sem id) → null (sem resposta). */
export async function responderMcp(admin: SupabaseClient, agente: Agente, msg: JsonRpcMsg): Promise<JsonRpcResp | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return erro(msg?.id ?? null, -32600, 'Invalid Request')
  }
  if (msg.id === undefined) return null
  const id = msg.id
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Args

  switch (msg.method) {
    case 'initialize': {
      const pedida = String(params.protocolVersion || '')
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOLOS.includes(pedida) ? pedida : MCP_PROTOCOLOS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'brs-workspace-projetos', title: 'BRS Workspace — Projetos', version: '1.0.0' },
          instructions: `${INSTRUCOES} Você é: ${agente.nome} (${agente.slug}).`,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
    case 'tools/call': {
      const nome = String(params.name || '')
      if (!MCP_TOOLS.some((t) => t.name === nome)) return erro(id, -32602, `Tool desconhecida: ${nome}`)
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Args
      try {
        return { jsonrpc: '2.0', id, result: await executarTool(admin, agente, nome, args) }
      } catch (err) {
        // Erro de execução vai como resultado com isError para a IA ler e corrigir.
        const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message || 'Erro interno.')
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Erro: ${message}` }], isError: true } }
      }
    }
    default:
      return erro(id, -32601, `Method not found: ${msg.method}`)
  }
}

