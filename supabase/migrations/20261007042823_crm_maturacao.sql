-- Aquecimento de Números (nome interno: MATURAÇÃO) — fatia S0 (banco).
-- Spec: .claude/tmp/spec-aquecimento.md (C.1-C.3, E) + decisões do Bruno 06-07/10/2026.
--
-- NOMES: tudo `crm_maturacao_*` / `maturacao_*`. "aquecimento" no banco já é a
-- QUARENTENA (`crm_parceiro_config.disparo_aquecimento_horas`, situação
-- `em_aquecimento` no engine). Maturar NÃO libera a quarentena.
--
-- CONTRATO (o que o engine/web podem assumir):
--  * Só números Baileys do MESMO parceiro, COM PROXY (`proxy_configurado`),
--    papel disparo|receptiva, não banidos, sem restrição vigente, não excluídos.
--    Garantido no banco pelo gatilho de `crm_maturacao_membros` (check_violation
--    'MATURACAO_INSTANCIA_INELEGIVEL'). Não existe pool "sem proxy".
--  * Passo só entre dois MEMBROS do MESMO plano (FKs compostas): não existe
--    campo de destino livre, nunca contato real.
--  * Todas as tabelas: RLS ligado, SEM policy, só service_role (engine e server
--    actions com cliente admin + permissão `config.maturacao`). Fora do Realtime.
--  * Liberação por parceiro: `crm_parceiro_config.maturacao_status` (desligado|
--    teste|pago) + `maturacao_ate` (fim do dia, Brasília; nulo = sem prazo).
--    O claim só entrega passo com flag vigente.
--  * Kill switch: `crm_maturacao_parametros.desligado_em` (linha global com
--    agente_parceiro_id nulo, ou por parceiro). Ligar cancela as execuções em
--    andamento do escopo; o claim não entrega nada enquanto estiver ligado.
--  * Paradas automáticas (gatilhos): evento de saúde em chat_instancia_eventos
--    (401/403 repetido/conflito, restrição, banimento, reconexão falhou, falha
--    ou remoção de proxy, exclusão — exceto `sessao_substituida`), ou proxy
--    removido / banida_em / restrito_ate / deleted_at / troca de provedor ou
--    parceiro em chat_instancias → membro `parado_auto`, plano pausado por
--    `pausa_automatica_min` (padrão 60) e volta sozinho SEM o número; passos
--    pendentes do número cancelados; evento com origem 'gatilho'.
--    Flag desligada ou plano parado/excluído → cancela execuções do escopo.
--  * Teto diário por número (dia de Brasília) = mensagens de maturação + envios
--    de disparo do dia; o claim não entrega acima de
--    least(plano.teto_diario_por_numero, parametros.teto_diario_max).
--  * RPCs (service_role): crm_maturacao_claim, _concluir, _adiar,
--    _criar_execucao, _parar_instancia.
--  * Sem PII: eventos só com códigos (motivo ^[a-z0-9_]+$) e observação sem
--    sequência de 8+ dígitos; trechos sem 6+ dígitos seguidos.
--
-- TAMBÉM APAGA o esquema antigo e nunca usado de "tráfego técnico"
-- (crm_disparo_trafego_tecnico, crm_parceiro_config.trafego_tecnico_*,
-- chat_conversas.origem='tecnico'). Conferido em produção em 07/10/2026
-- (SELECT): 0 linhas, 0 parceiros habilitados, 0 conversas 'tecnico'; sem
-- referência no código do Workspace nem do CRM (só tests/db/decisoes-0509.sql
-- do brs-alvoconsig, que precisa ser ajustado junto). A migration ABORTA se
-- encontrar dados.
--
-- ORDEM DE PUBLICAÇÃO: (1) esta migration (`supabase db push`), (2) Workspace
-- (lê/grava maturacao_status/ate — antes da migration o select da aba quebra),
-- (3) engine com MATURACAO_DESLIGADO=true, (4) web do CRM.
--
-- ROLLBACK (manual, só se nada estiver usando; perde planos/execuções):
--   drop trigger if exists crm_maturacao_evento_instancia_trg on public.chat_instancia_eventos;
--   drop trigger if exists crm_maturacao_instancia_trg on public.chat_instancias;
--   drop trigger if exists crm_maturacao_flag_trg on public.crm_parceiro_config;
--   drop table if exists public.crm_maturacao_passos, public.crm_maturacao_execucoes,
--     public.crm_maturacao_membros, public.crm_maturacao_eventos, public.crm_maturacao_planos,
--     public.crm_maturacao_recebidas, public.crm_maturacao_trechos, public.crm_maturacao_fontes,
--     public.crm_maturacao_parametros cascade;
--   drop function if exists public.crm_maturacao_claim(uuid[], integer, integer),
--     public.crm_maturacao_concluir(uuid, uuid, text, text, text, timestamptz, timestamptz),
--     public.crm_maturacao_adiar(uuid, uuid, timestamptz, text),
--     public.crm_maturacao_criar_execucao(uuid, date, timestamptz, timestamptz, bigint, jsonb, jsonb),
--     public.crm_maturacao_parar_instancia(uuid, text, text, text),
--     public.crm_maturacao_cancelar(uuid, uuid, text),
--     app_private.crm_maturacao_validar_membro(), app_private.crm_maturacao_ao_evento_instancia(),
--     app_private.crm_maturacao_ao_mudar_instancia(), app_private.crm_maturacao_ao_mudar_flag(),
--     app_private.crm_maturacao_ao_mudar_plano(), app_private.crm_maturacao_ao_kill_switch();
--   alter table public.crm_parceiro_config drop column if exists maturacao_status, drop column if exists maturacao_ate;
--   alter table public.chat_instancias drop column if exists wa_lid;
--   delete from public.crm_perfis_permissoes where permissao = 'config.maturacao';
--   (o tráfego técnico apagado NÃO volta: recriar com 20260905125422 se preciso.)
--
-- Idempotente: pode rodar duas vezes sem efeito na segunda.

