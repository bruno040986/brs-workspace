-- Ajuste do Bruno (23/08/2026): no Spread, só a Forma de Contrato é
-- obrigatória. Tipo de Agente, Instituição, Convênio e Formalização passam a
-- ser MULTI-seleção (arrays de ids); array vazio = vale para todos.
-- A tabela estava vazia (criada hoje) — recriação limpa.

drop table if exists public.spreads;

create table public.spreads (
  id uuid primary key default gen_random_uuid(),
  forma_contrato_id uuid not null references public.formas_contrato (id),
  -- Arrays de ids; '{}' (vazio) = aplica a todos.
  tipos_agente uuid[] not null default '{}',
  instituicoes uuid[] not null default '{}',
  convenios uuid[] not null default '{}',
  tipos_formalizacao uuid[] not null default '{}',
  pontos numeric(9, 4) not null check (pontos >= 0),
  vigencia_inicio date not null default current_date,
  vigencia_fim date null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint spreads_vigencia_valida
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index spreads_forma_idx on public.spreads (forma_contrato_id);

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('spreads');
  perform app_private.apply_policy(t, 'spreads_select_permitted', 'SELECT', 'app_private.has_permission(''sistema-config-credito'', ''can_view'')');
  perform app_private.apply_policy(t, 'spreads_insert_permitted', 'INSERT', null, 'app_private.has_permission(''sistema-config-credito'', ''can_include'')');
  perform app_private.apply_policy(t, 'spreads_update_permitted', 'UPDATE',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-credito'', ''can_edit'')');
  perform app_private.apply_policy(t, 'spreads_delete_permitted', 'DELETE', 'app_private.has_permission(''sistema-config-credito'', ''can_delete'')');
end $$;

notify pgrst, 'reload schema';
