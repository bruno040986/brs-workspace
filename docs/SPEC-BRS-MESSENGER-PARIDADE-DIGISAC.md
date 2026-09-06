# BRS Messenger — paridade funcional com o Digisac (spec, 06/09/2026)

> Objetivo do Bruno: a **Central de Atendimento** do Workspace (BRS Messenger, aba
> Atendimento + `/conversas`) funcionalmente **idêntica ao Digisac**, mantendo a
> estética atual (tema `--msn-*`, que já está aprovado). Grupos precisam funcionar
> plenamente. Bot/URA/canvas ficam **depois** de toda a melhoria do Messenger.
>
> Base: prints do Digisac enviados em 06/09 + contrato da Fase 1
> (`BRS-MESSENGER-CONTRATO.md`) + fundação do chat AlvoConsig (handoff 05/09).
> Motor: Chatwoot self-hosted (Railway) + engine Baileys/Z-API
> (`brs-alvoconsig/services/engine`) — o engine é **compartilhado**, as regras
> de negócio **não** (ver §0). No BRS Messenger **toda conexão envia, recebe e
> opera grupos**; não existe a divisão receptiva/disparo do CRM. O módulo
> "Disparo de WhatsApp" do Workspace é outro sistema, com conexão própria.

## Decisões do Bruno (06/09)

| Tema | Decisão |
|---|---|
| Departamentos | Os do Digisac: **Administrativo e Financeiro, Atendimento, Comercial, Grupos, Informes, Recursos Humanos, Suporte**. Um atendente pode estar em vários. |
| Distribuição automática | **Padrão = manual** (atendente assume da fila). Distribuição automática existe como **toggle opt-in**, desligado por padrão. |
| Ordem | Primeiro **atendimento individual + grupos** iguais ao Digisac; **bot/URA/canvas só depois** de terminar o Messenger. |
| Grupos (a mais que a conversa individual) | ver membros · adicionar membros · copiar link do grupo · tornar admin · remover membro · sair do grupo · **@mencionar** membro · **responder citando** · botão **Criar grupo**. |
| Kanban de chamados | Interessante como visão alternativa, mas **depois do bot/URA** (fase F). |
| Tags automáticas | **Sim**: Parceiro Ativo/Inativo derivadas do cadastro via vínculo. E **sinalizar no grupo** quando o parceiro vinculado estiver inativo (§8). |
| Painel "Agora" | **Obedece permissão de usuário** — chave própria `conversas-agora` (REGRA FIXA nos 4 pontos), não herda de `conversas`. |

## 0. Princípio: fundação compartilhada, regras próprias

O BRS Messenger e o CRM AlvoConsig são **dois sistemas com objetivos diferentes**
que compartilham o motor (Chatwoot + engine + Supabase). O que se **reaproveita**
do plano Astra é a **fundação técnica**; o que **não** se importa são as regras de
negócio do CRM — mesmo quando parecem parecidas.

| Reaproveita (fundação) | NÃO importa (regra do CRM) |
|---|---|
| inbox durável de eventos (`chat_engine_jobs`, claim/finish/renew) | divisão **receptiva × disparo** de instâncias e o "receptiva nunca inicia" |
| envios idempotentes (`chat_envios_operacoes`) | rodízio de números, cadência, limite de envios/dia por instância |
| histórico próprio (`crm_pessoas`/`chat_timelines`) — como base de ticks/reações/citação | tráfego técnico entre números |
| leases de instância, upload direto (`chat_upload_tickets`) | tabulação de funil obrigatória no encerrar, lead/oferta/simulação |
| padrão de atribuição atômica e o desenho lease/claim de agendamento | "Meus" mapeado a `crm_usuarios` (aqui é `users` do Workspace) |

Consequências práticas: `chat_instancias.papel` e `permite_grupos` existem no
schema por causa do CRM — **para a conta BRS não governam nada**; toda conexão do
Messenger pode criar/gerir grupos e iniciar conversa. O engine **não** pode
filtrar operações de grupo por `papel` quando a instância for da conta BRS —
o gate é posse da instância (conta) + token.

## Como ler o mapa

