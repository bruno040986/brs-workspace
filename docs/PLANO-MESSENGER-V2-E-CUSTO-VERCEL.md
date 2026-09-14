# Plano — custo de Observability (Vercel) · Quark 400 · BRS Messenger v2

> Rascunho para avaliação com o Bruno (13/09/2026). Tudo abaixo foi **verificado
> hoje** no código, no banco e nos logs de produção da Vercel — não é
> estimativa de leitura de código. Ainda não commitado.

---

## Parte 1 — Custo de Observability: o que os logs reais mostram

Fonte: runtime logs do projeto `interno-brs` (Workspace), produção, últimas 24h
(13/09, um sábado com praticamente só o Bruno usando). Top 25 caminhos:

| caminho | eventos/24h | o que é |
|---|---:|---|
| `/convenios` | 3.934 | tela em uso + prefetch + POST de server actions |
| `/api/chat/conversations` | 2.604 | **polling do Messenger interno (Bridge, 8 s)** |
| `/` | 2.037 | home |
| `/convenios/orgaos` · `/publicos` · `/tipos` · `/esferas` | 1.988 · 1.863 · 1.860 · 1.857 | **prefetch da sidebar** (ninguém abriu "Esferas" 1.857 vezes) |
| `/api/chat/contacts` | 1.670 | **polling do Messenger interno (Bridge, 12 s)** |
| `/rh/parceiros/config/comercial` · `/averbadoras` · `/promotoras` · `/instituicoes-financeiras` · `/agente-corban` | 1.557 · 1.555 · 1.536 · 1.383 · 1.383 | **prefetch da sidebar** (itens do acordeão aberto) |
| `/api/comunicados/notifications` | 1.500 | **polling do HubHeader (30 s)** |
| `/api/cron/messenger-agendamentos` · `/api/cron/wa-campaigns` | 1.440 · 1.440 | crons de 1 min |
| `/api/cron/*` (5 crons de 2 min) | 720 cada = 3.600 | crons |
| `/ia-workspace` · `/gateways` · `/links` · `/recalculo-tributario` · `/regimes-tributarios` | 874 · 864 · 860 · 706 · 704 | prefetch da sidebar |

Três origens, em ordem de peso — o recado do Portal pegou a 2ª, mas não a 1ª:

### 1.1 Prefetch dos links da sidebar (≈ 55% do volume) — não estava no recado

O `WorkspaceSidebar` usa `<Link>` sem `prefetch={false}`. Pela doc do Next 16.2
(`link.md`): *"Prefetching happens when a `<Link />` enters the viewport … If the
prefetched data has expired by the time the user hovers, Next.js will attempt to
prefetch it again."* Como o menu inteiro está sempre no viewport e o cache de
rota dinâmica expira em ~30 s, cada navegação/hover dispara um GET para **cada
item visível do acordeão aberto**. Evidência bruta: `GET /convenios/esferas` às
20:36:14, 20:36:27, 20:36:56, 20:38:15, 20:38:47, 20:38:54 — seis vezes em dois
minutos, tela nunca aberta. E cada um gera **2 eventos** de log (middleware +
função).

E o pior: como o Workspace não tem `loading.tsx` em lugar nenhum, esse prefetch
**nem entrega a página** (rota dinâmica sem boundary = só o layout). Ou seja,
paga-se por um pré-carregamento que não acelera nada.

**Correção (30 min):** `prefetch={false}` nos 3 `<Link>` do `WorkspaceSidebar`
(linhas 78, 85, 144) e nos links do topo. Efeito colateral: nenhum perceptível
(o clique já esperava o servidor de qualquer jeito). **Medir** com a mesma
consulta 24 h depois — meta: os itens de menu somem do top 25.

### 1.2 Polling montado no layout raiz (o que o recado apontou — confirmado)

Roda para todo usuário logado, em toda tela, o dia inteiro:

| onde | cadência | por usuário/8h | observação verificada |
|---|---|---:|---|
| `MessengerNotificationBridge` | `/api/chat/conversations` 8 s + `/api/chat/contacts` 12 s | 6.000 | sempre montado (layout) |
| `GoogleChatComponent` (aba **Interno** do dock) | conversas 5 s, contatos 6 s, canais fixos 8 s, mensagens 2 s (conversa aberta), canal fixo 3 s, heartbeat 60 s | até 15.000 | **montado sempre que o dock está expandido**, mesmo em outra aba (`display:none`). Não é código morto — é o chat Interno |
| `HubHeader` | elogios, comunicados, avisos — 3 × 30 s | 2.880 | elogios e avisos **já têm canal Realtime**, mas `praise_notifications` **não está na publication** `supabase_realtime` → canal morto, o poll "segura" |
| `useAtendimento` (Atendimento WhatsApp) | lista + contadores 6 s, thread 6 s | 9.600 | **já assina Realtime** (`chat_eventos`) e pollea mesmo assim |

