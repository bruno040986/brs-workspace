-- O bucket `avatars` passou a ser PRIVADO (incidente 2026-10-31). Troca as URLs publicas gravadas
-- (.../storage/v1/object/public/avatars/<path>[?v=..]) pelo caminho estavel /api/avatar/<path>,
-- servido por rota autenticada. Idempotente: so toca linhas que ainda tem a URL publica antiga.
UPDATE public.users
SET avatar_url = '/api/avatar/' || split_part(substring(avatar_url from position('/storage/v1/object/public/avatars/' in avatar_url) + length('/storage/v1/object/public/avatars/')), '?', 1)
WHERE avatar_url LIKE '%/storage/v1/object/public/avatars/%';

UPDATE public.commercial_entities
SET photo_url = '/api/avatar/' || split_part(substring(photo_url from position('/storage/v1/object/public/avatars/' in photo_url) + length('/storage/v1/object/public/avatars/')), '?', 1)
WHERE photo_url LIKE '%/storage/v1/object/public/avatars/%';
