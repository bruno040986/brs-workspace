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
import { MAX_CHAT, MAX_COTAS, avisoEscritaAlterada, ehPrioridade, ehTarefaStatus, tempoDesde } from './puro'
import {
  MENSAGEM_TIPO_LABEL,
  PROJETO_STATUS_LABEL,
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type ContaCotas,
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
  'Para conversar em tempo real no chat do projeto: chat_ouvir (passando o cursor da resposta anterior) e chat_enviar, em laço.',
  'Sempre que o Bruno colar a leitura de /usage, /status ou do painel de uso (ou a plataforma avisar limite), registre as cotas com cota_registrar.',
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
  {
    name: 'chat_ouvir',
    description:
      'Lê o chat do projeto (conversa curta em tempo real com o Bruno e as outras IAs; não é o fórum). Sem "desde", traz as últimas mensagens; com "desde", só as mais novas que ele. Devolve "cursor". Uso em laço: chame chat_ouvir com o cursor da última resposta; responda com chat_enviar; repita (a cada 30–60 s).',
    inputSchema: {
      type: 'object',
      properties: {
        codigo,
        desde: { type: 'string', description: 'Cursor devolvido pela chamada anterior de chat_ouvir (ISO 8601). Omita na primeira leitura.' },
        limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Máximo de mensagens (padrão 50).' },
      },
      required: ['codigo'],
    },
  },
  {
    name: 'chat_enviar',
    description: `Envia uma mensagem curta no chat do projeto (até ${MAX_CHAT} caracteres, markdown simples). Só IAs participantes. Para ideias longas use contribuir. Em laço: chame chat_ouvir com o cursor da última resposta; responda com chat_enviar; repita.`,
    inputSchema: { type: 'object', properties: { codigo, conteudo: { type: 'string', description: `Mensagem (até ${MAX_CHAT} caracteres).` } }, required: ['codigo', 'conteudo'] },
  },
  {
    name: 'cota_registrar',
    description:
      'Registra quanto já foi usado de cada cota de uma CONTA de IA. A cota é da conta, não da IA: Claude (chat) e Claude Code dividem a conta "claude" ("5 horas", "Semanal", "Fable semanal"); Codex usa "codex" ("5 horas", "Semanal"); Gemini Antigravity usa "antigravity" ("5 horas", "Sonnet 5.5", "Opus 5.5", "GPT"). Jarvis (ChatGPT) e Gemini NotebookLM não têm cota legível. Nenhuma IA lê a própria cota por API: use esta tool SEMPRE que o Bruno colar a leitura de /usage (Claude Code), /status (Codex) ou do painel de uso (Antigravity) ou equivalente, e também quando a plataforma avisar que um limite está perto ou foi atingido. Converta "restante" em "usado" (usado = 100 − restante). Cada cota é atualizada pelo nome (sem diferenciar maiúsculas); cotas não enviadas ficam como estão. Sem conta nem agenteSlug, grava na conta da IA que chama (erro se ela não tiver conta); com agenteSlug, na conta daquela IA; com conta, direto na conta.',
    inputSchema: {
      type: 'object',
      properties: {
        cotas: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_COTAS,
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string', description: 'Nome da cota como aparece na plataforma, ex.: "5 horas", "Semanal", "Opus 5.5" (até 60 caracteres).' },
              percentualUsado: { type: 'number', minimum: 0, maximum: 100, description: 'Percentual JÁ USADO, de 0 a 100.' },
              reiniciaEm: { type: 'string', description: 'Quando a cota reinicia, ISO 8601 com fuso, ex.: "2026-10-10T18:00:00-03:00". Omita se não souber.' },
              observacao: { type: 'string', description: 'Observação curta (até 200 caracteres).' },
            },
            required: ['nome', 'percentualUsado'],
          },
        },
        conta: { type: 'string', enum: ['claude', 'codex', 'antigravity'], description: 'Conta dona das cotas. Tem prioridade sobre agenteSlug. Omita para usar a conta da sua IA.' },
        agenteSlug: { type: 'string', description: 'Slug de uma IA (veja listar_agentes): grava na conta dela. Omita para usar a conta da sua IA.' },
      },
      required: ['cotas'],
    },
  },
  {
    name: 'cota_listar',
    description: 'Lista as cotas de uso por conta (Claude.ai / Claude Code, Codex, Antigravity), com as IAs que dividem cada conta, percentual usado, quando reinicia e há quanto tempo foi atualizado.',
    inputSchema: { type: 'object', properties: {} },
  },
]

