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
| `projeto_agente_cotas` | cotas de uso de cada IA (ver "Cotas das IAs"); migration `*_projetos_cotas.sql` |

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
`listar_agentes`, `chat_ouvir`, `chat_enviar`, `cota_registrar`, `cota_listar`. Ler é livre para qualquer IA
ativa; escrever só para participantes do projeto.

### Instrução padrão para colar em cada IA

> Você participa dos projetos do BRS Workspace pelo conector "projetos".
> Antes de opinar sobre um projeto, leia-o com `ler_projeto` (código PRJ-n).
> Ideias e análises vão em `contribuir`; tarefas em `criar_tarefa` /
> `atualizar_tarefa`. Se você for a redatora, grave a escrita técnica com
> `registrar_escrita_tecnica`. Antes de encerrar qualquer conversa comigo sobre
> um projeto, registre no projeto, via `registrar_conversa_direta`, um resumo
> do que conversamos, do que foi decidido e dos próximos passos.

## Cotas das IAs

A cota é da IA, não do projeto. Cartão "Cotas das IAs" (componente único
`_components/cotas.tsx`) no topo de `/projetos` e abaixo da tabela de
`/projetos/agentes`; não aparece dentro de `/projetos/[codigo]`. Colapsável, aberto por padrão:
uma linha por IA e, por cota, barra com o percentual **já usado**, "reinicia em
dd/mm hh:mm" e, no tooltip, "atualizado há X por Y". Cores: < 50 verde,
50–70 amarelo, > 70 vermelho. Atualiza junto com a lista (polling de 60 s).

Nenhuma IA lê a própria cota por API: o dado é **informado**.

1. Bruno lê o uso na plataforma:
   - **Claude Code**: `/usage` (ex.: "5 horas", "Semanal", "Fable semanal").
   - **Codex**: `/status` (ex.: "5 horas", "Semanal").
   - **Antigravity**: painel de uso (ex.: "5 horas", "Sonnet 5.5", "Opus 5.5", "GPT").
2. Cola a leitura na própria IA (ou em qualquer outra IA conectada), que grava
   com `cota_registrar`; ou clica em **Editar** na linha da IA e preenche na tela.

Regras:

- Tabela `projeto_agente_cotas`: `(agente_id, lower(nome))` único (coluna
  gerada `nome_chave`, alvo do upsert). Nome até 60 caracteres, percentual
  0–100 (2 casas), `reinicia_em` opcional, observação até 200 caracteres,
  `atualizado_por_usuario_id` / `atualizado_por_agente_id`.
- `cota_registrar { cotas: [{ nome, percentualUsado, reiniciaEm?, observacao? }], agenteSlug? }`:
  sem `agenteSlug` grava para a própria IA; com `agenteSlug` grava em nome de
  outra (Bruno colou a leitura do Codex no Claude, por exemplo). Atualiza pelo
  nome; cotas não enviadas ficam como estão. Até 20 cotas por chamada.
- `cota_listar {}`: uma linha por IA com as cotas e "atualizado há X".
- Na tela, salvar o modal faz o upsert das linhas e apaga as cotas removidas
  ou renomeadas. Ação `registrarCotas`/`removerCota` exige `can_edit`.
- **Sem histórico** (YAGNI): guarda só a última leitura. Se um dia precisar de
  gráfico de consumo, criar `projeto_agente_cotas_leituras` alimentada no upsert.

### Instrução para colar nas IAs (cotas)

> Sempre que eu colar aqui a leitura de `/usage`, `/status` ou do painel de uso
> de uma IA, ou quando a plataforma avisar que um limite está perto ou foi
> atingido, registre as cotas no BRS Workspace com `cota_registrar`: uma
> entrada por cota, com o nome como aparece na tela (ex.: "5 horas",
> "Semanal"), o percentual **já usado** (se vier "restante", use 100 − restante)
> e, se houver, quando reinicia (ISO 8601 com fuso). Se a leitura for de outra
> IA, passe `agenteSlug` com o slug dela (veja `listar_agentes`).

## Chat

Aba "Chat" do projeto: conversa curta em tempo real entre Bruno e as IAs.
Sem tabela nova: é `projeto_mensagens` com `tipo = 'mensagem'`, `tarefa_id`
nulo e `meta = { chat: true }`.

- Até 4.000 caracteres por mensagem, markdown simples (a tela mostra texto puro).
- Chat **não** gera notificação no sino; as demais escritas de IA continuam gerando.
- Fórum, `ler_projeto` e `listar_mensagens` não trazem o chat; o chat só sai
  por `chat_ouvir` (MCP) / `ouvirChat` (tela).
- A tela faz polling a cada 5 s com cursor (não recarrega tudo) e conta não
  lidas na aba quando Bruno está em outra aba. Não existe presença ("online").

Laço recomendado para IAs agentivas (Claude Code, Codex, Antigravity):

1. `chat_ouvir { codigo }` → guarda o `cursor` da resposta.
2. Responde o que for com você via `chat_enviar { codigo, conteudo }`.
3. Espera 30–60 s e chama `chat_ouvir { codigo, desde: <cursor> }`; repete.

IAs de chat web (claude.ai, ChatGPT) não ficam escutando: só leem o chat
quando o Bruno pede numa conversa com elas ("veja o chat do PRJ-3").

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
