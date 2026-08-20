-- Correções do worker de Disparo de WhatsApp (achados do primeiro teste real):
-- 1. wa_bump_slot: incremento ATÔMICO do contador do lote (o read-then-write
--    anterior perdia incrementos sob concorrência).
-- 2. wa_campaign_recount agora também recalcula o sent_count dos lotes a partir
--    dos destinatários (repara contadores corrompidos).

create or replace function public.wa_bump_slot(p_slot_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.wa_campaign_slots set sent_count = sent_count + 1 where id = p_slot_id;
$$;

revoke all on function public.wa_bump_slot(uuid) from public;
grant execute on function public.wa_bump_slot(uuid) to service_role;

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

  -- Lotes: processados = destinatários do lote que já saíram de pending/sending.
  update public.wa_campaign_slots sl set sent_count = coalesce(r.done, 0)
  from (
    select slot_id, count(*) filter (where status not in ('pending', 'sending')) as done
    from public.wa_campaign_recipients
    where campaign_id = p_campaign_id and slot_id is not null
    group by slot_id
  ) r
  where sl.campaign_id = p_campaign_id and sl.id = r.slot_id;
$$;

notify pgrst, 'reload schema';