Cada funcionalidade recebe uma **origem** — de onde a capacidade vem:
- **CW** = Chatwoot nativo (só expor na UI / configurar). Barato.
- **ENG** = engine (Baileys/Z-API) precisa expor. Repo do CRM (sessões `-chat`) — vira **recado com contrato**.
- **NOSSO** = tabela/regra própria no Workspace (schema = Fable).
- **UI** = trabalho de tela no Workspace (Sonnet).

## 1. Lista de conversas (sidebar)

| Digisac | Hoje | Origem | Nota |
|---|---|---|---|
| Abas **Chats / Fila / Contatos** com contadores | Meus / Fila / Geral (sem Contatos, sem contador) | CW + UI | `GET /conversations/meta` dá `mine_count`/`unassigned_count`/`all_count`. Aba **Contatos** = `GET /contacts` + busca + "Criar novo". Manter "Geral" como visão de supervisão. |
| Busca por nome ou número + filtro | ✅ busca; filtro por canal | CW + UI | Filtro ganha: departamento, atendente, tag, status, conexão. |
| **Ordenar chamados por** | ❌ | CW + UI | `sort_by`: última atividade, criação, **tempo de espera** (`waiting_since` — confirmar ao vivo que só resposta humana zera). |
| Item: avatar + badge do canal, prévia, **✓/✓✓** entrega/leitura, data, **não lidas** (badge), **silenciado** (🔕), **posição na fila** (1..n) | avatar/prévia/fila numerada ✅; ticks ❌; badge não lida ❌; ícone silenciado ❌ | ENG + NOSSO + UI | Ticks = ack do WhatsApp (ver §7). Não lidas = `unread_count` do CW. Silenciado = `muted` do CW. |

## 2. Cabeçalho da conversa

| Digisac | Hoje | Origem |
|---|---|---|
| Chip verde **conexão** "(61) 9…\| Adm e Financeiro" | mostra canal no painel | UI (já temos inbox/instância) |
| Chip escuro **departamento** | ❌ | CW Teams + UI |
| 🔍 **Buscar na conversa** | ❌ | CW `GET /search?q=` filtrado por `conversation_id` + UI |
| ⟲ **Histórico de chamados** do contato (tabela: Conexão, Departamento, Atendente, Último atendimento, **Protocolo**; Exportar; filtros) | ❌ | CW `GET /contacts/:id/conversations` + NOSSO (protocolo em `chat_conversa_meta`) + UI (export CSV) |
| 📅 **Agendamento** (Pessoa, Departamento*, Conexão*, Contato*, **Ações***, Data/hora*, Comentário interno, toggle "enviar mesmo com chamado em aberto") | ❌ | **NOSSO** (tabela + worker) — não existe no CW. Reaproveitar o desenho lease/claim de `chat_mensagens_agendadas` da proposta do plano Astra, generalizando `Ações` (enviar mensagem \| lembrete interno \| abrir chamado). |
| ⇄ **Transferir**: departamento (obrigatório) + atendente (opcional) + comentário | transfere só por atendente | CW (`assignments` com `team_id` + `assignee_id`) + nota privada com o comentário + UI |
| ✂️ **Finalizar** | ✅ encerrar com motivo | — |
| ⋮ mais | — | UI |

## 3. Composer

| Digisac | Hoje | Origem |
|---|---|---|
| + anexo · emoji · imagem · 🎤 áudio | ✅ | — |
| ⚡ **Respostas rápidas** com **Nome, Texto, Categorias, Departamentos, Arquivos** (JPG/PNG/MP4/PDF ≤10 MB) | chips de canned response (texto só) | **NOSSO** — canned response do CW não tem categoria, escopo por departamento nem arquivo. Tabela própria + bucket; atalho `/` no composer. (Hoje o Digisac deles tem ZERO cadastradas — paridade, não urgência.) |
| 💬 nota interna | ✅ | — |
| **Responder citando** | ❌ | ENG (quoted) + CW `content_attributes.in_reply_to` + UI (preview da citada) |
| **@menção** (grupo) | ❌ | ENG (`mentions`) + UI (picker de membros ao digitar @) |

## 4. Painel direito — contato (conversa individual)

