# Testes da migration ycloud_fundacao (F1)

Postgres descartável:
```
docker run -d --name t -e POSTGRES_PASSWORD=t postgres
docker exec -i t psql -U postgres -v ON_ERROR_STOP=1 < 00_stubs.sql
docker exec -i t psql -U postgres -v ON_ERROR_STOP=1 < ../../../supabase/migrations/20260926142223_ycloud_fundacao.sql
docker exec -i t psql -U postgres -v ON_ERROR_STOP=1 < 02_asserts.sql   # espera 4 NOTICEs de OK
```
