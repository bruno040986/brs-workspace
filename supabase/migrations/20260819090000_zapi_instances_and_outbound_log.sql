-- Z-API de verdade: múltiplas instâncias + log de todo envio de WhatsApp.
--
-- zapi_instances substitui a zapi_config de linha única (que fica no lugar por
-- ora, sem uso). Cada instância = 1 número de WhatsApp na Z-API. As instâncias
-- podem ser compartilhadas com o ARW, por isso guardamos as URLs de webhook
-- originais (relay) e nunca sobrescrevemos às cegas.
--
-- wa_outbound_messages é o log único de TODO envio (campanhas, boas-vindas do
-- parceiro, motor SCP, testes) e recebe as atualizações de status via webhook.

create extension if not exists pgcrypto;

create table if not exists public.zapi_instances (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instance_id text not null,
  token text not null,
  client_token text not null default '',
  is_active boolean not null default true,
  is_default boolean not null default false,
  webhook_key text not null unique default encode(gen_random_bytes(16), 'hex'),
  last_status jsonb null,
  last_device jsonb null,
  last_checked_at timestamptz null,
  webhook_mode text not null default 'none' check (webhook_mode in ('none', 'direct', 'relay')),
  webhook_relay_urls jsonb not null default '{}'::jsonb,
  webhook_flags jsonb not null default '{}'::jsonb,
  next_send_at timestamptz null,
  worker_lock_until timestamptz null,
  worker_lock_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists zapi_instances_instance_id_uniq on public.zapi_instances (instance_id);
create unique index if not exists zapi_instances_one_default on public.zapi_instances (is_default) where is_default;
create index if not exists zapi_instances_active_idx on public.zapi_instances (is_active);

create or replace trigger set_timestamp_zapi_instances
before update on public.zapi_instances
for each row execute function trigger_set_timestamp();

-- Backfill: a linha legada de zapi_config vira a "Instância principal" (padrão).
insert into public.zapi_instances (name, instance_id, token, client_token, is_active, is_default)
select 'Instância principal', z.instance_id, z.token, coalesce(z.client_key, ''), coalesce(z.is_active, false), true
from public.zapi_config z
where coalesce(z.instance_id, '') <> '' and coalesce(z.token, '') <> ''
  and not exists (select 1 from public.zapi_instances)
limit 1
on conflict (instance_id) do nothing;

-- Log de envios
create table if not exists public.wa_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid null references public.zapi_instances(id) on delete set null,
  phone text not null,
  source text not null check (source in ('campaign', 'campaign_button', 'campaign_contact', 'scp', 'welcome', 'test', 'manual')),
  message_type text not null check (message_type in ('text', 'image', 'document', 'audio', 'contact', 'button_list')),
  status text not null default 'accepted' check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  zaap_id text null,
  message_id text null,
  error text null,
  payload_summary jsonb not null default '{}'::jsonb,
  campaign_id uuid null,
  recipient_id uuid null,
  process_instance_id uuid null,
  partner_id uuid null,
  created_by uuid null,
  sent_at timestamptz not null default now(),
  status_updated_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists wa_outbound_messages_message_id_idx on public.wa_outbound_messages (message_id);
create index if not exists wa_outbound_messages_zaap_id_idx on public.wa_outbound_messages (zaap_id);
create index if not exists wa_outbound_messages_campaign_idx on public.wa_outbound_messages (campaign_id, recipient_id);
create index if not exists wa_outbound_messages_phone_idx on public.wa_outbound_messages (phone, sent_at desc);
create index if not exists wa_outbound_messages_partner_idx on public.wa_outbound_messages (partner_id);

-- RLS: leitura por quem configura WhatsApp ou opera campanhas; escrita só por
-- quem configura (service role — usado pelas ações — passa por cima).
do $$
declare
  t regclass;
begin
  t := app_private.enable_rls_if_exists('zapi_instances');
  perform app_private.apply_policy(t, 'zapi_instances_select_permitted', 'SELECT',
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_view'') OR app_private.has_permission(''comercial-disparo-whatsapp'', ''can_view'')');
  perform app_private.apply_policy(t, 'zapi_instances_insert_permitted', 'INSERT', null,
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_edit'')');
  perform app_private.apply_policy(t, 'zapi_instances_update_permitted', 'UPDATE',
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_edit'')',
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_edit'')');
  perform app_private.apply_policy(t, 'zapi_instances_delete_permitted', 'DELETE',
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_delete'')');

  t := app_private.enable_rls_if_exists('wa_outbound_messages');
  perform app_private.apply_policy(t, 'wa_outbound_messages_select_permitted', 'SELECT',
    'app_private.has_permission(''sistema-config-whatsapp'', ''can_view'') OR app_private.has_permission(''comercial-disparo-whatsapp'', ''can_view'')');
end $$;

notify pgrst, 'reload schema';
