# ENTREGA — Agente de IA de qualificação/roteamento (CRM AlvoConsig) — Fase 1

> 06/10/2026. Revisão final (fatia 13) do Fable sobre o trabalho da noite de 05→06/10.
> Spec: `docs/SPEC-AGENTES-IA-CRM.md`. Diário da execução: `brs-workspace/.claude/tmp/agentes-ia-progresso.md`.
> **NADA foi publicado.** Tudo está em commits locais da branch `agentes-ia/fase-1` em duas worktrees:
> `brs-workspace-agentes-ia` (Workspace, 8 commits) e `brs-alvoconsig-agentes-ia` (CRM + engine, 15 commits).
> Estado final verificado: Workspace `tsc` limpo, `npm test` 310 (307 ok / 0 falhas / 3 skip); CRM `typecheck` limpo,
> `node scripts/test.mjs` 740 (739 ok / 0 falhas / 1 skip), `test:db` PASS (migrations + fixtures no Postgres docker).

## 1. O que foi entregue, por fatia

| # | Fatia | Repo | Commit(s) | Resumo (1 linha) |
|---|---|---|---|---|
| 1 | Schema base | WS | `af22c71d` | Migration `20261005021849_agentes_ia_fundacao.sql`: flags do parceiro, `chat_instancias.agente_ia_ativo`, `chat_conversas.atendente_atual_id/origem_anuncio/link_entrada_id`, origem `'ia'` em `crm_contatos`, tabelas `ia_*` (perfil padrão v1 + versões + BC geral) e `crm_agente_*`/`chat_agente_conversas`, RPCs `crm_agente_rodizio_proximo`/`crm_agente_turno_claim`, RLS, permissões `config.agente_ia` + `comercial-agentes-ia` |
| 1 (teste) | Teste SQL | CRM | `7271408` | `tests/db/agentes-ia.sql` (31 asserções: perfil v1, RLS, claim concorrente, rodízio) |
| 2 | Flag no Workspace | WS | `bc951611` | `funcionalidadeAtiva()` + bloco "Funcionalidades" (Agente de IA / Site OS-Consig: desligado/teste/pago + "até") na aba AlvoConsig |
| 3 | Menu + telas padrão/BC | WS | `3441bcb1` | Menu Comercial › Agentes de IA (4 pontos), `src/lib/ia/perfis.ts`, `/agentes-ia/perfis` (editor + versões) e `/agentes-ia/conhecimento` (contador 6.000 tokens) |
| 4 | Tela CRM | CRM | `b47a5d7` | Configurações › Agentes de IA: Caixas, Perfil, Roteamento, Modelo (logos em pastilha clara, passo a passo, teto/dia, fallback gratuito + aviso LGPD), Links wa.me `[#COD]` |
| 5 | Cliente LLM + prompt + validador | CRM engine | `f5fb83a` | `ia-cliente.ts` (OpenRouter/Groq, fallback 429/402/5xx/timeout, 401/403 para), `prompt.ts` (`<lead>`), `validador.ts` + fixtures compartilhadas |
| 6 | Simulador | CRM web | `4fbe314` | Aba Simulador (perfil em edição, nada gravado), duplicata prompt/validador (mesmas fixtures), "Testar chave", guard `config.agente_ia` |
| 7 | Gate + loop + canal + handoff | CRM engine | `befbd3e`, `babb089` | `agente-ia/*` (gate, worker com claim/lease, política por canal, handoff humano) ligado em `bridge.ts`/`server.ts`/`index.ts` atrás da flag por parceiro (freio global `AGENTE_IA_DESLIGADO`) |
| 8a | Migration presença/espera | WS | `47d9fec6` | `20261005023447_agentes_ia_presenca_espera.sql`: `crm_presenca` (+Realtime), X/Y em `crm_parceiro_config`, RPCs `crm_presenca_*`, `crm_agente_espera_entregar`, notificação módulo `agente_ia` |
| 8a (teste) | Teste SQL | CRM | `3ee2957` | `tests/db/agentes-ia-presenca.sql` |
| 8 | Presença | CRM web | `fea7217` | Heartbeat 60 s, modal "Ainda está em atendimento?", pausa, visão do master (Realtime), cron `/api/cron/crm-presenca` |
| 9 | Roteamento | CRM | `79ca74e` | master / fixo / rodízio (pula offline e lotado) / espera; entrega ao 1º online; aviso ao master; dono do pré-lead |
| 10a | Pré-cadastro + documentos + etiquetas | CRM engine | `c8cc940`, `0a9d696` | Teto de gasto ligado às deps reais (fail-closed); `crm_contatos` origem `ia` sem WeSales; observação; documentos (15 MB, só host do nosso Chatwoot); etiquetas; entrega periódica da espera |
| 10b | Web | CRM web | `82df05d` | Modal Criar Lead pré-preenchido, aba "Com a IA", balão violeta, "Devolver ao agente de IA", "Completar e cadastrar no WeSales" |
| 11 | Origem do anúncio + links | CRM engine | `7b5a276` | `entrada-origem.ts` (Baileys/YCloud/Z-API + código `[#COD]`), gravado só na criação da conversa |
| 12 | Horário, opt-out, teto | CRM engine | `292c776` | `limites.ts`: fora do expediente (1x/dia, lease retido), opt-out por texto, teto/dia → modelo gratuito ou Fila |
| 13 | Revisão final | CRM | `9493650` | Correções desta revisão (ver §2) |
| — | Spec | WS | `3ccdb25b`, `0eca49ba`, `fb7d6a53`, `be973d0b` | `docs/SPEC-AGENTES-IA-CRM.md` |

