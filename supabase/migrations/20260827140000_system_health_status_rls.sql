-- system_health_status só é lido/gravado pelo cron via service role (bypassa
-- RLS) — habilita RLS sem política (mesmo padrão de process_jobs e outras
-- tabelas internas do sistema), fechando o achado ERROR do linter de
-- segurança (RLS Disabled in Public).
alter table public.system_health_status enable row level security;
