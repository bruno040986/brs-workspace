# SPEC — Esteira de Digitação e Acompanhamento de Propostas (CRM AlvoConsig)

> 29/09/2026 · só especificação: nenhum código, nenhuma migration, nenhum db push.
> Ancorado no código lido em `brs-alvoconsig` (main, `eedfb3b`) e `brs-workspace` (main, `5242a2ee`).
> Os blocos SQL deste documento são **rascunho, não são migration**.

---

## 1. Contexto e objetivo

Hoje o CRM AlvoConsig vai até a **simulação**. O atendente pede em `/crm/solicitacoes` (ou `/atendente/solicitacoes`), o operacional/master assume e responde com a oferta simulada (`responderOfertaSimulada` em `apps/web/src/lib/crm/chat-interno-actions.ts`), e a solicitação termina em `respondido`. Depois disso não existe registro de nada: quem digitou na IF, número da proposta, em que pé está, se pagou. A digitação acontece por fora, no WhatsApp e no chat interno.

Objetivo: criar uma **esteira de digitação manual** dentro do tenant. O atendente pede a digitação a partir de uma simulação respondida, o operacional digita na IF e mantém status e situação atualizados, e os dois conversam sobre a proposta (pendências, links de formalização, documentos) num só lugar. Tudo fica gravado no **modelo canônico `propostas_credito`**, o mesmo que a API de IF, o ARW e a conciliação vão usar depois.

## 2. Decisões (fechadas pelo Bruno; aqui só detalhadas)

1. A digitação é manual: o atendente pede, e o operacional ou o master digita na IF. Ainda não há API de digitação.
2. A simulação online é pré-requisito. "Solicitar digitação" só aparece numa `crm_solicitacoes_operacionais` com `tipo='simulacao'` e `status='respondido'`, e com o aceite do cliente registrado. A proposta nasce com o vínculo à solicitação e com um snapshot dos valores, da IF e do lead no momento do pedido. Uma oferta calculada pelo sistema não vira digitação direto.
3. São duas telas. **Solicitações** continua só para simulações. A nova tela **Esteira de Propostas (Digitações)** é uma tabela, com uma linha por proposta e um painel lateral. Cada linha mostra o logotipo da IF e é colorida pelo grupo e pelo status.
4. IF, convênio, forma e tabela vêm do catálogo, com texto livre como fallback. Valores e datas são sempre estruturados.
5. Documentos entram por referência (anexo da conversa ou arquivo do lead), com snapshot de caminho e SHA-256 protegido contra o expurgo. Upload manual só para o que não passou pelo chat.
6. O modelo é único: `propostas_credito` com `origem='manual'`. Não haverá tabela paralela. A proposta fica preparada para conciliar por IF + nº contrato + CPF, mas a conciliação não será construída agora.
7. Os catálogos **Status** e **Situação** ficam no Workspace (o tenant só lê) e espelham o ARW 1:1. O **Grupo** é um enum fixo de 4 valores. As flags de comportamento ficam nos dados, não no código.
8. Os papéis do tenant são Master, Atendente e Operacional, todos da equipe do parceiro. A BRS não participa.
9. Pendência devolve a proposta ao atendente com motivo obrigatório. Aparece como balão vermelho em tempo real, e o contador soma eventos não vistos e zera quando o item é aberto.
10. Uma proposta ainda não final e sem atualização há X dias (X configurável por tenant) gera alerta.
11. A Fase 1 muda só a tela de Solicitações: botão único "Responder" com trava que expira, tempo de espera, cor por SLA, ordem do mais antigo para o mais novo e escalonamento. O SLA vale também para a esteira.
12. Ficam fora de escopo, só registrados: conciliação por arquivo, adaptadores de IF, checklist de documentos por convênio, dashboards, transferência de status em lote e cancelamento automático.

## 3. Fatos do código que moldam o desenho

