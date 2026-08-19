-- Subsistema "Disparo de WhatsApp" (Comercial): campanhas, blocos de mensagem
-- (rotação), lotes agendados, destinatários, opt-outs e auditoria de webhooks.
--
-- O worker (api/cron/wa-campaigns) usa wa_campaign_recipients como fila durável
-- e as linhas de wa_campaigns/zapi_instances como máquina de estado. Contadores
-- da campanha são mantidos por trigger (ver abaixo) + função de recontagem.

create table if not exists public.wa_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instance_id uuid not null references public.zapi_instances(id),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  source_type text not null check (source_type in ('csv', 'agents', 'manual')),
  variables text[] not null default '{}',
  -- envio
  delay_min_seconds integer not null default 30 check (delay_min_seconds between 15 and 300),
  delay_max_seconds integer not null default 60 check (delay_max_seconds >= delay_min_seconds and delay_max_seconds <= 300),
  rotate_templates boolean not null default true,
  rotation_mode text not null default 'sequential' check (rotation_mode in ('sequential', 'random')),
  antiban jsonb null,
  -- agendamento
  schedule_mode text not null default 'direct' check (schedule_mode in ('direct', 'batches')),
  start_at timestamptz null,
  allowed_weekdays integer[] not null default '{0,1,2,3,4,5,6}',
  window_start time null,
  window_end time null,
  timezone text not null default 'America/Sao_Paulo',
  -- worker
  next_run_at timestamptz null,
  last_sent_at timestamptz null,
  last_error text null,
  consecutive_failures integer not null default 0,
  started_at timestamptz null,
  finished_at timestamptz null,
  cancelled_at timestamptz null,
  -- contadores (trigger)
  total_count integer not null default 0,
  pending_count integer not null default 0,
  sending_count integer not null default 0,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  read_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  optout_count integer not null default 0,
  cancelled_count integer not null default 0,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wa_campaigns_status_next_run_idx on public.wa_campaigns (status, next_run_at);
create index if not exists wa_campaigns_instance_status_idx on public.wa_campaigns (instance_id, status);
create index if not exists wa_campaigns_created_at_idx on public.wa_campaigns (created_at desc);

create or replace trigger set_timestamp_wa_campaigns
before update on public.wa_campaigns
for each row execute function trigger_set_timestamp();

create table if not exists public.wa_campaign_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wa_campaigns(id) on delete cascade,
  position integer not null,
  body text not null default '',
  media jsonb null,
  contact jsonb null,
  created_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table if not exists public.wa_campaign_slots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wa_campaigns(id) on delete cascade,
  position integer not null,
  run_at timestamptz not null,
  quantity integer not null check (quantity > 0),
  sent_count integer not null default 0,
  unique (campaign_id, position)
);

create table if not exists public.wa_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wa_campaigns(id) on delete cascade,
  position integer not null,
  phone text not null,
  phone_raw text null,
  name text null,
  variables jsonb not null default '{}'::jsonb,
  source_ref jsonb null,
  slot_id uuid null references public.wa_campaign_slots(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'optout', 'cancelled')),
  template_index integer null,
  message_id text null,
  zaap_id text null,
  error text null,
  attempts integer not null default 0,
  claimed_at timestamptz null,
  sent_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index if not exists wa_campaign_recipients_queue_idx on public.wa_campaign_recipients (campaign_id, status, position);
create index if not exists wa_campaign_recipients_message_id_idx on public.wa_campaign_recipients (message_id);
create index if not exists wa_campaign_recipients_phone_idx on public.wa_campaign_recipients (phone);

create or replace trigger set_timestamp_wa_campaign_recipients
before update on public.wa_campaign_recipients
for each row execute function trigger_set_timestamp();

create table if not exists public.wa_optouts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  source text not null check (source in ('button', 'text', 'manual')),
  reason text null,
  campaign_id uuid null,
  instance_id uuid null,
  message_id text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_webhook_events (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid null references public.zapi_instances(id) on delete set null,
  type text null,
  message_id text null,
  phone text null,
  payload jsonb not null default '{}'::jsonb,
  relayed_at timestamptz null,
  relay_status integer null,
  relay_error text null,
  received_at timestamptz not null default now()
);

create index if not exists wa_webhook_events_received_at_idx on public.wa_webhook_events (received_at desc);
create index if not exists wa_webhook_events_message_id_idx on public.wa_webhook_events (message_id);

-- ---------------------------------------------------------------------------
-- Contadores por trigger
-- ---------------------------------------------------------------------------
create or replace function public.wa_campaign_counter_column(p_status text)
returns text language sql immutable as $$
  select case p_status
    when 'pending' then 'pending_count'
    when 'sending' then 'sending_count'
    when 'sent' then 'sent_count'
    when 'delivered' then 'delivered_count'
    when 'read' then 'read_count'
    when 'failed' then 'failed_count'
    when 'skipped' then 'skipped_count'
    when 'optout' then 'optout_count'
    when 'cancelled' then 'cancelled_count'
    else null end
$$;

create or replace function public.wa_campaign_recipients_counter_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_col text;
  new_col text;
