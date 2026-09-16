-- FyDigital — chave do webhook (15/09/2026).
--
-- Descoberta da FyDigital (client_credentials + assinatura JWT RS256 de cada
-- payload, resposta/webhook assinados com a chave pública deles). A FyDigital
-- não expõe um segredo de webhook próprio — quem cadastra a URL com o
-- suporte deles somos nós, então geramos um token opaco e o exigimos na
-- query string (?key=), mesmo padrão fail-closed usado no webhook da Nuvidio/
-- Assinafy. A validação de verdade é a assinatura RS256 do payload (coluna
-- if_webhook_eventos.assinatura_valida); o ?key= é só a primeira barreira
-- pra não expor o endpoint a qualquer requisição não relacionada.
alter table public.if_credito_config
  add column if not exists webhook_key text;

update public.if_credito_config
  set webhook_key = encode(gen_random_bytes(20), 'hex')
  where webhook_key is null;

notify pgrst, 'reload schema';
