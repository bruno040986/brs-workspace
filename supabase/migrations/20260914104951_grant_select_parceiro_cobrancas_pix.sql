-- Grant de leitura pro parceiro em parceiro_cobrancas_pix (14/09/2026).
--
-- A tabela tem RLS com a policy parceiro_cobrancas_pix_select_own
-- (user_id = auth.uid()) e entrou na publication do Realtime
-- (20260914095410), mas o papel `authenticated` NUNCA recebeu GRANT SELECT:
-- policy sem privilégio de tabela não libera nada, e o Realtime avalia a
-- RLS com o papel do usuário — resultado: o evento de "pago" não chegava
-- ao navegador. O app nunca percebeu porque lê via service role.
-- Só SELECT, só authenticated; a policy continua limitando ao dono.

grant select on public.parceiro_cobrancas_pix to authenticated;