| Fato encontrado | Consequência na spec |
|---|---|
| O tenant do CRM é `agente_parceiro_id` em todas as tabelas `crm_*`, e `propostas_credito.agente_parceiro_id` já existe. | **Não se cria `tenant_id`.** O tenant da proposta é `agente_parceiro_id`, que passa a ser obrigatório quando `origem='manual'`. |
| `propostas_credito` já existe (migration `20260905102132_credito_propostas_fase1.sql`) com `status` canônico (10 valores fixos em CHECK), `id_externo_if`, `status_if_bruto`, `situacao_if_bruto` e `payload_bruto`. Só é lida por `src/lib/if-credito/painel-actions.ts` (Painel de Operações `/operacoes`, somente leitura). | A tabela é evoluída com `ALTER`, sem recriar. `instituicao_financeira_id` hoje é `NOT NULL` e precisa virar nullable por causa do texto livre. `created_by` aponta para `public.users` (funcionário BRS), então os usuários do CRM precisam de colunas próprias. |
| `propostas_credito.simulacao_id` aponta para `simulacoes_credito`, que é a simulação **via API de IF**. A simulação do CRM é `crm_solicitacoes_operacionais`. | Entra uma coluna nova, **`solicitacao_id`** → `crm_solicitacoes_operacionais(id)`. `simulacao_id` fica para o fluxo de API. |
| `crm_solicitacoes_operacionais` já aceita `tipo in ('simulacao','digitacao')`, tem `snapshot_condicoes`, `oferta_id`, `relacionamento_id` e `pessoa`, e usa `crm_solicitacoes_eventos` como trilha. | A digitação **não** vira uma solicitação `tipo='digitacao'`: o registro dela é a proposta (decisão 3). O valor `'digitacao'` fica sem uso. `relacionamento_id` e `pessoa` são reaproveitados no snapshot do lead. |
| `snapshot_condicoes` (tipo `RespostaSolicitacao` em `solicitacoes-types.ts`) grava `instituicaoNome`, mas **não grava `instituicaoId`**. | Na Fase 1, `responderOfertaSimulada` passa a gravar também `instituicaoId`. É só código, porque o campo é jsonb. Sem isso, a proposta tem de buscar a IF por `crm_ofertas.instituicao_id` via `oferta_id`, e esse caminho não existe quando a solicitação não tem lead. |
| Perfis: `crm_perfis` e `crm_perfis_permissoes` são globais (migration `20260830150000`). As chaves estão fixas em `apps/web/src/lib/crm/permissoes.ts`, com espelho em `brs-workspace/src/lib/alvoconsig/permissoes-crm.ts`. `sessao.papel` "só decide roteamento" (`lib/auth/session.ts`). | A suposição 8 bate com a matriz semeada: Operacional tem `leads.ver_todos`, `atendimento.ver_todas`, `receber_simulacao` e `responder_simulacao`. Atendente tem só `leads.ver_meus`. A esteira usa **chaves de permissão, não `papel`**. `listarSolicitacoes('todas')` hoje testa `sessao.papel !== 'master'`, o que é inconsistente com esse modelo; corrigir na Fase 1. |
| O acesso aos dados do CRM é por `service_role` com filtro de parceiro na app: RLS ligada e `revoke all from authenticated`. O Realtime usa tabelas de sinal com policy `select` via `app_private.crm_agente_parceiro_do_usuario()` (`20260903020000_chat_atendimento_sinais.sql`). | As tabelas novas seguem o mesmo padrão. O único ponto lido pelo navegador é a tabela de notificações, com policy por usuário. |
| Solicitações **não tem Realtime**: `SolicitacoesPainel.tsx` faz `polling(carregar, 20000)`, e o comentário diz que "abrir isso é decisão de arquitetura". | O balão em tempo real vem da tabela nova `crm_notificacoes`, que entra na publicação. As listas continuam com polling e recarregam quando chega uma notificação. |
| Não lidas já existem: chat interno usa `crm_chat_membros.lido_ate` → `nao_lidas` (`20260913021429_crm_chat_resumo_canais.sql`), e Atendimento usa o `unread_count` do Chatwoot (`naoLidas` em `atendimento-actions.ts`). | Os balões de **Chat interno** e **Atendimento** somam esses contadores, que já zeram ao abrir o item. Só Digitações e Solicitações usam `crm_notificacoes`. |
| `workspace_notifications.user_id` → `public.users` (só funcionários). | Não serve para usuário do CRM (`crm_usuarios`). Por isso entra a `crm_notificacoes`. |
| Anexos: `salvarAnexoDoChat` baixa o anexo do Chatwoot e grava em `parceiro-midias` + `crm_arquivos` (`origem='chat'`). O expurgo apaga `crm_arquivos` em cascata, mas o trigger `crm_preservar_contato_expurgo` guarda a linha em `crm_historico_registros`, e o objeto no storage **não** é apagado pelo expurgo. **Já `excluirArquivo` apaga o objeto do storage.** | O documento da proposta aponta para `crm_arquivos` com `on delete set null` e guarda o próprio snapshot (bucket, path, sha256). `excluirArquivo` tem de **recusar** apagar um arquivo referenciado por proposta. |
| `financial_institutions.logo_url` guarda data URL base64 de 500×500 (`20260911092422_averbadoras_logotipo.sql`). | **Não** selecionar `logo_url` por linha da tabela. A página carrega o mapa `id → logo` das IFs presentes uma vez e o guarda em cache. |
| Os catálogos espelho do ARW já seguem um padrão: `formas_contrato`, `tipos_formalizacao` e `tabelas_comissao` têm `codigo_arw`/`id_arw`, `is_active` e nome único case-insensitive (`20260823120000_comissionamento_arw.sql`). | Status e Situação seguem o mesmo padrão. **Não existe** hoje no Workspace nenhuma tabela de status ou situação de proposta (grep por `situac`/`status_proposta` sem resultado). |
| `crm_ofertas.estagio` já tem estágios de pós-venda (`digitacao_analise_bancaria`, `formalizacao`, `liberada_pagamento`, `proposta_paga`, `reprovadas_operacional`), que alimentam o funil AC-Oferta do WeSales. | Existe risco de duas verdades (§10). A sincronização fica como pergunta aberta. |
| Os crons do CRM ficam em `apps/web/vercel.json` (`/api/cron/lembretes` roda a cada 5 min). | O cron de SLA e inatividade é novo e segue as invariantes: intervalo ≥ maxDuration e horário desalinhado dos outros. |

## 4. Modelo de dados proposto

### 4.1 Onde cada coisa vive

Tudo fica no **mesmo Supabase**, e a migration sai só do `brs-workspace`. "Workspace ou CRM" define quem edita:

| Tabela | Dono (quem escreve) | Quem lê |
|---|---|---|
| `propostas_status`, `propostas_situacoes`, `propostas_esteira_config` (global) | Workspace (tela de catálogo) | CRM via server action `service_role`, só as linhas `is_active` |
| `financial_institutions`, `convenios`, `formas_contrato`, `tabelas_comissao`, `tipos_formalizacao` | Workspace (já existe) | CRM (já lê `financial_institutions` em `responderOfertaSimulada`) |
| `propostas_credito` (linhas `origem='manual'`) | CRM, filtrado por `agente_parceiro_id` | CRM; no Workspace, por enquanto, fora do `/operacoes` (pergunta aberta 4) |
| `propostas_eventos`, `propostas_documentos` | CRM | CRM |
| `crm_notificacoes` | CRM (server) | Navegador do próprio usuário (Realtime + policy) |
| `crm_parceiro_config` (colunas de SLA novas) | CRM (master do tenant) | CRM |

O tenant lê os catálogos por uma server action no CRM, `listarCatalogosEsteira()`, com `createAdminClient()` e cache curto (`unstable_cache`, 5 min, tag `catalogos-esteira`). Não precisa de policy RLS: segue o mesmo padrão de `responderOfertaSimulada`, que já lê `financial_institutions`.

### 4.2 Catálogos no Workspace (rascunho, não é migration)

```sql
-- Grupo: enum fixo. Define cor base, balão, ranking, conversão e se a proposta é final.
-- em_andamento | pendente | pago | cancelado   (pago e cancelado = finais)

create table public.propostas_status (           -- "Status de Proposta" do ARW (8 itens)
  id uuid primary key default gen_random_uuid(),
  nome text not null,                            -- unique lower(trim(nome))
  codigo_arw text null,
  grupo text not null check (grupo in ('em_andamento','pendente','pago','cancelado')),
  cor text null,                                 -- "Cor do Botão" (#hex); o chip usa esta cor, a linha usa a do grupo
  atualiza_data_atualizacao boolean not null default true,  -- "Atualizar Data de Última Atualização"
  libera_contratos boolean not null default false,          -- INTERNO "Liberar Contratos" (conta para ranking/carteira)
  acao_na_alteracao text null,                   -- INTERNO "Ação na Alteração do Status" — guardado, sem efeito na v1
  alerta_observacao boolean not null default false,         -- PARCEIRO "Visualizar Alerta de Observação"
  pendente boolean not null default false,       -- PARCEIRO "Pendente" → devolve ao atendente + balão vermelho
  padrao_cadastro boolean not null default false,-- config ARW "status de cadastro" (EM ANDAMENTO); índice único parcial where true
  mesa_digitacao boolean not null default false, -- config ARW "status da mesa de digitação" (guardado p/ migração)
  descricao text not null default '',
  ordem integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.propostas_situacoes (        -- "Situação Proposta" do ARW (30 itens), independente do status
  id uuid primary key default gen_random_uuid(),
  codigo_arw text not null,                      -- o ID do ARW (1..30); unique
  nome text not null,
  descricao text not null default '',            -- "Descrição/Explicação"
  status_sugerido_id uuid null references public.propostas_status(id),  -- pré-seleciona o status; nunca obriga
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.propostas_esteira_config (   -- linha única (id boolean primary key default true check (id))
  id boolean primary key default true check (id),
  cancelamento_automatico_dias integer not null default 90,   -- ARW; SEM efeito na v1 (fase futura)
  exigir_contato_ao_pendenciar boolean not null default false -- ARW "obrigatoriedade de WhatsApp/e-mail ao pendenciar"; sem efeito na v1
);
```

