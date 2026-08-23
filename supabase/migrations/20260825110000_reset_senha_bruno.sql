-- Restauração de acesso (23/08/2026): reset da senha do usuário interno do
-- Bruno após alteração acidental (colisão de sessão no fluxo de troca de
-- senha — ver correção do storageKey do Workspace).
--
-- A versão executada desta migration definiu uma senha provisória (comunicada
-- ao Bruno por canal direto) com temp_password_reset_required = true, forçando
-- a troca no primeiro acesso. O conteúdo foi substituído por este no-op ANTES
-- do commit para não versionar a senha em texto puro (apontamento da revisão
-- de segurança); a versão já consta como aplicada em schema_migrations e não
-- será reexecutada.

select 1;
