-- Contas "legadas" ANTES das migrations de segurança, para provar o rebaixamento (decisão 8).
-- 0000000a: forma exata do trigger antigo (id, name, email, role='admin') -> deve ser rebaixada.
-- 0000000b: admin com cadastro interno completo (cpf) -> não pode ser tocada.
-- 0000000c: admin sem cpf mas com permissão individual -> não pode ser tocada.
-- 0000000d: admin com perfil de acesso -> não pode ser tocada.
-- 0000000e: role consulta, sem cadastro (nunca foi admin) -> não pode ser tocada.
-- O trigger em auth.users NÃO é versionado nas migrations (existe só no banco real); o teste o
-- recria como em produção para que o signup corporativo exercite handle_new_user de verdade.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000003-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'm03a.legado@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000003-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'm03a.cadastrado@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000003-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', 'm03a.comperm@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000003-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'm03a.comperfil@brspromotora.com.br', '{}', '{}', now(), now()),
  ('00000003-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'm03a.consulta@brspromotora.com.br', '{}', '{}', now(), now());
insert into public.access_profiles (id, name) values ('00000003-0000-4000-8000-0000000000a1', 'M03A PERFIL LEGADO');
-- 0000000a nasce SÓ pelo trigger antigo (handle_new_user da época), a forma real do legado.
-- Os demais viram cadastro interno completo via upsert, como saveUserDirectly.
insert into public.users (id, name, email, role, cpf, profile_id) values
  ('00000003-0000-4000-8000-00000000000b', 'M03A Cadastrado','m03a.cadastrado@brspromotora.com.br', 'admin',    '00000000272', null),
  ('00000003-0000-4000-8000-00000000000c', 'M03A ComPerm',   'm03a.comperm@brspromotora.com.br',    'admin',    null,          null),
  ('00000003-0000-4000-8000-00000000000d', 'M03A ComPerfil', 'm03a.comperfil@brspromotora.com.br',  'admin',    null,          '00000003-0000-4000-8000-0000000000a1'),
  ('00000003-0000-4000-8000-00000000000e', 'M03A Consulta',  'm03a.consulta@brspromotora.com.br',   'consulta', null,          null)
on conflict (id) do update set name = excluded.name, email = excluded.email, role = excluded.role,
  cpf = excluded.cpf, profile_id = excluded.profile_id;
insert into public.user_permissions (user_id, resource_name, can_view) values ('00000003-0000-4000-8000-00000000000c', 'rh-painel', true);
