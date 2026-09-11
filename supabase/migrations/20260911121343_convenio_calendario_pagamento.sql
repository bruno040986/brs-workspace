-- Convênio BC: calendário de pagamento (11/09/2026).
--
-- Gap real identificado pelo Bruno: nem a base de referência da Alicia nem a
-- BC do Workspace tinham data de pagamento / fechamento da folha — informação
-- operacional que o agente de IA precisa pra responder "até quando dá pra
-- mandar desconto esse mês" / "quando cai o pagamento". Cada convênio tem uma
-- regra diferente (Bruno, 11/09): por isso 3 modos por campo, não um só.
--
-- Modelo (2 conceitos × 4 colunas cada, mesmo padrão flat da seção "geral"
-- existente em convenios.abrangencia/numero_servidores/...):
--   modo = 'dia_fixo'    → usa `_dia` (1-31, dia corrido do mês)
--   modo = 'dia_util'    → usa `_dia_util` (Nº dia útil, contado do início do mês)
--   modo = 'texto_livre' → usa `_texto` (regra que não cabe em dia fixo/útil)
-- Sem NOT NULL: BC inteira é opcional (mesmo padrão dos demais campos da seção).

alter table public.convenios
  add column if not exists pagamento_modo text null
    check (pagamento_modo is null or pagamento_modo in ('dia_fixo', 'dia_util', 'texto_livre')),
  add column if not exists pagamento_dia integer null check (pagamento_dia is null or (pagamento_dia between 1 and 31)),
  add column if not exists pagamento_dia_util integer null check (pagamento_dia_util is null or pagamento_dia_util > 0),
  add column if not exists pagamento_texto text null,
  add column if not exists fechamento_folha_modo text null
    check (fechamento_folha_modo is null or fechamento_folha_modo in ('dia_fixo', 'dia_util', 'texto_livre')),
  add column if not exists fechamento_folha_dia integer null check (fechamento_folha_dia is null or (fechamento_folha_dia between 1 and 31)),
  add column if not exists fechamento_folha_dia_util integer null check (fechamento_folha_dia_util is null or fechamento_folha_dia_util > 0),
  add column if not exists fechamento_folha_texto text null;

notify pgrst, 'reload schema';