| Digisac | Hoje | Origem |
|---|---|---|
| ✏️ editar contato (nome/foto) | ❌ | CW contacts + UI |
| **Mídias e documentos** (contador + galeria + "ver todos") | 🟡 agregado simples | UI (agregar anexos paginando; medir) |
| **Pessoa** (vincular a um cadastro) | ✅ "Vincular a" parceiro/IF/promotora — **por conversa** | NOSSO — **evoluir para nível de CONTATO** (`chat_contato_meta`) pra persistir entre conversas |
| **Silenciar** / **Marcar como não lida** | ✅ | — |
| **Tags** | ✅ labels na conversa | CW — adicionar **labels no CONTATO** (`/contacts/:id/labels`); ver §8 |
| Etapa no quadro Kanban | ❌ | **fora do escopo agora** (não pedido) |
| **Observações** | ✅ | — |
| **Protocolo** + Copiar | ✅ | — |
| **Departamento padrão** / **Atendente padrão** para chamados (por contato) | ❌ | NOSSO (`chat_contato_meta`) + regra na criação da conversa |
| **Campos personalizados** (ex.: "Elogio, Sugestão ou Reclamação", "Código de Parceiro ARW") | ❌ | "Código de Parceiro" **já é o vínculo** (`agentes_parceiros.arw_code`) — não duplicar. Campos livres extras = CW custom attributes do contato. |

## 5. Grupos (o que Bruno pediu, item 6)

Todos dependem do **engine** expor as operações do WhatsApp — o Chatwoot não conhece grupo.

| Funcionalidade | Origem | Engine (Baileys) | Z-API |
|---|---|---|---|
| Aba **Membros** (nome, número, papel Admin/Membro, "(Você)") | ENG + UI | `groupMetadata(jid)` | `/group-metadata` |
| **Adicionar membros** (picker dos contatos da conexão, busca, paginação) | ENG + UI | `groupParticipantsUpdate(jid, [..], 'add')` + contatos da instância | `/add-participant` |
| **Copiar link** do grupo | ENG + UI | `groupInviteCode(jid)` | `/group-invitation-link` |
| **Tornar admin** / **remover** | ENG + UI | `'promote'` / `'demote'` / `'remove'` | `/add-admin` `/remove-admin` `/remove-participant` |
| **Sair do grupo** | ENG + UI | `groupLeave(jid)` | `/leave-group` |
| **Criar grupo** (nome + **conexão** + contatos) | ENG + UI | `groupCreate(nome, [jids])` | `/create-group` |
| **@menção** | ENG + UI | `sendMessage(jid, {text, mentions})` | `mentioned` |
| **Responder citando** | ENG + UI | `quoted` | `messageId` |
| **Nome do remetente por mensagem** (label na bolha, como no Digisac) | ENG + UI | hoje vai como prefixo no texto → passar a ir em `content_attributes.sender` e a UI renderiza o label | idem |
| Roteamento automático pro departamento **Grupos** | NOSSO | `ehGrupo` → `team_id` = Grupos na criação | — |

Regra do Messenger: **qualquer conexão da conta BRS cria e gere grupos**; a operação
roda sempre na conexão dona do grupo (a que está no grupo). "Criar grupo" lista
todas as conexões ativas da conta.

## 6. Departamentos, conexões, presença

| Digisac | Origem | Desenho |
|---|---|---|
| Cadastro de **Departamentos** (nome, usuários vinculados, status) | CW Teams + NOSSO + UI | Fonte da verdade da **filiação** = Chatwoot Teams. Tabela espelho `chat_departamentos` (chatwoot_team_id, nome, ordem, ativo, **distribuicao_automatica** bool) pra guardar o que o CW não guarda. Tela em Configurações › Comunicação. |
| Atendente em **vários departamentos** | CW | membership em N teams |
| **Conexões**: número, tipo (QR/360dialog), status, **departamento padrão**, bot vinculado (depois), Ativas/Arquivadas | ✅ instâncias + status; ❌ departamento padrão | NOSSO (`chat_instancias.departamento_id`) + regra na criação da conversa |
| **Permissão por departamento** (atendente só vê os seus) | ❌ (Fase 2 do contrato) | Filiação ao Team **é** a permissão — sem chave nova em `SYSTEM_MODULES`. UI filtra por teams do usuário; supervisor (`central-conversas`) vê tudo. |
| **Distribuição automática** | ❌ | CW auto-assignment por inbox — ligado só se `distribuicao_automatica=true` no departamento. **Default OFF.** |
| **Presença** do atendente (Online / Ausente / Offline) | ❌ | CW `availability_status` (online/busy/offline; "Ausente"=busy) + seletor no Messenger |

