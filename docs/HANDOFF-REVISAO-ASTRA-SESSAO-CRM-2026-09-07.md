# Handoff para revisão externa (Astra) — sessão "CRM AlvoConsig / engine", 02–07/09/2026

> Resumo do que ESTA sessão fez, para revisão independente. A sessão do
> Workspace (BRS Messenger Fases A/B, folha, etc.) manda o resumo dela à parte.
> Repos: `brs-alvoconsig` (apps/web = CRM Next.js na Vercel; services/engine =
> ponte Baileys/Chatwoot no Railway) e `brs-workspace` (só migrations do
> Supabase compartilhado + limites por parceiro). Todos os commits abaixo estão
> na `main` dos respectivos repos e em produção.

## 0. Fora do escopo desta revisão

Commits de 05/09 no `brs-alvoconsig` `1725ca7`, `5655770`, `ed9ad89`,
`65572b5`, `1098f15`, `f7b888c`, `b3a4e57` (fundação do chat externo, etapas
4–6) são da sessão "chat AlvoConsig" coordenada pelo próprio Astra — não
entram aqui. Commits de 02/09 anteriores a `ec33122` (kanban sticky, tipos de
campanha de voz renomeados, usuário recém-criado, simulador com seletor de IF,
"Visão de Oferta" no wizard) são correções da planilha de bugs feitas nesta
sessão; podem ser revisados, mas têm prioridade baixa.

## 1. Frentes entregues (ordem cronológica)

### 1.1 Projeto de velocidade (02/09) — 3 fases

| Fase | O quê | Commits | Migration |
|---|---|---|---|
| 1 | Chat Interno chega ao vivo via Supabase Realtime (Postgres Changes); poll vira rede de segurança 30s | `41e3b50`, `bc7720f`, `f2a910d`, `ec33122` | `20260903010000` (RLS SELECT em `crm_chat_mensagens` só p/ membro ativo) |
| 3 | Cache de sessão do CRM ganha L2 compartilhado (Upstash Redis via REST, integração Vercel Marketplace); sem envs vira no-op | `25f1527`, `40d8036` | — |
| 2 | Atendimento WhatsApp entrega mensagem nova por sinal leve (`chat_atendimento_sinais`) emitido pelo engine no webhook `message_created`; navegador refaz o fetch que já existia | `a2da200` | `20260903020000` |

Arquivos-chave: `apps/web/src/lib/auth/sessao-cache.ts` (aceita
`KV_REST_API_*` e `UPSTASH_REDIS_REST_*`), `services/engine/src/bridge.ts`
(`emitirSinalAtendimento`, antes dos filtros de direção).

Erro corrigido no caminho: envio no grupo "equipe" levava 9–12 s porque toda
mensagem regravava `crm_chat_membros` (contenção) + bug de paginação
(`41e3b50`/`bc7720f`). Engine: todo envio regravava `ultimo_erro=null` mesmo já
nulo (`93941e5`).

### 1.2 Disparo de WhatsApp Não Oficial (03/09)

Regras do Bruno: mínimo 3 números de disparo, 3 templates por número; rodízio
quadrado-latino número×template (volta seguinte desloca o template); delay
sorteado uniforme em ms, nunca igual ao anterior, sem tendência; disparo NÃO
aparece no Atendimento até o cliente responder.

- Commits: `6e52945` (núcleo), `7db7a0d` (segundo template sobrescrevia o
  primeiro — confirmado no banco), `4184418` (contador da regra 3+3 sem F5),
  `322c23b` (CRM lê limites do parceiro), `b3c2fc9` (tela de Caixas de Entrada
  abria em ~1 min: Server Actions em `Promise.all` são serializadas pelo Next
  por cliente + poll que se auto-redisparava → fan-out movido pro servidor
  em `statusInstanciasParceiro()`).
