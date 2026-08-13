-- Migração: aposentar a biblioteca "Ações e Gatilhos" do SCP
-- Data: 2026-07-27
--
-- A tela "Ações e Gatilhos" era um CRUD de catálogo ÓRFÃO: nenhum motor nem o
-- Construtor de Processos lia estas tabelas. O motor real do SCP orquestra por
-- handlers em código (src/lib/scp-engine/handlers.ts) + a config das etapas.
-- Removida a tela, a rota, a lib e as ações; aqui removemos as tabelas.
--
-- Também remove o recurso de permissão 'scp-acoes-gatilhos' das tabelas de
-- permissão (profile/user), já que o menu não existe mais.
--
-- NÃO APLICADA. Revisar e rodar com acompanhamento (banco de produção).

DROP TABLE IF EXISTS public.scp_automation_actions;
DROP TABLE IF EXISTS public.scp_automation_triggers;

DELETE FROM public.profile_permissions WHERE resource_name = 'scp-acoes-gatilhos';
DELETE FROM public.user_permissions WHERE resource_name = 'scp-acoes-gatilhos';

NOTIFY pgrst, 'reload schema';