**Seed** (na mesma migration): os 8 status com grupo e flags da decisão 7, sendo EM ANDAMENTO `padrao_cadastro=true`; PENDENTE e PAGO COM AUTO REGULAÇÃO `alerta_observacao=true`; PAGO e PROPOSTA INTEGRADA `libera_contratos=true`; PENDENTE `pendente=true`. Entram também as 30 situações com `codigo_arw` = ID do ARW. O ARW não expõe ID de status, então `propostas_status.codigo_arw` fica nulo e a chave de migração é o nome. `status_sugerido_id` começa nulo e o Bruno preenche na tela.

Nenhum código do CRM testa nome de status (`if status == 'PAGO'` é proibido). O comportamento sai sempre de `grupo` e das flags.

### 4.3 `propostas_credito` — evolução (rascunho, não é migration)

Antes do `ALTER`, conferir em produção que a tabela está vazia (`select count(*) from propostas_credito`). A fatia FyDigital com adaptador ainda não foi publicada.

```sql
alter table public.propostas_credito
  alter column instituicao_financeira_id drop not null,
  add column origem text not null default 'api' check (origem in ('manual','api','arw')),
  add column solicitacao_id uuid null references public.crm_solicitacoes_operacionais(id) on delete set null,
  -- identidade do lead (padrão de crm_solicitacoes_operacionais: contato é temporário, relacionamento é estável)
  add column contato_id uuid null references public.crm_contatos(id) on delete set null,
  add column relacionamento_id uuid null references public.crm_relacionamentos(id),
  add column lead_snapshot jsonb not null default '{}'::jsonb,   -- {nome, cpf, nascimento, telefone, matricula, idws, convenio_texto, margens} no pedido
  add column condicoes_snapshot jsonb not null default '{}'::jsonb, -- cópia de crm_solicitacoes_operacionais.snapshot_condicoes no pedido
  -- catálogo OU texto livre
  add column instituicao_texto text null,
  add column convenio_texto text null,
  add column forma_contrato_texto text null,
  add column tabela_comissao_id uuid null references public.tabelas_comissao(id),
  add column tabela_texto text null,
  add column tipo_formalizacao_id uuid null references public.tipos_formalizacao(id),
  add column pendente_normalizacao boolean generated always as (
      (instituicao_financeira_id is null and instituicao_texto is not null)
   or (convenio_id is null and convenio_texto is not null)
   or (forma_contrato_id is null and forma_contrato_texto is not null)
   or (tabela_comissao_id is null and tabela_texto is not null)) stored,
  -- status do catálogo + grupo denormalizado (filtro, contagem e índice sem join)
  add column status_proposta_id uuid null references public.propostas_status(id),
  add column situacao_proposta_id uuid null references public.propostas_situacoes(id),
  add column grupo text null check (grupo in ('em_andamento','pendente','pago','cancelado')),
  -- identificação na IF (id_externo_if já existe = Nº Proposta)
  add column numero_contrato text null,
  -- valores (valor_parcela e num_parcelas = prazo já existem; valor_solicitado = o que foi simulado)
  add column valor_bruto numeric(14,2) null,
  add column valor_liquido numeric(14,2) null,
  add column valor_base numeric(14,2) null,
  add column data_pagamento_cliente date null,
  -- pessoas (CRM)
  add column atendente_crm_usuario_id uuid null references public.crm_usuarios(id),
  add column operacional_crm_usuario_id uuid null references public.crm_usuarios(id),
  add column trava_expira_em timestamptz null,        -- trava do "Responder"/assumir (igual à Fase 1)
  -- tempos
  add column digitada_em timestamptz null,           -- fila = digitada_em is null (estrutural; ver §5)
  add column data_atualizacao timestamptz not null default now(), -- "Data Atualização" do ARW; só muda se o status tiver a flag
  add column finalizada_em timestamptz null,
  add constraint propostas_credito_if_check check (instituicao_financeira_id is not null or instituicao_texto is not null),
  add constraint propostas_credito_manual_check check (origem <> 'manual' or (agente_parceiro_id is not null and atendente_crm_usuario_id is not null)),
  add constraint propostas_credito_id_tenant_uq unique (id, agente_parceiro_id);
```

- **`status` legado (CHECK com 10 valores):** para `origem='manual'` fica no default `'criada'` e **nenhuma tela lê esse campo**. O status de negócio é `status_proposta_id`/`grupo` (pergunta aberta 3).
- **`grupo`** é gravado pela mesma action que troca o status, na mesma instrução. Não há trigger: uma escrita só, sempre pelo mesmo helper `aplicarStatus()`.
- **CPF:** `propostas_credito.cpf` é `NOT NULL` e precisa dos 11 dígitos. O `payload.cpfMascarado` da solicitação **não serve**. A fonte é `crm_contatos.cpf`, depois `crm_pessoas.cpf` via `relacionamento_id`, depois `pessoa.cpf` da solicitação sem lead.

**Índices** (esteira + conciliação futura):

```sql
create index propostas_esteira_idx   on propostas_credito (agente_parceiro_id, grupo, data_atualizacao);
create index propostas_fila_idx      on propostas_credito (agente_parceiro_id, created_at) where digitada_em is null and grupo in ('em_andamento','pendente');
create index propostas_atendente_idx on propostas_credito (atendente_crm_usuario_id, data_atualizacao desc);
create index propostas_operac_idx    on propostas_credito (operacional_crm_usuario_id) where grupo in ('em_andamento','pendente');
create index propostas_conciliacao_idx on propostas_credito (instituicao_financeira_id, numero_contrato, cpf) where numero_contrato is not null;  -- conciliação futura; NÃO único
create unique index propostas_solicitacao_viva_uq on propostas_credito (solicitacao_id) where grupo in ('em_andamento','pendente');  -- 1 proposta viva por simulação
create index propostas_normalizar_idx on propostas_credito (created_at) where pendente_normalizacao;
```

