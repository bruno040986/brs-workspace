-- Biblioteca de Artes — taxonomia relacional (03/09/2026) + Convênios: Esfera e
-- Tipo de Convênio. Substitui os campos-texto grupo/categoria/formato da arte
-- por cadastros próprios amarrados por uma tabela de ASSOCIAÇÃO (Grupo+Categoria
-- → Formato). Uma arte serve N combinações do MESMO formato (a dimensão da
-- imagem). Em Convênios: nova cadeia Esfera → Tipo de Convênio (tem esfera) →
-- Convênio (tem tipo; esfera deriva do tipo). Reaproveita as permissões
-- existentes (marketing-biblioteca-artes / workspace-convenios) — sem chave nova.

-- ===========================================================================
-- 1) Cadastros de taxonomia da Biblioteca de Artes
-- ===========================================================================
create table if not exists public.marketing_grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_formatos (
  id uuid primary key default gen_random_uuid(),
  rotulo text not null unique,            -- ex.: "1080x1920px"
  largura_px integer not null,
  altura_px integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Combinações válidas: escolher Grupo+Categoria restringe os Formatos possíveis.
create table if not exists public.marketing_associacoes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.marketing_grupos (id) on delete cascade,
  categoria_id uuid not null references public.marketing_categorias (id) on delete cascade,
  formato_id uuid not null references public.marketing_formatos (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (grupo_id, categoria_id, formato_id)
);

-- Ponte arte ↔ destinos. Uma arte serve N associações (todas do mesmo formato).
create table if not exists public.marketing_arte_associacoes (
  arte_id uuid not null references public.marketing_artes (id) on delete cascade,
  associacao_id uuid not null references public.marketing_associacoes (id) on delete cascade,
  primary key (arte_id, associacao_id)
);

-- Novos vínculos na arte
alter table public.marketing_artes
  add column if not exists formato_id uuid references public.marketing_formatos (id);
-- tipo_convenio_id é adicionado após criar a tabela convenio_tipos (abaixo).

create index if not exists idx_mkt_assoc_grupo on public.marketing_associacoes (grupo_id);
create index if not exists idx_mkt_assoc_cat on public.marketing_associacoes (categoria_id);
create index if not exists idx_mkt_assoc_fmt on public.marketing_associacoes (formato_id);
create index if not exists idx_mkt_arte_assoc_arte on public.marketing_arte_associacoes (arte_id);
create index if not exists idx_mkt_arte_assoc_assoc on public.marketing_arte_associacoes (associacao_id);
create index if not exists idx_mkt_artes_formato on public.marketing_artes (formato_id);

-- ===========================================================================
-- 2) Convênios — Esfera e Tipo de Convênio
-- ===========================================================================
create table if not exists public.convenio_esferas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,              -- Municipal, Estadual, Federal…
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.convenio_tipos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  esfera_id uuid not null references public.convenio_esferas (id),  -- obrigatório
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Convênio passa a apontar para um Tipo (a esfera deriva do tipo). Nullable no
-- banco por segurança na migração; a obrigatoriedade é validada na action/UI.
alter table public.convenios
  add column if not exists tipo_convenio_id uuid references public.convenio_tipos (id);

-- Agora a arte pode filtrar convênios por Tipo.
alter table public.marketing_artes
  add column if not exists tipo_convenio_id uuid references public.convenio_tipos (id);

create index if not exists idx_convenios_tipo on public.convenios (tipo_convenio_id);
create index if not exists idx_convenio_tipos_esfera on public.convenio_tipos (esfera_id);
create index if not exists idx_mkt_artes_tipoconv on public.marketing_artes (tipo_convenio_id);

-- ===========================================================================
-- 3) Seed de taxonomia de marketing (starter — Bruno edita nas telas)
-- ===========================================================================
insert into public.marketing_grupos (nome) values
  ('WhatsApp'), ('Instagram'), ('Facebook'), ('TikTok')
on conflict (nome) do nothing;

insert into public.marketing_categorias (nome) values
  ('Status'), ('Conversa'), ('Foto de Perfil'), ('Capa de Perfil'),
  ('Catálogo'), ('Feed'), ('Stories')
on conflict (nome) do nothing;

insert into public.marketing_formatos (rotulo, largura_px, altura_px) values
  ('1080x1920px', 1080, 1920),
  ('1080x1350px', 1080, 1350),
  ('1080x1080px', 1080, 1080),
  ('1080x566px', 1080, 566),
  ('1211x681px', 1211, 681),
  ('500x500px', 500, 500)
on conflict (rotulo) do nothing;

