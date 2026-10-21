-- Cancelamento de solicitação com motivo (HelpDesk 0183f0f1).
-- Ao cancelar uma simulação/digitação, o usuário informa o motivo (lista fechada)
-- e uma observação opcional de até 1000 caracteres. Idempotente; sem DROP de dado.
-- Linhas já canceladas ficam sem motivo: o check de consistência é NOT VALID
-- (vale só para inserts/updates novos).

alter table public.crm_solicitacoes_operacionais
  add column if not exists motivo_cancelamento text null,
  add column if not exists observacao_cancelamento text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_solic_motivo_cancelamento_chk') then
    alter table public.crm_solicitacoes_operacionais
      add constraint crm_solic_motivo_cancelamento_chk
      check (motivo_cancelamento is null or motivo_cancelamento in (
        'inviabilidade_financeira', 'restricao_instituicao_financeira', 'fora_roteiro_operacional', 'outros'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_solic_observacao_cancelamento_chk') then
    alter table public.crm_solicitacoes_operacionais
      add constraint crm_solic_observacao_cancelamento_chk
      check (observacao_cancelamento is null or char_length(observacao_cancelamento) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_solic_cancelamento_consistente_chk') then
    -- motivo só em 'cancelado' e obrigatório nele; observação exige motivo.
    alter table public.crm_solicitacoes_operacionais
      add constraint crm_solic_cancelamento_consistente_chk
      check (
        (status = 'cancelado' and motivo_cancelamento is not null)
        or (status <> 'cancelado' and motivo_cancelamento is null and observacao_cancelamento is null)
      ) not valid;
  end if;
end $$;

comment on column public.crm_solicitacoes_operacionais.motivo_cancelamento is
  'Motivo do cancelamento: inviabilidade_financeira | restricao_instituicao_financeira | fora_roteiro_operacional | outros.';
comment on column public.crm_solicitacoes_operacionais.observacao_cancelamento is
  'Observação opcional do cancelamento (até 1000 caracteres).';