Com 7 colaboradores × 8 h isso passa de **100 mil eventos/dia** quando o
Messenger for adotado por todos — exatamente o cenário da migração do Digisac.
Resolver isso é pré-requisito do Messenger v2, não só economia.

**Correção — trocar poll por push, com poll só como rede de segurança:**

| etapa | o quê | schema |
|---|---|---|
| **1a (hoje, 1 h)** | `prefetch={false}` (1.1); todos os polls do layout **pausam com a aba oculta** (Page Visibility — o CRM já faz, commit `d2fd373`) e atualizam no foco; HubHeader 30 s → 5 min; adicionar `praise_notifications` à publication | migration de 1 linha (`alter publication supabase_realtime add table praise_notifications`) |
| **1b (1 dia)** | Chat Interno em Realtime: publicar `workspace_chat_messages` + `workspace_chat_user_profiles`; Bridge e GoogleChat assinam INSERT/UPDATE e só então refazem o fetch que já existe; intervalos de 2–12 s viram 60 s de segurança; heartbeat de presença fica (1/min) | migration (publication) |
| **1c (entra no Messenger v2, M0)** | Atendimento: assinar `chat_atendimento_sinais` (o engine já emite em todo `message_created`, tabela já publicada) em vez de `chat_eventos` sem filtro; polls de 6 s → 30 s de segurança + visibilidade — é o desenho do CRM `a2da200` | nenhum |

Resultado esperado: de ~40 mil eventos/dia (1 usuário) para poucos milhares;
com a empresa toda, diferença de mais de 10×.

### 1.3 Crons — fixos, 5.760+/dia

9 crons no `vercel.json`: 2 por minuto (`wa-campaigns`, `messenger-agendamentos`)
e 5 a cada 2 min. Ganho modesto (~2 mil/dia) e opcional: `auth-healthcheck` e
`convenio-pesquisas` podem ir para 5 min sem perda; `messenger-agendamentos`
fica em 1 min (o agendamento promete precisão de minuto). **Não mexer agora**;
revisar depois de medir 1.1 e 1.2.

---

## Parte 2 — Sincronização QuarkRH: `HTTP 400`

`listarColaboradoresQuark` chama `/v1/colaboradores/?pagina=0` e o Quark devolve
400 **sem `message`** no corpo (por isso a tela mostra só "HTTP 400"). Suspeitos,
em ordem: paginação 1-based (`pagina=0` inválido) ou parâmetro obrigatório
(unidade/departamento). O Swagger (`/v3/api-docs`) exige token (403 sem ele), e
o token só decifra em produção — não dá pra conferir daqui.

**Correção (20 min, antes de qualquer outra coisa da folha):**
1. o erro passa a incluir os primeiros 300 caracteres do corpo da resposta;
2. tentar `pagina=1`, e sem `pagina`, antes de falhar;
3. se persistir, o botão **Explorar endpoints** do card já chama
   `/v1/colaboradores/` sem parâmetro — o status que ele mostrar fecha o diagnóstico.

Com o sync rodando, a Etapa 1 da folha destrava (Bruno preenche INSS/IRRF/
competência, que hoje estão vazias) e a pré-folha pode começar.

---

## Parte 3 — BRS Messenger v2: do "paramos" ao desligamento do Digisac

### 3.1 Onde estamos (verificado hoje)

| fase | estado |
|---|---|
| **A** departamentos/fila/transferir/presença | ✅ implementada 06/09 |
| **B** paridade da conversa individual (histórico, tags, respostas rápidas, agendamento, ticks, reações, citação, "dispositivo externo") | ✅ código 07/09 — **nunca validada ao vivo** ("UI ainda não testada no navegador") |
| **C** grupos de WhatsApp | ❌ **UI não começou** (`engine.ts` sem métodos de grupo). Engine: **pronto e revisado** (4 entregas, `f1d6bb9`); roteiro pronto (`ROTEIRO-BRS-MESSENGER-FASE-C.md`, frentes a–f) |
| **D** "Agora"/Resumo (supervisão) | ❌ |
| **E** bot/URA · **F** kanban | ❌ (decisão: depois) |

Pendências do engine que afetam a experiência (recado já registrado): citação/
menção enviadas pelo caminho normal (Chatwoot → webhook → engine) **não saem no
WhatsApp**; `/enviar` **não espelha** envio para grupo (grupo criado só aparece na
lista na 1ª mensagem recebida).

### 3.2 O que o CRM AlvoConsig refinou (30/08 → 13/09) e o que vale portar

Regra da spec §0: do CRM só se importa **fundação**, nunca regra de negócio.

