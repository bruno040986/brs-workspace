-- O trigger handle_new_user espelhava TODO usuário novo do auth em
-- public.users com role 'admin'. Com o SSO de parceiros (Portal Parceiro,
-- e-mails @parceiro.brspromotora.com.br) e os usuários do CRM AlvoConsig
-- (app_metadata.external = 'alvoconsig'), usuários EXTERNOS passariam a
-- aparecer nas telas internas. O trigger agora ignora externos, e a limpeza
-- remove os que já foram espelhados.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- Usuários externos (parceiros do portal e usuários do CRM AlvoConsig)
  -- não entram no espelho interno public.users.
  if new.email ilike '%@parceiro.brspromotora.com.br'
     or coalesce(new.raw_app_meta_data->>'external', '') <> '' then
    return new;
  end if;

  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'admin'
  );
  return new;
end;
$function$;

-- Limpeza: remove do espelho interno os externos já criados.
delete from public.users u
where u.email ilike '%@parceiro.brspromotora.com.br';

delete from public.users u
where exists (
  select 1 from public.crm_usuarios cu where cu.auth_user_id = u.id
);
