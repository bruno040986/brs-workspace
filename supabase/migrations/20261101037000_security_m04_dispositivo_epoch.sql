-- M04 pos-revisao (3): cookie de dispositivo confiavel preso ao estado da conta.
-- credencial_epoch por usuario; sobe em: troca de senha/e-mail/ban no Auth, bloqueio administrativo, logout "todas",
-- remocao de fator e sessao negada (tudo via auth_revogar_liberacoes) e auth_revogar_sessao com motivo <> 'logout'.
-- Logout comum NAO sobe (decisao do revisor: e confianca do dispositivo). Idempotente.
CREATE TABLE IF NOT EXISTS public.auth_credencial_epoch (
  user_id uuid PRIMARY KEY,
  epoch integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_credencial_epoch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_credencial_epoch FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.auth_credencial_epoch IS 'M04 dispositivo confiavel: RLS deny-all; so service_role e funcoes SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION app_private.auth_bump_epoch(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_credencial_epoch (user_id, epoch) VALUES (p_user, 1)
  ON CONFLICT (user_id) DO UPDATE SET epoch = public.auth_credencial_epoch.epoch + 1, atualizado_em = now();
$$;
REVOKE ALL ON FUNCTION app_private.auth_bump_epoch(uuid) FROM PUBLIC, anon, authenticated;

-- Epoch atual do usuario; NULL se o usuario nao existe no Auth (cookie ignorado).
CREATE OR REPLACE FUNCTION public.auth_credencial_epoch(p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e integer;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN RETURN NULL; END IF;
  INSERT INTO public.auth_credencial_epoch (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT epoch INTO e FROM public.auth_credencial_epoch WHERE user_id = p_user;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.auth_credencial_epoch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_credencial_epoch(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auth_revogar_liberacoes(p_user uuid, p_motivo text, p_exceto_session uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  UPDATE public.auth_sessao_liberacoes SET revogada_em = now(), motivo_revogacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND revogada_em IS NULL AND (p_exceto_session IS NULL OR session_id <> p_exceto_session);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND consumido_em IS NULL AND invalidado_em IS NULL AND (p_exceto_session IS NULL OR session_id <> p_exceto_session);
  PERFORM app_private.auth_bump_epoch(p_user);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.auth_revogar_sessao(p_user uuid, p_session uuid, p_motivo text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  UPDATE public.auth_sessao_liberacoes SET revogada_em = now(), motivo_revogacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND session_id = p_session AND revogada_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.auth_desafios_email SET invalidado_em = now(), motivo_invalidacao = left(coalesce(p_motivo, 'revogada'), 60)
   WHERE user_id = p_user AND session_id = p_session AND consumido_em IS NULL AND invalidado_em IS NULL;
  IF coalesce(p_motivo, '') <> 'logout' THEN PERFORM app_private.auth_bump_epoch(p_user); END IF;
  RETURN n;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.auth_revogar_liberacoes(uuid,text,uuid)', 'public.auth_revogar_sessao(uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  RAISE NOTICE 'M04: credencial_epoch do dispositivo confiavel instalado';
END $$;
