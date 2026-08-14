-- Segurança (M-3): estas duas tabelas ficaram sem RLS em todas as migrations,
-- ficando expostas a leitura/escrita direta via PostgREST com a anon key
-- (ex.: reescrever destination_url dos cartões públicos = phishing).
--
-- O app acessa ambas apenas via service-role (admin client), que ignora RLS,
-- então habilitar RLS aqui NÃO quebra o aplicativo — apenas bloqueia o acesso
-- direto de anon/authenticated pelo PostgREST (deny-all sem policies).

do $$
begin
  perform app_private.enable_rls_if_exists('commercial_card_links');
  perform app_private.enable_rls_if_exists('commercial_vehicle_rental_rates');
end $$;

notify pgrst, 'reload schema';
