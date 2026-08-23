-- =============================================================================
-- Cadastros Recebidos (Agente Corban) — pipeline de aprovação de novos
-- parceiros vindos do Portal Parceiro. Substitui o fluxo SCP (descontinuado;
-- dados históricos preservados). Ver docs/ORIENTACAO-CADASTROS-RECEBIDOS.md.
--
-- Etapas: validacao -> analise -> nuvidio -> arw -> contrato -> termo ->
--         boas_vindas -> concluido. Correção de itens reprovados via magic
--         link (token de uso controlado, só o HASH fica no banco).
-- =============================================================================

-- 1. Processo (1 por cadastro recebido; o portal cria junto com agentes_parceiros)
create table if not exists public.corban_onboarding_processos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros(id) on delete cascade,
  etapa_atual text not null default 'validacao'
    check (etapa_atual in ('validacao','analise','nuvidio','arw','contrato','termo','boas_vindas','concluido')),
  status text not null default 'em_andamento'
    check (status in ('em_andamento','aguardando_correcao','correcao_recebida','concluido','cancelado')),
  -- Histórico/estado por etapa: { "<etapa>": { started_at, completed_at, completed_by, ... } }
  etapas jsonb not null default '{}'::jsonb,
  -- Etapa Nuvidio (v1 manual)
  nuvidio_link text null,
  nuvidio_video_url text null,
  -- Assinafy (contrato de serviços e termo de usuário)
  contrato_assinafy_document_id text null,
  contrato_status text null check (contrato_status in (null, 'preparado','enviado','assinado')),
  termo_assinafy_document_id text null,
  termo_status text null check (termo_status in (null, 'preparado','pendente_contrato','enviado','assinado')),
  contrato_pdf_assinado_url text null,
  termo_pdf_assinado_url text null,
  responsavel_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corban_onboarding_processos_agente_unique unique (agente_parceiro_id)
);
create index if not exists corban_onboarding_processos_status_idx
  on public.corban_onboarding_processos (status, etapa_atual, created_at desc);

-- 2. Checklist item a item (etapas validacao e analise)
create table if not exists public.corban_onboarding_itens (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  etapa text not null check (etapa in ('validacao','analise')),
  -- chave: dot-path dentro do corban_data (ex.: 'documents.social_contract_url',
  -- 'master.email') OU chave sintética de análise (ex.: 'analise:serasa:cpf:123...').
  chave text not null,
  rotulo text not null,
  tipo text not null check (tipo in ('informacao','documento','analise')),
  -- Snapshot do valor avaliado (texto ou lista de arquivos) no momento da avaliação.
  valor jsonb null,
  status text not null default 'pendente'
    check (status in ('pendente','aprovado','reprovado','corrigido')),
  motivo_reprovacao text null,
  instrucoes_correcao text null,
  avaliado_por uuid null,
  avaliado_em timestamptz null,
  correcao_id uuid null,
  created_at timestamptz not null default now(),
  constraint corban_onboarding_itens_unique unique (processo_id, etapa, chave)
);
create index if not exists corban_onboarding_itens_processo_idx
  on public.corban_onboarding_itens (processo_id, etapa, status);

