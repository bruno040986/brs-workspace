-- Correção pontual de dado (não é alteração de schema): o login do parceiro
-- DF3 (agentes_parceiros.auth_user_id = 40083975-1368-42c2-afcb-63c8d87bb5c1)
-- ficou vinculado a uma conta de teste/demo criada como
-- demo1@parceiro.brspromotora.com.br, em vez do e-mail sintético esperado
-- df3@parceiro.brspromotora.com.br (Portal Parceiro monta
-- <codigo_arw>@parceiro.brspromotora.com.br no login) — bloqueava o acesso
-- do DF3 independente de senha. Confirmado: é o único parceiro com essa
-- inconsistência (27/08/2026).
update auth.users
set email = 'df3@parceiro.brspromotora.com.br',
    updated_at = now()
where id = '40083975-1368-42c2-afcb-63c8d87bb5c1';

update auth.identities
set identity_data = jsonb_set(identity_data, '{email}', '"df3@parceiro.brspromotora.com.br"'),
    updated_at = now()
where user_id = '40083975-1368-42c2-afcb-63c8d87bb5c1' and provider = 'email';