### 4.4 Linha do tempo + comentários = eventos (rascunho)

```sql
create table public.propostas_eventos (           -- append-only (grant select, insert ao service_role)
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null,
  agente_parceiro_id uuid not null,
  foreign key (proposta_id, agente_parceiro_id) references propostas_credito (id, agente_parceiro_id) on delete cascade,
  tipo text not null check (tipo in ('criada','assumida','trava_expirada','digitada','status','situacao','campos',
                                     'pendencia','pendencia_respondida','comentario','documento','cancelada','reaberta','alerta_inatividade')),
  autor_crm_usuario_id uuid null references crm_usuarios(id) on delete set null,   -- null = sistema (cron)
  status_de uuid null, status_para uuid null, situacao_de uuid null, situacao_para uuid null,
  nota text null,                                   -- motivo da pendência/cancelamento; texto do comentário
  dados jsonb not null default '{}'::jsonb,         -- diff de campos alterados, ids de documento etc.
  created_at timestamptz not null default now()
);
create index propostas_eventos_idx on propostas_eventos (proposta_id, created_at);
```

Um comentário é o evento `tipo='comentario'`. O painel lateral mostra duas vistas da mesma tabela: "Comentários" filtra `comentario/pendencia/pendencia_respondida`, e a "Linha do tempo" mostra tudo. Ranking, SLA e tempo por etapa saem desses eventos, como já acontece em `crm_solicitacoes_eventos`.

### 4.5 Documentos por referência (rascunho)

```sql
create table public.propostas_documentos (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null,
  agente_parceiro_id uuid not null,
  foreign key (proposta_id, agente_parceiro_id) references propostas_credito (id, agente_parceiro_id) on delete cascade,
  origem text not null check (origem in ('chat','arquivo_lead','solicitacao','upload')),
  crm_arquivo_id uuid null references crm_arquivos(id) on delete set null,  -- vínculo vivo; some no expurgo, o snapshot fica
  bucket text not null,                     -- 'parceiro-midias'
  storage_path text not null,               -- sempre com prefixo do tenant (conferido no servidor)
  sha256 text not null,
  nome text not null, mime text null, tamanho_bytes bigint null,
  chat_ref jsonb null,                      -- {conversationId, messageId, attachmentId} quando veio do Chatwoot
  adicionado_por uuid null references crm_usuarios(id) on delete set null,
  removido_em timestamptz null,             -- soft delete (tira da lista, não do storage)
  created_at timestamptz not null default now(),
  unique (proposta_id, sha256)
);
```

- **Anexo da conversa:** reaproveita o fluxo de `salvarAnexoDoChat` (Chatwoot → `parceiro-midias` + `crm_arquivos`). Se o anexo já tiver sido salvo antes (mesmo sha256 em `crm_arquivos` do lead), o documento aponta para ele sem copiar de novo. Esse é o "por referência": há uma cópia por lead, e as propostas só apontam para ela.
- **Anexos da solicitação** (`crm_solicitacoes_operacionais.anexos`, prefixo `solicitacoes/<tenant>/<id>/`) são vinculados sozinhos quando a proposta nasce, com `origem='solicitacao'`.
- **Proteção:** `excluirArquivo` (`atendimento-actions.ts`) passa a recusar com "Arquivo vinculado à proposta X" quando existir um `propostas_documentos` ativo com o mesmo `storage_path`. O expurgo não mexe no storage. Contra o `on delete cascade` de `crm_arquivos`, o snapshot na proposta basta.
- O hash é calculado no servidor, sobre os bytes baixados ou enviados.

### 4.6 Notificações do CRM (rascunho)

```sql
create table public.crm_notificacoes (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references agentes_parceiros(id),
  crm_usuario_id uuid not null references crm_usuarios(id) on delete cascade,
  modulo text not null check (modulo in ('digitacoes','solicitacoes')),
  tipo text not null,                 -- 'pendencia','status','comentario','simulacao_respondida','sla_estourado','sem_atualizacao',...
  entidade_tipo text not null,        -- 'proposta' | 'solicitacao'
  entidade_id uuid not null,
  titulo text not null, corpo text not null default '', href text not null default '',
  urgente boolean not null default false,   -- pendência → balão vermelho
  created_at timestamptz not null default now(),
  visto_em timestamptz null
);
create index crm_notificacoes_nao_vistas_idx on crm_notificacoes (crm_usuario_id, modulo) where visto_em is null;
-- RLS: select para authenticated onde crm_usuario_id = app_private.crm_usuario_do_auth()  (função nova, mesmo molde de
-- app_private.crm_agente_parceiro_do_usuario()); escrita só via service_role; adicionar à publicação supabase_realtime;
-- limpeza: vistas há mais de 30 dias (no cron de §6).
```

### 4.7 Config por tenant (rascunho)

```sql
alter table public.crm_parceiro_config
  add column sla_simulacao_min integer not null default 15  check (sla_simulacao_min > 0),
  add column sla_digitacao_min integer not null default 60  check (sla_digitacao_min > 0),
  add column trava_min integer not null default 10          check (trava_min between 2 and 120),
  add column dias_sem_atualizacao integer not null default 3 check (dias_sem_atualizacao between 1 and 90);

alter table public.crm_solicitacoes_operacionais add column trava_expira_em timestamptz null;
```

O `crm_parceiro_config` já é a config do tenant, embora hoje a BRS defina `habilitado`/`max_atendentes`. As 4 colunas novas são editadas pelo **master do tenant** numa aba nova do CRM, "Configurações › Esteira e SLA".

### 4.8 RLS e isolamento

- `propostas_credito`, `propostas_eventos` e `propostas_documentos` ficam **sem policy**, com RLS ligada e `revoke all from anon, authenticated` (padrão atual). Todo acesso passa por server action com `createAdminClient()` + `.eq('agente_parceiro_id', sessao.agenteParceiroId)` obrigatório.
- A defesa em profundidade vem da FK composta `(proposta_id, agente_parceiro_id)`: um evento ou documento não consegue apontar para a proposta de outro tenant, mesmo com bug na app. É o mesmo padrão de `chat_historico_*`.
- Toda action carrega a proposta por `id` **e** tenant antes de agir, e aplica a regra de visibilidade da §7 (atendente só vê as próprias).
- O `storage_path` recebido do navegador nunca é assinado sem conferir o prefixo do tenant (regra já escrita em `20260913165513`).