-- `supabase db push` não roda a migration em transação: `set local` não vale.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Apaga o "tráfego técnico" antigo (só se vazio)
-- ---------------------------------------------------------------------------
do $$
declare v boolean;
begin
  if to_regclass('public.crm_disparo_trafego_tecnico') is not null then
    execute 'select exists (select 1 from public.crm_disparo_trafego_tecnico)' into v;
    if v then raise exception 'crm_disparo_trafego_tecnico tem linhas: conferir antes de apagar'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'crm_parceiro_config' and column_name = 'trafego_tecnico_habilitado') then
    execute 'select exists (select 1 from public.crm_parceiro_config where trafego_tecnico_habilitado)' into v;
    if v then raise exception 'há parceiro com trafego_tecnico_habilitado: conferir antes de apagar'; end if;
  end if;
  if exists (select 1 from public.chat_conversas where origem = 'tecnico') then
    raise exception 'há chat_conversas com origem tecnico: conferir antes de apagar';
  end if;
end $$;

drop table if exists public.crm_disparo_trafego_tecnico;
drop index if exists public.chat_conversas_tecnico_idx;
alter table public.crm_parceiro_config
  drop column if exists trafego_tecnico_habilitado,
  drop column if exists trafego_tecnico_min_numeros,
  drop column if exists trafego_tecnico_destinatarios_por_ciclo,
  drop column if exists trafego_tecnico_max_ciclos_dia_por_numero;

-- Só reescreve o CHECK se ainda aceita 'tecnico' (NOT VALID + VALIDATE: o scan
-- não segura o lock exclusivo).
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.chat_conversas'::regclass
             and conname = 'chat_conversas_origem_check' and pg_get_constraintdef(oid) like '%tecnico%') then
    alter table public.chat_conversas drop constraint chat_conversas_origem_check;
    alter table public.chat_conversas add constraint chat_conversas_origem_check
      check (origem in ('organica', 'disparo')) not valid;
    alter table public.chat_conversas validate constraint chat_conversas_origem_check;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Colunas novas
-- ---------------------------------------------------------------------------
alter table public.crm_parceiro_config
  add column if not exists maturacao_status text not null default 'desligado',
  add column if not exists maturacao_ate timestamptz null;
alter table public.crm_parceiro_config drop constraint if exists crm_parceiro_config_maturacao_status_check;
alter table public.crm_parceiro_config add constraint crm_parceiro_config_maturacao_status_check
  check (maturacao_status in ('desligado', 'teste', 'pago'));
comment on column public.crm_parceiro_config.maturacao_status is
  'Aquecimento de Números (maturação): desligado|teste|pago. Ativa se teste|pago e (maturacao_ate nulo ou >= agora). Editado no Workspace.';
comment on column public.crm_parceiro_config.maturacao_ate is
  'Validade da liberação do Aquecimento de Números (fim do dia, Brasília). Nulo = sem prazo.';

alter table public.chat_instancias add column if not exists wa_lid text null;
comment on column public.chat_instancias.wa_lid is
  'LID do próprio número (sock.user.lid), gravado pelo engine no open. Usado pelo filtro da maturação para reconhecer mensagens entre números do pool.';

-- ---------------------------------------------------------------------------
-- 3. Tabelas
-- ---------------------------------------------------------------------------
-- Parâmetros e kill switch: linha global (agente_parceiro_id nulo) + por parceiro.
create table if not exists public.crm_maturacao_parametros (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid null references public.agentes_parceiros (id) on delete cascade,
  teto_diario_max integer not null default 60 check (teto_diario_max between 1 and 500),
  pausa_automatica_min integer not null default 60 check (pausa_automatica_min between 15 and 1440),
  desligado_em timestamptz null,
  desligado_motivo text null check (desligado_motivo is null or char_length(desligado_motivo) <= 300),
  desligado_por uuid null,
  updated_at timestamptz not null default now(),
  constraint crm_maturacao_parametros_parceiro_key unique nulls not distinct (agente_parceiro_id)
);
comment on table public.crm_maturacao_parametros is
  'Maturação: teto e pausa automática + KILL SWITCH (desligado_em). Linha com agente_parceiro_id nulo = global. Vale o mais restritivo entre global e parceiro.';
comment on column public.crm_maturacao_parametros.desligado_por is 'auth.users.id (Workspace) ou crm_usuarios.id de quem ligou o kill switch.';
insert into public.crm_maturacao_parametros (agente_parceiro_id) values (null) on conflict do nothing;

