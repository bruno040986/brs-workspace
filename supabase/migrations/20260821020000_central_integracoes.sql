-- Central de Integrações + Portal Tecnologia
--
-- O frontend da central mora no Workspace (rota /central-integracoes) e
-- consome a Admin API dos orquestradores via proxy server-side (tokens só em
-- env). Não há tabelas novas aqui — o estado técnico (jobs, eventos, logs)
-- vive no Supabase de cada orquestrador, como manda a arquitetura
-- hub-and-spoke. Esta migration só cria as permissões:
--
--   workspace-tec        -> card "Tecnologia" no hub (Portal Tecnologia)
--   central-integracoes  -> acesso à central (view = ver; include = comandar
--                           ações/uploads; edit = reprocessar eventos)
--
-- Seeds: perfis/usuários que já são administradores do sistema
-- (sistema-usuarios-root) ganham tudo. Demais acessos serão concedidos
-- manualmente pela tela de perfis.

insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, r.resource_name, true, true, true, false, false
from public.profile_permissions pp
cross join (values ('workspace-tec'), ('central-integracoes')) as r(resource_name)
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, r.resource_name, true, true, true, false, false
from public.user_permissions up
cross join (values ('workspace-tec'), ('central-integracoes')) as r(resource_name)
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
