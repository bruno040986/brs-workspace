-- Agente de IA de qualificação/roteamento do CRM AlvoConsig — Fatia 1 (schema base).
-- Spec: docs/SPEC-AGENTES-IA-CRM.md (§3.1–3.5, 3.7–3.10, §7 perfil padrão v1).
-- Invariantes (§2): agente sem ferramentas; multi-tenant por agente_parceiro_id;
-- tabelas crm_agente_*/chat_agente_* só via service role (engine e actions com
-- createAdminClient após exigirComPermissao); ia_* globais, lidas/editadas pelo
-- menu Comercial › Agentes de IA do Workspace e lidas pelo engine (service role).

-- ---------------------------------------------------------------------------
-- 3.1 Flags da funcionalidade por parceiro (colunas tipadas, nunca o jsonb permissoes)
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists ia_agente_status text not null default 'desligado',
  add column if not exists ia_agente_ate timestamptz null,
  add column if not exists site_os_consig_status text not null default 'desligado',
  add column if not exists site_os_consig_ate timestamptz null;
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_ia_agente_status_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_ia_agente_status_check
  check (ia_agente_status in ('desligado', 'teste', 'pago'));
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_site_os_consig_status_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_site_os_consig_status_check
  check (site_os_consig_status in ('desligado', 'teste', 'pago'));

-- 3.2 Caixa habilitada (o parceiro liga por instância no CRM)
alter table public.chat_instancias
  add column if not exists agente_ia_ativo boolean not null default false;

-- 3.7 / 3.9 Colunas em chat_conversas: dono atual (mantido pelo engine no
-- assign/webhook) e origem do anúncio/link de entrada.
alter table public.chat_conversas
  add column if not exists atendente_atual_id uuid null references public.crm_usuarios (id) on delete set null,
  add column if not exists origem_anuncio jsonb null;

-- 3.8 Pré-lead criado pela IA
alter table public.crm_contatos drop constraint if exists crm_contatos_origem_check;
alter table public.crm_contatos
  add constraint crm_contatos_origem_check check (origem in ('alocacao', 'receptivo', 'manual', 'ia'));