- Migrations (brs-workspace): `20260903144646` (`chat_conversas.origem/
  respondida`, `crm_campanha_disparo_instancias`, `crm_campanha_disparo_
  templates`, `crm_disparo_fila`), `20260903203242` (`crm_parceiro_config`:
  `max_instancias_receptivas`=2, `max_instancias_disparo`=10,
  `disparo_min_instancias`=3, `disparo_min_templates_por_instancia`=3, CHECKs).
- Arquivos: `apps/web/src/lib/crm/disparo.ts` (`montarRotacao`,
  `sortearDelayMs`, `avaliarRequisitosDisparo`), `disparo-shared.ts`
  (`persistirComposicaoDisparo` materializa a fila com `agendado_para`
  cumulativo), `limites-parceiro.ts`, `app/api/cron/disparo-whatsapp/route.ts`
  (1 item por parceiro por tick, claim por update condicional, 3 tentativas),
  `lib/chat/engine.ts` (`enviarDisparo` com `origem:'disparo'`).
- Decisão de produto: campanha em andamento NÃO é afetada por mudança de regra
  (a composição é materializada na criação). Limites são editados no Workspace
  (Agente Corban → aba AlvoConsig).
- **Recusado por mim e aceito pelo Bruno:** "camuflagem" (números da empresa
  respondendo uns aos outros pra inflar métrica de resposta do WhatsApp). Não
  existe no código. Astra: se encontrar algo nessa direção, é bug, não feature.

### 1.3 Discadora / campanhas de voz (05/09)

Modelo: a discadora (CallFace) é dona de discar/ritmo/retentativa (não somos
nós — corrigido pelo Bruno: discadora liga sem parar enquanto a campanha está
ativa); a campanha define o quê/pra quem; a configuração do provedor é um
adaptador. 5 tipos de voz: 3 terminam em atendente humano (overlay leve:
nome, convênio, 3 margens, script em destaque, tabulação, botão "abrir no
atendimento" — só texto), 2 terminam em WhatsApp (mensagem única pela
instância RECEPTIVA, template canal `voz_whatsapp` isolado, round-robin
simples, SEM delay artificial, **fail-closed**: qualquer receptiva escolhida
desconectada → pausa a campanha inteira com `pausa_motivo`).

- Commits: `100bd26` (overlay `ChamadaAoVivo.tsx` montado no layout do
  atendente, Realtime INSERT em `crm_chamadas` filtrado por
  `crm_usuario_id`), `4a6b97f` (opt-in voz→WhatsApp), `db3339f` (revisão
  Fable, 5 correções), `25de4b5` (ramal + telefone ambíguo).
- Migrations: `20260905160000_crm_discadora` (`crm_usuarios.ramal_discadora`
  único parcial; CHECK de canal ganha `voz_whatsapp`; `crm_chamadas` com
  desfecho atendente|whatsapp, status conectada|tabulada|encerrada|perdida,
  `id_externo` único por provedor, RLS via `app_private.crm_usuario_do_auth()`,
  realtime), `20260905190449` (`crm_campanhas_parceiro.pausa_motivo`).
- Arquivos: `apps/web/src/lib/crm/voz-whatsapp.ts` (`enviarOptinVoz`),
  `app/api/discadora/evento/route.ts` (webhook genérico da discadora),
  `components/crm/discadora/ChamadaAoVivo.tsx`, `lib/crm/actions.ts`
  (`setAtendenteRamalDiscadora`).

**Erros encontrados na revisão Fable (`db3339f`) e corrigidos:**
1. Opt-in de mídia saía por `enviarDisparo` (origem 'disparo') → conversa
   ficava OCULTA no Atendimento até o cliente responder, o oposto do desenho
   ("disparo quente"). Criado `enviarMidia` sem origem.
2. Busca de lead por telefone exigia igualdade exata → nunca achava (formatos
   divergentes). Agora `ilike %sufixo8` + `telefoneIgual`, ordenado por
   `updated_at desc`; ambíguo → o mais recente (decisão do Bruno).
