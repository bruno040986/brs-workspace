-- ============================================================================
-- Landing do convênio — preview do RASCUNHO por token (contrato v1, seção 14)
-- `preview_token`: 32 bytes aleatórios em base64url, gravado só no rascunho
-- (is_draft) pela action gerarLinkPreview (validade de 2 h). A rota pública
-- /api/convenios/publico/v1/{slug}/rascunho?token=... monta o snapshot do
-- rascunho sem gravar nada. Rascunho publicado deixa de ser rascunho: o link morre.
-- Aditivo: linhas existentes ficam com null (sem preview).
-- ============================================================================

alter table public.convenio_conteudo_site
  add column if not exists preview_token text null,
  add column if not exists preview_token_expira_em timestamptz null;

create unique index if not exists convenio_conteudo_site_preview_token_idx
  on public.convenio_conteudo_site (preview_token)
  where preview_token is not null;

-- Gerar/renovar o token NÃO pode mexer em updated_at: ele é o token de concorrência
-- (CAS) de salvar, marcar como revisado e publicar. Sem isto, gerar um link de preview
-- quebraria a revisão/publicação aberta na tela com CONFLITO_CONCORRENCIA.
create or replace function public.convenio_conteudo_site_set_timestamp()
returns trigger
language plpgsql
as $$
begin
  -- Só o token mudou (e nada mais): mantém updated_at. Qualquer outro update segue como antes.
  if (new.preview_token is distinct from old.preview_token or new.preview_token_expira_em is distinct from old.preview_token_expira_em)
     and (to_jsonb(new) - array['preview_token', 'preview_token_expira_em', 'updated_at'])
       = (to_jsonb(old) - array['preview_token', 'preview_token_expira_em', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_timestamp_convenio_conteudo_site on public.convenio_conteudo_site;
create trigger set_timestamp_convenio_conteudo_site
  before update on public.convenio_conteudo_site
  for each row execute function public.convenio_conteudo_site_set_timestamp();

notify pgrst, 'reload schema';