-- ---------------------------------------------------------------------------
-- 3.3 Perfil do agente: tipos, padrão de fábrica versionado, overrides do parceiro
-- ---------------------------------------------------------------------------
create table if not exists public.ia_agente_tipos (
  tipo text primary key,
  nome text not null,
  descricao text null,
  schema_campos jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ia_agente_perfis_padrao (
  tipo text primary key references public.ia_agente_tipos (tipo) on delete cascade,
  perfil jsonb not null,
  versao integer not null default 1,
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

-- Imutável: espelha mensagem_templates_versoes (a app insere ao publicar).
create table if not exists public.ia_agente_perfis_padrao_versoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  versao integer not null,
  perfil jsonb not null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  unique (tipo, versao)
);

create table if not exists public.ia_conhecimento_geral (
  chave text primary key,
  titulo text not null,
  conteudo_md text not null default '',
  ordem integer not null default 0,
  ativo boolean not null default true,
  versao integer not null default 1,
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

-- Só os caminhos alterados (ex.: {"identidade.nome_assistente":"Lia"}).
create table if not exists public.crm_agente_perfis (
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  tipo text not null references public.ia_agente_tipos (tipo),
  overrides jsonb not null default '{}'::jsonb,
  versao integer not null default 1,
  atualizado_por uuid null references public.crm_usuarios (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (agente_parceiro_id, tipo)
);

create table if not exists public.crm_agente_perfis_versoes (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  tipo text not null,
  versao integer not null,
  overrides jsonb not null default '{}'::jsonb,
  atualizado_por uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_agente_perfis_versoes_idx
  on public.crm_agente_perfis_versoes (agente_parceiro_id, tipo, versao desc);

-- ---------------------------------------------------------------------------
-- 3.4 Estado da conversa do agente (engine escreve, CRM lê)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_agente_conversas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  chat_conversa_id uuid not null references public.chat_conversas (id) on delete cascade,
  chatwoot_conversation_id integer null,
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  tipo_agente text not null default 'qualificacao' references public.ia_agente_tipos (tipo),
  status text not null default 'em_qualificacao'
    check (status in ('em_qualificacao', 'aguardando_atendente', 'encerrada', 'humano_assumiu')),
  motivo_fim text null
    check (motivo_fim is null or motivo_fim in ('concluido', 'parar', 'humano_pedido', 'limite_turnos', 'limite_gasto', 'fora_expediente', 'erro_ia', 'humano_assumiu', 'transbordo')),
  turnos integer not null default 0,
  msgs_agente integer not null default 0,
  campos_coletados jsonb not null default '{}'::jsonb,
  intencao text null,
  resumo text null,
  pendente_desde timestamptz null,
  lease_ate timestamptz null,
  lease_token uuid null,
  roteado_para uuid null references public.crm_usuarios (id) on delete set null,
  roteado_em timestamptz null,
  roteamento_motivo text null,
  aviso_espera_enviado_em timestamptz null,
  perfil_versao_padrao integer null,
  perfil_versao_parceiro integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Uma só linha VIVA por conversa; encerradas ficam como histórico (§4.2.3 reabre
-- com linha nova após 24 h — por isso não é unique simples em chat_conversa_id).
create unique index if not exists chat_agente_conversas_viva_uidx
  on public.chat_agente_conversas (chat_conversa_id)
  where status in ('em_qualificacao', 'aguardando_atendente');
create index if not exists chat_agente_conversas_parceiro_status_idx
  on public.chat_agente_conversas (agente_parceiro_id, status);
create index if not exists chat_agente_conversas_tick_idx
  on public.chat_agente_conversas (status, pendente_desde) where pendente_desde is not null;
create index if not exists chat_agente_conversas_conversa_idx
  on public.chat_agente_conversas (chat_conversa_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3.5 Log de decisões e custo (append-only; nunca apiKey, nunca prompt inteiro)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_agente_log (
  id bigserial primary key,
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  chat_agente_conversa_id uuid null references public.chat_agente_conversas (id) on delete set null,
  turno integer null,
  evento text not null
    check (evento in ('turno', 'roteamento', 'encerramento', 'erro', 'pre_cadastro', 'etiqueta', 'troca_modelo_teto', 'violacao')),
  modelo text null,
  provedor text null,
  tokens_entrada integer null,
  tokens_saida integer null,
  custo_estimado_usd numeric(10, 6) null,
  latencia_ms integer null,
  json_devolvido jsonb null,
  intencao text null,
  campos_coletados jsonb null,
  motivo text null,
  erro text null,
  created_at timestamptz not null default now()
);
-- Teto de gasto/dia: sum(custo) where created_at >= hoje, por parceiro.
create index if not exists crm_agente_log_custo_idx
  on public.crm_agente_log (agente_parceiro_id, created_at desc);
create index if not exists crm_agente_log_conversa_idx
  on public.crm_agente_log (chat_agente_conversa_id, id);

-- 3.7 Ponteiro do rodízio (estado mutável fora do jsonb do perfil)
create table if not exists public.crm_agente_rodizio (
  agente_parceiro_id uuid primary key references public.agentes_parceiros (id) on delete cascade,
  ponteiro integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 3.9 Links de entrada (wa.me com sufixo curto; não confundir com crm_campanhas_parceiro)
create table if not exists public.crm_links_entrada (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  codigo text not null,
  nome text not null,
  instancia_id uuid null references public.chat_instancias (id) on delete set null,
  texto_prefixo text not null default '',
  ativo boolean not null default true,
  criado_por uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agente_parceiro_id, codigo)
);
alter table public.chat_conversas
  add column if not exists link_entrada_id uuid null references public.crm_links_entrada (id) on delete set null;

-- 4.2.7 Opt-out ("parar" grava aqui; gate consulta antes de atuar)
create table if not exists public.crm_agente_optout (
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  telefone_e164 text not null,
  motivo text null,
  created_at timestamptz not null default now(),
  primary key (agente_parceiro_id, telefone_e164)
);

-- updated_at
do $$
declare tabela text;
begin
  foreach tabela in array array['ia_agente_perfis_padrao', 'ia_conhecimento_geral', 'crm_agente_perfis', 'chat_agente_conversas', 'crm_agente_rodizio'] loop
    execute format('drop trigger if exists set_timestamp on public.%I', tabela);
    execute format('create trigger set_timestamp before update on public.%I for each row execute function trigger_set_timestamp()', tabela);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Funções atômicas do engine (security definer, só service role)
-- ---------------------------------------------------------------------------
-- Avança o ponteiro do rodízio e devolve o slot a usar (engine faz slot mod n e
-- percorre roteamento.ordem[] pulando offline/lotado — §5.2, fatia 9).
create or replace function public.crm_agente_rodizio_proximo(p_parceiro uuid)
returns integer language sql security definer set search_path = '' as $$
  insert into public.crm_agente_rodizio (agente_parceiro_id, ponteiro)
  values (p_parceiro, 0)
  on conflict (agente_parceiro_id) do update
    set ponteiro = public.crm_agente_rodizio.ponteiro + 1, updated_at = now()
  returning ponteiro;
$$;

-- Claim do tick (§4.4): conversas em qualificação com mensagem pendente há mais
-- que a janela de agrupamento e sem lease viva. Uma só réplica responde por
-- conversa. A janela é política de canal (código): o engine chama uma vez por
-- grupo de provedores (ycloud 8 s; baileys/zapi 4 s). p_provedores nulo = todos.
create or replace function public.crm_agente_turno_claim(
  p_limit integer default 10,
  p_janela_s integer default 4,
  p_lease_s integer default 60,
  p_provedores text[] default null
)
returns setof public.chat_agente_conversas language sql security definer set search_path = '' as $$
  with cand as (
    select c.id
    from public.chat_agente_conversas c
    join public.chat_instancias i on i.id = c.instancia_id
    where c.status = 'em_qualificacao'
      and c.pendente_desde is not null
      and c.pendente_desde < clock_timestamp() - make_interval(secs => p_janela_s)
      and (c.lease_ate is null or c.lease_ate < clock_timestamp())
      and (p_provedores is null or i.provedor = any (p_provedores))
    order by c.pendente_desde
    limit greatest(p_limit, 0)
    for update of c skip locked
  )
  update public.chat_agente_conversas c
  set lease_ate = clock_timestamp() + make_interval(secs => p_lease_s),
      lease_token = gen_random_uuid(),
      updated_at = now()
  from cand
  where c.id = cand.id
  returning c.*;
$$;

revoke all on function public.crm_agente_rodizio_proximo(uuid), public.crm_agente_turno_claim(integer, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.crm_agente_rodizio_proximo(uuid), public.crm_agente_turno_claim(integer, integer, integer, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Tabelas do CRM/engine: RLS ligado e nenhuma policy — só service role.
do $$
declare tabela text; t regclass;
begin
  foreach tabela in array array['crm_agente_perfis', 'crm_agente_perfis_versoes', 'chat_agente_conversas', 'crm_agente_log', 'crm_agente_rodizio', 'crm_links_entrada', 'crm_agente_optout'] loop
    t := app_private.enable_rls_if_exists(tabela);
    execute format('revoke all on public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on public.%I to service_role', tabela);
  end loop;
end $$;
grant usage, select on sequence public.crm_agente_log_id_seq to service_role;

-- Globais do Workspace: leitura/escrita por permissão do menu Agentes de IA.
do $$
declare
  t regclass; tabela text;
  ler text := 'app_private.has_permission(''comercial-agentes-ia'', ''can_view'')';
  escrever text := 'app_private.has_permission(''comercial-agentes-ia'', ''can_edit'')';
begin
  foreach tabela in array array['ia_agente_tipos', 'ia_agente_perfis_padrao', 'ia_agente_perfis_padrao_versoes', 'ia_conhecimento_geral'] loop
    t := app_private.enable_rls_if_exists(tabela);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT', ler);
    perform app_private.apply_policy(t, tabela || '_insert_permitted', 'INSERT', null, escrever);
    perform app_private.apply_policy(t, tabela || '_update_permitted', 'UPDATE', escrever, escrever);
    perform app_private.apply_policy(t, tabela || '_delete_permitted', 'DELETE', escrever);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3.10 Permissões
-- ---------------------------------------------------------------------------
-- CRM: config.agente_ia para master e operacional (chave de LLM segue em config.editar_canais).
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'config.agente_ia'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave in ('master', 'operacional')
on conflict do nothing;

-- Workspace: comercial-agentes-ia (regra dos 4 pontos), seed a partir de quem é root.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'comercial-agentes-ia', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'comercial-agentes-ia', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

-- ---------------------------------------------------------------------------
-- Seed: tipo 'qualificacao' + perfil padrão v1 (§7.1) + BC geral inicial
-- ---------------------------------------------------------------------------
insert into public.ia_agente_tipos (tipo, nome, descricao, schema_campos) values (
  'qualificacao',
  'Qualificação e roteamento',
  'Acolhe o lead que escreve sem cadastro, coleta os dados mínimos, classifica a intenção e entrega a um atendente humano online.',
  '["identidade","tom","objetivo","limites","coleta","pos_qualificacao","roteamento","modelos","tempos","horario"]'::jsonb
) on conflict (tipo) do nothing;

insert into public.ia_agente_perfis_padrao (tipo, perfil, versao) values (
  'qualificacao',
  $perfil${
    "identidade": { "nome_assistente": "Lia" },
    "tom": "cordial, direto, linguagem simples, 1 pergunta por vez, sem gírias, sem emojis em excesso (máx. 1 por mensagem), trata por 'você'",
    "objetivo": "entender o que a pessoa procura, coletar os dados mínimos e passar para um atendente humano",
    "limites": {
      "max_turnos": 10,
      "max_msgs_agente": { "ycloud": 10, "baileys": 25, "zapi": 25 },
      "gasto_dia_max_usd": 5.00,
      "proibicoes": [
        "informar taxa, juros, valor de parcela ou valor liberado",
        "dizer que está aprovado ou garantido",
        "pedir CPF na primeira mensagem",
        "pedir senha, cartão, código SMS",
        "falar de outros produtos além dos listados",
        "prometer prazo de pagamento"
      ]
    },
    "coleta": [
      { "ordem": 1, "campo": "nome", "obrigatorio": true, "pergunta": "como posso te chamar?" },
      { "ordem": 2, "campo": "produto", "obrigatorio": true, "opcoes": ["consignado_inss", "consignado_publico", "consignado_privado_clt", "fgts", "cartao_beneficio", "portabilidade", "outro"] },
      { "ordem": 3, "campo": "vinculo", "obrigatorio": true, "descricao": "texto curto: aposentado/pensionista, servidor de qual órgão, CLT, …" },
      { "ordem": 4, "campo": "cidade_uf", "obrigatorio": false },
      { "ordem": 5, "campo": "cpf", "obrigatorio": false, "so_se_quer_simulacao": true, "nunca_no_turno_1": true, "validar_dv": true,
        "justificativa_lgpd": "Preciso do seu CPF só para consultar a margem disponível. O dado é protegido e usado apenas para isso." },
      { "ordem": 6, "campo": "melhor_horario", "obrigatorio": false, "opcoes": ["manha", "tarde", "noite"] },
      { "ordem": 7, "campo": "sobrenome", "obrigatorio": false, "descricao": "pedido junto com o nome quando natural" }
    ],
    "pos_qualificacao": {
      "pedir_documento": false,
      "mensagem_transferencia": "Perfeito, {nome}. Vou te passar para {atendente}, que confirma valores e condições com você. Só um instante.",
      "mensagem_espera": "Nossos atendentes estão em atendimento agora. Sua conversa já está na fila e o primeiro que ficar livre te chama por aqui, {nome}.",
      "mensagem_fora_expediente": "Oi! Nosso atendimento humano funciona {horario}. Já deixei seu interesse registrado e a equipe te chama na abertura.",
      "mensagem_fallback_erro": "Vou te passar para a nossa equipe, que segue com você por aqui.",
      "mensagem_optout": "Tudo bem, não vou mais te escrever. Se mudar de ideia, é só mandar mensagem."
    },
    "roteamento": {
      "modo": "rodizio",
      "master_id": null,
      "atendente_fixo_id": null,
      "ordem": [],
      "max_abertas": 5,
      "espera_master_min": 15,
      "destinos": {
        "quer_credito": "equipe_humana", "quer_simulacao": "equipe_humana", "duvida_produto": "equipe_humana",
        "ja_cliente": "equipe_humana", "quer_humano": "equipe_humana",
        "fora_de_escopo": "encerrar", "parar": "encerrar", "spam": "encerrar"
      }
    },
    "modelos": {
      "provedor": "openrouter",
      "principal": "anthropic/claude-sonnet-4.5",
      "fallbacks": ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"],
      "fallback_gratuito": null
    },
    "tempos": {
      "agrupar_s": { "ycloud": 8, "baileys": 4, "zapi": 4 },
      "digitacao_ms_por_char": 25, "digitacao_min_ms": 1500, "digitacao_max_ms": 4000, "digitacao_oficial_ms": 0
    },
    "horario": { "janela": null, "fuso": "America/Sao_Paulo" }
  }$perfil$::jsonb,
  1
) on conflict (tipo) do nothing;

insert into public.ia_agente_perfis_padrao_versoes (tipo, versao, perfil)
select tipo, versao, perfil from public.ia_agente_perfis_padrao where tipo = 'qualificacao'
on conflict (tipo, versao) do nothing;

insert into public.ia_conhecimento_geral (chave, titulo, conteudo_md, ordem) values
  ('credito-consignado', 'O que é crédito consignado',
   'Empréstimo em que as parcelas são descontadas direto da folha (salário, aposentadoria ou pensão). Por isso costuma ter condições melhores que outros empréstimos. O quanto a pessoa pode comprometer da renda é a **margem consignável**, definida por lei e consultada pelo atendente. Quem confirma margem, valor, prazo e condições é sempre o atendente humano.', 1),
  ('produtos', 'Produtos que podem ser oferecidos',
   '- **Consignado INSS**: aposentados e pensionistas do INSS.
- **Consignado público**: servidores públicos (federal, estadual ou municipal), conforme convênio do órgão.
- **Consignado privado (CLT)**: trabalhadores com carteira assinada, com desconto em folha pela empresa.
- **Antecipação do FGTS**: antecipa parcelas do saque-aniversário do FGTS.
- **Cartão benefício / consignado**: cartão com desconto da parcela em folha.
- **Portabilidade**: traz um contrato de outro banco para renegociar condições.
Cada produto depende do vínculo da pessoa e do convênio disponível; o atendente confirma se ela se encaixa.', 2),
  ('limites-do-atendimento', 'O que a assistente não faz',
   'A assistente virtual acolhe, explica em linguagem simples e reúne os dados mínimos. Ela **não** informa taxa, juros, valor de parcela ou valor liberado, **não** diz que algo está aprovado ou garantido e **não** promete prazo de pagamento — tudo isso é confirmado pelo atendente. Nunca pede senha, cartão ou código SMS. O CPF só é pedido quando a pessoa quer simulação, com a explicação de que é necessário para consultar a margem e que o dado é protegido.', 3)
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