## 2. Revisão final — achados e o que foi corrigido (commit CRM `9493650`)

Nenhum achado Crítico. Nada foi encontrado que permitisse a um parceiro ler ou escrever dados de outro pelas
telas (toda server action parte de `sessao.agenteParceiroId` e filtra por ele; as RPCs novas são `security
definer` com `search_path=''`, só `service_role`, e `crm_agente_espera_entregar` checa que o usuário é do
parceiro). Os 3 avisos automáticos de segurança sem detalhe foram investigados:

| Sev. | Onde | Achado | Estado |
|---|---|---|---|
| Alto | `services/engine/src/agente-ia/handoff.ts` (`sincronizarDono`) → `dados.ts definirAtendenteAtual` | O id do dono vinha do e-mail do assignee no webhook do Chatwoot sem checar que o `crm_usuario` é do mesmo parceiro da conversa (aviso "cross-tenant-authorization"). Só exploraria se um agente Chatwoot de um parceiro fosse adicionado à conta de outro, mas o webhook não pode escolher tenant. | **Corrigido**: grava só se `crm_usuarios.agente_parceiro_id` = parceiro da instância da conversa; senão ignora e loga |
| Alto | `handoff.ts marcarHumano` | Humano assumia conversa `pending` (atribuir/responder) e o engine não reabria: a conversa sumia de Meus/Fila (listam `open`) e de "Com a IA" (linha deixa de ser viva). | **Corrigido**: se o Chatwoot está `pending`, volta a `open`; o webhook `open` que retorna é ignorado (linha não é mais viva). Teste novo em `handoff.test.ts` |
| Médio | `validador.ts` (engine) + `agente-ia-prompt.ts` (web) | Contornos do filtro de proibições (aviso "output-filter-bypass"): "dois por cento", "1,5 por cento", "mil reais" sem dígito, "R $ 1 . 000", "$1,000"/"dollars", "pré-aprovado", "aprovação", "aprovar", "approved", leet ("aprov4do", "g4rantido"), "garanto", caracteres invisíveis (zero-width/soft hyphen) no meio da palavra. | **Corrigido** nas duas cópias (mesmas fixtures; 5 casos novos em `__fixtures__/respostas-modelo.json`). Fica fora: homóglifos cirílicos e emoji entre dígitos (improváveis na saída de um LLM; registrar como Fase 2 se aparecer no log `violacao`) |
| Médio | `chatwoot.ts baixarAnexoDoChat` | Download de anexo sem teto de bytes nem timeout (aviso "resource-bound"); só o `file_size` declarado era checado antes. | **Corrigido**: 15 MB por Content-Length e pelo corpo + `AbortSignal.timeout(30 s)`; host restrito ao nosso Chatwoot já existia; máx. 10 anexos/conversa, só do lead, só mimes do CRM |
| Médio | `atendimento-actions.ts getAgenteIaDaConversa` / `devolverAoAgenteIa` | `.maybeSingle()` em `chat_agente_conversas` por conversa quebra (PGRST116) quando há histórico (encerrada + nova linha após 24 h). | **Corrigido**: `order created_at desc limit 1` |
| Baixo | `AgenteIaBarra.tsx` | Poll de 20 s chamava `exigirConversaAutorizada` (1 GET no Chatwoot) além do poll do `ConversaCentro`. Trocar por checagem local não é seguro (a visibilidade do lead depende do assignee no Chatwoot). | **Mitigado**: 60 s + recarga após ação |
| Baixo | `presenca-shared.ts validarPresencaMin` | Exigia Y > X, mas o banco soma X+Y (Y conta a partir do modal). | **Corrigido**: Y ≥ 1; rótulo da tela ajustado; teste atualizado |
| Baixo | `SimuladorAba.tsx` | Simulador ≠ engine (uma chave p/ todos os modelos, sem fallback gratuito, cidade "Brasil", sem horário/limites/roteamento) não estava dito na tela. | **Corrigido**: frase no aviso amarelo |

