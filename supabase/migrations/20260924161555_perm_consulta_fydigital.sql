-- Reorganização dos menus de Gestão de Leads / CRM (24/09/2026) — REGRA FIXA
-- ponto 4: chave NOVA `alvoconsig-consulta-fydigital` (item "Consulta
-- Fy.Digital", por enquanto página "Em breve"; a integração real vem depois
-- da resposta da FyDigital sobre o webhook). Seed só pra quem tem
-- sistema-usuarios-root. Todas as outras mudanças da reorganização são só
-- rótulo/posição — ids gravados em profile_permissions/user_permissions não
-- mudam.
insert into public.profile_permissions (profile_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct pp.profile_id, 'alvoconsig-consulta-fydigital', true, true, true, false, false
from public.profile_permissions pp
where pp.resource_name = 'sistema-usuarios-root' and coalesce(pp.can_view, false)
on conflict (profile_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

insert into public.user_permissions (user_id, resource_name, can_view, can_include, can_edit, can_delete, can_activate_inactivate)
select distinct up.user_id, 'alvoconsig-consulta-fydigital', true, true, true, false, false
from public.user_permissions up
where up.resource_name = 'sistema-usuarios-root' and coalesce(up.can_view, false)
on conflict (user_id, resource_name) do update
  set can_view = excluded.can_view, can_include = excluded.can_include, can_edit = excluded.can_edit;

notify pgrst, 'reload schema';
