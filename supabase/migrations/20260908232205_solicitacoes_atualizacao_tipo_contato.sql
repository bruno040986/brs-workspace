-- Acrescenta o tipo 'contato' (telefones/WhatsApp/e-mails) às solicitações
-- de atualização cadastral do Portal Parceiro. Até aqui só existiam
-- 'cadastral' (razão social/endereço) e 'bancario'; o Bruno pediu um card
-- próprio para os dados de contato em vez de misturá-los em 'cadastral'.

alter table public.solicitacoes_atualizacao_cadastral
  drop constraint if exists solicitacoes_atualizacao_cadastral_tipo_check;

alter table public.solicitacoes_atualizacao_cadastral
  add constraint solicitacoes_atualizacao_cadastral_tipo_check
  check (tipo in ('cadastral', 'bancario', 'contato'));
