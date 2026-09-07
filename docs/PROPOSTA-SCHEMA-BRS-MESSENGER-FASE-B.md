# Proposta de schema — BRS Messenger Fase B (paridade da conversa individual)

Rascunho do Sonnet 5, 06/09/2026, revisado pelo Fable. **APLICADA em 07/09/2026
como `supabase/migrations/20260907022722_brs_messenger_fase_b.sql`** — a
migration é a fonte da verdade; diferenças da revisão: triggers de
`updated_at`, índice por conversa em `chat_acoes_agendadas`, RPCs
`chat_acoes_agendadas_claim` (FOR UPDATE SKIP LOCKED) e `_finish` (só
`service_role`), grant de delete. Roteiro de execução:
`ROTEIRO-BRS-MESSENGER-FASE-B.md`. Contexto: `docs/SPEC-BRS-MESSENGER-PARIDADE-DIGISAC.md` §4/§9, decisão
"Ok, implemente!" do Bruno em 06/09 pra seguir com a Fase B.

Convenções seguidas do que já existe: `chat_contato_meta` espelha o desenho de
`chat_conversa_meta` (`20260831120000_brs_messenger_atendimento.sql`) — mesmo
vínculo genérico `entidade_tipo/entidade_id`, mesmo `app_private.
enable_rls_if_exists`. As tabelas novas sem parentesco direto seguem o padrão
mais recente (`20260906103500_brs_messenger_departamentos.sql`): RLS + revoke
all + grant só a `service_role` (tudo servido por Server Action com
`requirePermission`).

## 1. `chat_contato_meta` — vínculo/departamento/atendente padrão por CONTATO

Hoje o "Vincular a" (`chat_conversa_meta.entidade_*`) é por CONVERSA — perde o
vínculo se o Chatwoot cria uma conversa nova pro mesmo contato (reabertura,
outro canal). O Digisac guarda isso no CONTATO. Chave = `(conta_id,
chatwoot_contact_id)`, mesmo `meta.sender.id` que a lista de conversas já
devolve — não duplica nada do Chatwoot, só complementa.

```sql
create table if not exists public.chat_contato_meta (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  chatwoot_contact_id integer not null,
  -- Mesmo vínculo genérico de chat_conversa_meta (parceiro/instituicao/promotora).
  entidade_tipo text null check (entidade_tipo in ('parceiro', 'instituicao', 'promotora')),
  entidade_id uuid null,
  -- Digisac: "Departamento padrão para chamados" / "Atendente padrão para chamados".
  departamento_padrao_id uuid null references public.chat_departamentos (id) on delete set null,
  atendente_padrao_chatwoot_id integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, chatwoot_contact_id),
  constraint chat_contato_meta_entidade_coerente check ((entidade_tipo is null) = (entidade_id is null))
);
create index if not exists chat_contato_meta_entidade_idx on public.chat_contato_meta (entidade_tipo, entidade_id);

do $$ declare t text; begin t := app_private.enable_rls_if_exists('chat_contato_meta'); end $$;

do $$ begin
  create trigger set_timestamp_chat_contato_meta before update on public.chat_contato_meta
    for each row execute function trigger_set_timestamp();
exception when duplicate_object then null; end $$;
```