begin
  if tg_op = 'INSERT' then
    new_col := public.wa_campaign_counter_column(new.status);
    execute format('update public.wa_campaigns set total_count = total_count + 1, %I = %I + 1 where id = $1', new_col, new_col) using new.campaign_id;
    return new;
  elsif tg_op = 'DELETE' then
    old_col := public.wa_campaign_counter_column(old.status);
    execute format('update public.wa_campaigns set total_count = greatest(total_count - 1, 0), %I = greatest(%I - 1, 0) where id = $1', old_col, old_col) using old.campaign_id;
    return old;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    old_col := public.wa_campaign_counter_column(old.status);
    new_col := public.wa_campaign_counter_column(new.status);
    execute format('update public.wa_campaigns set %I = greatest(%I - 1, 0), %I = %I + 1 where id = $1', old_col, old_col, new_col, new_col) using new.campaign_id;
    return new;
  end if;
  return new;
end $$;

drop trigger if exists wa_campaign_recipients_counter on public.wa_campaign_recipients;
create trigger wa_campaign_recipients_counter
after insert or update of status or delete on public.wa_campaign_recipients
for each row execute function public.wa_campaign_recipients_counter_trg();

create or replace function public.wa_campaign_recount(p_campaign_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.wa_campaigns c set
    total_count = s.total,
    pending_count = s.pending,
    sending_count = s.sending,
    sent_count = s.sent,
    delivered_count = s.delivered,
    read_count = s.read,
    failed_count = s.failed,
    skipped_count = s.skipped,
    optout_count = s.optout,
    cancelled_count = s.cancelled
  from (
    select
      count(*) as total,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'sending') as sending,
      count(*) filter (where status = 'sent') as sent,
      count(*) filter (where status = 'delivered') as delivered,
      count(*) filter (where status = 'read') as read,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'skipped') as skipped,
      count(*) filter (where status = 'optout') as optout,
      count(*) filter (where status = 'cancelled') as cancelled
    from public.wa_campaign_recipients where campaign_id = p_campaign_id
  ) s
  where c.id = p_campaign_id;
$$;

-- Claim atômico de 1 destinatário pendente (usado pelo worker).
create or replace function public.wa_claim_next_recipient(p_campaign_id uuid)
returns setof public.wa_campaign_recipients language sql security definer set search_path = public as $$
  update public.wa_campaign_recipients r
  set status = 'sending', claimed_at = now(), attempts = attempts + 1
  where r.id = (
    select id from public.wa_campaign_recipients
    where campaign_id = p_campaign_id and status = 'pending'
    order by position
    limit 1
    for update skip locked
  )
  returning r.*;
$$;

revoke all on function public.wa_campaign_recount(uuid) from public;
revoke all on function public.wa_claim_next_recipient(uuid) from public;
grant execute on function public.wa_campaign_recount(uuid) to service_role;
grant execute on function public.wa_claim_next_recipient(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: mídia das campanhas (privado; URL assinada na hora do envio)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
select 'wa-campaign-media', 'wa-campaign-media', false
where not exists (select 1 from storage.buckets where id = 'wa-campaign-media');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t regclass;
  res text := 'comercial-disparo-whatsapp';
begin
  foreach t in array array[
    app_private.enable_rls_if_exists('wa_campaigns'),
    app_private.enable_rls_if_exists('wa_campaign_templates'),
    app_private.enable_rls_if_exists('wa_campaign_slots'),
    app_private.enable_rls_if_exists('wa_campaign_recipients')
  ] loop
    if t is null then continue; end if;
    perform app_private.apply_policy(t, t::text || '_select_permitted', 'SELECT', format('app_private.has_permission(%L, %L)', res, 'can_view'));
    perform app_private.apply_policy(t, t::text || '_insert_permitted', 'INSERT', null, format('app_private.has_permission(%L, %L)', res, 'can_include'));
    perform app_private.apply_policy(t, t::text || '_update_permitted', 'UPDATE', format('app_private.has_permission(%L, %L)', res, 'can_edit'), format('app_private.has_permission(%L, %L)', res, 'can_edit'));
    perform app_private.apply_policy(t, t::text || '_delete_permitted', 'DELETE', format('app_private.has_permission(%L, %L)', res, 'can_delete'));
  end loop;

  t := app_private.enable_rls_if_exists('wa_optouts');
  perform app_private.apply_policy(t, 'wa_optouts_select_permitted', 'SELECT', 'app_private.has_permission(''comercial-disparo-whatsapp'', ''can_view'')');
  perform app_private.apply_policy(t, 'wa_optouts_insert_permitted', 'INSERT', null, 'app_private.has_permission(''comercial-disparo-whatsapp'', ''can_include'')');
  perform app_private.apply_policy(t, 'wa_optouts_delete_permitted', 'DELETE', 'app_private.has_permission(''comercial-disparo-whatsapp'', ''can_delete'')');

  -- wa_webhook_events: só service role (RLS ligada, sem políticas).
  t := app_private.enable_rls_if_exists('wa_webhook_events');
end $$;

notify pgrst, 'reload schema';
