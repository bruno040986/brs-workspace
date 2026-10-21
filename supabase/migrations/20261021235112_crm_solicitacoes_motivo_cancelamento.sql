-- Cancelamento de solicitação com motivo (HelpDesk 0183f0f1).
-- Ao cancelar uma simulação/digitação, o usuário informa o motivo (lista fechada)
-- e uma observação opcional de até 1000 caracteres. Idempotente; sem DROP de dado.
-- Check de consistência VALIDADO e simples: motivo/observação só existem em
-- 'cancelado'. A obrigatoriedade do motivo ao cancelar fica no app, porque há
-- linhas antigas canceladas sem motivo (exigir no banco travaria UPDATEs nelas,
-- inclusive ON DELETE SET NULL e o app antigo).

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
    -- motivo/observação só em 'cancelado' (vale para todas as linhas).
    alter table public.crm_solicitacoes_operacionais
      add constraint crm_solic_cancelamento_consistente_chk
      check (status = 'cancelado' or (motivo_cancelamento is null and observacao_cancelamento is null));
  end if;
end $$;

comment on column public.crm_solicitacoes_operacionais.motivo_cancelamento is
  'Motivo do cancelamento: inviabilidade_financeira | restricao_instituicao_financeira | fora_roteiro_operacional | outros.';
comment on column public.crm_solicitacoes_operacionais.observacao_cancelamento is
  'Observação opcional do cancelamento (até 1000 caracteres).';