**Decidido:** quando a conversa nasce, o vínculo do CONTATO
(`chat_contato_meta`) preenche o vínculo da CONVERSA (`chat_conversa_meta`)
automaticamente — mas a conversa continua podendo ter um vínculo próprio,
pontual, sem alterar o padrão do contato (ex.: "essa conversa aqui é sobre a
IF X, mas o parceiro dono do número continua sendo Y"). `chat_conversa_meta`
não muda de schema, só ganha essa regra de preenchimento na app. Reversível
sem migration nova se o comportamento não agradar na prática.

**Serve também pro sinal de "parceiro inativo" no grupo** (spec §8): o grupo é
um contato no Chatwoot — mesma tabela, mesmo vínculo; a UI checa
`agentes_parceiros.is_active` quando `entidade_tipo='parceiro'`.

## 2. Respostas rápidas próprias (categoria + departamento + arquivo)

A canned response nativa do Chatwoot é só texto — sem categoria, sem escopo
por departamento, sem anexo. Duas tabelas + uma ponte N:N pro escopo:

```sql
create table if not exists public.chat_resposta_categorias (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  unique (conta_id, nome)
);

create table if not exists public.chat_respostas_rapidas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  nome text not null,
  atalho text not null,              -- digitado no composer, ex.: "/bomdia"
  texto text not null,
  categoria_id uuid null references public.chat_resposta_categorias (id) on delete set null,
  arquivo_url text null,             -- bucket parceiro-midias (mesmo do chat interno)
  ativo boolean not null default true,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conta_id, atalho)
);

-- Sem linha = visível a todos os departamentos (padrão mais simples de usar).
create table if not exists public.chat_resposta_departamentos (
  resposta_id uuid not null references public.chat_respostas_rapidas (id) on delete cascade,
  departamento_id uuid not null references public.chat_departamentos (id) on delete cascade,
  primary key (resposta_id, departamento_id)
);

alter table public.chat_resposta_categorias enable row level security;
alter table public.chat_respostas_rapidas enable row level security;
alter table public.chat_resposta_departamentos enable row level security;
revoke all on public.chat_resposta_categorias, public.chat_respostas_rapidas, public.chat_resposta_departamentos from public, anon, authenticated;
grant select, insert, update, delete on public.chat_resposta_categorias, public.chat_respostas_rapidas, public.chat_resposta_departamentos to service_role;
```

## 3. Agendamento de ação por conversa

Mensagem ou lembrete interno numa data/hora futura — precisa de worker (não dá
pra confiar só no navegador aberto). Mesmo desenho de lease/claim que o plano
Astra já validou em produção pro disparo (`crm_disparo_claim`/`finish`), mas
tabela PRÓPRIA do Messenger — os campos são diferentes e as regras não se
misturam (ver princípio §0 da spec: fundação compartilhada, regras próprias).

```sql
create table if not exists public.chat_acoes_agendadas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  chatwoot_conversation_id integer not null,
  criado_por uuid not null references public.users (id),
  acao text not null check (acao in ('mensagem', 'lembrete_interno')),
  texto text null,
  agendado_para timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'executado', 'cancelado', 'falhou')),
  lease_token uuid null,
  lease_until timestamptz null,
  ultimo_erro text null,
  executado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_acoes_agendadas_pendentes_idx on public.chat_acoes_agendadas (agendado_para) where status = 'pendente';

alter table public.chat_acoes_agendadas enable row level security;
revoke all on public.chat_acoes_agendadas from public, anon, authenticated;
grant select, insert, update on public.chat_acoes_agendadas to service_role;
```

**Diferença do rascunho anterior (etapa 5 do CRM):** tirei a ação "abrir
chamado" — não existe "abrir conversa" no Messenger como conceito separado (a
conversa já existe no Chatwoot); só `mensagem` (envia pela instância certa,
revalidando conexão/acesso no momento do disparo, igual o plano pede) e
`lembrete_interno` (nota interna com aviso, sem sair pro WhatsApp).

**Worker:** cron de 1 min reivindicando `agendado_para <= now()` com o mesmo
contrato de `lease_token`/`lease_until` — código TS, fica pra depois do
schema aprovado (frente separada, não é SQL).

## 4. Ticks (✓/✓✓/lida) e reações — dependem de webhook novo do engine

```sql
create table if not exists public.chat_mensagem_status (
  chatwoot_message_id integer primary key,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  status text not null check (status in ('enviado', 'entregue', 'lido', 'falhou')),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.chat_mensagem_reacoes (
  id uuid primary key default gen_random_uuid(),
  chatwoot_message_id integer not null,
  conta_id uuid not null references public.chat_contas (id) on delete cascade,
  jid text not null,           -- quem reagiu (WhatsApp jid)
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (chatwoot_message_id, jid)   -- upsert: trocar/remover emoji do mesmo jid substitui a linha
);
create index if not exists chat_mensagem_reacoes_msg_idx on public.chat_mensagem_reacoes (chatwoot_message_id);

alter table public.chat_mensagem_status enable row level security;
alter table public.chat_mensagem_reacoes enable row level security;
revoke all on public.chat_mensagem_status, public.chat_mensagem_reacoes from public, anon, authenticated;
grant select, insert, update, delete on public.chat_mensagem_status, public.chat_mensagem_reacoes to service_role;
```

**Bloqueado no engine ainda:** o contrato atual (`RECADO-ENGINE-GRUPOS-BRS-
MESSENGER.md`) só cobre grupos. Ack (`messages.update`) e reação
(`messages.reaction`) do Baileys ainda não têm webhook — isso vai num recado
separado quando o engine chegar na Fase 4 dele (`origem:'aparelho'`, que já
tem o achado da guarda de eco registrado no GRUPO.md). Essas duas tabelas
podem ser aplicadas junto com o resto da Fase B mesmo assim — ficam vazias até
o engine emitir os eventos.

## 5. Campos personalizados — NÃO precisa de tabela

O "Elogio, Sugestão ou Reclamação" / campos livres do Digisac cabem no
`custom_attributes` NATIVO do contato no Chatwoot (`POST/PUT
/contacts/:id`, campo `custom_attributes: object` — já documentado na API,
sem tabela nova). "Código de Parceiro" do Digisac já É o vínculo
(`agentes_parceiros.arw_code` via `chat_contato_meta`/`chat_conversa_meta`) —
não duplicar.

## Resumo pra aplicar

| Tabela | Migration nova | Depende de |
|---|---|---|
| `chat_contato_meta` | sim | nada — pode aplicar já |
| `chat_resposta_categorias` / `chat_respostas_rapidas` / `chat_resposta_departamentos` | sim | nada — pode aplicar já |
| `chat_acoes_agendadas` | sim | nada — pode aplicar já (worker é frente separada) |
| `chat_mensagem_status` / `chat_mensagem_reacoes` | sim | nada pra aplicar; fica vazia até o engine emitir ack/reação |

Nenhuma permissão nova (`SYSTEM_MODULES`/`divisoes.ts`/`permissions.ts`) — tudo
sob `conversas`/`central-conversas` já existentes.
