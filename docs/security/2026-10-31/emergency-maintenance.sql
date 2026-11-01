-- Contenção temporária autorizada por Bruno; NÃO é a migration definitiva N01.
-- Não apaga dados/políticas. Preserva catálogo anterior em schema sem acesso público.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE SCHEMA brs_security_maintenance;
REVOKE ALL ON SCHEMA brs_security_maintenance FROM PUBLIC, anon, authenticated;
CREATE TABLE brs_security_maintenance.table_state AS
 SELECT clock_timestamp() AS captured_at,n.nspname AS schema_name,c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND (n.nspname='public' OR (n.nspname='storage' AND c.relname IN ('objects','buckets')) OR (n.nspname='realtime' AND c.relname='messages'));
CREATE TABLE brs_security_maintenance.policy_state AS
 SELECT clock_timestamp() AS captured_at,p.* FROM pg_policies p
 JOIN brs_security_maintenance.table_state t ON p.schemaname=t.schema_name AND p.tablename=t.table_name;
CREATE TABLE brs_security_maintenance.refresh_state AS
 SELECT clock_timestamp() AS captured_at,id,user_id,revoked FROM auth.refresh_tokens WHERE revoked=false;
CREATE TABLE brs_security_maintenance.user_ban_state AS
 SELECT clock_timestamp() AS captured_at,id,banned_until FROM auth.users;
REVOKE ALL ON ALL TABLES IN SCHEMA brs_security_maintenance FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT * FROM brs_security_maintenance.table_state LOOP
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',t.schema_name,t.table_name);
  EXECUTE format('CREATE POLICY brs_emergency_20261031 ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',t.schema_name,t.table_name);
 END LOOP;
END $$;
UPDATE auth.refresh_tokens SET revoked=true WHERE revoked=false;
COMMIT;
SELECT (SELECT count(*) FROM brs_security_maintenance.table_state) AS protected_tables,
 (SELECT count(*) FROM pg_policies WHERE policyname='brs_emergency_20261031') AS emergency_policies,
 (SELECT count(*) FROM auth.refresh_tokens WHERE revoked=false) AS active_refresh_tokens;