-- 3. Rodadas de correção (magic link — token NUNCA em claro, só hash sha256)
create table if not exists public.corban_onboarding_correcoes (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  status text not null default 'pendente_envio'
    check (status in ('pendente_envio','enviada','aberta','corrigida','encerrada')),
  enviada_em timestamptz null,
  aberta_em timestamptz null,
  corrigida_em timestamptz null,
  -- Log de envio: { email: {...}, whatsapp: {...} }
  envio jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists corban_onboarding_correcoes_processo_idx
  on public.corban_onboarding_correcoes (processo_id, created_at desc);

-- 4. Documentos de análise (relatórios Serasa, Cartão CNPJ, vídeo Nuvidio etc.)
create table if not exists public.corban_onboarding_docs_analise (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  alvo_tipo text not null check (alvo_tipo in ('cpf','cnpj','processo')),
  alvo_valor text not null default '',
  tipo_documento text not null check (tipo_documento in ('serasa','cartao_cnpj','video_nuvidio','outro')),
  arquivo_url text not null,
  file_name text not null default '',
  status text not null default 'pendente' check (status in ('pendente','aprovado','reprovado')),
  observacao text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  avaliado_por uuid null,
  avaliado_em timestamptz null
);
create index if not exists corban_onboarding_docs_analise_processo_idx
  on public.corban_onboarding_docs_analise (processo_id);

-- 5. Auditoria (transições, envios, aprovações, webhooks)
create table if not exists public.corban_onboarding_eventos (
  id bigint generated always as identity primary key,
  processo_id uuid not null references public.corban_onboarding_processos(id) on delete cascade,
  tipo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  actor_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists corban_onboarding_eventos_processo_idx
  on public.corban_onboarding_eventos (processo_id, created_at desc);

-- =============================================================================
-- RLS — usuários internos com a permissão 'agente-corban-cadastros-recebidos'.
-- Escritas do PORTAL (criação do processo, correções) passam pelo service role.
-- =============================================================================
do $$
declare
  t regclass;
  tabela text;
begin
  foreach tabela in array array[
    'corban_onboarding_processos',
    'corban_onboarding_itens',
    'corban_onboarding_correcoes',
    'corban_onboarding_docs_analise',
    'corban_onboarding_eventos'
  ] loop
    t := app_private.enable_rls_if_exists(tabela);
    perform app_private.apply_policy(t, tabela || '_select_permitted', 'SELECT',
      'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_view'')');
    perform app_private.apply_policy(t, tabela || '_insert_permitted', 'INSERT', null,
      'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_include'')');
    perform app_private.apply_policy(t, tabela || '_update_permitted', 'UPDATE',
      'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_edit'')');
    perform app_private.apply_policy(t, tabela || '_delete_permitted', 'DELETE',
      'app_private.has_permission(''agente-corban-cadastros-recebidos'', ''can_delete'')');
  end loop;
end $$;

-- Bucket privado dos documentos de análise + vídeo Nuvidio + PDFs assinados.
-- Sem policy para authenticated: TODA leitura/escrita via service role (signed URLs).
insert into storage.buckets (id, name, public)
values ('partner-analise', 'partner-analise', false)
on conflict (id) do nothing;

-- Seed de permissão: quem já enxerga o subsistema Agente Corban.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'agente-corban-cadastros-recebidos', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'agente-corban' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'agente-corban-cadastros-recebidos', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'agente-corban' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

-- =============================================================================
-- Magic link de correção — 3 RPCs SECURITY DEFINER, EXCLUSIVAS do service role.
-- O token em claro só existe no retorno de criar_correcao (uma única vez).
-- =============================================================================

-- Cria a rodada: marca itens reprovados, gera token e devolve { correcao_id, token }.
create or replace function public.corban_onboarding_criar_correcao(
  p_processo_id uuid,
  p_item_ids uuid[],
  p_ttl_horas integer default 168,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_correcao_id uuid;
  v_marcados integer;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'Nenhum item informado para correção.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.corban_onboarding_correcoes (processo_id, token_hash, expires_at, created_by)
  values (
    p_processo_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + make_interval(hours => greatest(p_ttl_horas, 1)),
    p_created_by
  )
  returning id into v_correcao_id;

  update public.corban_onboarding_itens
  set correcao_id = v_correcao_id
  where id = any(p_item_ids)
    and processo_id = p_processo_id
    and status = 'reprovado';
  get diagnostics v_marcados = row_count;
  if v_marcados = 0 then
    raise exception 'Nenhum item reprovado encontrado para esse processo.';
  end if;

  update public.corban_onboarding_processos
  set status = 'aguardando_correcao', updated_at = now()
  where id = p_processo_id;

  insert into public.corban_onboarding_eventos (processo_id, tipo, detalhe, actor_id)
  values (p_processo_id, 'correcao_criada',
          jsonb_build_object('correcao_id', v_correcao_id, 'itens', v_marcados), p_created_by);

  return jsonb_build_object('correcao_id', v_correcao_id, 'token', v_token);
end;
$$;

-- Valida o token (portal, server-side) e devolve o pacote de pré-preenchimento.
create or replace function public.corban_onboarding_validar_correcao(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_correcao record;
  v_itens jsonb;
  v_corban jsonb;
begin
  select c.*, p.agente_parceiro_id
  into v_correcao
  from public.corban_onboarding_correcoes c
  join public.corban_onboarding_processos p on p.id = c.processo_id
  where c.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if v_correcao.id is null then
    return jsonb_build_object('valido', false, 'motivo', 'nao_encontrado');
  end if;
  if v_correcao.expires_at < now() then
    return jsonb_build_object('valido', false, 'motivo', 'expirado');
  end if;
  if v_correcao.status not in ('pendente_envio', 'enviada', 'aberta') then
    return jsonb_build_object('valido', false, 'motivo', 'encerrada');
  end if;

  update public.corban_onboarding_correcoes
  set status = 'aberta', aberta_em = coalesce(aberta_em, now())
  where id = v_correcao.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id, 'etapa', i.etapa, 'chave', i.chave, 'rotulo', i.rotulo,
    'tipo', i.tipo, 'motivo', i.motivo_reprovacao, 'instrucoes', i.instrucoes_correcao,
    'status', i.status
  )), '[]'::jsonb)
  into v_itens
  from public.corban_onboarding_itens i
  where i.correcao_id = v_correcao.id;

  select ap.corban_data into v_corban
  from public.agentes_parceiros ap
  where ap.id = v_correcao.agente_parceiro_id;

  return jsonb_build_object(
    'valido', true,
    'correcao_id', v_correcao.id,
    'processo_id', v_correcao.processo_id,
    'agente_parceiro_id', v_correcao.agente_parceiro_id,
    'itens', v_itens,
    'corban_data', coalesce(v_corban, '{}'::jsonb)
  );
end;
$$;

-- Aplica a correção: só chaves de itens DESTA rodada, gravadas no dot-path do
-- corban_data. Chaves de análise ('analise:*') nunca são graváveis pelo parceiro.
create or replace function public.corban_onboarding_submeter_correcao(
  p_token text,
  p_respostas jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_correcao record;
  v_item record;
  v_chave text;
  v_valor jsonb;
  v_aplicadas integer := 0;
begin
  select c.*, p.agente_parceiro_id
  into v_correcao
  from public.corban_onboarding_correcoes c
  join public.corban_onboarding_processos p on p.id = c.processo_id
  where c.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');

  if v_correcao.id is null or v_correcao.expires_at < now()
     or v_correcao.status not in ('enviada', 'aberta') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  for v_chave, v_valor in select key, value from jsonb_each(coalesce(p_respostas, '{}'::jsonb)) loop
    select i.* into v_item
    from public.corban_onboarding_itens i
    where i.correcao_id = v_correcao.id and i.chave = v_chave
      and i.tipo in ('informacao', 'documento');
    if v_item.id is null or v_chave like 'analise%' then
      continue; -- chave fora da rodada ou não editável: ignora silenciosamente
    end if;

    update public.agentes_parceiros
    set corban_data = jsonb_set(coalesce(corban_data, '{}'::jsonb),
                                string_to_array(v_chave, '.')::text[], v_valor, true),
        updated_at = now()
    where id = v_correcao.agente_parceiro_id;

    update public.corban_onboarding_itens
    set status = 'corrigido', valor = v_valor
    where id = v_item.id;
    v_aplicadas := v_aplicadas + 1;
  end loop;

  if v_aplicadas = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nenhum_item_aplicado');
  end if;

  update public.corban_onboarding_correcoes
  set status = 'corrigida', corrigida_em = now()
  where id = v_correcao.id;

  update public.corban_onboarding_processos
  set status = 'correcao_recebida', updated_at = now()
  where id = v_correcao.processo_id;

  insert into public.corban_onboarding_eventos (processo_id, tipo, detalhe)
  values (v_correcao.processo_id, 'correcao_submetida',
          jsonb_build_object('correcao_id', v_correcao.id, 'itens_aplicados', v_aplicadas));

  return jsonb_build_object('ok', true, 'itens_aplicados', v_aplicadas);
end;
$$;

-- As 3 RPCs são exclusivas de código servidor confiável (service role).
revoke all on function public.corban_onboarding_criar_correcao(uuid, uuid[], integer, uuid) from public, anon, authenticated;
revoke all on function public.corban_onboarding_validar_correcao(text) from public, anon, authenticated;
revoke all on function public.corban_onboarding_submeter_correcao(text, jsonb) from public, anon, authenticated;
grant execute on function public.corban_onboarding_criar_correcao(uuid, uuid[], integer, uuid) to service_role;
grant execute on function public.corban_onboarding_validar_correcao(text) to service_role;
grant execute on function public.corban_onboarding_submeter_correcao(text, jsonb) to service_role;

notify pgrst, 'reload schema';