create table if not exists public.crm_maturacao_planos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  preset text not null default 'circulos' check (preset in ('circulos', 'todos', 'pares', 'alvo')),
  alvo_instancia_id uuid null references public.chat_instancias (id) on delete set null,
  faixas jsonb null,
  pausas jsonb not null default '[]' check (jsonb_typeof(pausas) = 'array'),
  dias_semana smallint[] not null default '{1,2,3,4,5,6,7}' check (dias_semana <@ '{1,2,3,4,5,6,7}'::smallint[]),
  hora_inicio time not null default '09:00',
  duracao_max_min integer not null default 720 check (duracao_max_min between 30 and 720),
  teto_diario_por_numero integer not null default 60 check (teto_diario_por_numero between 1 and 500),
  ceder_vez_s integer not null default 90 check (ceder_vez_s between 0 and 3600),
  rampa_idade boolean not null default false,
  fontes text[] not null default '{}',
  status text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado', 'parado')),
  pausado_ate timestamptz null,
  pausa_motivo text null check (pausa_motivo is null or pausa_motivo ~ '^[a-z0-9_]{1,80}$'),
  seed bigint not null default (floor(random() * 2147483647))::bigint,
  created_by uuid null references public.crm_usuarios (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  check (faixas is null or jsonb_typeof(faixas) = 'array'),
  check (preset <> 'alvo' or alvo_instancia_id is not null)
);
comment on table public.crm_maturacao_planos is
  'Maturação: plano por parceiro. status ativo + pausado_ate futuro = pausa automática (volta sozinho); status pausado = pausa manual.';
create index if not exists crm_maturacao_planos_parceiro_idx on public.crm_maturacao_planos (agente_parceiro_id) where deleted_at is null;

-- Membros = persona + círculo (proximos) por número. Uma instância em um plano só.
create table if not exists public.crm_maturacao_membros (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.crm_maturacao_planos (id) on delete cascade,
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  persona jsonb not null default '{}' check (jsonb_typeof(persona) = 'object'),
  persona_origem text not null default 'auto' check (persona_origem in ('auto', 'manual')),
  proximos uuid[] not null default '{}',
  status text not null default 'ativo' check (status in ('ativo', 'parado_auto', 'removido')),
  parado_em timestamptz null,
  parado_motivo text null check (parado_motivo is null or parado_motivo ~ '^[a-z0-9_]{1,80}$'),
  entrou_em timestamptz not null default now(),
  constraint crm_maturacao_membros_plano_instancia_key unique (plano_id, instancia_id),
  check (not (instancia_id = any (proximos)))
);
comment on column public.crm_maturacao_membros.proximos is
  'Círculo: 1-2 instâncias (membros do mesmo plano) que levam ~70% das iniciativas. Validado pelo planejador.';
create unique index if not exists crm_maturacao_membros_uma_vez_idx
  on public.crm_maturacao_membros (instancia_id) where status <> 'removido';

create table if not exists public.crm_maturacao_execucoes (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.crm_maturacao_planos (id) on delete cascade,
  dia date not null,
  inicio_em timestamptz not null,
  fim_em timestamptz not null,
  status text not null default 'ativa' check (status in ('ativa', 'encerrada', 'cancelada')),
  motivo_fim text null check (motivo_fim is null or motivo_fim ~ '^[a-z0-9_]{1,80}$'),
  seed bigint not null,
  snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint crm_maturacao_execucoes_plano_dia_key unique (plano_id, dia),
  constraint crm_maturacao_execucoes_id_plano_key unique (id, plano_id),
  check (fim_em > inicio_em and fim_em <= inicio_em + interval '12 hours')
);
create index if not exists crm_maturacao_execucoes_ativas_idx on public.crm_maturacao_execucoes (fim_em) where status = 'ativa';

-- Corpus: SÓ domínio público, CC0 ou frases próprias (sem CC BY / CC BY-SA, sem upload).
create table if not exists public.crm_maturacao_fontes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_-]{1,60}$'),
  titulo text not null,
  autor text null,
  licenca text not null check (licenca in ('dominio_publico', 'cc0', 'proprio')),
  justificativa text not null check (char_length(justificativa) between 5 and 500),
  url_origem text null,
  padrao boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
comment on column public.crm_maturacao_fontes.justificativa is
  'Por que é domínio público/CC0 (ex.: autor falecido em 1908, Lei 9.610 art. 41) ou "frases próprias BRS".';

