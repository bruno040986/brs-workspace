-- Tira da publicação `supabase_realtime` as tabelas que nenhum código assina.
--
-- Levantamento de 22/09/2026 nos três repos (brs-workspace, brs-portal-parceiro
-- e brs-alvoconsig, incluindo worktrees): não há `.channel()` / `postgres_changes`
-- para nenhuma das três. Foram publicadas por migrations de 03 e 05/09
-- (20260903020000_chat_atendimento_sinais, 20260903010000_crm_chat_realtime,
-- 20260905160000_crm_discadora) para features que acabaram não usando Realtime.
--
-- Sobre o ganho, para não criar expectativa errada: é pequeno. Medido em
-- 22/09/2026, a decodificação de WAL do Realtime consome ~1,2% de um núcleo
-- (187s de 15.243s de relógio). Isto aqui é higiene — a publicação passa a
-- refletir o que o sistema de fato escuta —, não otimização.
--
-- REVERSÃO (uma linha por tabela):
--   alter publication supabase_realtime add table public.<tabela>;
-- ATENÇÃO: enquanto não for republicada, uma feature nova que dependa de
-- Realtime nessas tabelas simplesmente NÃO recebe eventos, sem erro visível.

do $$
declare
  t text;
begin
  foreach t in array array['chat_atendimento_sinais', 'crm_chamadas', 'crm_chat_mensagens']
  loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
      raise notice 'realtime: % removida da publicacao', t;
    else
      raise notice 'realtime: % ja estava fora da publicacao', t;
    end if;
  end loop;
end $$;
