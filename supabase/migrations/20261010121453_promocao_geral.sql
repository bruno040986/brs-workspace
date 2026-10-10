-- =============================================================================
-- Promoção geral NuAzul "Servidor Premiado" (PRJ-1/T-18)
-- A campanha 'valparaiso-go' vira a promoção para servidores públicos de qualquer
-- convênio: o convênio passa a ser da inscrição/indicação (escolhido no cadastro).
-- - promocao_inscricoes / promocao_indicacoes: convenio_id (da lista) OU convenio_texto_livre
--   ("não encontrei meu convênio", até 120 caracteres, vinculado depois pela equipe).
--   Pelo menos um dos dois é obrigatório só para linhas criadas a partir desta migration.
-- - Renomeia a campanha: slug 'promocao-servidor-publico', sem cidade/uf, regulamento 2026-10-11.
-- - Prefixos de código (VPG/IND) NÃO mudam: códigos já emitidos continuam válidos.
-- =============================================================================

-- 1. Convênio por inscrição e por indicação ------------------------------------
alter table public.promocao_inscricoes
  add column if not exists convenio_id uuid null references public.convenios (id);
create index if not exists promocao_inscricoes_convenio_idx on public.promocao_inscricoes (convenio_id);

alter table public.promocao_indicacoes
  add column if not exists convenio_id uuid null references public.convenios (id);
create index if not exists promocao_indicacoes_convenio_idx on public.promocao_indicacoes (convenio_id);

alter table public.promocao_inscricoes
  add column if not exists convenio_texto_livre text null;
alter table public.promocao_indicacoes
  add column if not exists convenio_texto_livre text null;

-- O check só vale para linhas criadas depois desta migration (corte = now() na aplicação;
-- as antigas seguem válidas sem convênio). Nota: entre aplicar a migration e publicar o código
-- novo, a API antiga não grava convênio e o insert falharia — aplicar e publicar juntos.
do $$
declare
  v_corte text := quote_literal(now()::text);
  t text;
begin
  foreach t in array array['promocao_inscricoes', 'promocao_indicacoes'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_convenio_check');
    execute format(
      'alter table public.%I add constraint %I check ('
      || '(convenio_texto_livre is null or char_length(convenio_texto_livre) between 1 and 120)'
      || ' and (created_at < %s::timestamptz or convenio_id is not null or convenio_texto_livre is not null))',
      t, t || '_convenio_check', v_corte);
  end loop;
end $$;

-- 2. Backfill com o convênio da campanha ---------------------------------------
update public.promocao_inscricoes i
   set convenio_id = c.convenio_id
  from public.promocao_campanhas c
 where c.id = i.campanha_id and i.convenio_id is null and c.convenio_id is not null;

update public.promocao_indicacoes i
   set convenio_id = c.convenio_id
  from public.promocao_campanhas c
 where c.id = i.campanha_id and i.convenio_id is null and c.convenio_id is not null;

-- 3. Campanha geral: cidade/uf deixam de ser obrigatórios ------------------------
alter table public.promocao_campanhas alter column cidade drop not null;
alter table public.promocao_campanhas alter column uf drop not null;

update public.promocao_campanhas
   set slug = 'promocao-servidor-publico',
       nome = 'NuAzul – Você Sempre no Azul | Servidor Premiado',
       cidade = null,
       uf = null,
       regulamento_url = 'https://nuazul.com.br/promocao-servidor-publico#regulamento',
       regulamento_versao = '2026-10-11',
       wesales_tags = '{promo-servidor-publico}',
       updated_at = now()
 where slug = 'valparaiso-go';

notify pgrst, 'reload schema';