## 5. Máquina de estados e quem faz o quê

A proposta tem dois eixos. O **eixo da esteira** é estrutural e fica no código: fila → digitada → final. O **eixo de negócio** vem dos dados: Status (grupo + flags) e Situação.

```
[Simulação respondida + aceite] --Solicitar digitação--> NA FILA (digitada_em nulo, status = padrao_cadastro, grupo em_andamento)
NA FILA --Responder/Assumir (CAS + trava)--> EM DIGITAÇÃO (operacional definido, trava_expira_em)
EM DIGITAÇÃO --trava expira sem "Registrar digitação"--> NA FILA (evento trava_expirada; operacional volta a nulo)
EM DIGITAÇÃO --Registrar digitação (Nº proposta + valores obrigatórios)--> DIGITADA (digitada_em)
DIGITADA --Alterar status/situação--> qualquer status ativo; efeitos pelas flags:
    pendente=S      → motivo obrigatório, evento 'pendencia', notifica o atendente (urgente), "com o atendente"
    grupo=pago      → exige data_pagamento_cliente + valor_liquido; finalizada_em
    grupo=cancelado → motivo obrigatório; finalizada_em
    alerta_observacao=S → observação obrigatória, exibida em destaque para o atendente
    atualiza_data_atualizacao=S → data_atualizacao = now()
PENDENTE --atendente "Responder pendência" (comentário/documento)--> evento 'pendencia_respondida', notifica o operacional
FINAL (pago/cancelado) --Reabrir (motivo)--> último status não final   [só com permissão de reabrir]
```

- A fila é `digitada_em is null`, e não um status. Assim a fila não depende de alguém trocar o status certo, e o catálogo continua 1:1 com o ARW. A flag `mesa_digitacao` fica guardada só para a migração (pergunta aberta 6).
- "Com quem está a bola" é derivado, sem coluna: se o status tem `pendente=S`, está com o atendente; senão, com o operacional. Isso aparece na linha e define quem recebe o alerta de inatividade.
- Toda escrita usa CAS no estado esperado (`.eq(...)` no update + `select('id')`, como `assumirSolicitacao`). Se ninguém casar, a resposta é "O estado mudou — atualize".

| Ação | Atendente (dono) | Operacional | Master |
|---|---|---|---|
| Solicitar digitação | sim (só nas simulações dele) | sim | sim |
| Ver proposta | só as próprias (`atendente_crm_usuario_id = eu`) | todas do tenant | todas |
| Assumir / Responder / Registrar digitação | não | sim | sim |
| Alterar status, situação e campos | não | sim, se for o operacional dela ou ela estiver sem dono | sim |
| Pendenciar | não | sim | sim |
| Responder pendência | sim | sim | sim |
| Comentar / anexar documento | sim | sim | sim |
| Cancelar | só antes de digitada (desistência, motivo obrigatório) | sim | sim |
| Reabrir final / editar valores após PAGO | não | não | sim |
| Reatribuir operacional | não | não | sim (evento `assumida` com `atribuido_de`) |

## 6. Telas

### 6.1 Solicitações — Fase 1 (`SolicitacoesPainel.tsx`)

- Um botão **"Responder"** substitui "Assumir" + "Responder com oferta simulada". O clique faz o CAS: `atribuido_a = eu`, `trava_expira_em = now() + trava_min` e `status='em_atendimento'`. O CAS só casa se `atribuido_a is null or trava_expira_em < now() or atribuido_a = eu`. Em seguida abre o `ResponderSolicitacaoModal`. Enquanto o modal está aberto, uma renovação a cada 60 s estende a trava. Fechar sem responder mantém a trava até expirar, e outra pessoa pode pegar depois disso. `aguardando_informacoes` não expira, porque a bola está com o atendente. `podeAssumir`/`podeResponder` (`solicitacoes-shared.ts`) passam a considerar a trava. A trava vencida não apaga o histórico, e o evento `trava_expirada` é registrado ("não apagar atrasos ao reatribuir").
- **Espera visível:** "há 12 min" desde `criado_em`, somando `tempoAguardandoAgora` quando houver.
- **Cor por SLA:** verde abaixo de 50% de `sla_simulacao_min`, âmbar entre 50% e 100%, vermelho acima (tinta + borda + ícone de relógio; não depende só da cor).
- **Ordem:** na aba Fila, do mais antigo para o mais novo (`order('criado_em', { ascending: true })`). Minhas e Todas continuam do mais novo para o mais antigo.
- **Escalonamento:** o cron de §7 notifica quem tem `receber_simulacao` quando uma solicitação passa de 100% do SLA, e notifica o master quando passa de 200%. Cada nível dispara uma vez só, controlado por evento.
- **Balão da aba Solicitações:** o atendente recebe `simulacao_respondida` e `pedido_informacoes`. O abrir do card chama `marcarVisto('solicitacao', id)`.
- Correção incluída: o escopo `todas` passa a checar permissão (`leads.ver_todos`) em vez de `papel`.
- `responderOfertaSimulada` passa a gravar `instituicaoId` em `snapshot_condicoes`.

### 6.2 Botão "Solicitar digitação"

Aparece no card de Solicitações (aba Minhas) quando `status='respondido'`, `tipo='simulacao'` e não existe proposta viva para a solicitação. Abre um modal curto:
- mostra o resumo da oferta respondida (IF, produto, prazo, parcela, valor liberado, validade), vindo de `snapshot_condicoes`;
- **"Cliente aceitou esta oferta"**, checkbox obrigatório (pergunta aberta 1);
- telefone do cliente pré-preenchido do lead, e observação para o operacional;
- documentos: checklist dos anexos da conversa do lead + arquivos do lead + anexos da solicitação (§4.5), com "Enviar arquivo" para o que não veio pelo chat.

A server action `solicitarDigitacao(solicitacaoId, {...})` cria a proposta com `origem='manual'`, o status `padrao_cadastro`, o grupo desse status, o `lead_snapshot`, o `condicoes_snapshot` e a IF do snapshot (`instituicaoId`, ou `instituicao_texto` como fallback para respostas antigas). Também grava o evento `criada` e os documentos, notifica quem tem `propostas.digitar` e manda aviso no chat interno pelo padrão existente `avisarNoChatDaSolicitacao`/`canalDeAvisoDaSolicitacao` ("aviso no chat só notifica").