create table if not exists public.crm_maturacao_trechos (
  id uuid primary key default gen_random_uuid(),
  fonte_id uuid not null references public.crm_maturacao_fontes (id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 280 and texto !~ '[0-9]{6,}'),
  chars integer generated always as (char_length(texto)) stored,
  frases smallint not null default 1 check (frases between 1 and 5),
  tipo text not null default 'trecho' check (tipo in ('saudacao', 'pergunta', 'comentario', 'reacao', 'fechamento', 'trecho')),
  tema text null,
  hash text not null unique,
  bloqueado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_maturacao_trechos_fonte_idx on public.crm_maturacao_trechos (fonte_id, tipo) where not bloqueado;

-- Fila de passos (mensagens e leituras) + auditoria. Passo k+1 nasce 'aguardando'
-- e vira 'pendente' quando o k conclui (crm_maturacao_concluir).
create table if not exists public.crm_maturacao_passos (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid not null,
  plano_id uuid not null,
  sessao_id uuid not null,
  ordem smallint not null check (ordem >= 1),
  acao text not null default 'mensagem' check (acao in ('mensagem', 'leitura')),
  ref_passo_id uuid null references public.crm_maturacao_passos (id) on delete cascade,
  remetente_instancia_id uuid not null,
  destinatario_instancia_id uuid not null,
  papel text null check (papel in ('abertura', 'resposta', 'fechamento')),
  texto text null check (texto is null or char_length(texto) between 1 and 1000),
  trecho_id uuid null references public.crm_maturacao_trechos (id) on delete set null,
  digitar_ms integer not null default 0 check (digitar_ms >= 0),
  atraso_ms integer null check (atraso_ms >= 0),
  agendado_para timestamptz null,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'pendente', 'enviando', 'enviado', 'incerto', 'cancelado', 'pulado', 'falhou')),
  motivo text null check (motivo is null or motivo ~ '^[a-z0-9_]{1,80}$'),
  tentativas integer not null default 0,
  adiamentos integer not null default 0,
  lease_token uuid null,
  lease_until timestamptz null,
  wa_id text null,
  enviado_em timestamptz null,
  created_at timestamptz not null default now(),
  constraint crm_maturacao_passos_execucao_fk foreign key (execucao_id, plano_id)
    references public.crm_maturacao_execucoes (id, plano_id) on delete cascade,
  constraint crm_maturacao_passos_remetente_fk foreign key (plano_id, remetente_instancia_id)
    references public.crm_maturacao_membros (plano_id, instancia_id) on delete cascade,
  constraint crm_maturacao_passos_destinatario_fk foreign key (plano_id, destinatario_instancia_id)
    references public.crm_maturacao_membros (plano_id, instancia_id) on delete cascade,
  check (remetente_instancia_id <> destinatario_instancia_id),
  check ((acao = 'mensagem' and texto is not null and ref_passo_id is null)
      or (acao = 'leitura' and texto is null and ref_passo_id is not null)),
  check (status <> 'pendente' or agendado_para is not null)
);
create index if not exists crm_maturacao_passos_pendentes_idx on public.crm_maturacao_passos (agendado_para) where status = 'pendente';
create index if not exists crm_maturacao_passos_enviando_idx on public.crm_maturacao_passos (lease_until) where status = 'enviando';
create index if not exists crm_maturacao_passos_sessao_idx on public.crm_maturacao_passos (execucao_id, sessao_id, ordem);
create index if not exists crm_maturacao_passos_enviados_dia_idx on public.crm_maturacao_passos (remetente_instancia_id, enviado_em) where status = 'enviado';
create index if not exists crm_maturacao_passos_monitor_idx on public.crm_maturacao_passos (plano_id, created_at desc);
create index if not exists crm_maturacao_passos_wa_id_idx on public.crm_maturacao_passos (wa_id) where wa_id is not null;
create index if not exists crm_maturacao_passos_destinatario_idx on public.crm_maturacao_passos (destinatario_instancia_id) where status in ('pendente', 'aguardando');
create index if not exists crm_maturacao_passos_ref_idx on public.crm_maturacao_passos (ref_passo_id) where ref_passo_id is not null;

-- Mensagens do pool recebidas (gravadas pelo filtro do engine): key para readMessages.
create table if not exists public.crm_maturacao_recebidas (
  instancia_id uuid not null references public.chat_instancias (id) on delete cascade,
  wa_id text not null,
  remote_jid text not null,
  recebido_em timestamptz not null default now(),
  primary key (instancia_id, wa_id)
);
create index if not exists crm_maturacao_recebidas_em_idx on public.crm_maturacao_recebidas (recebido_em);

