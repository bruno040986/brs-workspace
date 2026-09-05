-- =============================================================================
-- Campanha do parceiro: motivo da pausa (05/09/2026)
--
-- Campanha de voz→WhatsApp é FAIL-CLOSED por decisão do Bruno: se QUALQUER
-- receptiva selecionada cair, a campanha inteira para — mesmo que sobrem
-- outras conectadas. O raciocínio é que um número caindo pode ser sinal de
-- bloqueio, e nesse caso continuar disparando pelas que sobraram é o pior
-- movimento possível.
--
-- Parar sem dizer por quê seria só metade: o operador precisa abrir a tela e
-- entender na hora que foi "número desconectado", não ficar procurando.
-- =============================================================================

alter table public.crm_campanhas_parceiro
  add column if not exists pausa_motivo text null;

comment on column public.crm_campanhas_parceiro.pausa_motivo is
  'Por que a campanha foi pausada automaticamente (ex.: receptiva desconectada). NULL = pausa manual.';
