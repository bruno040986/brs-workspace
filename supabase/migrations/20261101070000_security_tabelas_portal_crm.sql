-- Tabelas/RPCs propostas pelo Portal e pelo CRM (SQL-PARA-WORKSPACE.md de cada um). Idempotente.
-- Acesso so via service_role (Portal: src/lib/security/rate-limit.ts; CRM: trocar-senha/actions.ts com createAdminClient()).
-- RLS ligado e sem policies; anon/authenticated sem privilegio.

-- 1. Portal: rate limit persistido do cadastro (chave_hash = HMAC; nunca e-mail/IP em claro).
create table if not exists public.cadastro_rate_limit_eventos (
  id bigint generated always as identity primary key,
  escopo text not null,          -- codigo_email | codigo_ip | link_retomada | upload
  chave_hash text not null,
  criado_em timestamptz not null default now()
);
create index if not exists cadastro_rate_limit_busca on public.cadastro_rate_limit_eventos (escopo, chave_hash, criado_em desc);
create index if not exists cadastro_rate_limit_retencao on public.cadastro_rate_limit_eventos (criado_em);
alter table public.cadastro_rate_limit_eventos enable row level security;
revoke all on public.cadastro_rate_limit_eventos from public, anon, authenticated;
grant select, insert, delete on public.cadastro_rate_limit_eventos to service_role;
-- Limpeza sugerida (job diario, NAO criado aqui): delete from public.cadastro_rate_limit_eventos where criado_em < now() - interval '2 days';

-- 2. CRM: throttle persistido da troca de senha (3 erros -> pausa 300 s; reincidencia dobra; teto 7200 s; sucesso zera).
create table if not exists public.auth_throttle (
  chave text primary key,
  falhas int not null default 0,
  reincidencias int not null default 0,
  bloqueado_ate timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from public, anon, authenticated;
grant select, insert, update, delete on public.auth_throttle to service_role;

create or replace function public.auth_throttle_status(p_chave text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select greatest(0, ceil(extract(epoch from (bloqueado_ate - now())))::int)
                     from public.auth_throttle where chave = p_chave), 0)
$$;

create or replace function public.auth_throttle_registrar(p_chave text, p_ok boolean, p_erros int, p_base_seg int, p_teto_seg int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.auth_throttle; pausa int := 0;
begin
  if p_ok then
    delete from public.auth_throttle where chave = p_chave;
    return 0;
  end if;
  insert into public.auth_throttle(chave, falhas) values (p_chave, 1)
    on conflict (chave) do update set falhas = public.auth_throttle.falhas + 1, updated_at = now()
    returning * into r;
  if r.falhas >= p_erros then
    pausa := least(p_teto_seg, (p_base_seg * least(2 ^ r.reincidencias, 1048576))::int);
    update public.auth_throttle
       set falhas = 0, reincidencias = reincidencias + 1, bloqueado_ate = now() + make_interval(secs => pausa), updated_at = now()
     where chave = p_chave;
  end if;
  return pausa;
end $$;

revoke all on function public.auth_throttle_status(text) from public, anon, authenticated;
revoke all on function public.auth_throttle_registrar(text, boolean, int, int, int) from public, anon, authenticated;
grant execute on function public.auth_throttle_status(text) to service_role;
grant execute on function public.auth_throttle_registrar(text, boolean, int, int, int) to service_role;

-- 3. CRM: indice parcial das operacoes de envio presas. A tabela real do ledger e chat_envios_operacoes
-- (nao existe "chat_envios"). So cria se tabela e coluna updated_at existirem; senao pula sem falhar.
do $$
begin
  if to_regclass('public.chat_envios_operacoes') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'chat_envios_operacoes' and column_name = 'updated_at') then
    create index if not exists chat_envios_operacoes_presas_idx
      on public.chat_envios_operacoes (updated_at)
      where status in ('processing', 'uncertain');
  else
    raise notice 'chat_envios_operacoes_presas_idx: tabela ou coluna updated_at ausente, indice nao criado';
  end if;
end $$;
