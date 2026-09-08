# Retorno ao Astra — publicação controlada de 99e82b0, 08/09/2026

Responde à liberação de publicação do lote 02A. **Fundação durável mantida
desligada. Sem migrations nem ativação de piloto nesta etapa.**

## Conferência pré-push (antes de publicar)

- `brs-alvoconsig` `main` local conferido: exatamente `99e82b0` (o commit
  aprovado), sem commits extras, working tree limpo. `git fetch origin`
  mostrou `origin/main` em `f1d6bb9`, 3 commits atrás, sem divergência —
  fast-forward garantido.
- Estado das flags checado **no Railway (remoto)**, não pela ausência local:
  `list-variables` do serviço `engine`/produção não lista `ENGINE_DURABLE_EVENTS`
  nem `ENGINE_DURABLE_ACCOUNT_IDS` entre as 21 variáveis definidas. Confirmação
  mais forte ainda veio depois do deploy, direto do processo em produção (ver
  logs abaixo): `duravel: false, contasSelecionadas: 0`.

## Push

`git push origin main` — fast-forward `f1d6bb9..99e82b0`, sem force, sem
reescrever histórico.

## Deploys

| Serviço | Plataforma | Deploy ID | Commit implantado | Estado |
|---|---|---|---|---|
| CRM (apps/web) | Vercel | `dpl_2EjfmGy3ebnKELFFeXRDjwQkJxFE` | `99e82b0ff434d7ba7073be6e31a3427c124d2b50` | READY |
| Engine (services/engine) | Railway | `47fd8504-f3b8-4dc1-b6e5-c8e1f266264d` | `99e82b0ff434d7ba7073be6e31a3427c124d2b50` | SUCCESS |

Commit implantado confere com o commit aprovado nos dois serviços (SHA
completo igual, não só os 7 dígitos curtos).

## Saúde HTTP

- CRM: `https://alvoconsig.brspromotora.com.br/` respondeu com página
  completa e funcional (landing do Alvo Consig), sem sinal de erro
  5xx/redirect quebrado.
- Engine: `GET /health` → `{"ok":true,"instancias_ativas":2}`.

## Logs de inicialização (engine, deploy `47fd8504`)

```
engine no ar                         port=3000 publicUrl=https://engine-production-113d.up.railway.app
processamento durável                duravel=false contasSelecionadas=0
reconectando instâncias com sessão salva   total=2
instância conectada                  instId=906d9c33-... numero=556198882537
instância conectada                  instId=5576d3fc-... numero=556131991641
```

Nenhuma linha de erro na subida. As 2 instâncias Baileys com sessão salva
reconectaram normalmente.

## Configuração das flags (nomes, sem valores)

Variáveis do serviço `engine`/produção no Railway, listadas nesta checagem
(21 no total, nomes apenas — `valuesRedacted: true` no retorno da API):
`CHATWOOT_URL`, `CRM_CREDENTIALS_KEY`, `ENGINE_API_TOKEN`,
`ENGINE_PUBLIC_URL`, `ENGINE_WEBHOOK_SECRET`, `LOG_LEVEL`, `PORT`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (+ `RAILWAY_*` injetadas pela
plataforma).

**Ausentes:** `ENGINE_DURABLE_EVENTS`, `ENGINE_DURABLE_ACCOUNT_IDS`,
`ENGINE_OWNED_HISTORY`, `ENGINE_DISPARO_WORKER`, `CHAT_INSTANCE_LEASES` (e as
variáveis de lease associadas). Toda a fundação nova e as demais flags do
lote de retomada (histórico próprio, leases, worker de disparo) seguem
desligadas — nenhuma delas fazia parte desta publicação.

## Estado final

- `brs-alvoconsig`: GitHub `main` = `99e82b0`; Vercel produção e Railway
  produção servindo esse commit.
- `brs-workspace`: inalterado nesta etapa (`main` continua em `b511b66`,
  já publicado antes desta rodada — não fazia parte desta liberação).
- Nenhuma migration aplicada, nenhuma flag ligada, nenhuma conta no piloto,
  nenhuma mensagem real enviada por esta publicação.

## Pendente

Piloto de uma conta do CRM (ativação de `ENGINE_DURABLE_EVENTS` +
`ENGINE_DURABLE_ACCOUNT_IDS`, conta BRS mantida fora) e homologação real com
navegador/socket/provedor — ambos aguardando autorização explícita, conforme
combinado.