/** Tools que não mudam a tela renderizada no servidor: a rota não revalida o cache (o chat a tela busca por polling). */
export const MCP_TOOLS_SEM_REVALIDAR = new Set(['listar_projetos', 'ler_projeto', 'listar_mensagens', 'listar_agentes', 'chat_ouvir', 'chat_enviar', 'cota_registrar', 'cota_listar'])

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

const horaBr = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function textoChat(ms: Mensagem[], cursor: string | null): string {
  const linhas = ms.map((m) => `[${horaBr(m.createdAt)}] ${m.autorNome}: ${m.conteudo}`)
  return `${linhas.join('\n') || 'Nenhuma mensagem nova.'}\n\ncursor: ${cursor ?? '(vazio)'}`
}

const dataHoraBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function linhaCotas(a: ContaCotas): string {
  const quem = `- ${a.rotulo} (conta ${a.conta}; IAs: ${a.agentes.join(', ') || '—'})`
  if (!a.cotas.length) return `${quem}: sem leitura registrada`
  const cotas = a.cotas.map((c) => `${c.nome} ${c.percentualUsado}%${c.reiniciaEm ? ` (reinicia ${dataHoraBr(c.reiniciaEm)})` : ''}${c.observacao ? ` [${c.observacao}]` : ''}`)
  const ultima = a.cotas.reduce((x, y) => (Date.parse(y.atualizadoEm) > Date.parse(x.atualizadoEm) ? y : x))
  return `${quem}: ${cotas.join(' · ')} — atualizado ${tempoDesde(ultima.atualizadoEm)} por ${ultima.atualizadoPorNome}`
}

function textoAprovacao(p: ProjetoDetalhe): string {
  if (!p.aprovadoEm) return 'Aprovação: escrita técnica ainda não aprovada.'
  const aviso = avisoEscritaAlterada(p)
  return `Aprovação: por ${p.aprovadoPorNome || '—'} em ${p.aprovadoEm} (v${p.versaoEscritaAprovada ?? '?'}).${aviso ? ` Atenção: ${aviso}` : ''}`
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
    textoAprovacao(p),
    `## Objetivo\n${p.objetivo}`,
    `## Ideia principal\n${p.ideiaPrincipal}`,
    `## Escrita técnica (v${p.escritaVersao})\n${p.escritaTecnica || '(ainda não registrada)'}`,
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
      return ok(`Escrita técnica v${r.versao} registrada em ${r.codigo}. Status atual: ${PROJETO_STATUS_LABEL[r.status]}.`, {
        codigo: r.codigo,
        status: r.status,
        versao: r.versao,
      })
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
    case 'chat_ouvir': {
      const r = await svc.ouvirChat(admin, { codigo: arg(a, 'codigo', true)!, desde: arg(a, 'desde'), limite: numArg(a, 'limite') })
      return ok(textoChat(r.mensagens, r.cursor), { mensagens: r.mensagens, cursor: r.cursor })
    }
    case 'chat_enviar': {
      const r = await svc.enviarChat(admin, autor, { codigo: arg(a, 'codigo', true)!, conteudo: arg(a, 'conteudo', true)! })
      return ok(`Mensagem enviada no chat de ${r.codigo}.`)
    }
    case 'cota_registrar': {
      const r = await svc.registrarCotas(admin, autor, { conta: arg(a, 'conta'), agenteSlug: arg(a, 'agenteSlug'), agenteId: agente.id }, a.cotas)
      return ok(`${r.total} cota(s) da conta ${r.rotulo} registrada(s).`, { conta: r.conta, total: r.total })
    }
    case 'cota_listar': {
      const lista = await svc.listarCotas(admin)
      return ok(lista.map(linhaCotas).join('\n') || 'Nenhuma conta com cota legível.', {
        contas: lista,
      })
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

