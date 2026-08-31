-- Fila WeSales do CRM: libera as operações que o código já enfileira mas o
-- CHECK (de 25/08) não conhecia — 'atualizar_campo' (espelho "Código de
-- Parceiro BRS", 30/08) e 'mover_oferta' (funis AC, fase C). Sem isso o
-- INSERT em lote da alocação falhava inteiro (batch all-or-nothing) e a
-- campanha nascia sem nenhuma operação na fila (bug real: df3-3, 31/08).
alter table public.crm_wesales_queue drop constraint if exists crm_wesales_queue_operacao_check;
alter table public.crm_wesales_queue add constraint crm_wesales_queue_operacao_check
  check (operacao in (
    'upsert_contato','atualizar_dono','atualizar_campo','mover_estagio','mover_oferta',
    'adicionar_nota','aplicar_tag','remover_tag','sincronizar_estagio','sincronizar_atendimento'
  ));
