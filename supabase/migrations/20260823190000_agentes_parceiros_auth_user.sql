-- Vínculo login do portal ↔ cadastro do Agente Corban (spec
-- SPEC-FINANCEIRO-CONTA-VIRTUAL.md do portal). Preenchida no provisionamento
-- e retroativamente pelo código ARW (e-mail sintético
-- <codigo>@parceiro.brspromotora.com.br).

alter table public.agentes_parceiros
  add column if not exists auth_user_id uuid null references auth.users (id);

create unique index if not exists agentes_parceiros_auth_user_idx
  on public.agentes_parceiros (auth_user_id) where auth_user_id is not null;

-- Backfill dos já provisionados: casa o e-mail sintético com o código ARW.
update public.agentes_parceiros ap
set auth_user_id = u.id
from auth.users u
where ap.auth_user_id is null
  and coalesce(trim(ap.arw_code), '') <> ''
  and lower(u.email) = lower(trim(ap.arw_code)) || '@parceiro.brspromotora.com.br';

notify pgrst, 'reload schema';