Verificado e **sem correção necessária**:
- **Chave global invertida (decisão do Bruno, 06/10/2026)**: `AGENTE_IA_ATIVO` foi REMOVIDA. O liga/desliga do dia a dia é só a flag por parceiro (`ia_agente_status` teste|pago + `ia_agente_ate` vigente; nasce `desligado`) + caixa ativa. A env agora é o freio `AGENTE_IA_DESLIGADO=true|1|sim` (getter `agenteIaDesligadoGlobal`, ausente = segue as flags), checado em `gate.ts` (fail-closed, 1º item), `worker.ts` (`autorizadoAgora`, a cada turno) e `aoReceberMensagem`. Os ticks (agente, espera, entrega periódica) sobem SEMPRE; ocioso = 1 RPC de claim indexada a cada 2 s e, nos ganchos do bridge, `agenteEmUso` (cache 60 s: 2 consultas leves/min) corta tudo quando nenhum parceiro está habilitado e não há conversa viva.
- `funcionalidadeAtiva` (WS e engine) e `funcionalidadeLiberada` (CRM web): mesma regra teste|pago e `ate` nulo/futuro (diferença `>=`×`>` no segundo exato é irrelevante).
- Segredos: a apiKey é decifrada só em `dados.chaveLlm`, nunca gravada em `crm_agente_log` (`tirarChave` nos erros do cliente LLM; corpo de erro HTTP não entra em log); token do Chatwoot nunca sai de `ChatwootConta`; o corpo da resposta do `/enviar` não é logado.
- Prompt injection: `<`/`>` do lead virados em `‹›`, marcador `[ATENDENTE HUMANO]` neutralizado, modelo sem ferramentas, enum fechado, `resposta` ≤ 900, CPF pedido no turno 1 removido, `concluido`/intenção terminal decididos pelo código.
- Fail-closed: todo erro do turno → `falharParaFila` (mensagem fixa do perfil se já falou + `open` sem dono + nota + log); falha do próprio fim → lease curto e nova tentativa, nunca silêncio.
- Limites gravados: `campos_coletados` (≤120 chars por valor, nome ≤60), observação ≤2000, `json_devolvido` com resposta ≤900 e CPF mascarado, motivos `slice(200/300)`.
- RLS: `crm_agente_*`/`chat_agente_conversas`/`crm_links_entrada`/`crm_agente_optout` só service role; `ia_*` por `app_private.has_permission('comercial-agentes-ia')`; `crm_presenca` leitura por tenant (`app_private.crm_agente_parceiro_do_usuario()`, função já existente desde 20260903020000).
- `crm_agente_turno_claim` não recebe parceiro de propósito (claim global do engine, service role) — o tenant está na linha devolvida.

> **Decisão 06/10/2026 (Bruno):** flag por parceiro no Workspace é o único liga/desliga do dia a dia (nasce `desligado`);
> `AGENTE_IA_ATIVO` removida, `AGENTE_IA_DESLIGADO` é freio de emergência; heartbeat de presença 60 s (era 30 s; com X
> de presença = 1 min o atendente ativo pode oscilar para "ausente" — usar X ≥ 2 min).

## 3. Pendências registradas (não implementadas — decisão/escopo)

1. **`convenio_por_produto` (fatia 10a) não existe no perfil padrão nem nas telas.** `convenios` é tabela GLOBAL
   (todos os convênios da BRS), então "único convênio ativo" praticamente nunca acontece → **hoje o pré-cadastro
   automático em `crm_contatos` NÃO vai ocorrer**; o lead fica sem contato e o humano usa o modal "Criar Lead"
   pré-preenchido (nome/sobrenome/CPF/e-mail/horário; o convênio só é sugerido quando o produto/vínculo casa com
   UM nome). Expor o mapa exige decidir onde ele vive (o engine lê `coleta[produto].convenio_por_produto`; os
   overrides são caminhos planos e `coleta` é array) → Fase 2, sem migration.
