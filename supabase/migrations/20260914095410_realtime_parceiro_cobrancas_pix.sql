-- Realtime para o checkout Pix do Portal Parceiro (14/09/2026).
--
-- Hoje a tela de recarga (e a de pagamento do lote de higienização) só
-- descobre que o Pix foi pago quando o parceiro clica em "Já paguei —
-- verificar": o webhook do gateway confirma e credita o saldo, mas o QR
-- continua na tela. Com a tabela na publication, o Portal escuta a própria
-- cobrança e mostra "pago" sozinho no instante da confirmação.
--
-- Segurança: RLS já restringe o SELECT ao dono
-- (parceiro_cobrancas_pix_select_own: user_id = auth.uid()) e o Realtime
-- respeita a policy — cada parceiro só recebe eventos das suas cobranças.
-- Idempotente, mesmo padrão de 20260914091154_realtime_chat_status_reacoes.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'parceiro_cobrancas_pix'
  ) then
    alter publication supabase_realtime add table public.parceiro_cobrancas_pix;
  end if;
end $$;
