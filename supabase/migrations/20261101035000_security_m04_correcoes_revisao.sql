-- M04 - correcoes pos-revisao (I2, I3). Fica entre M04 (030000) e M05 (040000). Idempotente.
--  I2: pausa de senha por (identificador, origem) + limitador por IP + contador so por identificador que NAO
--      cresce (pausa fixa curta, sem escalada) + desbloqueio zera as chaves de senha do usuario.
--  I3: trocar encrypted_password no Auth revoga as liberacoes (mesma funcao do trigger de ciclo de vida).
DO $$ BEGIN
  IF to_regclass('public.auth_tentativas') IS NULL THEN
    RAISE EXCEPTION 'M04 correcoes: aplique antes 20261101030000_security_m04_login_cinco_etapas.sql';
  END IF;
END $$;

-- Hash do identificador (HMAC do e-mail, calculado pelo servidor) para o administrador limpar as chaves de senha.
ALTER TABLE public.auth_tentativas ADD COLUMN IF NOT EXISTS identificador text;
CREATE INDEX IF NOT EXISTS auth_tentativas_identificador_idx ON public.auth_tentativas (identificador) WHERE identificador IS NOT NULL;

-- Falha com limiar configuravel.
--  p_pausa_fixa_min NULL  : pausa escalonada (5,15,30,60,120,240) como auth_registrar_falha.
--  p_pausa_fixa_min = N   : pausa SEMPRE de N min, sem escalada (pausas fica em 1) e com alerta ligado
--                           (limiar estourado e sinal de ataque; M05 consome). Decai: janela de falhas 15 min,
--                           contador de pausas zera apos 24 h sem falha. Em pausa nada soma.
CREATE OR REPLACE FUNCTION public.auth_registrar_falha_limiar(
  p_chave text, p_etapa text, p_limite int, p_pausa_fixa_min int DEFAULT NULL, p_identificador text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.auth_tentativas%ROWTYPE; novo_alerta boolean := false; minutos int;
BEGIN
  IF p_chave IS NULL OR length(p_chave) = 0 OR p_etapa NOT IN ('senha', 'totp', 'email') OR p_limite IS NULL OR p_limite < 1
     OR (p_pausa_fixa_min IS NOT NULL AND (p_pausa_fixa_min < 1 OR p_pausa_fixa_min > 60)) THEN
    RAISE EXCEPTION 'auth_registrar_falha_limiar: parametros invalidos';
  END IF;
  INSERT INTO public.auth_tentativas (chave, etapa, identificador) VALUES (p_chave, p_etapa, p_identificador) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.auth_tentativas WHERE chave = p_chave AND etapa = p_etapa FOR UPDATE;

  IF r.pausa_ate IS NOT NULL AND r.pausa_ate > now() THEN
    RETURN jsonb_build_object('pausa_seg', ceil(extract(epoch FROM (r.pausa_ate - now())))::int, 'restantes', 0, 'alerta', false, 'pausas', r.pausas);
  END IF;
  IF r.ultima_falha IS NOT NULL AND r.ultima_falha < now() - interval '24 hours' THEN r.pausas := 0; END IF;
  IF r.ultima_falha IS NOT NULL AND r.ultima_falha < now() - interval '15 minutes' THEN r.falhas := 0; END IF;

  r.falhas := r.falhas + 1;
  r.ultima_falha := now();
  IF r.falhas >= p_limite THEN
    IF p_pausa_fixa_min IS NULL THEN
      r.pausas := r.pausas + 1;
      minutos := app_private.auth_pausa_minutos(r.pausas);
      novo_alerta := r.pausas >= 2;
    ELSE
      r.pausas := 1; minutos := p_pausa_fixa_min; novo_alerta := true;
    END IF;
    r.pausa_ate := now() + make_interval(mins => minutos);
    r.falhas := 0;
  END IF;
  UPDATE public.auth_tentativas SET falhas = r.falhas, pausas = r.pausas, pausa_ate = r.pausa_ate, ultima_falha = r.ultima_falha,
         identificador = coalesce(p_identificador, identificador)
   WHERE chave = p_chave AND etapa = p_etapa;
  RETURN jsonb_build_object(
    'pausa_seg', CASE WHEN r.pausa_ate IS NOT NULL AND r.pausa_ate > now() THEN ceil(extract(epoch FROM (r.pausa_ate - now())))::int ELSE 0 END,
    'restantes', greatest(0, p_limite - r.falhas), 'alerta', novo_alerta, 'pausas', r.pausas);
END $$;

-- Desbloqueio administrativo: alem do bloqueio e das pausas de TOTP/e-mail, zera as chaves de SENHA do usuario
-- (par identificador+origem e so-identificador), localizadas pelo hash do identificador calculado no servidor.
DROP FUNCTION IF EXISTS public.auth_desbloquear_usuario(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.auth_desbloquear_usuario(p_user uuid, p_por uuid, p_motivo text, p_identificador text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF p_por IS NULL THEN RAISE EXCEPTION 'desbloqueio exige quem liberou'; END IF;
  UPDATE public.auth_bloqueios_admin SET removido_em = now(), removido_por = p_por, removido_motivo = left(p_motivo, 300)
   WHERE user_id = p_user AND removido_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.auth_tentativas SET falhas = 0, pausas = 0, pausa_ate = NULL
   WHERE chave = p_user::text OR (p_identificador IS NOT NULL AND identificador = p_identificador);
  RETURN n;
END $$;

-- I3: o trigger de ciclo de vida do Auth tambem cobre troca de senha (qualquer caminho, inclusive direto no GoTrue).
CREATE OR REPLACE FUNCTION app_private.auth_revogar_por_mudanca_cadastro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_SCHEMA = 'public' THEN
    IF (OLD.active IS DISTINCT FROM NEW.active AND NOT coalesce(NEW.active, true)) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'usuario_desativado', NULL);
    ELSIF (OLD.email IS DISTINCT FROM NEW.email) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'email_alterado', NULL);
    END IF;
  ELSE
    IF (OLD.email IS DISTINCT FROM NEW.email) OR (NEW.banned_until IS NOT NULL AND NEW.banned_until IS DISTINCT FROM OLD.banned_until) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'auth_email_ou_ban', NULL);
    ELSIF (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password) THEN
      PERFORM public.auth_revogar_liberacoes(NEW.id, 'auth_senha_alterada', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.auth_revogar_por_mudanca_cadastro() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS m04_authusers_revogar_liberacoes ON auth.users;
CREATE TRIGGER m04_authusers_revogar_liberacoes AFTER UPDATE OF email, banned_until, encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_private.auth_revogar_por_mudanca_cadastro();

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.auth_registrar_falha_limiar(text,text,int,int,text)', 'public.auth_desbloquear_usuario(uuid,uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  RAISE NOTICE 'M04: correcoes pos-revisao instaladas (pausa de senha por origem, trigger de senha)';
END $$;