| refinamento do CRM | commit | portar? | esforço |
|---|---|---|---|
| Mensagem nova por **Supabase Realtime** (`chat_atendimento_sinais`), poll vira rede de segurança de 30 s | `a2da200` | **sim — base de tudo** (a tabela já está publicada) | 0,5 d |
| Polls pausam com a aba em segundo plano; lista memoizada (sem remount a cada poll/tecla); loads em paralelo | `d2fd373`, `a89c2d3` | sim | 0,5 d |
| `useRolagemThread`: rolagem acompanha mensagem nova, preserva âncora do histórico e da paginação, cobre áudio/anexo — **com testes** | `fcc2002`…`3122172` | sim — hook genérico, copiar | 0,5 d |
| Fotos de contato nos avatares + contador da Fila | `7175672` | sim | 0,5 d |
| Feedback otimista ao assumir/transferir + "Assumir para mim" | `d70b30b` | sim | 0,5 d |
| Notas de sistema 🔁/✅/🏁 como aviso central na thread | `51936fc` | sim (paridade visual) | pequeno |
| Composer: anexos até 15 MB, áudio, emoji | `51936fc` | Workspace já tem — **conferir o limite de anexo** | — |
| Endurecimento do envio/1º contato, contato duplicado no Chatwoot, alias LID↔telefone, sessão substituída | `4940b06`, `d4952c9`, `e4c9301`, `0fa9b87`, `868b8cd` | **já vale para os dois** — engine compartilhado | 0 |
| Chat interno v2 (mídia/figurinhas/GIF) | `462a51c` | **depois** — é o Interno, não o atendimento (migrations do plano v3 já estão no Workspace) | fase posterior |
| Tabulação/funil, lead/oferta/simulador, receptiva × disparo, discadora | — | **não** (regra do CRM) | — |

### 3.3 Fases propostas (M = marco)

| marco | entrega | quem | duração | gate para avançar |
|---|---|---|---|---|
| **M0 — fundação tempo real + validação ao vivo** | Parte 1 (1a+1b+1c) + os 6 itens "sim" da tabela 3.2 + **checklist de teste das fases A/B com o Bruno** (departamentos, fila, transferir, respostas rápidas, agendamento, ticks/reações, citação, dispositivo externo) | Sonnet executa, Fable revisa | 2–3 dias | Bruno opera 1 dia real com **uma** conexão, sem bug bloqueante |
| **M1 — grupos (Fase C)** | frentes a–f do roteiro (membros, adicionar, link, admin/remover, sair, criar grupo, @menção, remetente como label) + 2 pedidos ao engine: espelhar envio para grupo e citação/menção pelo webhook | Sonnet + Fable; engine na sessão `-chat` | 2–3 dias | 2–3 grupos reais de parceiros operados **em paralelo** com o Digisac por 1 semana |
| **M2 — piloto de migração** | 1 departamento sai do Digisac (sugestão: Suporte). Cutover **por número**: um número só pode estar pareado num lugar (Baileys ≠ Digisac). Expor do Chatwoot: horário de atendimento + mensagem de ausência. Tags automáticas Parceiro Ativo/Inativo (precisa `agentes_parceiros.ativo` — migration pendente de ok) | Fable (schema) + Sonnet | 1 semana de operação | atendentes do piloto não voltam ao Digisac |
| **M3 — "Agora" + Resumo (Fase D)** | 3 abas de supervisão + KPIs (TME, abertos, fila) por departamento/atendente; permissão `conversas-agora` (já semeada) | Fable + Sonnet | 2 dias | gestor consegue supervisionar sem o painel do Digisac |
| **M4 — desligar o Digisac** | migrar os números restantes, exportar histórico do Digisac (se quiserem guardar), conferir relatórios equivalentes, cancelar licença. Depois: **E** bot/URA, **F** kanban | — | — | — |

Por que essa ordem, se grupos são a prioridade: sem M0 a ferramenta não é
confiável o bastante para colocar parceiros nela (B nunca foi validada; o
polling atual derruba a fatura no dia em que todos usarem). M0 e M1 podem
**sobrepor**: o roteiro da C não depende do Realtime.

### 3.4 Decisões que preciso de você

1. **Parte 1a hoje?** (prefetch + visibilidade + praise na publication + HubHeader 5 min) — reversível, 1 h.
2. **M0 antes de M1, ou em paralelo** (Sonnet na C enquanto eu fecho o Realtime)?
3. Autorizar os 2 pedidos ao engine (sessão `-chat`): espelhar envio para grupo; citação/menção via webhook.
4. Migration `agentes_parceiros.ativo boolean default true` (tag automática Parceiro Inativo) — sim/não.
5. Piloto: qual departamento e quais números saem primeiro do Digisac.

Fora deste plano (continua onde estava): Quark/folha (Parte 2 destrava a Etapa 1),
Motor de Crédito Fase 2 (sessão própria), Convênio BC Fase 4.
