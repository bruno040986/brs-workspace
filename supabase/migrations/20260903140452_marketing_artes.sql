-- Biblioteca de Artes de Marketing (spec da sessão do Portal Parceiro,
-- 03/09/2026). Staff cadastra artes-base com elementos posicionados (logo/
-- texto/foto/WhatsApp em % do canvas); o parceiro gera a arte personalizada
-- no portal, com o próprio logotipo. Buckets: marketing-templates (privado,
-- imagem-base — meu lado), marketing-parceiro-logos (privado — o portal cria
-- via ensureBucket), marketing-artes-geradas (público — o portal gera).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_artes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  imagem_url text not null,
  largura_px integer not null,
  altura_px integer not null,
  convenio_id uuid null references public.convenios (id),
  categoria text not null default '',
  formato text not null default '',
  grupo_nome text null,
  elementos jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- elementos: [{id, tipo: 'logo'|'texto'|'foto'|'whatsapp', x,y,w,h (% do canvas),
--   proporcao? (logo/foto), maxChars?/fonte?/cor?/alinhamento? (texto),
--   modoPermitido?: ['texto','qrcode'] (whatsapp)}]

create table if not exists public.marketing_parceiro_logos (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  formato text not null check (formato in ('quadrado', 'retangular')),
  arquivo_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agente_parceiro_id, formato)
);

create table if not exists public.marketing_artes_geradas (
  id uuid primary key default gen_random_uuid(),
  agente_parceiro_id uuid not null references public.agentes_parceiros (id) on delete cascade,
  arte_id uuid not null references public.marketing_artes (id),
  valores jsonb not null default '{}'::jsonb,
  arquivo_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_marketing_artes_ativo on public.marketing_artes (is_active, categoria);
create index if not exists idx_marketing_artes_convenio on public.marketing_artes (convenio_id);
create index if not exists idx_marketing_logos_parceiro on public.marketing_parceiro_logos (agente_parceiro_id);
create index if not exists idx_marketing_geradas_parceiro on public.marketing_artes_geradas (agente_parceiro_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Bucket da imagem-base (privado). Os outros dois o portal cria por conta.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
select 'marketing-templates', 'marketing-templates', false
where not exists (select 1 from storage.buckets where id = 'marketing-templates');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.marketing_artes enable row level security;
alter table public.marketing_parceiro_logos enable row level security;
alter table public.marketing_artes_geradas enable row level security;

-- marketing_artes: SELECT liberado a qualquer authenticated com is_active
-- (staff e parceiro — não é dado sensível); escrita só staff via permissão.
drop policy if exists marketing_artes_select_ativas on public.marketing_artes;
create policy marketing_artes_select_ativas on public.marketing_artes
  for select to authenticated
  using (is_active = true or app_private.has_permission('marketing-biblioteca-artes', 'can_view'));

drop policy if exists marketing_artes_insert_staff on public.marketing_artes;
create policy marketing_artes_insert_staff on public.marketing_artes
  for insert to authenticated
  with check (app_private.has_permission('marketing-biblioteca-artes', 'can_include'));

drop policy if exists marketing_artes_update_staff on public.marketing_artes;
create policy marketing_artes_update_staff on public.marketing_artes
  for update to authenticated
  using (app_private.has_permission('marketing-biblioteca-artes', 'can_edit'));

drop policy if exists marketing_artes_delete_staff on public.marketing_artes;
create policy marketing_artes_delete_staff on public.marketing_artes
  for delete to authenticated
  using (app_private.has_permission('marketing-biblioteca-artes', 'can_delete'));

-- logos/geradas: SELECT só do próprio parceiro (mesmo padrão nuvidio); escrita
-- é service role nas actions do portal (sem policy de INSERT).
drop policy if exists marketing_logos_select_parceiro on public.marketing_parceiro_logos;
create policy marketing_logos_select_parceiro on public.marketing_parceiro_logos
  for select to authenticated
  using (
    exists (
      select 1 from public.agentes_parceiros ap
      where ap.id = marketing_parceiro_logos.agente_parceiro_id
        and ap.auth_user_id = auth.uid()
    )
    or app_private.has_permission('marketing-biblioteca-artes', 'can_view')
  );

drop policy if exists marketing_geradas_select_parceiro on public.marketing_artes_geradas;
create policy marketing_geradas_select_parceiro on public.marketing_artes_geradas
  for select to authenticated
  using (
    exists (
      select 1 from public.agentes_parceiros ap
      where ap.id = marketing_artes_geradas.agente_parceiro_id
        and ap.auth_user_id = auth.uid()
    )
    or app_private.has_permission('marketing-biblioteca-artes', 'can_view')
  );

-- ---------------------------------------------------------------------------
-- Permissão nova: marketing-biblioteca-artes (seed p/ root)
-- ---------------------------------------------------------------------------
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'marketing-biblioteca-artes', true, true, true, true, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'marketing-biblioteca-artes', true, true, true, true, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
