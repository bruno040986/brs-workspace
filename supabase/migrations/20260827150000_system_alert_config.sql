-- Configuração do alerta de monitoramento (telefone + mensagens), editável
-- pela tela /central-integracoes/monitoramento em vez de env var na Vercel.
-- Singleton: sempre no máximo 1 linha (mesmo idioma do nvti_config).
create table if not exists public.system_alert_config (
  id uuid primary key default gen_random_uuid(),
  telefone text null,
  mensagem_degradado text not null default '⚠️ BRS Workspace: {sistema} degradado/indisponível desde {data}.',
  mensagem_recuperado text not null default '✅ BRS Workspace: {sistema} normalizado às {data}.',
  updated_at timestamptz not null default now()
);

create trigger set_timestamp_system_alert_config
  before update on public.system_alert_config
  for each row execute function trigger_set_timestamp();

do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('system_alert_config');
  perform app_private.apply_policy(t, 'system_alert_config_select_permitted', 'SELECT', 'app_private.has_permission(''central-integracoes'', ''can_view'')');
  perform app_private.apply_policy(t, 'system_alert_config_insert_permitted', 'INSERT', null, 'app_private.has_permission(''central-integracoes'', ''can_edit'')');
  perform app_private.apply_policy(
    t,
    'system_alert_config_update_permitted',
    'UPDATE',
    'app_private.has_permission(''central-integracoes'', ''can_edit'')',
    'app_private.has_permission(''central-integracoes'', ''can_edit'')'
  );
end $$;
