-- Promoção NuAzul Valparaíso — segurança 2 (idempotente).
-- (a) Só service_role acessa as tabelas/sequences promocao_* (PostgREST expõe public por padrão).
-- (b) promocao_numeros: identidade do número é imutável; status/motivo/desconsiderado_* continuam liberados.

do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'promocao\_%' loop
    execute format('revoke all on public.%I from anon, authenticated', r.tablename);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'promocao\_%' loop
    execute format('revoke all on sequence public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

create or replace function public.promocao_numeros_proteger_identidade()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.numero is distinct from old.numero
     or new.geracao_id is distinct from old.geracao_id
     or new.direito_id is distinct from old.direito_id
     or new.inscricao_id is distinct from old.inscricao_id
     or new.titular_tipo is distinct from old.titular_tipo
     or new.titular_id is distinct from old.titular_id
     or new.campanha_id is distinct from old.campanha_id then
    raise exception '% é imutável (identidade do número não pode mudar)', tg_table_name using errcode = 'P0003';
  end if;
  return new;
end;
$$;
revoke execute on function public.promocao_numeros_proteger_identidade() from public, anon, authenticated;

drop trigger if exists promocao_numeros_identidade_imutavel on public.promocao_numeros;
create trigger promocao_numeros_identidade_imutavel
  before update on public.promocao_numeros
  for each row execute function public.promocao_numeros_proteger_identidade();
