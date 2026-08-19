-- Libera o subsistema "Disparo de WhatsApp" (Comercial) para perfis e usuários
-- que já operam o Comercial (comercial-agentes / comercial-estrutura) ou o
-- setor Comercial do hub (workspace-com).

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'comercial-disparo-whatsapp', true, true, true, true, true
from public.profile_permissions pp
where pp.resource_name in ('comercial-agentes', 'comercial-estrutura', 'workspace-com')
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'comercial-disparo-whatsapp', true, true, true, true, true
from public.user_permissions up
where up.resource_name in ('comercial-agentes', 'comercial-estrutura', 'workspace-com')
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit,
    can_delete = excluded.can_delete, can_activate_inactivate = excluded.can_activate_inactivate;

notify pgrst, 'reload schema';