## 7. Coisas do WhatsApp que o Chatwoot não modela (precisam de desenho)

| Item | Origem | Nota |
|---|---|---|
| **✓/✓✓/lida** (ack) | ENG + NOSSO | Baileys `messages.update` (status). CW não tem endpoint público pra marcar entrega em canal API → guardar em tabela leve `chat_mensagem_status` (chatwoot_message_id → sent/delivered/read/failed). |
| **"Dispositivo externo"** (mensagem enviada pelo próprio celular) | ENG + UI | Baileys `fromMe` sem operation_id nosso → espelhar no CW como outgoing com `content_attributes.origem='aparelho'`; UI rotula em itálico. **Verificar** o que o engine faz hoje com `fromMe`. |
| **Reações** ("reagiu com ❤️ a …") | ENG + NOSSO + UI | Baileys `messages.reaction` → tabela `chat_mensagem_reacoes` (ou coluna em status) + render. |
| Citação / menção | ENG | ver §3/§5 |

## 8. Tags

Digisac usa tag no **contato** ("Contatos com a tag"): Cliente Tomador, Fornecedor, Instituição Financeira, Lead, Operacional, Parceiro, Parceiro Ativo, Parceiro Inativo. Cadastro com **cor** e contagem.

- Origem: **CW** (labels são da conta, com cor; aplicáveis a contato e conversa) + UI de cadastro (cor, contagem = `GET /labels` + contagem via busca).
- **Decidido (06/09): Parceiro Ativo/Inativo automáticas** — derivadas do vínculo do
  contato (§4, `chat_contato_meta`) + status em `agentes_parceiros`; recalculadas
  quando o vínculo muda ou o parceiro é ativado/inativado (trigger ou job leve).
  Continuam sendo labels do Chatwoot (filtro/busca funcionam igual às manuais).
- **Sinal de parceiro inativo no GRUPO**: o grupo é um contato no Chatwoot, então
  recebe o mesmo vínculo → quando o parceiro vinculado está inativo: badge
  "Parceiro inativo" no cabeçalho da conversa e no item da lista, faixa âmbar no
  topo da thread, e a tag automática. O vínculo grupo↔parceiro é manual (Vincular
  a); sugestão de automação depois: propor o parceiro cujo telefone cadastrado é
  membro do grupo.

## 9. "Agora" — supervisão em tempo real + Resumo

| Aba | Origem | Desenho |
|---|---|---|
| **Em atendimento** (card por atendente: presença, conversas abertas dele, total) | CW + UI | `GET /conversations?assignee_type=all` agrupado por `assignee` + `availability_status` dos agentes |
| **Filas de atendimento** (card por departamento: conversas na fila, total) | CW + UI | conversas `status=open` sem assignee agrupadas por `team_id` |
| **Resumo** — KPIs: usuários online/ausente/offline; com/sem atendimento; **chamados em aberto**; **em fila**; **média dos chamados aberto**; **TME primeiro atendimento** + tabelas por departamento e por atendente | CW Reports + NOSSO + UI | `GET /reports` (`avg_first_response_time`, `avg_resolution_time`, contagens) por agente/team. "Média dos abertos" = cálculo nosso sobre `created_at` das abertas. Auto-refresh. |

