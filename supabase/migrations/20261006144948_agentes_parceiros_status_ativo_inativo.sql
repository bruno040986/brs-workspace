-- Alinha agentes_parceiros.status com AGENTE_CORBAN_STATUSES (src/lib/agente-corban.ts):
-- 'finalizado' passa a ser 'ativo'; adiciona 'inativo'.
alter table public.agentes_parceiros drop constraint if exists agentes_parceiros_status_check;

update public.agentes_parceiros set status = 'ativo' where status = 'finalizado';

alter table public.agentes_parceiros add constraint agentes_parceiros_status_check
  check (status in ('novo', 'aguarda_assinatura', 'assinatura_realizada', 'validacao_final', 'ativo', 'inativo'));
