-- Complemento à migration 20260923011931 (cadastro no portal — rascunho +
-- link mágico): cooldown de 60s do reenvio de link precisa de um carimbo
-- server-side próprio (não pode reusar ultimo_acesso_em, que também é
-- tocado pelo autosave de cada etapa, nem codigo_enviado_em, que é do
-- código de verificação por e-mail — propósito diferente).
alter table public.corban_cadastro_rascunhos
  add column if not exists link_enviado_em timestamptz null;

notify pgrst, 'reload schema';