Rota: `/conversas/agora`. **Permissão própria `conversas-agora`** (decisão 06/09):
nó em `SYSTEM_MODULES` (filho de `conversas`, "Atendimento — Painel Agora
(supervisão)"), item em `divisoes.ts`, rota nos 2 mapas de `permissions.ts`, seed
na migration da Fase A a partir de quem tem `central-conversas` + root. Quem só
tem `conversas` não vê o painel.

## 10. Fases propostas (pra aprovação)

Ordem respeita: Bruno quer **individual + grupos** primeiro; grupos são majoritariamente **engine** (outro repo) e podem correr **em paralelo** com a UI.

| Fase | Entrega | Onde | Precisa de schema (Fable) |
|---|---|---|---|
| **A — Departamentos e fila** | Cadastro de departamentos (Teams) + membros; departamento padrão por conexão; grupos → "Grupos"; **transferir para departamento + atendente + comentário**; chip de departamento no cabeçalho; permissão por departamento; presença Online/Ausente/Offline; abas **Chats/Fila/Contatos** com contadores; ordenação; distribuição automática opt-in (OFF) | Workspace | `chat_departamentos` (espelho + flag), `chat_instancias.departamento_id` |
| **B — Conversa individual: paridade** | Histórico de chamados (+ export); busca na conversa; galeria; **tags de contato** + cadastro com cor; **vínculo/Pessoa por contato**; departamento/atendente padrão por contato; campos personalizados; **respostas rápidas** (categoria/depto/arquivo); **agendamento** (worker); ticks; "Dispositivo externo"; reações; **responder citando** | Workspace + engine (ticks/fromMe/reações/citação) | `chat_contato_meta`, `chat_respostas_rapidas` (+categorias), `chat_acoes_agendadas`, `chat_mensagem_status`, `chat_mensagem_reacoes` |
| **C — Grupos completos** | Membros; adicionar; link; admin/remover; sair; **criar grupo**; **@menção**; citação em grupo; nome do remetente como label; sinal de parceiro inativo; qualquer conexão da conta | **engine (recado com contrato) + Workspace UI** | nenhum (estado vem do WhatsApp via engine) |
| **D — "Agora" + Resumo** | 3 abas de supervisão + KPIs + tabelas + auto-refresh; permissão `conversas-agora` | Workspace | só o seed da permissão (entra na migration da A) |
| **E — Bot/URA → canvas** | depois de A–D, conforme decisão de 06/09 | — | — |
| **F — Kanban de chamados** | visão alternativa do atendimento; depois do bot | — | — |

Paralelismo: **A** (Workspace) e o **contrato do engine da C** podem começar juntos; **B** depende de A (departamentos) e de parte do engine (ticks/citação); **D** fecha em cima de A.

## 11. Contrato do engine (rascunho do recado pra sessão do CRM/engine)

Endpoints novos em `services/engine` (Bearer `ENGINE_API_TOKEN`, por `instancia_id`).
**Gate = posse da instância pela conta + token — NÃO filtrar por `papel`** (a
divisão receptiva/disparo é regra do CRM; na conta BRS toda conexão opera grupos):

```
GET  /instancias/:id/contatos?q=&page=          → contatos da conexão (nome, jid, foto)
GET  /instancias/:id/grupos/:jid                 → metadata (nome, descrição, membros[{jid,nome,admin}])
POST /instancias/:id/grupos                      → criar {nome, participantes[]}
POST /instancias/:id/grupos/:jid/participantes   → {acao: add|remove|promote|demote, jids[]}
GET  /instancias/:id/grupos/:jid/convite         → {link}
POST /instancias/:id/grupos/:jid/sair
POST /instancias/:id/enviar                      → ADITIVO: {mentions[], quoted:{messageId}}
```
Webhooks/espelho no Chatwoot (aditivo, `content_attributes`): `sender` (grupo), `origem:'aparelho'` (fromMe), `in_reply_to`, eventos `ack` (status) e `reaction` gravados nas tabelas do §7.

## 12. Decisões fechadas em 06/09

1. **Kanban de chamados**: fase F, depois do bot/URA.
2. **Tags automáticas** Parceiro Ativo/Inativo: sim, + sinal de parceiro inativo no grupo (§8).
3. **"Agora"**: permissão própria `conversas-agora`, obedece perfis/usuários (§9).
4. **Regras ≠ CRM**: toda conexão do Messenger envia, recebe e opera grupos; sem receptiva/disparo; Disparo de WhatsApp é módulo separado com conexão própria (§0).
