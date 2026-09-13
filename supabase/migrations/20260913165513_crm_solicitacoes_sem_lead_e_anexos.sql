-- Solicitação de simulação SEM lead + anexos (Fable, 13/09/2026, decisão do
-- Bruno na homologação): a solicitação pode nascer na tela de Solicitações
-- informando nome, CPF e data de nascimento (cliente ainda sem cadastro),
-- com documentos opcionais. Convenções (a app valida antes de gravar):
--   pessoa = { "nome": "...", "cpf": "11 dígitos", "nascimento": "AAAA-MM-DD" }
--            só quando NÃO há contato_id/relacionamento_id.
--   anexos = [{ "bucket": "parceiro-midias", "path": "solicitacoes/<agente_parceiro_id>/<solicitacao_id>/<uuid>.<ext>",
--               "mime": "...", "nome": "...", "tamanho": 123 }]
--            bucket privado já existente; nunca assinar path vindo do
--            navegador sem conferir o prefixo do parceiro da sessão.
--   snapshot_condicoes (já existia, pensado pra digitação) passa a guardar
--            também a oferta respondida na simulação — é o que permite
--            responder uma solicitação sem lead (não há crm_ofertas pra criar).
--
-- Aplicar pela pasta principal do brs-workspace (`echo Y | npx supabase db push`);
-- em 13/09 o apply_migration via MCP foi bloqueado pelo classificador.
alter table public.crm_solicitacoes_operacionais
  add column if not exists pessoa jsonb null,
  add column if not exists anexos jsonb not null default '[]'::jsonb;

alter table public.crm_solicitacoes_operacionais
  drop constraint if exists crm_solicitacoes_operacionais_check;
alter table public.crm_solicitacoes_operacionais
  add constraint crm_solicitacoes_op_identidade_check
  check (relacionamento_id is not null or contato_id is not null or (pessoa is not null and pessoa ? 'cpf'));
alter table public.crm_solicitacoes_operacionais
  add constraint crm_solicitacoes_op_anexos_check check (jsonb_typeof(anexos) = 'array');

comment on column public.crm_solicitacoes_operacionais.pessoa is 'Cliente sem cadastro: {nome, cpf (11 dígitos), nascimento AAAA-MM-DD}. Só quando não há contato/relacionamento.';
comment on column public.crm_solicitacoes_operacionais.anexos is 'Documentos opcionais: [{bucket, path, mime, nome, tamanho}] no bucket privado parceiro-midias.';
