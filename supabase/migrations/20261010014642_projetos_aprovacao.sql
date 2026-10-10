-- Módulo Projetos: aprovação da escrita técnica ao entrar em "planejamento".
-- escrita_versao sobe a cada registrar_escrita_tecnica; a aprovação guarda
-- quem aprovou, quando e qual versão da escrita foi aprovada.

alter table public.projetos
  add column if not exists escrita_versao integer not null default 0,
  add column if not exists aprovado_por uuid null references public.users (id) on delete set null,
  add column if not exists aprovado_em timestamptz null,
  add column if not exists versao_escrita_aprovada integer null;

-- Projetos que já têm escrita técnica começam na v1.
update public.projetos set escrita_versao = 1
where escrita_versao = 0 and coalesce(btrim(escrita_tecnica), '') <> '';

notify pgrst, 'reload schema';