2. **`documentos_pendentes`**: quando o lead manda anexo e não há contato, a referência fica em
   `crm_agente_log.json_devolvido.documentos_pendentes`; o modal/"Criar Lead" ainda não copia esses anexos para
   Arquivos (o humano usa o botão de salvar anexo existente). Fase 2.
3. **Concorrência com N réplicas do engine**: o rodízio usa lock em memória por parceiro (1 réplica hoje); com N
   réplicas `max_abertas` pode estourar em 1–2 conversas numa corrida (o ponteiro SQL continua atômico). A entrega
   da espera é atômica no banco (skip locked). Upgrade = RPC única.
4. **Atribuição dupla Chatwoot × CRM**: `chat_conversas.atendente_atual_id` é mantido por engine (webhook) e CRM
   (actions). Assignee nulo no webhook NÃO limpa o dono (o `open` do próprio engine chega antes da atribuição);
   desatribuir à mão limpa pela action do CRM. Conversas resolvidas fora do CRM só limpam o dono se o webhook
   `conversation_status_changed` chegar.
5. **Chatwoot `pending`**: conversa `pending` recebendo mensagem do lead pode piscar na Fila se o Chatwoot a
   reabrir; o engine reafirma `pending` (handoff). Confirmar em homologação.
6. **Z-API referral**: campo não documentado, normalizador defensivo, sem teste real.
7. **YCloud**: lead só-BSUID (sem telefone normalizável) não recebe o agente (gate `telefone_indeterminado`);
   fora da janela de 24 h o agente não fala (template = Fase 2) e encerra com nota.
8. `composing` do Baileys e `response_format: json_object` não implementados (atraso de digitação sem presença).
9. Simulador: rate limit em memória por instância serverless (aproximado).
10. Filtro: homóglifos/emoji entre dígitos não cobertos (ver §2).

## 4. ORDEM DE PUBLICAÇÃO (Bruno) — passo a passo

Pré-requisitos checados nesta revisão: a `main` do Workspace está em `b8ee1832` (= base das duas branches); a
migration mais nova na `main` é `20261004011529_api_meta_permissao.sql`, anterior às duas novas → **não precisa
`--include-all`** (se outra sessão mergear migration mais nova antes, aí precisa).

### 4.1 Antes de tudo (manual, fora do código)
1. Chatwoot (conta 8, inbox 25 da NuAzul): **`enable_auto_assignment` OFF** (Settings › Inboxes › inbox 25 ›
   Collaborators › "Enable auto assignment" desmarcado). Sem isso o Chatwoot atribui sozinho na hora do
   `pending → open` e o gate do agente passa a bloquear com `tem_atendente`.
2. Conferir que o webhook da inbox API entrega `conversation_updated`/`conversation_status_changed` ao engine
   (log do engine mostrava "webhook Chatwoot ignorado: evento inesperado" para eles — bom sinal).
3. (Recomendado, à parte) fixar a tag da imagem do Chatwoot (hoje `:latest`, 4.18) antes de depender do
   comportamento de `pending`/labels.

### 4.2 Banco (Workspace, pasta principal — NUNCA na worktree)
```bash
cd "SITES/BRS GESTÃO/brs-workspace"            # main
git merge agentes-ia/fase-1                     # traz as 2 migrations + flag + menu + perfis.ts
ls supabase/migrations | tail -5                # 20261005021849 e 20261005023447 devem ser as últimas
npx supabase migration list                     # as 2 novas aparecem só em Local
echo Y | supabase db push                       # aplica as 2 em sequência (fundação antes de presença)
npx supabase migration list                     # confirmar que as 2 constam em Remote
```
Validar no SQL editor (leitura): `select tipo, versao from ia_agente_perfis_padrao;` → `qualificacao | 1`;
`select count(*) from ia_conhecimento_geral;` → 3.

### 4.3 Workspace (deploy)
```bash
git push                                        # Vercel faz o deploy da main
git branch -d agentes-ia/fase-1 && git worktree remove ../brs-workspace-agentes-ia
```
Depois do deploy: menu Comercial › Agentes de IA aparece só para quem tem `comercial-agentes-ia` (seed = quem
tem `sistema-usuarios-root`; dar a permissão a mais alguém em Usuários).

