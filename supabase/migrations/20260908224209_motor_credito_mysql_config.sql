-- Motor de crédito (convênios públicos) — conexão MySQL do fornecedor
-- (08/09/2026). O fornecedor passou a alimentar um banco próprio (MySQL,
-- tabela `consultas`) toda vez que criamos uma lista de higienização de
-- margem no sistema deles; em vez de exportar Excel, o Workspace vai LER
-- direto dessa tabela. Fase 1 desta migration: só a credencial (cofre AES,
-- mesma CRM_CREDENTIALS_KEY) + um cursor genérico de sincronização
-- (coluna/valor — configurável, porque ainda não temos o schema real de
-- `consultas` pra travar num nome fixo). O mapeamento de colunas
-- (cpf/margem/convênio) e a tabela de auditoria da sincronização vêm numa
-- 2ª migration, depois do DESCRIBE consultas.
--
-- Linha única (id=1), só servidor lê (nenhuma policy de SELECT — mesmo
-- padrão de quark_config/if_credito_config).

create table if not exists public.motor_credito_mysql_config (
  id integer primary key default 1 check (id = 1),
  host text not null default '',
  porta integer not null default 3306,
  banco text not null default '',
  tabela text not null default 'consultas',
  usuario text not null default '',
  senha_enc text,
  -- Coluna usada como cursor de "o que já sincronizei" (ex.: um id
  -- autoincrement ou uma coluna de data) e o último valor processado.
  -- Preenchido depois de conhecermos o schema real da tabela.
  cursor_coluna text,
  cursor_valor text,
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);

alter table public.motor_credito_mysql_config enable row level security;

-- Permissões novas (seed p/ root) — REGRA FIXA ponto 4.
--   sistema-config-motor-credito → card "Motor de Crédito (MySQL)" em Provedores e APIs
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'sistema-config-motor-credito', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'sistema-config-motor-credito', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