3. Corrida de idempotência no webhook: verificava-depois-inseria → evento
   duplicado enviava duas vezes. Agora insert-first; `23505` = duplicado.
4. Opt-in que falhava não deixava rastro. Agora chamada fica `perdida`.
5. Token do webhook comparado com `===`. Agora `timingSafeEqual`
   (`DISCADORA_WEBHOOK_TOKEN` / header `x-discadora-token`).

### 1.4 Grupos do WhatsApp para o BRS Messenger (06–07/09) — engine

Contratos (escritos pela sessão do Workspace):
`brs-workspace/docs/RECADO-ENGINE-GRUPOS-BRS-MESSENGER.md` e
`RECADO-ENGINE-ACK-REACAO-APARELHO.md`. v1 só Baileys (Z-API não opera grupo,
devolve 501; zero instâncias Z-API em produção).

| Entrega | Commit engine | O quê |
|---|---|---|
| 1 | `7275e41` | `GET /instancias/:id/grupos/:jid` (metadata+membros); gate `podeGrupos` por `owner_tipo` (conta BRS opera grupo em qualquer instância, sem filtrar por `papel`); `content_attributes.sender` em mensagem de grupo; erros de domínio `{erro, codigo}` via `ErroGrupo` + `setErrorHandler` |
| 2 | `5b77273` | participantes (add/remove/promote/demote), link de convite, sair, criar grupo, `GET .../contatos` (cache em memória por sessão, `contacts.upsert/update`) |
| 3 | `45fdb54` | `mentions`/`quoted` no `POST /enviar` (`quoted.messageId` = id do Chatwoot, resolvido pro `wa_id` via mapa); inbound extrai `contextInfo` → `in_reply_to`/`mentions` |
| 4 | `45fdb54` | `origem:'aparelho'` (fromMe que chega em `inboundBaileys` = outro aparelho vinculado); ack `messages.update` → `chat_mensagem_status` ("só avança"); reação `messages.reaction` → `chat_mensagem_reacoes` (emoji vazio = delete) |

Pré-requisito que o contrato assumia existir e NÃO existia: mapeamento
`wa_id ↔ chatwoot_message_id`. Criei `chat_mensagens_mapa` (migration
`20260907030221`, brs-workspace `3ab2414`), gravada logo após cada
`enviarMensagem` no Chatwoot (único call site: `espelharMensagemNaConversa`).
RLS: `revoke all` de public/anon/authenticated, grant só `service_role`
(mesmo padrão da Fase B). Insert engole `23505`.

`ORIGENS_PROPRIAS_ENGINE = ['engine','aparelho']` (`bridge.ts`) é a guarda de
eco — o Workspace NUNCA deve usar `!== 'engine'` como critério.

**Erros encontrados na revisão Fable (`f1d6bb9`, 07/09) e corrigidos:**
1. `mapearErroWhatsapp` lia `boom.output.statusCode`, mas `assertNodeErrorFree`
   do Baileys lança `new Boom(text, { data: +code })` — o código do WhatsApp
   fica em `data` e `statusCode` é sempre 500. `NAO_ADMIN`/`NAO_MEMBRO` eram
   código morto: tudo virava `FALHA_WHATSAPP 502`. Agora lê `data` (fallback
   `statusCode`) e distingue operação: 403 em leitura (`groupMetadata`) =
   `NAO_MEMBRO`; em gestão (participantes/convite/sair) = `NAO_ADMIN`.
2. Reação atribuída à pessoa errada: fallback caía em `r.key` (key da mensagem
   REAGIDA → autor original) e reação nossa (`reaction.key.fromMe`) num 1:1
   caía no jid do contato. Agora fromMe → nosso JID (`sock.user.id`), nunca cai
   em `r.key`.