-- Log sem PII (só códigos). Eventos por número também ficam aqui (instancia_id).
create table if not exists public.crm_maturacao_eventos (
  id bigint generated always as identity primary key,
  agente_parceiro_id uuid null references public.agentes_parceiros (id) on delete cascade,
  plano_id uuid null references public.crm_maturacao_planos (id) on delete cascade,
  instancia_id uuid null references public.chat_instancias (id) on delete set null,
  tipo text not null check (tipo in ('iniciado', 'pausado', 'retomado', 'parado', 'pausa_automatica', 'pausa_suspensa_aceite',
    'membro_parado', 'membro_reincluido_aceite', 'execucao_encerrada', 'execucao_cancelada', 'teto_atingido', 'entrega_falhou',
    'alerta', 'kill_switch_ligado', 'kill_switch_desligado')),
  motivo text null check (motivo is null or motivo ~ '^[a-z0-9_]{1,80}$'),
  observacao text null check (observacao is null or (char_length(observacao) <= 500 and observacao !~ '[0-9]{8,}')),
  origem text not null check (origem in ('engine', 'usuario', 'gatilho')),
  autor_crm_usuario_id uuid null references public.crm_usuarios (id) on delete set null,
  aceite_risco boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_maturacao_eventos_plano_idx on public.crm_maturacao_eventos (plano_id, created_at desc);
create index if not exists crm_maturacao_eventos_instancia_idx on public.crm_maturacao_eventos (instancia_id, created_at desc) where instancia_id is not null;
create index if not exists crm_maturacao_eventos_parceiro_idx on public.crm_maturacao_eventos (agente_parceiro_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Elegibilidade do membro (a "constraint" de proxy/papel/parceiro)
-- ---------------------------------------------------------------------------
create or replace function app_private.crm_maturacao_validar_membro()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'ativo' then return new; end if;
  if not exists (
    select 1
    from public.chat_instancias i
    join public.crm_maturacao_planos p on p.id = new.plano_id
    where i.id = new.instancia_id
      and i.agente_parceiro_id = p.agente_parceiro_id
      and i.deleted_at is null
      and i.provedor = 'baileys'
      and i.papel in ('disparo', 'receptiva')
      and i.proxy_configurado
      and i.banida_em is null
      and (i.restrito_ate is null or i.restrito_ate <= now())
  ) then
    raise exception using errcode = 'check_violation',
      message = 'MATURACAO_INSTANCIA_INELEGIVEL: só número Baileys do mesmo parceiro, com proxy, não banido, sem restrição vigente e não excluído';
  end if;
  return new;
end $$;
drop trigger if exists crm_maturacao_membros_validar_trg on public.crm_maturacao_membros;
create trigger crm_maturacao_membros_validar_trg
  before insert or update of status, instancia_id, plano_id on public.crm_maturacao_membros
  for each row execute function app_private.crm_maturacao_validar_membro();

-- ---------------------------------------------------------------------------
-- 5. Paradas automáticas
-- ---------------------------------------------------------------------------
-- Para o número em qualquer plano ativo: membro parado_auto, plano pausado por
-- N min (volta sozinho sem o número), passos pendentes do número cancelados.
create or replace function public.crm_maturacao_parar_instancia(
  p_instancia uuid, p_motivo text, p_origem text default 'engine', p_observacao text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; v_min integer;
begin
  for r in
    update public.crm_maturacao_membros m
    set status = 'parado_auto', parado_em = now(), parado_motivo = p_motivo
    where m.instancia_id = p_instancia and m.status = 'ativo'
    returning m.plano_id
  loop
    n := n + 1;
    select coalesce(max(pa.pausa_automatica_min), 60) into v_min
    from public.crm_maturacao_parametros pa
    join public.crm_maturacao_planos p on p.id = r.plano_id
    where pa.agente_parceiro_id is null or pa.agente_parceiro_id = p.agente_parceiro_id;

    update public.crm_maturacao_planos
    set pausado_ate = greatest(coalesce(pausado_ate, now()), now() + make_interval(mins => v_min)),
        pausa_motivo = p_motivo, updated_at = now()
    where id = r.plano_id;

    update public.crm_maturacao_passos
    set status = 'cancelado', motivo = 'instancia_parada', lease_token = null, lease_until = null
    where plano_id = r.plano_id and status in ('pendente', 'aguardando')
      and (remetente_instancia_id = p_instancia or destinatario_instancia_id = p_instancia);

    insert into public.crm_maturacao_eventos (agente_parceiro_id, plano_id, instancia_id, tipo, motivo, observacao, origem)
    select p.agente_parceiro_id, p.id, p_instancia, 'membro_parado', p_motivo, p_observacao, p_origem
    from public.crm_maturacao_planos p where p.id = r.plano_id
    union all
    select p.agente_parceiro_id, p.id, null, 'pausa_automatica', p_motivo, null, p_origem
    from public.crm_maturacao_planos p where p.id = r.plano_id;
  end loop;
  return n;
end $$;

-- Cancela execuções ativas do escopo (parceiro e/ou plano; ambos nulos = tudo).
create or replace function public.crm_maturacao_cancelar(p_parceiro uuid, p_plano uuid, p_motivo text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with ex as (
    update public.crm_maturacao_execucoes e
    set status = 'cancelada', motivo_fim = p_motivo
    from public.crm_maturacao_planos p
    where p.id = e.plano_id and e.status = 'ativa'
      and (p_parceiro is null or p.agente_parceiro_id = p_parceiro)
      and (p_plano is null or p.id = p_plano)
    returning e.id, e.plano_id, p.agente_parceiro_id
  ), ps as (
    update public.crm_maturacao_passos s
    set status = 'cancelado', motivo = p_motivo, lease_token = null, lease_until = null
    from ex where s.execucao_id = ex.id and s.status in ('pendente', 'aguardando')
  )
  insert into public.crm_maturacao_eventos (agente_parceiro_id, plano_id, tipo, motivo, origem)
  select agente_parceiro_id, plano_id, 'execucao_cancelada', p_motivo, 'gatilho' from ex;
  get diagnostics n = row_count;
  return n;
end $$;

-- 5.1 Evento de saúde do número (registrado pelo engine OU pela web).
create or replace function app_private.crm_maturacao_ao_evento_instancia()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 440 "sessão substituída" é deploy/troca de container, não sinal de saúde (P2).
  if coalesce(new.observacao, '') like '%sessao_substituida%' then return null; end if;
  begin
    perform public.crm_maturacao_parar_instancia(
      new.instancia_id,
      'evento_' || new.tipo || coalesce('_' || new.motivo, ''),
      'gatilho',
      (select 'código ' || m[1] from regexp_match(coalesce(new.observacao, ''), 'código ([0-9]{3})') m));
  exception when others then
    -- Nunca perder o evento de saúde por causa da maturação.
    raise warning 'crm_maturacao: falha ao parar instância %: %', new.instancia_id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_maturacao_evento_instancia_trg on public.chat_instancia_eventos;
create trigger crm_maturacao_evento_instancia_trg
  after insert on public.chat_instancia_eventos
  for each row
  when (new.tipo in ('desconexao_externa', 'restricao', 'banimento', 'reconexao_falhou', 'proxy_falha', 'proxy_removido', 'exclusao')
        or (new.tipo = 'reconexao' and new.motivo in ('banimento', 'restricao_meta')))
  execute function app_private.crm_maturacao_ao_evento_instancia();

-- 5.2 Mudança no cadastro do número que o torna inelegível.
create or replace function app_private.crm_maturacao_ao_mudar_instancia()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_motivo text;
begin
  v_motivo := case
    when new.deleted_at is not null and old.deleted_at is null then 'instancia_excluida'
    when new.proxy_url_cifrada is null and old.proxy_url_cifrada is not null then 'proxy_removido'
    when new.banida_em is not null and old.banida_em is null then 'banida'
    when new.restrito_ate > now() and new.restrito_ate is distinct from old.restrito_ate then 'restricao_vigente'
    when new.provedor is distinct from old.provedor then 'provedor_alterado'
    when new.agente_parceiro_id is distinct from old.agente_parceiro_id then 'parceiro_alterado'
  end;
  if v_motivo is null then return null; end if;
  begin
    perform public.crm_maturacao_parar_instancia(new.id, v_motivo, 'gatilho', null);
  exception when others then
    raise warning 'crm_maturacao: falha ao parar instância %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_maturacao_instancia_trg on public.chat_instancias;
create trigger crm_maturacao_instancia_trg
  after update of deleted_at, proxy_url_cifrada, banida_em, restrito_ate, provedor, agente_parceiro_id on public.chat_instancias
  for each row execute function app_private.crm_maturacao_ao_mudar_instancia();

-- 5.3 Flag do parceiro desligada no Workspace → cancela execuções do parceiro.
create or replace function app_private.crm_maturacao_ao_mudar_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_maturacao_cancelar(new.agente_parceiro_id, null, 'flag_desligada');
  return null;
end $$;
drop trigger if exists crm_maturacao_flag_trg on public.crm_parceiro_config;
create trigger crm_maturacao_flag_trg
  after update of maturacao_status on public.crm_parceiro_config
  for each row when (new.maturacao_status = 'desligado' and old.maturacao_status <> 'desligado')
  execute function app_private.crm_maturacao_ao_mudar_flag();

-- 5.4 Plano parado ou excluído → cancela as execuções dele.
create or replace function app_private.crm_maturacao_ao_mudar_plano()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_maturacao_cancelar(null, new.id, case when new.deleted_at is not null then 'plano_excluido' else 'plano_parado' end);
  return null;
end $$;
drop trigger if exists crm_maturacao_plano_trg on public.crm_maturacao_planos;
create trigger crm_maturacao_plano_trg
  after update of status, deleted_at on public.crm_maturacao_planos
  for each row when ((new.status = 'parado' and old.status <> 'parado') or (new.deleted_at is not null and old.deleted_at is null))
  execute function app_private.crm_maturacao_ao_mudar_plano();

-- 5.5 Kill switch ligado → cancela tudo no escopo (global ou parceiro).
create or replace function app_private.crm_maturacao_ao_kill_switch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.desligado_em is not null and (tg_op = 'INSERT' or old.desligado_em is null) then
    perform public.crm_maturacao_cancelar(new.agente_parceiro_id, null, 'kill_switch');
    insert into public.crm_maturacao_eventos (agente_parceiro_id, tipo, motivo, origem)
    values (new.agente_parceiro_id, 'kill_switch_ligado', 'kill_switch', 'gatilho');
  elsif tg_op = 'UPDATE' and new.desligado_em is null and old.desligado_em is not null then
    insert into public.crm_maturacao_eventos (agente_parceiro_id, tipo, motivo, origem)
    values (new.agente_parceiro_id, 'kill_switch_desligado', 'kill_switch', 'gatilho');
  end if;
  return null;
end $$;
drop trigger if exists crm_maturacao_kill_switch_trg on public.crm_maturacao_parametros;
create trigger crm_maturacao_kill_switch_trg
  after insert or update of desligado_em on public.crm_maturacao_parametros
  for each row execute function app_private.crm_maturacao_ao_kill_switch();

-- ---------------------------------------------------------------------------
-- 6. RPCs do engine
-- ---------------------------------------------------------------------------
-- Claim: varre leases vencidos ('enviando' → incerto, sem reenvio, e cancela o
-- resto da sessão) e execuções vencidas; depois reivindica passos pendentes de
-- remetentes com sessão LOCAL (p_instancias), com todas as barreiras do banco.
create or replace function public.crm_maturacao_claim(
  p_instancias uuid[], p_limit integer default 5, p_lease_s integer default 120
) returns setof public.crm_maturacao_passos language plpgsql security definer set search_path = '' as $$
declare v_dia timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  with venc as (
    update public.crm_maturacao_passos
    set status = 'incerto', motivo = 'lease_vencido', lease_token = null, lease_until = null
    where status = 'enviando' and lease_until < clock_timestamp()
    returning execucao_id, sessao_id
  )
  update public.crm_maturacao_passos s
  set status = 'cancelado', motivo = 'sessao_incerta'
  from venc v
  where s.execucao_id = v.execucao_id and s.sessao_id = v.sessao_id and s.status in ('pendente', 'aguardando');

  with ex as (
    update public.crm_maturacao_execucoes e
    set status = 'encerrada', motivo_fim = 'fim_da_janela'
    where e.status = 'ativa' and e.fim_em <= now()
    returning e.id, e.plano_id
  ), ps as (
    update public.crm_maturacao_passos s
    set status = 'cancelado', motivo = 'execucao_encerrada'
    from ex where s.execucao_id = ex.id and s.status in ('pendente', 'aguardando')
  )
  insert into public.crm_maturacao_eventos (agente_parceiro_id, plano_id, tipo, motivo, origem)
  select p.agente_parceiro_id, ex.plano_id, 'execucao_encerrada', 'fim_da_janela', 'engine'
  from ex join public.crm_maturacao_planos p on p.id = ex.plano_id;

  return query
  with cand as (
    select s.id
    from public.crm_maturacao_passos s
    join public.crm_maturacao_execucoes e on e.id = s.execucao_id and e.status = 'ativa' and e.fim_em > now()
    join public.crm_maturacao_planos p on p.id = s.plano_id and p.status = 'ativo' and p.deleted_at is null
      and (p.pausado_ate is null or p.pausado_ate <= now())
    join public.crm_parceiro_config c on c.agente_parceiro_id = p.agente_parceiro_id
      and c.maturacao_status in ('teste', 'pago') and (c.maturacao_ate is null or c.maturacao_ate >= now())
    join public.crm_maturacao_membros mr on mr.plano_id = s.plano_id and mr.instancia_id = s.remetente_instancia_id and mr.status = 'ativo'
    join public.crm_maturacao_membros md on md.plano_id = s.plano_id and md.instancia_id = s.destinatario_instancia_id and md.status = 'ativo'
    join public.chat_instancias ir on ir.id = s.remetente_instancia_id
    join public.chat_instancias ide on ide.id = s.destinatario_instancia_id
    where s.status = 'pendente'
      and s.agendado_para <= clock_timestamp()
      and s.remetente_instancia_id = any (p_instancias)
      and ir.agente_parceiro_id = p.agente_parceiro_id and ide.agente_parceiro_id = p.agente_parceiro_id
      and ir.deleted_at is null and ide.deleted_at is null
      and ir.provedor = 'baileys' and ide.provedor = 'baileys'
      and ir.proxy_configurado and ide.proxy_configurado
      and ir.banida_em is null and ide.banida_em is null
      and (ir.restrito_ate is null or ir.restrito_ate <= now())
      and (ide.restrito_ate is null or ide.restrito_ate <= now())
      and not exists (
        select 1 from public.crm_maturacao_parametros k
        where k.desligado_em is not null and (k.agente_parceiro_id is null or k.agente_parceiro_id = p.agente_parceiro_id))
      and (s.acao = 'leitura' or (
        (select count(*) from public.crm_maturacao_passos x
          where x.remetente_instancia_id = s.remetente_instancia_id and x.status = 'enviado'
            and x.acao = 'mensagem' and x.enviado_em >= v_dia)
        + (select count(*) from public.crm_disparo_fila f
          where f.instancia_id = s.remetente_instancia_id and f.status = 'enviado' and f.enviado_em >= v_dia)
        < least(p.teto_diario_por_numero, coalesce(
          (select min(t.teto_diario_max) from public.crm_maturacao_parametros t
            where t.agente_parceiro_id is null or t.agente_parceiro_id = p.agente_parceiro_id), 500))))
    order by s.agendado_para
    limit greatest(p_limit, 0)
    for update of s skip locked
  )
  update public.crm_maturacao_passos s
  set status = 'enviando', lease_token = gen_random_uuid(),
      lease_until = clock_timestamp() + make_interval(secs => p_lease_s),
      tentativas = s.tentativas + 1
  from cand
  where s.id = cand.id
  returning s.*;
end $$;

-- Concluir: fecha o passo (só com o lease certo) e, se enviado, libera o
-- próximo da sessão e agenda a leitura; senão cancela o resto da sessão.
-- Horários vêm do TS (relógio injetável); nulo = agora (+ atraso_ms do próximo).
create or replace function public.crm_maturacao_concluir(
  p_id uuid, p_token uuid, p_status text, p_wa_id text default null, p_motivo text default null,
  p_proximo_em timestamptz default null, p_leitura_em timestamptz default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.crm_maturacao_passos;
begin
  if p_status not in ('enviado', 'incerto', 'falhou', 'pulado', 'cancelado') then
    raise exception using errcode = 'check_violation', message = 'crm_maturacao_concluir: status inválido ' || coalesce(p_status, 'null');
  end if;
  update public.crm_maturacao_passos
  set status = p_status, wa_id = coalesce(p_wa_id, wa_id), motivo = p_motivo,
      enviado_em = case when p_status = 'enviado' then clock_timestamp() else enviado_em end,
      lease_token = null, lease_until = null
  where id = p_id and lease_token = p_token and status = 'enviando'
  returning * into s;
  if not found then return false; end if;

  if s.acao = 'leitura' then return true; end if;

  if p_status = 'enviado' then
    update public.crm_maturacao_passos n
    set status = 'pendente',
        agendado_para = coalesce(p_proximo_em, clock_timestamp() + make_interval(secs => coalesce(n.atraso_ms, 0) / 1000.0))
    where n.id = (select x.id from public.crm_maturacao_passos x
                  where x.execucao_id = s.execucao_id and x.sessao_id = s.sessao_id and x.acao = 'mensagem'
                    and x.status = 'aguardando' and x.ordem > s.ordem
                  order by x.ordem limit 1);
    if p_leitura_em is not null then
      insert into public.crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, acao, ref_passo_id,
        remetente_instancia_id, destinatario_instancia_id, agendado_para, status)
      values (s.execucao_id, s.plano_id, s.sessao_id, s.ordem, 'leitura', s.id,
        s.destinatario_instancia_id, s.remetente_instancia_id, p_leitura_em, 'pendente');
    end if;
  else
    update public.crm_maturacao_passos
    set status = 'cancelado', motivo = 'sessao_interrompida'
    where execucao_id = s.execucao_id and sessao_id = s.sessao_id and status in ('pendente', 'aguardando');
  end if;
  return true;
end $$;

-- Adiar: devolve a 'pendente' sem gastar tentativa (cedeu a vez, horário, freio).
create or replace function public.crm_maturacao_adiar(p_id uuid, p_token uuid, p_para timestamptz, p_motivo text default null)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update public.crm_maturacao_passos
    set status = 'pendente', agendado_para = p_para, motivo = p_motivo,
        adiamentos = adiamentos + 1, tentativas = greatest(tentativas - 1, 0),
        lease_token = null, lease_until = null
    where id = p_id and lease_token = p_token and status = 'enviando'
    returning 1
  ) select exists (select 1 from u);
$$;

-- Criar execução + passos de uma vez; null se o plano não está ativo ou já há
-- execução do dia (idempotente entre réplicas pelo unique (plano_id, dia)).
-- p_passos: [{sessao_id, ordem, remetente_instancia_id, destinatario_instancia_id,
--   papel, texto, trecho_id, digitar_ms, atraso_ms, agendado_para}] (agendado nulo = aguardando).
create or replace function public.crm_maturacao_criar_execucao(
  p_plano uuid, p_dia date, p_inicio timestamptz, p_fim timestamptz, p_seed bigint, p_snapshot jsonb, p_passos jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.crm_maturacao_planos where id = p_plano and status = 'ativo' and deleted_at is null) then
    return null;
  end if;
  insert into public.crm_maturacao_execucoes (plano_id, dia, inicio_em, fim_em, seed, snapshot)
  values (p_plano, p_dia, p_inicio, p_fim, p_seed, coalesce(p_snapshot, '{}'))
  on conflict (plano_id, dia) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  insert into public.crm_maturacao_passos (execucao_id, plano_id, sessao_id, ordem, acao, remetente_instancia_id,
    destinatario_instancia_id, papel, texto, trecho_id, digitar_ms, atraso_ms, agendado_para, status)
  select v_id, p_plano, x.sessao_id, x.ordem, 'mensagem', x.remetente_instancia_id, x.destinatario_instancia_id,
         x.papel, x.texto, x.trecho_id, coalesce(x.digitar_ms, 0), x.atraso_ms, x.agendado_para,
         case when x.agendado_para is null then 'aguardando' else 'pendente' end
  from jsonb_to_recordset(coalesce(p_passos, '[]')) as x(sessao_id uuid, ordem smallint, remetente_instancia_id uuid,
    destinatario_instancia_id uuid, papel text, texto text, trecho_id uuid, digitar_ms integer, atraso_ms integer,
    agendado_para timestamptz);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Acesso: só service_role (RLS ligado, sem policy)
-- ---------------------------------------------------------------------------
do $$
declare tabela text;
begin
  foreach tabela in array array['crm_maturacao_parametros', 'crm_maturacao_planos', 'crm_maturacao_membros',
    'crm_maturacao_execucoes', 'crm_maturacao_passos', 'crm_maturacao_recebidas', 'crm_maturacao_fontes',
    'crm_maturacao_trechos', 'crm_maturacao_eventos'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all on public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on public.%I to service_role', tabela);
  end loop;
end $$;

revoke all on function
  public.crm_maturacao_claim(uuid[], integer, integer),
  public.crm_maturacao_concluir(uuid, uuid, text, text, text, timestamptz, timestamptz),
  public.crm_maturacao_adiar(uuid, uuid, timestamptz, text),
  public.crm_maturacao_criar_execucao(uuid, date, timestamptz, timestamptz, bigint, jsonb, jsonb),
  public.crm_maturacao_parar_instancia(uuid, text, text, text),
  public.crm_maturacao_cancelar(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.crm_maturacao_claim(uuid[], integer, integer),
  public.crm_maturacao_concluir(uuid, uuid, text, text, text, timestamptz, timestamptz),
  public.crm_maturacao_adiar(uuid, uuid, timestamptz, text),
  public.crm_maturacao_criar_execucao(uuid, date, timestamptz, timestamptz, bigint, jsonb, jsonb),
  public.crm_maturacao_parar_instancia(uuid, text, text, text),
  public.crm_maturacao_cancelar(uuid, uuid, text)
to service_role;
revoke all on function
  app_private.crm_maturacao_validar_membro(), app_private.crm_maturacao_ao_evento_instancia(),
  app_private.crm_maturacao_ao_mudar_instancia(), app_private.crm_maturacao_ao_mudar_flag(),
  app_private.crm_maturacao_ao_mudar_plano(), app_private.crm_maturacao_ao_kill_switch()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Permissão do CRM: config.maturacao (só o perfil global master)
-- ---------------------------------------------------------------------------
insert into public.crm_perfis_permissoes (perfil_id, permissao)
select p.id, 'config.maturacao'
from public.crm_perfis p
where p.agente_parceiro_id is null and p.chave = 'master'
on conflict do nothing;

reset lock_timeout;
notify pgrst, 'reload schema';
