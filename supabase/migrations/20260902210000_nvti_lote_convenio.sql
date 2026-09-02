-- Lote de higienização NVTI ganha um convênio obrigatório (decisão
-- 02/09/2026, padronização de cadastro/atualização de leads): a API da NVTI
-- não devolve convênio nativamente, e o lead precisa dessa informação pra
-- ser trabalhável no CRM. Nullable no banco (a obrigatoriedade é decidida na
-- API de upload, não aqui — lotes antigos ficam sem convênio, sem quebrar).
alter table public.nvti_batches
  add column if not exists convenio_id uuid null references public.convenios (id);
