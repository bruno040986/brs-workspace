-- Usuários do CRM AlvoConsig vazavam pro espelho interno public.users (com
-- role 'admin'!) mesmo com app_metadata.external marcado: o GoTrue insere o
-- auth.users primeiro e aplica o app_metadata customizado depois, então o
-- trigger AFTER INSERT não vê a marca. Blindagem definitiva: o espelho
-- interno só aceita e-mail corporativo @brspromotora.com.br (todo funcionário
-- usa; parceiros/atendentes de CRM nunca) — a marca external continua valendo
-- como segunda barreira.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- Espelho interno é SÓ para funcionários (e-mail corporativo). Usuários
  -- externos (portal do parceiro, CRM AlvoConsig) ficam de fora — a marca
  -- app_metadata.external nem sempre está presente no INSERT (GoTrue aplica
  -- depois), por isso a regra principal é o domínio do e-mail.
  if new.email is null
     or new.email not ilike '%@brspromotora.com.br'
     or new.email ilike '%@parceiro.brspromotora.com.br'
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

-- Limpeza dos externos que já vazaram pro espelho (hoje: o atendente de teste
-- do DF3, bruno0409@gmail.com). Remove também o rastro que o trigger do chat
-- interno criou (canal "Você" e participação no grupo Equipe BRS).
do $$
declare
  r record;
begin
  for r in
    select u.id
    from public.users u
    join auth.users au on au.id = u.id
    where coalesce(au.raw_app_meta_data->>'external', '') <> ''
       or au.email ilike '%@parceiro.brspromotora.com.br'
  loop
    delete from public.workspace_chat_participants where user_id = r.id;
    delete from public.workspace_chat_conversations where kind = 'self' and created_by = r.id;
    delete from public.user_permissions where user_id = r.id;
    delete from public.users where id = r.id;
  end loop;
end $$;
