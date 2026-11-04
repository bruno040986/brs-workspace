-- Fecha o bucket `avatars` (fotos dos funcionários) para quem NÃO é interno.
--
-- Brecha (leva 2, análise de isolamento, 04/11): a política permissiva
-- `avatars_select_authenticated` usa `bucket_id = 'avatars' AND sessao_interna_ok()`, e
-- `sessao_interna_ok()` devolve TRUE para quem não é interno (`NOT is_active_internal_user_base() OR ...`).
-- Resultado: qualquer parceiro (Portal) ou atendente (CRM) autenticado lista e baixa os 16 objetos.
--
-- Desenho escolhido: política RESTRITIVA nova, só para o bucket `avatars`, em vez de reescrever a
-- permissiva. Motivos (menor risco):
--   * não altera a política existente: o caminho do funcionário interno continua idêntico
--     (`is_active_internal_user()` = base AND sessão liberada, que é exatamente o que a permissiva já
--     exige de um interno; nenhum interno que hoje lê passa a ser negado);
--   * `FOR ALL`: cobre também qualquer política permissiva futura de INSERT/UPDATE/DELETE em `avatars`;
--   * `bucket_id IS DISTINCT FROM 'avatars' OR ...`: para os outros buckets a política é sempre verdadeira (sem efeito);
--   * só `authenticated`; `anon` já não tem política nenhuma; `service_role` (rota /api/avatar,
--     upload em usuarios/actions.ts e rh/parceiros/actions.ts, URL assinada do /cartao) tem BYPASSRLS;
--   * rollback = apagar uma política pelo nome, sem recriar nada.
-- `(select ...)` para o Postgres avaliar o helper uma vez por comando (initPlan), não por linha.

DROP POLICY IF EXISTS seg_avatars_somente_interno ON storage.objects;

CREATE POLICY seg_avatars_somente_interno ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (bucket_id IS DISTINCT FROM 'avatars' OR (SELECT app_private.is_active_internal_user()))
  WITH CHECK (bucket_id IS DISTINCT FROM 'avatars' OR (SELECT app_private.is_active_internal_user()));

-- ROLLBACK (idempotente; volta ao estado anterior, a permissiva antiga nunca foi tocada):
--   DROP POLICY IF EXISTS seg_avatars_somente_interno ON storage.objects;