### 4.4 CRM web (Vercel) + engine (Railway) — só DEPOIS do db push
```bash
cd "SITES/BRS GESTÃO/brs-alvoconsig"          # main
git merge agentes-ia/fase-1
git push                                        # Vercel (apps/web) + Railway (services/engine) deployam
git branch -d agentes-ia/fase-1 && git worktree remove ../brs-alvoconsig-agentes-ia
```
Variáveis de ambiente:
- **Railway (engine)**: nada a criar para ligar. `AGENTE_IA_DESLIGADO` é só o freio de emergência (ausente = segue as
  flags). O deploy sobe inerte porque a flag nasce `desligado` para todos os parceiros; `/enviar` ganha a origem `agente_ia`.
- **Vercel (CRM web)**: nada novo. `CRON_SECRET` já existe (mesmo padrão dos outros crons). O cron
  `/api/cron/crm-presenca` (`1-59/2 * * * *`, `maxDuration` 10 s, 1 RPC) entra pelo `vercel.json`; respeita o
  invariante intervalo ≥ maxDuration; os minutos ímpares desalinham dos crons `*/1`... — se preferir menos
  frequência, `*/3` ou `*/4` funciona (o estado "ausente/offline" só fica atrasado para o Realtime; o roteamento
  calcula presença na leitura).
- Logos: `apps/web/public/logos/openrouter.png` e `groq.png` já estão no commit `b47a5d7`.

### 4.5 Ligar para o laboratório (NuAzul), nesta ordem
1. Workspace › Agente Corban › NuAzul › aba AlvoConsig › Funcionalidades › **Agente de IA = teste, até
   31/12/2026** (grava `ia_agente_status/ia_agente_ate`). Site OS-Consig fica desligado.
2. CRM (login master NuAzul) › Configurações › Agentes de IA:
   - **Modelo**: chave OpenRouter da NuAzul (exige `config.editar_canais`), "Testar chave"; modelo principal e
     fallbacks; teto/dia (padrão US$ 5); fallback gratuito opcional (aviso LGPD).
   - **Roteamento**: modo (sugestão lab: `rodizio` com a ordem dos atendentes, ou `master`), `max_abertas`,
     `espera_master_min`, X/Y de presença.
   - **Simulador**: rodar as 10 conversas-roteiro (§9.2 da spec) ANTES de ligar a caixa.
   - **Links**: criar 1 link de entrada (`[#COD]`) para o teste.
   - **Caixas**: ligar `agente_ia_ativo` SÓ na caixa Baileys de teste da NuAzul.
3. Nada na Railway: a flag `teste` do passo 1 + a caixa do passo 2 já liberam o agente (efeito em ≤ 60 s pelo cache).

### 4.6 Como DESLIGAR rápido (do mais rápido ao mais amplo)
1. **Workspace › aba AlvoConsig**: Agente de IA = desligado (todas as caixas do parceiro; efeito em até ~60 s pelo cache).
   A conversa já em curso cai na Fila com motivo `transbordo`, sem silêncio.
2. **CRM › Caixas**: desligar a caixa (mesmo efeito, ≤ 60 s, só aquela caixa).
3. **Railway (freio de emergência, todos os parceiros)**: `AGENTE_IA_DESLIGADO=true` + redeploy do engine. Com o freio o
   engine não atende ninguém novo e entrega as conversas vivas à Fila (`transbordo`, sem LLM), inclusive as que
   esperavam o lead; a entrega de `aguardando_atendente` a atendentes online continua.
4. Rollback de código: `git revert` do merge; as migrations são aditivas (colunas/tabelas novas) e podem ficar.

## 5. Checklist de homologação (NuAzul, número pareado do Bruno — §9.3 da spec, atualizado)

Pré: flag `teste`, caixa Baileys da NuAzul com `agente_ia_ativo`, chave OpenRouter válida,
auto-assignment OFF, o número do Bruno SEM lead na NuAzul (ou apagar/soft-delete o contato de teste antes).

1. [ ] Abrir o link de entrada (`wa.me/...?text=... [#COD]`) e mandar a 1ª mensagem → resposta em ≤ 10 s com
   "assistente virtual" + nome; no Chatwoot a conversa fica `pending` com etiqueta `ia-em-atendimento`; no CRM ela
   NÃO aparece em Fila/Meus e aparece em **"Com a IA"** ("IA conversando"); `chat_conversas.origem_anuncio.link_codigo`
   = COD e `link_entrada_id` preenchido (contador "30 dias" na aba Links sobe).
