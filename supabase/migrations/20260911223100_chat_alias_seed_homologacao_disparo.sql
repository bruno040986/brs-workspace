-- Correção de dados (11/09/2026, homologação do disparo): as 3 conversas
-- órfãs por @lid criadas hoje. Cada LID nasceu na mesma instância em que
-- UM único lead do disparo tinha acabado de responder (conv 31→32 na 2537,
-- 35→36 na 2043, 33→38 na 4435), então o par LID↔telefone é inequívoco.
-- Semeia o alias (mensagens futuras desses leads caem na conversa do
-- telefone) e liga a conversa órfã ao lead (some o "criar lead").
--
-- APLICADA em 11/09/2026 22:31 UTC via Supabase MCP (apply_migration), com
-- esta mesma versão registrada — este arquivo é o espelho no repositório.
insert into public.chat_contato_alias (conta_id, instancia_id, jid_telefone, lid, origem)
select i.conta_id, p.instancia_id, p.jid_telefone, p.lid, 'inbound'
from (values
  ('906d9c33-8ba4-4bf6-b9d4-97be1da4a692'::uuid, '54108199342270@lid', '556192873740@s.whatsapp.net'),
  ('dd8ab522-da61-46a2-a2db-2bf70860f6c0'::uuid, '64193050976280@lid', '556182970623@s.whatsapp.net'),
  ('b20c4df9-b52e-4b69-8f67-f5b772737460'::uuid, '249370414948431@lid', '556186310435@s.whatsapp.net')
) as p(instancia_id, lid, jid_telefone)
join public.chat_instancias i on i.id = p.instancia_id
on conflict do nothing;

update public.chat_conversas c
set crm_contato_id = p.contato_id, telefone_e164 = p.telefone_e164
from (values
  ('906d9c33-8ba4-4bf6-b9d4-97be1da4a692'::uuid, '54108199342270@lid', '4107d0e2-9b3b-45eb-b829-4ef80ce2ae0a'::uuid, '5561992873740', 32),
  ('dd8ab522-da61-46a2-a2db-2bf70860f6c0'::uuid, '64193050976280@lid', '812d8e74-5f3e-4758-86aa-6570b23fcf00'::uuid, '5561982970623', 36),
  ('b20c4df9-b52e-4b69-8f67-f5b772737460'::uuid, '249370414948431@lid', '12ef2334-8779-484e-af18-ef9d5bd082cd'::uuid, '5561986310435', 38)
) as p(instancia_id, lid, contato_id, telefone_e164, conversa_cw)
where c.instancia_id = p.instancia_id and c.jid = p.lid and c.chatwoot_conversation_id = p.conversa_cw and c.crm_contato_id is null;