### 6.3 Esteira de Propostas (Digitações)

As rotas são `/crm/propostas` e `/atendente/propostas`, com o mesmo componente e um `basePath`, igual a Solicitações. As abas seguem a permissão: **Minhas** (atendente: `atendente_crm_usuario_id = eu`; operacional: `operacional_crm_usuario_id = eu`), **Fila** (`digitada_em is null`, do mais antigo para o mais novo, com `propostas.digitar`), **Pendentes** (status com `pendente=S`), **Em andamento**, **Finalizadas** (últimos 60 dias) e **Todas** (com `propostas.ver_todas`). A busca aceita CPF, nome e Nº proposta/contrato. Filtros por IF, atendente, operacional, "sem atualização" e "pendente de normalização". A lista vem de server action com limite de 200 e polling de 20 s, mais o recarregamento quando chega notificação.

**Colunas** (poucas):

| Coluna | Conteúdo |
|---|---|
| IF | logo 24 px (mapa de logos carregado uma vez) ou iniciais do `instituicao_texto` num círculo neutro |
| Status / Situação | chip do status (`cor` do catálogo + ícone por grupo) e situação em texto pequeno abaixo; selo "Na fila" quando `digitada_em` é nulo; selo vermelho "Pendente" |
| Cliente | nome + CPF mascarado |
| IF · Convênio · Forma | texto curto, com ícone de "texto livre" quando veio de fora do catálogo |
| Valor / Parcela / Prazo | `valor_bruto` (ou o solicitado) · parcela · `num_parcelas`x |
| Atendente · Operacional | nomes de exibição (operacional "—" enquanto estiver na fila) |
| Tempo / SLA | na fila: espera × `sla_digitacao_min` (cor igual à Fase 1); depois de digitada: "sem atualização há N dias" com alerta quando N ≥ `dias_sem_atualizacao` e a proposta não é final |
| Atualizado | `data_atualizacao` relativa |

**Cor da linha:** tinta clara (8–12% de opacidade) + borda lateral de 3 px pela cor do **grupo** (em_andamento = `secondary`, pendente = vermelho, pago = esmeralda, cancelado = cinza), com as mesmas classes `dark:` usadas em `COR_STATUS`. A cor específica do status vai só no chip. O grupo também aparece como ícone e texto no chip, então a cor não é o único sinal.

**Painel lateral** (drawer à direita, largura cheia no celular; URL `?p=<id>` para dar para linkar):
- Cabeçalho: logo grande (64 px), cliente, CPF, chip de status e situação, "com quem está a bola", alerta de inatividade e de `alerta_observacao`.
- Ficha: ID Simulação (link para a solicitação), Status, Situação, Nº Contrato, Nº Proposta, IF, Forma de Contrato, Convênio, Formalização, Tabela, Valor Bruto, Valor Líquido, Valor Base, Valor da Parcela, Prazo, CPF, Cliente, Atendente, Operacional, Data Cadastro (`created_at`), Data Atualização (`data_atualizacao`), Data Pagamento Cliente e Observações. Os campos em texto livre aparecem com o selo "fora do catálogo".
- Abas **Comentários**, **Linha do tempo** e **Documentos** (§4.4/§4.5). Comentário com URL mostra o link clicável e um botão **Copiar**. É o canal de entrega: o operacional cola o link de formalização, o atendente copia e manda na conversa. Nada vai ao cliente sozinho.
- Ações conforme a §5.
- Abrir o painel chama `marcarVisto('proposta', id)`, que zera os eventos daquela proposta.

### 6.4 Formulário do operacional

- **Registrar digitação:** Nº Proposta (`id_externo_if`, obrigatório), Nº Contrato (opcional), IF, Convênio, Forma, Tabela, Formalização, Valor Bruto, Valor Líquido, Parcela e Prazo (os quatro obrigatórios), Valor Base (opcional), Status e Situação (vêm com o status padrão e a situação sugerida).
- **Combobox catálogo + texto livre** (IF, Convênio, Forma, Tabela): busca no catálogo ativo. A Tabela vem filtrada por IF + Forma (+ Convênio quando houver), a partir de `tabelas_comissao`. A última opção é "Não está na lista: usar '<texto digitado>'", que grava `*_id = null` + `*_texto`. `pendente_normalizacao` é uma coluna gerada, então a app não precisa lembrar de marcar.
- **Alterar status/situação:** escolher a situação pré-seleciona `status_sugerido_id`. Os campos obrigatórios aparecem conforme as flags e o grupo do status de destino (§5). O servidor revalida tudo: valor > 0, data de pagamento não futura, prazo inteiro > 0.
- **Valores e datas** usam `<input type="number" step="0.01">`/`type="date"`, sem biblioteca de máscara.

### 6.5 Catálogos no Workspace

Menu novo na divisão **Cadastros**: **"Status e Situações de Proposta"**, `href: '/propostas-catalogos'`, com abas **Status** (CRUD com grupo e flags; índice único impede dois `padrao_cadastro`), **Situações** (CRUD + status sugerido) e **Configuração** (a linha de `propostas_esteira_config`, com o aviso "sem efeito ainda"). Nada é apagado: inativar tira o item da escolha e mantém as propostas antigas legíveis.

Os 4 pontos da REGRA FIXA "permissões acompanham o menu", na mesma entrega:
1. `src/app/(dashboard)/usuarios/page.tsx` → `SYSTEM_MODULES`: `{ id: 'operacional-propostas-catalogos', name: 'Status e Situações de Proposta', parentId: 'cat-div-cadastros', level: 1 }`.
2. `src/lib/nav/divisoes.ts`: item na divisão Cadastros, perto de "Formas de Contrato", com `perms: [view('operacional-propostas-catalogos')]`.
3. `src/lib/auth/permissions.ts`: `'/propostas-catalogos'` nos **dois** mapas (o de página, linha ~187, e o de prefixo, linha ~292), com `any([view('operacional-propostas-catalogos')])`.
4. Seed na migration: `INSERT` em `profile_permissions` e `user_permissions` a partir de quem tem `sistema-usuarios-root`, no mesmo molde do seed de `20260905102132`.

**No CRM, o equivalente:**
- (1) chaves novas em `apps/web/src/lib/crm/permissoes.ts` **e** no espelho `brs-workspace/src/lib/alvoconsig/permissoes-crm.ts`;
- (2) itens em `ITENS_NAV` (`components/crm/Sidebar.tsx`) e `ITENS` (`components/crm/AtendenteNav.tsx`) com `requer`;
- (3) as server actions exigem a chave (`exigirComPermissao`);
- (4) seed em `crm_perfis_permissoes` na migration para os perfis globais `master`, `operacional` e `atendente`.

