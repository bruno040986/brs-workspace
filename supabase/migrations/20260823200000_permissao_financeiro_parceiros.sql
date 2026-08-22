-- Permissão do subsistema "Conta Virtual Portal Parceiro" (Portal Financeiro).
-- Seed: quem já tem Central de Integrações (admins); ajustável na matriz.

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'financeiro-conta-parceiros', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'central-integracoes' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'financeiro-conta-parceiros', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'central-integracoes' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;
