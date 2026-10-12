-- Cotas por CONTA, não por IA (decisão do Bruno, 2026-10-10): Claude (chat) e
-- Claude Code usam a mesma conta, logo a mesma cota. projeto_agentes.cota_conta
-- liga a IA à conta; IA cuja cota não dá para ler (Jarvis/ChatGPT, Gemini
-- NotebookLM) fica com null e não aparece no cartão.
-- projeto_agente_cotas deixa de ser chaveada por agente_id e passa a usar a conta.

alter table public.projeto_agentes
  add column if not exists cota_conta text null
    check (cota_conta is null or cota_conta ~ '^[a-z0-9-]{1,40}$'),
  add column if not exists cota_conta_rotulo text null
    check (cota_conta_rotulo is null or char_length(btrim(cota_conta_rotulo)) between 1 and 60);

update public.projeto_agentes a
   set cota_conta = v.conta, cota_conta_rotulo = v.rotulo
  from (values
    ('claude', 'claude', 'Claude.ai / Claude Code'),
    ('claude-code', 'claude', 'Claude.ai / Claude Code'),
    ('codex', 'codex', 'Codex (OpenAI)'),
    ('gemini-antigravity', 'antigravity', 'Gemini (Antigravity)')
  ) as v (slug, conta, rotulo)
 where a.slug = v.slug;

alter table public.projeto_agente_cotas add column if not exists cota_conta text null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'projeto_agente_cotas' and column_name = 'agente_id'
  ) then
    update public.projeto_agente_cotas c
       set cota_conta = a.cota_conta
      from public.projeto_agentes a
     where a.id = c.agente_id and c.cota_conta is null;
    -- IA sem conta legível: a cota não tem onde ficar.
    delete from public.projeto_agente_cotas where cota_conta is null;
    -- Claude e Claude Code com cota de mesmo nome: fica a leitura mais recente.
    delete from public.projeto_agente_cotas c
     using public.projeto_agente_cotas d
     where d.cota_conta = c.cota_conta and d.nome_chave = c.nome_chave
       and (d.updated_at, d.id) > (c.updated_at, c.id);
    alter table public.projeto_agente_cotas drop constraint if exists projeto_agente_cotas_agente_nome_key;
    alter table public.projeto_agente_cotas drop column agente_id;
  end if;
end $$;

alter table public.projeto_agente_cotas alter column cota_conta set not null;
alter table public.projeto_agente_cotas drop constraint if exists projeto_agente_cotas_conta_nome_key;
-- Alvo do upsert (cota_conta, nome_chave).
alter table public.projeto_agente_cotas
  add constraint projeto_agente_cotas_conta_nome_key unique (cota_conta, nome_chave);

notify pgrst, 'reload schema';