## 7. Notificações, balões e alerta de inatividade

- **Fonte por aba:**
  - **Digitações** = `crm_notificacoes` com `modulo='digitacoes'` e `visto_em` nulo.
  - **Solicitações** = o mesmo com `modulo='solicitacoes'`.
  - **Chat interno** = soma de `nao_lidas` (já existe; `lido_ate` zera ao abrir o canal).
  - **Atendimento** = soma de `naoLidas` das conversas visíveis (Chatwoot `unread_count`; zera ao abrir a conversa).
- **Balão:** vermelho, com número. Mostra "9+" acima de 9. Um ponto pulsante aparece quando houver `urgente` (pendência). O mesmo componente serve a `Sidebar` (também recolhida) e a `AtendenteNav`.
- **Tempo real:** uma action `contadoresNavegacao()` é chamada no mount. Depois:
  - Realtime em `crm_notificacoes` com filtro `crm_usuario_id=eq.<eu>`, aplicando +1 local;
  - os canais já existentes de `crm_chat_mensagens` e `chat_atendimento_sinais`, que chamam `contadoresNavegacao()` com debounce de 2 s;
  - reconciliação a cada 60 s, só com a aba visível (lição de custo de 14/09).
- **Zera ao abrir o item, não a aba:** `marcarVisto(entidade_tipo, entidade_id)` faz `update ... set visto_em=now() where crm_usuario_id=eu and entidade_id=... and visto_em is null`.
- **Quem é notificado de quê:**

| Evento | Destinatário |
|---|---|
| pendência | atendente dono, urgente |
| pendência respondida | operacional; se não houver, quem tem `propostas.digitar` |
| status ou situação alterados | atendente |
| comentário | a outra ponta (atendente ↔ operacional) |
| proposta nova na fila | quem tem `propostas.digitar` |
| simulação respondida / pedido de informações | solicitante |
| SLA estourado | fila e depois o master (§6.1) |
| sem atualização | operacional (ou quem tem `propostas.digitar` se não houver) + master |

  O autor da ação nunca é notificado.
- **Alerta de inatividade:** a condição é grupo `em_andamento|pendente`, `digitada_em` não nulo e `data_atualizacao < now() - dias_sem_atualizacao`. Aparece na linha e no painel sempre (derivado na consulta). A notificação sai **uma vez por período**, controlada pelo evento `alerta_inatividade` com a data de referência em `dados`. Se a proposta está com o atendente (pendente), o alerta vai ao atendente e ao master.
- **Cron novo:** `/api/cron/esteira-alertas` em `apps/web/vercel.json`, `"schedule": "7-59/10 * * * *"` (10 min, desalinhado de `lembretes */5` e dos crons de minuto). `maxDuration` ≤ 60 s, processamento em lotes com limite e idempotência pelo evento. Ele cobre o SLA de solicitações, o SLA da fila de digitação, a inatividade e a limpeza de `crm_notificacoes` vistas há mais de 30 dias.

## 8. Permissões novas do CRM

| Chave | Rótulo | Master | Operacional | Atendente |
|---|---|---|---|---|
| `propostas.solicitar_digitacao` | Solicitar digitação a partir de simulação respondida | ✓ | ✓ | ✓ |
| `propostas.ver_minhas` | Ver as propostas que eu pedi ou opero | ✓ | ✓ | ✓ |
| `propostas.ver_todas` | Ver todas as propostas do parceiro | ✓ | ✓ | — |
| `propostas.digitar` | Assumir, digitar, alterar status/situação, pendenciar | ✓ | ✓ | — |
| `propostas.gerir` | Reabrir final, editar após pago, reatribuir | ✓ | — | — |
| `config.esteira` | Editar SLA, trava e dias sem atualização | ✓ | — | — |

O menu "Digitações" usa `requer: ['propostas.ver_minhas', 'propostas.ver_todas']`. Continuam valendo `chat_interno.receber_simulacao` e `responder_simulacao` em Solicitações. No Workspace, a única chave nova é `operacional-propostas-catalogos` (§6.5).

## 9. Fatias de entrega

Política do Bruno: **Fable** faz arquitetura nova, migration, segurança/RLS e revisão final. **Sonnet** executa sobre padrão definido. **Opus** faz as revisões intermediárias enquanto a cota Fable está sendo poupada (até ~02/10). Cada fatia usa worktree própria por repo (`brs-workspace-esteira`, `brs-alvoconsig-esteira`). As migrations saem da pasta principal do `brs-workspace` com timestamp real e `npx supabase migration list` antes do push. O `db push` do Workspace vai **antes** do deploy do CRM que depende dele.

| # | Fatia | Escopo | Repos | Migration | Modelo |
|---|---|---|---|---|---|
| 1a | Base da Fase 1 | `trava_expira_em` em solicitações; 4 colunas em `crm_parceiro_config`; `crm_notificacoes` + `app_private.crm_usuario_do_auth()` + policy + publicação Realtime; chave `config.esteira` + seed | workspace | **sim** | **Fable** |
| 1b | Solicitações Fase 1 | botão "Responder" com trava e renovação, espera, cor SLA, ordenação da Fila, `instituicaoId` no snapshot, correção do escopo `todas`, balão "Solicitações", `marcarVisto`, aba "Esteira e SLA" em Configurações, cron `esteira-alertas` (só a parte das solicitações) | CRM | não | **Sonnet**; revisão **Opus** |
| 2 | Catálogos no Workspace | `propostas_status`, `propostas_situacoes`, `propostas_esteira_config` + seed 8/30 + chave `operacional-propostas-catalogos` (4 pontos) | workspace | **sim** | **Fable** (migration); telas **Sonnet** |
| 3 | Modelo da proposta | `ALTER propostas_credito` (§4.3), `propostas_eventos`, `propostas_documentos`, índices, FKs compostas, chaves `propostas.*` + seed em `crm_perfis_permissoes` + espelho `permissoes-crm.ts`; Painel `/operacoes` filtra `origem <> 'manual'` | workspace | **sim** (pode sair junto com a 2 numa migration só) | **Fable** |
| 4 | Pedir + ver | "Solicitar digitação" (modal, action, snapshot, anexos da solicitação); Esteira em tabela (abas, colunas, cores, logos em mapa); painel lateral só com ficha, comentários e linha do tempo; balão "Digitações" | CRM | não | **Sonnet**; revisão **Opus** |
| 5 | Operar | Assumir/Responder com trava; Registrar digitação; combobox catálogo + texto livre; alterar status/situação com regras por flag; pendência e resposta; cancelar e reabrir; notificações; cron (SLA da fila + inatividade) | CRM | não | **Sonnet**; revisão **Opus** (regras de transição e CAS) |
| 6 | Documentos | seletor de anexos da conversa e do lead, upload, sha256 no servidor, dedupe, bloqueio em `excluirArquivo`, conferência de prefixo | CRM | não | **Sonnet**; revisão **Fable** (tenant/path = segurança) |
| 7 | Balões unificados | balões de Chat interno e Atendimento na `Sidebar`/`AtendenteNav` a partir dos contadores já existentes + Realtime | CRM | não | **Sonnet** |
| 8 | Revisão final e homologação | revisão pré-merge do conjunto (tenancy, CAS, migrations), roteiro de teste com 1 parceiro real (Bem Digital) | ambos | — | **Fable** |