2. [ ] Mandar 3 mensagens em 3 s → UMA resposta (agrupamento 4 s).
3. [ ] Mandar um áudio → resposta fixa "não consigo ouvir…", sem LLM (log sem `turno` com modelo).
4. [ ] Pedir taxa ("qual a taxa?") → a resposta não traz %/valor; `crm_agente_log` tem evento `violacao` se o modelo
   tentou.
5. [ ] Completar a qualificação (nome+sobrenome, produto, vínculo; CPF de teste válido) → nota privada "Decisão: …",
   etiquetas `ia`, `ia-concluido`, `intencao:*`, `produto:*`, `origem:link`; conversa `open` **atribuída** ao
   atendente online (rodízio) e notificação (sino) para ele. **Esperado hoje: sem `crm_contatos`** (convênio
   indeterminável, §3.1) — na conversa, a barra violeta mostra os campos; "Criar lead" vem pré-preenchido.
6. [ ] Repetir com TODOS offline (fechar as abas de atendimento / pausar) → mensagem de espera; conversa `open` sem dono
   na Fila com etiqueta `ia-aguardando`; mandar outra mensagem → UMA resposta "a caminho"; abrir a aba de atendimento
   com um atendente → ele recebe (assign + notificação "Lead da IA entregue a você"); após `espera_master_min` sem
   ninguém → notificação urgente ao master + nota.
7. [ ] Humano assume no meio ("Assumir" ou responder pelo CRM) → IA cala (`humano_assumiu`, etiqueta `ia-pausada`),
   conversa volta a `open` e **aparece em Meus**; "Devolver ao agente de IA" → `pending` de novo, IA retoma com
   contexto (mensagens do humano marcadas).
8. [ ] Lead COM cadastro escreve → IA não responde (fluxo atual; log do engine `tem_lead`).
9. [ ] "Parar" → mensagem de opt-out, fim `parar`, `crm_agente_optout` gravado; próxima mensagem = silêncio da IA
   (conversa na Fila normalmente).
10. [ ] Trocar a chave por uma inválida → próximo turno cai na Fila com nota "Decisão: … erro_ia (credencial_llm_invalida)"
    e mensagem fixa ao lead (se a IA já tinha falado). Nunca silêncio.
11. [ ] Presença: sem interação por X min → modal; sem resposta por Y → offline (sem deslogar); Pausar/Retomar; o master
    vê em Roteamento › Presença da equipe (Realtime).
12. [ ] `crm_agente_log`: tokens/custo por turno, `troca_modelo_teto` se bater o teto (testar baixando o teto para
    US$ 0,01 com fallback gratuito configurado), **nenhuma apiKey** em `erro`/`motivo`/`json_devolvido`.
13. [ ] Desligar a caixa com uma conversa em curso → cai na Fila com `transbordo`, sem silêncio.

## 6. O que o Bruno precisa verificar com login real (telas não abertas no navegador pelos executores)

Workspace: menu Agentes de IA visível só com a permissão; editor do perfil padrão publica versão (v2) e "Restaurar"
volta; Base de Conhecimento mostra contador e aviso > 6.000 tokens; aba AlvoConsig grava `teste`/data.
CRM: página sem `config.agente_ia` → 403; abas Caixas/Perfil/Roteamento/Modelo/Links/Simulador renderizam nos DOIS
temas (logos em pastilha clara, Groq legível no escuro); salvar override grava só caminhos alterados e cria versão;
chave nunca volta ao cliente (só máscara); "Testar chave"; link wa.me abre o WhatsApp com o texto + `[#COD]` (exige
`numero` da instância com DDD); aba "Com a IA" para atendente sem `ver_todas`/`ver_sem_lead` fica vazia; balão
violeta no sino; modal Criar Lead pré-preenchido só em campo vazio; "Completar e cadastrar no WeSales" (só aparece
quando houver pré-cadastro origem `ia`, hoje raro — §3.1); barra de presença com Pausar/Retomar e o modal.

## 7. Decisões para o Bruno

1. Onde expor `convenio_por_produto` (perfil padrão no Workspace, tela do CRM, ou aceitar "sem pré-cadastro
   automático" na Fase 1) — hoje o pré-cadastro automático não ocorre (§3.1).
2. Frequência do cron de presença (`1-59/2` como está, ou `*/3`/`*/4`).
3. Fixar a tag da imagem do Chatwoot antes da homologação.
4. Mover `execute_sql`/`npx supabase *`/Vercel deploy de `allow` para `ask` no `.claude/settings.json` (aviso
   automático recorrente; não alterado).