-- Associações-exemplo (usam subselect por nome)
insert into public.marketing_associacoes (grupo_id, categoria_id, formato_id)
select g.id, c.id, f.id
from (values
  ('WhatsApp','Status','1080x1920px'),
  ('WhatsApp','Conversa','1080x1080px'),
  ('WhatsApp','Foto de Perfil','500x500px'),
  ('WhatsApp','Capa de Perfil','1211x681px'),
  ('WhatsApp','Catálogo','1080x1080px'),
  ('Instagram','Feed','1080x1350px'),
  ('Instagram','Feed','1080x1080px'),
  ('Instagram','Feed','1080x566px'),
  ('Instagram','Stories','1080x1920px'),
  ('Facebook','Feed','1080x1080px'),
  ('Facebook','Stories','1080x1920px'),
  ('TikTok','Stories','1080x1920px')
) as v(grupo, categoria, formato)
join public.marketing_grupos g on g.nome = v.grupo
join public.marketing_categorias c on c.nome = v.categoria
join public.marketing_formatos f on f.rotulo = v.formato
on conflict (grupo_id, categoria_id, formato_id) do nothing;

-- ===========================================================================
-- 4) Seed de Esfera/Tipo + backfill dos convênios existentes
-- ===========================================================================
insert into public.convenio_esferas (nome) values
  ('Municipal'), ('Estadual'), ('Federal')
on conflict (nome) do nothing;

-- Um tipo "geral" por esfera, para não deixar convênio existente sem tipo.
insert into public.convenio_tipos (nome, esfera_id)
select v.nome, e.id
from (values
  ('Municipal (geral)', 'Municipal'),
  ('Estadual (geral)', 'Estadual'),
  ('Federal (geral)', 'Federal')
) as v(nome, esfera)
join public.convenio_esferas e on e.nome = v.esfera
on conflict (nome) do nothing;

-- Backfill: convênios sem tipo herdam o tipo "geral" da sua esfera-texto atual.
update public.convenios cv
set tipo_convenio_id = t.id
from public.convenio_tipos t
join public.convenio_esferas e on e.id = t.esfera_id
where cv.tipo_convenio_id is null
  and t.nome = (initcap(cv.esfera) || ' (geral)')
  and e.nome = initcap(cv.esfera);

-- Convênios cuja esfera não casou (ex.: 'outro'/nulo) ficam sem tipo — a UI
-- obriga o preenchimento na próxima edição.

-- ===========================================================================
-- 5) RLS — SELECT liberado a authenticated (taxonomia não é sensível; o Portal
--    precisa ler para montar filtros); escrita via permissão (defensivo — as
--    actions gravam por service role). Espelha o padrão de marketing_artes.
-- ===========================================================================
alter table public.marketing_grupos enable row level security;
alter table public.marketing_categorias enable row level security;
alter table public.marketing_formatos enable row level security;
alter table public.marketing_associacoes enable row level security;
alter table public.marketing_arte_associacoes enable row level security;
alter table public.convenio_esferas enable row level security;
alter table public.convenio_tipos enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'marketing_grupos','marketing_categorias','marketing_formatos',
    'marketing_associacoes','convenio_esferas','convenio_tipos'
  ] loop
    execute format('drop policy if exists %I_sel on public.%I', t, t);
    execute format(
      'create policy %I_sel on public.%I for select to authenticated using (is_active = true or app_private.has_permission(''marketing-biblioteca-artes'', ''can_view''))',
      t, t
    );
    execute format('drop policy if exists %I_ins on public.%I', t, t);
    execute format(
      'create policy %I_ins on public.%I for insert to authenticated with check (app_private.has_permission(''marketing-biblioteca-artes'', ''can_include'') or app_private.has_permission(''workspace-convenios'', ''can_include''))',
      t, t
    );
    execute format('drop policy if exists %I_upd on public.%I', t, t);
    execute format(
      'create policy %I_upd on public.%I for update to authenticated using (app_private.has_permission(''marketing-biblioteca-artes'', ''can_edit'') or app_private.has_permission(''workspace-convenios'', ''can_edit''))',
      t, t
    );
    execute format('drop policy if exists %I_del on public.%I', t, t);
    execute format(
      'create policy %I_del on public.%I for delete to authenticated using (app_private.has_permission(''marketing-biblioteca-artes'', ''can_delete'') or app_private.has_permission(''workspace-convenios'', ''can_delete''))',
      t, t
    );
  end loop;
end $$;

-- Ponte arte↔associação: SELECT a authenticated (o Portal resolve grupos/
-- categorias/formato de uma arte por aqui); escrita via permissão de marketing.
drop policy if exists marketing_arte_assoc_sel on public.marketing_arte_associacoes;
create policy marketing_arte_assoc_sel on public.marketing_arte_associacoes
  for select to authenticated using (true);
drop policy if exists marketing_arte_assoc_ins on public.marketing_arte_associacoes;
create policy marketing_arte_assoc_ins on public.marketing_arte_associacoes
  for insert to authenticated
  with check (app_private.has_permission('marketing-biblioteca-artes', 'can_include') or app_private.has_permission('marketing-biblioteca-artes', 'can_edit'));
drop policy if exists marketing_arte_assoc_del on public.marketing_arte_associacoes;
create policy marketing_arte_assoc_del on public.marketing_arte_associacoes
  for delete to authenticated
  using (app_private.has_permission('marketing-biblioteca-artes', 'can_edit'));

notify pgrst, 'reload schema';