Futuras (só registradas, fora desta entrega):
- tela "Pendentes de normalização" no Workspace, para mapear `*_texto` → `*_id` em lote (usa `propostas_normalizar_idx`);
- transferência de status em lote (Financeira + Forma + Status base → Status receber);
- cancelamento automático (`cancelamento_automatico_dias`);
- conciliação por arquivo da IF (`propostas_conciliacao_idx`);
- adaptadores de IF escrevendo nas mesmas linhas (`origem='api'`);
- importação do histórico do ARW (`origem='arw'`, casando por `codigo_arw`);
- checklist de documentos por convênio;
- dashboards de ranking, conversão e carteira (grupo `pago` + `libera_contratos` + `valor_liquido` + `data_pagamento_cliente` + eventos).

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **O operacional não atualiza o status, e a tabela mente** (principal). | A coluna "sem atualização há N dias" fica sempre visível e em cor. A notificação ao operacional e ao master sai uma vez por período. A fila é estrutural (`digitada_em`) e não depende de status. O ranking só conta grupo `pago` **com** `data_pagamento_cliente` e `valor_liquido`, então uma proposta esquecida não infla nada. O filtro "sem atualização" dá ao master uma lista de cobrança. Cancelamento automático e conciliação por arquivo ficam registrados como próximos passos. |
| Duas verdades de status: `propostas_credito.status` (legado) × catálogo. | A regra fica escrita: a tela e o ranking leem só `status_proposta_id`/`grupo`. O legado fica restrito à integração (pergunta 3). |
| Duas verdades de pós-venda: `crm_ofertas.estagio` / funil AC-Oferta no WeSales × proposta. | Na v1 a proposta não mexe na oferta. O vínculo `oferta_id` fica disponível via solicitação para a sincronização futura (pergunta 5). |
| Documento some porque alguém excluiu o arquivo do lead. | `excluirArquivo` recusa quando o arquivo está vinculado. O snapshot com path e hash fica na proposta. |
| Vazamento entre tenants por bug de filtro. | Filtro obrigatório por `agente_parceiro_id` em toda action, FK composta nos filhos, conferência de prefixo no storage e revisão Fable nas fatias 3, 6 e 8. |
| Dois operacionais digitam a mesma proposta na IF (trabalho duplicado na IF). | O CAS na trava impede isso. A trava renova com o modal aberto. Quando a trava expira depois de digitar sem registrar, o risco existe e é tratado pelo aviso "Proposta em digitação por X desde HH:MM" e pelo evento `trava_expirada` visível. |
| Tabela pesada com logos base64. | Mapa de logos carregado uma vez por página, nunca por linha. |
| Texto livre vira bagunça e trava os relatórios. | `pendente_normalizacao` é gerado pelo banco, o índice parcial alimenta a tela de normalização futura, e os valores continuam sempre estruturados. |
| Balão com custo (polling ou Realtime demais). | Um canal por usuário em `crm_notificacoes`, reuso dos canais existentes, reconciliação de 60 s só com a aba visível. |
| Catálogo editado no Workspace quebra propostas antigas. | Os itens nunca são apagados, só inativados. `grupo` fica denormalizado na proposta, então mudar o grupo de um status não reescreve o passado (fica registrado como decisão consciente). |

## 11. Decisões finais das perguntas em aberto (29/09/2026)

1. **DECIDIDA — Como registrar o aceite do cliente?** Caixa obrigatória "Cliente aceitou esta oferta" no modal de Solicitar digitação, gravada com autor e hora no evento `criada`. Sem estado novo na solicitação e sem prova anexada na v1.
2. **DECIDIDA — Uma simulação pode gerar mais de uma proposta?** Uma **viva** por vez (índice único parcial). Uma nova só depois que a anterior estiver em CANCELADO. Exceção à regra "simulação antes" fica para reavaliar após 30 dias de uso.
3. **DECIDIDA — O que fazer com `propostas_credito.status` (CHECK de 10 valores)?** O catálogo manda para todas as origens. O `status` legado passa a ser só o estado técnico da integração e é revisto na fatia do adaptador FyDigital, que mapeia o enum da IF → `status_proposta_id`/`situacao_proposta_id`.
4. **DECIDIDA — O Painel de Operações da BRS (`/operacoes`) mostra as propostas manuais dos parceiros?** **Não**. Filtrar `origem <> 'manual'`, porque a BRS não participa da esteira do tenant. A produção do parceiro chega à BRS depois, pelos relatórios e pela migração do ARW.
5. **DECIDIDA — A proposta deve mover `crm_ofertas.estagio` (funil AC-Oferta no WeSales)?** Sim, mas numa fatia futura. Na v1 não mexe.
6. **DECIDIDA — Qual status está configurado no ARW como "mesa de digitação"?** A fila da esteira é `digitada_em is null` e a flag só é guardada para a migração. Se o ARW usar um status próprio de "aguardando digitação", ele entra no catálogo sem mudar a regra.
7. **DECIDIDA — Onde ficam os catálogos de Status e Situação?** Menu próprio "Status e Situações de Proposta" na divisão **Cadastros** (não Operacional). Chave única `operacional-propostas-catalogos` para RBA. Status de proposta é operação e configuração, não comissão, e quem mantém a mesa pode não ter acesso às tabelas de comissão.
8. **DECIDIDA — "Obrigatório WhatsApp/e-mail ao pendenciar" (config do ARW) vale na esteira?** Não. A notificação interna + aviso no chat interno bastam. A flag fica guardada sem efeito.
