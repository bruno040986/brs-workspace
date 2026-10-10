# Módulo Projetos

Tecnologia › Projetos (`/projetos`, permissão `projetos`). Bruno cria um projeto,
escolhe as IAs participantes e a IA redatora; as IAs entram por MCP (token
próprio por IA) para ler, escrever a escrita técnica, contribuir, registrar
conversas diretas e cuidar das tarefas. Commits do GitHub chegam por webhook.

Código: `src/lib/projetos/` (tipos, puro, service, actions, mcp),
`src/app/api/projetos/mcp/[token]/route.ts`,
`src/app/api/projetos/github/webhook/route.ts`, migration `*_projetos_modulo.sql`.

## Esquema

| Tabela | O quê |
|---|---|
| `projeto_agentes` | IAs (slug, nome, `token_hash` = sha256 hex do token MCP, ativo). Seed: claude-code, claude, jarvis, codex, gemini-antigravity, gemini-notebooklm |
| `projetos` | `numero` serial → código `PRJ-<n>`; título, objetivo, ideia principal, status, redator, escrita técnica, criado_por |
| `projeto_participantes` | (projeto, agente). O redator é sempre incluído |
| `projeto_tarefas` | `numero` sequencial por projeto → `T-<n>`; status, prioridade, prazo, responsável (IA), concluida_em |
| `projeto_mensagens` | linha do tempo; autor = usuário OU agente; tipos: mensagem, contribuicao, decisao, registro_direto, status, escrita_tecnica |
| `projeto_commits` | commits do webhook, `unique(repo, sha)`, ligados a projeto/tarefa |

Todas com RLS ligada sem policy (só service role).

## Fluxo de status

`rascunho → escrita_tecnica → brainstorm → planejamento → execucao → concluido` (+ `arquivado`).

- Criar com "iniciar" exige redator e já entra em `escrita_tecnica`.
- O redator grava a escrita técnica (`registrar_escrita_tecnica`); se o projeto
  está em `escrita_tecnica`, avança sozinho para `brainstorm`.
- Demais transições são manuais e livres (pode voltar etapa); só não repete o
  status atual nem entra em `escrita_tecnica` sem redator.
- Toda mudança de status (projeto ou tarefa) vira mensagem `status` com
  `meta = { entidade, de, para }`. Tarefa concluída grava `concluida_em`.
- Toda escrita de uma IA gera notificação no sino para quem criou o projeto.

## Aprovação

Migration `*_projetos_aprovacao.sql` (colunas em `projetos`).

- `escrita_versao` sobe 1 a cada `registrar_escrita_tecnica` (0 = nunca
  registrada; projetos que já tinham escrita começam em 1).
- Entrar em `planejamento` (de qualquer status) exige escrita técnica não vazia;
  na tela o botão "Avançar para Planejamento" fica desabilitado.
- Quando um **usuário** leva o projeto a `planejamento`, grava `aprovado_por`,
  `aprovado_em` e `versao_escrita_aprovada = escrita_versao`; a mensagem de
  status ganha `meta.aprovacao = { versao }`. Voltar etapa não apaga a aprovação;
  aprovar de novo sobrescreve.
- Se `escrita_versao > versao_escrita_aprovada`, a tela e o `ler_projeto` avisam
  "escrita técnica alterada após a aprovação (vA → vB)".
- Nenhuma tool MCP muda status de projeto; a aprovação é sempre humana.

## Conectar as IAs

1. Em `/projetos`, gere o token da IA (botão "Gerar token"). A tela mostra a URL
   **uma vez**: `https://workspace.brspromotora.com.br/api/projetos/mcp/<token>`.
   Gerar de novo invalida a anterior. Trate a URL como senha.
2. Conecte:
   - **Claude (claude.ai)**: Configurações › Conectores › Adicionar conector
     personalizado, cole a URL, sem autenticação.
   - **ChatGPT (Jarvis)**: Configurações › Conectores › modo desenvolvedor ›
     criar conector MCP com a URL, sem autenticação.
   - **Claude Code**: `claude mcp add --transport http projetos <url>`
   - **Codex**: em `~/.codex/config.toml`:
     ```toml
     [mcp_servers.projetos]
     url = "<url>"
     ```
   - **Gemini (Antigravity)**: config MCP do editor com `"serverUrl": "<url>"`
     (transporte HTTP).
   - **Gemini (NotebookLM)**: não aceita MCP; Bruno cola o resumo na tela
     (mensagem) ou pede a outra IA para registrar.
3. Quem preferir header: `Authorization: Bearer <token>` também vale (tem
   precedência sobre o token da URL).

Tools: `listar_projetos`, `ler_projeto`, `listar_mensagens`,
`registrar_escrita_tecnica` (só redator), `contribuir`,
`registrar_conversa_direta`, `criar_tarefa`, `atualizar_tarefa`,
`listar_agentes`. Ler é livre para qualquer IA ativa; escrever só para
participantes do projeto.

### Instrução padrão para colar em cada IA

> Você participa dos projetos do BRS Workspace pelo conector "projetos".
> Antes de opinar sobre um projeto, leia-o com `ler_projeto` (código PRJ-n).
> Ideias e análises vão em `contribuir`; tarefas em `criar_tarefa` /
> `atualizar_tarefa`. Se você for a redatora, grave a escrita técnica com
> `registrar_escrita_tecnica`. Antes de encerrar qualquer conversa comigo sobre
> um projeto, registre no projeto, via `registrar_conversa_direta`, um resumo
> do que conversamos, do que foi decidido e dos próximos passos.

## Webhook do GitHub

Env na Vercel: `GITHUB_WEBHOOK_SECRET` (sem ela a rota responde 503).

```bash
gh api repos/{owner}/{repo}/hooks -f name=web -F active=true \
  -f 'events[]=push' \
  -f config[url]=https://workspace.brspromotora.com.br/api/projetos/github/webhook \
  -f config[content_type]=json \
  -f config[secret]="$GITHUB_WEBHOOK_SECRET"
```

Só o evento `push` é gravado (o resto responde 200 e é ignorado). Assinatura
`x-hub-signature-256` inválida → 401.

### Convenção de referência no commit

- `PRJ-3` → liga o commit ao projeto 3.
- `PRJ-3/T-2` → liga à tarefa 2 do projeto 3.
- `T-2` solto → tarefa 2, só quando a mensagem cita um único `PRJ-`.
- Vários projetos citados → vale o primeiro.

Ex.: `feat(busca): filtro por data (PRJ-3/T-2)`.