Verificados e aprovados sem mudança: guarda de eco (única comparação de
origem no engine; worker durável passa por `outboundDoChatwoot` → mesma
guarda); cobertura do mapa; premissa do 'aparelho' (`messages.upsert` filtra
`type !== 'notify'` — eco do próprio envio vem como 'append' — antes do
`enviadasPorApi`).

## 2. Estado atual (07/09, 11:35)

- Tudo acima em produção: Vercel (`brs-alvoconsig`) e Railway (engine, deploy
  `1b5d3d83` SUCCESS, 2 instâncias reconectadas). Migrations todas aplicadas.
- Worktrees desta sessão: `brs-alvoconsig-grupos` + `brs-workspace-grupos`
  (branch `grupos/engine-brs-messenger`), `brs-alvoconsig-discadora` +
  `brs-workspace-discadora` (branch `discadora/integracao`). Pastas principais
  em `main`, só estação de merge.

## 3. O que falta (desta sessão)

1. **Discadora — adaptador CallFace** (bloqueado até terça): respostas do
   suporte sobre webhook no atendimento com ramal, API de pausar mailing
   (propagar a pausa fail-closed até a discadora), API de listar agentes (pra
   preencher `ramal_discadora` sozinho). Env `DISCADORA_WEBHOOK_TOKEN` na
   Vercel antes do 1º teste.
2. **Wizard de campanha de voz** (5 tipos, tela de template `voz_whatsapp`
   dentro da campanha, seleção de receptivas) — não iniciado.
3. **Follow-up do mapa:** coluna `participant_jid` em `chat_mensagens_mapa`
   pra citar mensagem de terceiro em grupo com autor correto (migration).
4. Limpeza periódica de `chat_atendimento_sinais` e `chat_mensagens_mapa`
   (função existe pra sinais, não agendada; mapa não tem).
5. Domínio `engine.brspromotora.com.br` com TLS quebrado no Railway (app não
   usa; não urgente).
6. UI de grupos no Workspace é da OUTRA sessão (não iniciada).

## 4. Onde eu pediria ao Astra pra olhar com lupa

1. `services/engine/src/bridge.ts`: `espelharMensagemNaConversa` (derivação
   de `origem`, gravação do mapa) e `outboundDoChatwoot` (guarda de eco) — é
   o ponto onde um erro duplica mensagem no WhatsApp do cliente.
2. `services/engine/src/baileys.ts`: handlers `messages.update` /
   `messages.reaction` / `contacts.*` e o `enviar()` com `quoted`/`mentions` —
   tipos do Baileys 6.7.18 foram lidos do `node_modules`, não de doc.
3. `apps/web/src/app/api/discadora/evento/route.ts`: idempotência
   insert-first, `leadPeloTelefone`, fail-closed do opt-in.
4. `apps/web/src/lib/crm/disparo.ts`: `montarRotacao` (quadrado-latino) e
   `sortearDelayMs` — regras de negócio que o Bruno ditou textualmente.
5. `apps/web/src/lib/auth/sessao-cache.ts` + `session.ts`: invalidação do L2
   (troca de senha/permissão precisa derrubar o cache compartilhado).
6. Migrations `20260903144646`, `20260905160000`, `20260907030221`: RLS e
   índices únicos que sustentam a idempotência.

## 5. Decisões deliberadas (não são bugs)

- `atualizarStatusMensagem`: 'falhou' fica fora da ordem "só avança", então um
  'enviado' posterior sobrescreve 'falhou' (WhatsApp retenta). Ambíguo no
  contrato; escolhi permitir.
- `quoted.messageId` sem linha no mapa → envia SEM citação, silenciosamente
  (mensagem anterior ao mapa). Poderia devolver `aviso`.
- Z-API: fromMe não é rotulado 'aparelho' (zero instâncias em produção).
- Grupo com `addressingMode='lid'`: membros saem com `numero=null`/`eu=false`
  (LID→PN exigiria lookup extra).
