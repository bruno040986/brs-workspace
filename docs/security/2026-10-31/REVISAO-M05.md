# Revisão independente M05 (papel do Codex) — eventos, incidentes, intenções, monitor (+ B-1 documento do parceiro)

Data: 2026-11-01. Worktree `brs-workspace-seguranca-20261031`. Commits revisados: `84f1e6fb`, `e8a7ce61`, `829989fe`, `8f12f0f2` (inclui B-1). Somente leitura; nenhum arquivo além deste foi tocado. Referências: PM §5/§10, PT02 §5 (C) e §5.6/5.7, RELATORIO-M05.md.

## Veredito

**APROVADO COM CORREÇÕES (nenhum BLOQUEANTE).** O núcleo (persistência antes do efeito, estados separados, lease com dono, idempotência, advisory lock, cardinalidade, deny-all) está correto e os testes reais confirmam. Os IMPORTANTES abaixo são de cobertura do monitor, de dado sensível em claro e de custo; recomendo corrigir I-1, I-2 e I-3 antes de ligar os ganchos do M04 e antes de aplicar a migration em produção. Nada aqui exige refazer desenho.

## Saídas reais dos testes

- `bash supabase/tests/run-m05.sh` (Postgres 17 em Docker `brs-security-20261031`, base M03-A, migration aplicada 2x): 42 `OK` + concorrência `1 incidente, 6 eventos, 1 intencao` + claim concorrente `OK` → `M05 TUDO OK`, rc=0.
- `npm test`: 512 testes, 509 pass, 0 fail, 3 skipped.
- `npx tsc --noEmit`: limpo (rc=0).
- Sondagens adversariais adicionais rodadas por mim no banco descartável (resultados citados em cada achado).

## Achados

### IMPORTANTE

**I-1. Monitor não vê função SECURITY DEFINER com EXECUTE público nem tabela sem RLS lida por `authenticated`.**
`supabase/migrations/20261101040000_security_m05_incidentes.sql:484-536` (`seg_monitor_itens`) só percorre `pg_policies`, ACL de relações e `storage.buckets`. Sondagem: criei `public.zz_leak()` SECURITY DEFINER (EXECUTE padrão a PUBLIC) e `public.zz_aberta` sem RLS com `GRANT SELECT TO authenticated` → o monitor devolveu nenhum item para a função e `violacao = NULL` para o grant a authenticated (linhas 514-517 só tratam PUBLIC/anon). PM §10 pede "detecta RLS/grants/buckets divergentes"; uma função definer exposta via PostgREST é a forma mais comum de vazar dados sem mexer em RLS. Correção: (a) adicionar `RETURN QUERY` sobre `pg_proc` em `public` com `prosecdef` e `aclexplode(coalesce(proacl, acldefault('f', proowner)))` com grantee 0/anon/authenticated → `violacao='funcao_definer_executavel'`, `alta`; (b) em `grant`, `quem='authenticated' AND NOT rls AND privs && SELECT` → `alta` (escrita → `critica`). Com a Data API desligada o risco imediato é menor, mas o monitor existe justamente para quando ela for religada.

**I-2. Desvio "novo" em policy/grant/bucket relativo à baseline vira `media` e não notifica.**
`...sql:566` (`coalesce(c.gravidade, 'media')`) e `:589` (só rank ≥ 3 abre incidente). Sondagem: policy nova `TO authenticated USING (id > 0)` e grants novos → 3 desvios `novo|media`, `incidente_id` nulo, nenhuma intenção. Ou seja, após a baseline, qualquer política/grant/bucket NOVO que não seja `true` literal fica só na tabela de desvios, sem alerta. Também `qual` com `(1 = 1)` ou `(select true)` escapa do teste textual. Correção: para `item_tipo IN ('policy','grant','bucket')` e `tipo_desvio IN ('novo','alterado')`, gravidade mínima `alta` (ou configurável em `seg_config`), já que mudança não prevista nesses três objetos é exatamente o que o monitor deve anunciar; o humano fecha/aceita pela baseline.

**I-3. `identidade_informada` guarda em claro o que foi digitado, inclusive senha no campo errado.**
`...sql:299` grava `left(identidade_informada, 254)` sem passar por `seg_sanitizar`; `normalizar.ts:50` só faz trim/lowercase. Sondagem: `identidade_informada: "MinhaSenha@123!"` → gravada literalmente e exibida no painel (`[id]/page.tsx:49`). Usuário que digita a senha no campo de e-mail (erro comum) deixa a senha no log de segurança, contra PM §10 ("sem senhas"). Correção: no TS (`normalizar.ts`), guardar o valor só se parecer identificador (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/` ou CPF `^\d{11}$`), senão gravar `[nao_identificador]`; a correlação já usa `hashCurto`, então nada se perde. Opcional: repetir a regra em SQL.

**I-4. Sanitizador não limita o tamanho de entrada antes de recursar: 7 s de CPU no banco por evento.**
`seg_sanitizar` (`...sql:66-96`) limita 40 chaves × 20 itens × profundidade 5 × 300 chars, mas percorre todo o payload antes do corte em 8 KB (`:289`). Sondagem: payload 40×40×40 chaves (~20 MB) → `seg_registrar_evento` levou **7.176 ms**. O TS (`sanitizarPayload`) tem os mesmos tetos e manda o resultado inteiro pelo RPC. A estrutura do payload é definida pelo servidor (não por atacante), por isso não é bloqueante; mas os ganchos do M04 vão incluir dados derivados da requisição. Correção de uma linha em cada lado: `IF octet_length(p::text) > 16384 THEN RETURN jsonb_build_object('truncado', true, 'bytes', octet_length(p::text)); END IF;` no início de `seg_sanitizar` (nível 0) e `JSON.stringify(payload).length > 16384` → `{ truncado: true }` em `normalizarEvento`.

**I-5. Página de detalhe `/usuarios/seguranca/incidentes/[id]` é negada pelo proxy.**
`src/lib/auth/permissions.ts:98` só tem regra exata para `/usuarios/seguranca/incidentes`; não há `prefixRouteRules` para `/usuarios/...` (`:227-240`), e `getRouteAccessDecision` termina em `deny` (`:352`). O link da listagem (`page.tsx:56`) cai em `/acesso-negado` para todo mundo, inclusive o Bruno. Fail-closed (não é falha de segurança), mas o painel fica inútil para investigar. Correção: adicionar `['/usuarios/seguranca/incidentes', any([view('seguranca-incidentes')])]` em `prefixRouteRules`.

### MENOR

**M-1. Contexto fornecido pelo chamador pode mascarar o incidente agregado.** `...sql:344` monta a chave do agregado como `regra|__agregado__|hora`; sondagem com `contexto:'__agregado__', janela_min:60` colidiu e anexou ao INC agregado (`"agregado": true, "novo": false`). Contextos vêm de código do servidor, então é defesa em profundidade: rejeitar `v_ctx ~ '^__'` em `:317`. Também o lock da chave do agregado é tomado depois do lock `card`, enquanto um chamador com esse contexto o toma antes — ordem inversa.

**M-2. Classificações do excedente de cardinalidade ficam com `incidente_id` nulo.** `:377` atualiza por `contexto = v_ctx`, mas `v_ctx` já foi trocado para `__volume_anomalo__` (`:343`). Sondagem: 9 linhas de `card_regra` sem incidente. Efeito: continuam contando no limiar do contexto original e são religadas em todo agregado novo (`:359`, `contexto = v_ctx OR v_agr`). Guardar o contexto original numa variável antes da troca.

**M-3. Deadlock possível com classificações em ordem diferente na mesma transação.** Os `pg_advisory_xact_lock` por chave (`:326`) são mantidos até o fim; dois eventos com regras `[A,B]` e `[B,A]` podem deadlockar (PG aborta um → evento perdido, pois `registrar.ts:27` engole o erro). Hoje `classificarEvento` sempre produz a mesma ordem; basta documentar ou ordenar `p_classificacoes` por `regra` antes do loop.

**M-4. Estado `preparada` da tentativa é código morto.** `seg_tentativa_preparar` (`:445`) já insere como `enviando`; o CTE `t2` da varredura (`:417`) nunca encontra `preparada`. PT02 §5.1 prevê `preparada → enviando`. Ou gravar `preparada` e deixar o M06 marcar `enviando` logo antes do `fetch`, ou remover `t2` e o estado.

**M-5. Sem teto de `claims`/retentativas.** `seg_intencao_claim` (`:427`) incrementa `claims` sem limite e `seg_intencao_finish('pendente')` permite retentar para sempre. Falta estado `esgotada` (PT02 §5.1). Para o M06: `WHERE claims < seg_cfg('intencao.max_claims', 10)` no claim e, acima, `falhou`.

**M-6. `monitor.buckets_publicos_permitidos` com `?` exige array de strings.** `:523` `v_perm ? b.id::text` funciona para `["logos"]`; se alguém gravar `"logos"` (string) ou objeto, nenhum bucket é permitido (fail-closed, ok) — documentar o formato no `descricao`.

**M-7. Pré-requisito verifica existência, não legibilidade, de `storage.buckets`/`auth.users`.** `:16` usa `to_regclass`. Em produção as funções são SECURITY DEFINER do `postgres` (confirmado no teste: owner `postgres`), que no Supabase tem acesso a ambos; mas se a migration for aplicada por outro papel o monitor falha só na primeira execução do cron. Adicionar `PERFORM count(*) FROM storage.buckets; PERFORM 1 FROM auth.users LIMIT 1;` no DO inicial para falhar cedo.

**M-8. Falha na leitura de `user_schedules` silencia a regra "fora do expediente".** `registrar.ts:19` ignora `error`; se a consulta falhar (coluna renomeada, RLS), `data=null` → `dentro=null` → nunca alerta, sem log. Logar o erro. Convenção `day_of_week` 0=segunda confirmada em `usuarios/page.tsx:14-15`.

**M-9. Painel não avisa "sem baseline".** `seg_monitor_snapshot` devolve `baseline:false`, mas `page.tsx:36` só mostra a última execução. Mostrar "modo absoluto, baseline não definida" para não dar falsa sensação de cobertura (ver item 4 do roteiro de revisão: a primeira execução não aceita estado inseguro — correto — mas também não vê "novo" até alguém rodar `seg_monitor_baseline_definir` à mão).

**M-10. `profile_permissions` está no pré-requisito (`:15`) mas não é usada.** Remover ou conceder também por perfil.

**M-11. Eventos sem `idOrigem` nunca são deduplicados** (`UNIQUE (fonte, id_origem)` com NULL). O relatório já orienta; reforçar no tipo (`idOrigem` obrigatório para `login.*`).

## Checklist do roteiro

1. **Persistência/estados/lease/idempotência**: OK. Evento+incidente+intenção na mesma transação (`:295-392`); 5 tabelas com máquinas próprias; lease com dono e `lease_until`, `CHECK (estado='em_envio') = (owner AND until)` (`:199`); `finish` só pelo dono com lease válido (`:459`); recibos monotônicos (`:472-475`); repetir evento → `duplicado:true` sem contar (`:307-312`). Não há caminho que volte `aceita/entregue/lida` para trás. Estados do incidente divergem do PT02 (`em_acompanhamento/falso_positivo` ausentes) — declarado no relatório, aceitável.
2. **Agrupamento**: lock por chave estável (`hashtextextended('seg:'||chave)`), separado do lock de cardinalidade (`seg:card:`); 50 chaves/regra/h + agregado por hora e teto 200 confirmados nos testes (50 + 1 agregado com 10 suprimidos). Variar IP/e-mail: cada contexto ainda precisa atingir o limiar (5/15) e a cardinalidade fecha em 50 incidentes + 1 agregado por hora por regra; intenções ficam limitadas a ≤ 51/h por regra alta (orçamento é do M06). Crescimento de `seg_eventos`/`seg_evento_classificacoes` sem retenção — já listado como risco pelo executor. Sanitização: chaves e valores sensíveis removidos em TS e SQL; exceções em I-3 e I-4.
3. **RLS/GRANT**: todas as `seg_*` com RLS sem política; REVOKE PUBLIC/anon/authenticated em tabelas, views, sequência e funções; `search_path` fixo em todas (verificado em `pg_proc.proconfig`); nenhum EXECUTE remanescente para PUBLIC/anon/authenticated (verificado via `aclexplode`). OK.
4. **Monitor**: roda como dono `postgres` (SECURITY DEFINER), lê `pg_policies` (sem filtro de privilégio), ACL via `aclexplode`, `storage.buckets` e `auth.users` — funcionou no teste e no Supabase o `postgres` tem acesso. Detecta policy `{public|anon}/true` (crítica), bucket público fora da allowlist (crítica), escrita anon sem RLS (crítica), conta Auth sem cadastro (alta). **Não** detecta função definer pública (I-1) nem novos objetos não-`true` como alerta (I-2). Baseline: recusa violações sem `p_aceitar_violacoes=true` (testado); só é definida por SQL manual — decisão humana preservada. OK com I-1/I-2/M-9.
5. **Cron/painel/permissão**: `isCronAuthorized` usa `safeEqual` SHA-256 + `timingSafeEqual`, fail-closed sem `CRON_SECRET`; só GET. Painel só leitura, `hasPermission('seguranca-incidentes','can_view')` em ambas as páginas, e `getCurrentUserEffectivePermissions` passa por `requireCurrentUser` → gate M04. Migration concede por `lower(u.email) = 'bruno.rodrigues@...'` em `public.users` com `ON CONFLICT (user_id, resource_name)` — a constraint existe (confirmada no teste e usada por `usuarios/actions.ts:446`). Hardcode do e-mail é aceitável para seed único e menor privilégio; se o e-mail não existir, ninguém recebe e nada quebra (então a tela de Perfis já lista o recurso). Rota no proxy: listagem OK; detalhe negado (I-5).
6. **Regras**: `login_fora_expediente` só em `login.concluido` com `identidade_validada_user_id` e `foraDoExpediente === true` (`regras.ts:58-62`; teste cobre). `signup.tentativa` tem regra pronta mas nenhuma fonte dispara (`tipos.ts:12`, `lacunas.ts:3`), logo nenhum falso positivo; a detecção real de signup é o proxy `auth_user_sem_cadastro` (alta), claramente rotulado como lacuna.

## B-1 (commit `8f12f0f2`): `/api/agente-corban/documento`

- **Autorização**: `requireAnyPermission` (`route.ts:16-19`) → `requireCurrentUser` → gate M04; falha → 403. Permissão de módulo, não por agente — coerente com o painel que já mostra os cadastros.
- **Path só do agente**: `resolverDocumentoDoAgente` (`agente-corban-documento.ts:90-95`) exige UUID do agente e que o path esteja em `corban_data` dele ou comece por `correcao/<agenteId>/`. Correto.
- **Traversal**: `extrairPathDocumento` rejeita `..`, `\`, `\0`, `?`, `#`, schemes, `//`, `/api/`; decode só no ramo de URL antiga e o teste `..` vem depois do decode (`:60-66`). `%2e%2e` cru passa pelo filtro, mas no Supabase Storage o nome do objeto é chave literal (não caminho de arquivo) e precisaria vir do `corban_data` ou do prefixo `correcao/<uuid>/` — sem efeito prático. MENOR: rejeitar `%` no path cru.
- **Headers**: `Content-Type` do Storage com `nosniff`, `CSP: sandbox` (neutraliza SVG/HTML com script), `Content-Disposition: inline` com nome saneado (`nomeArquivoSeguro`), `Cache-Control: private, no-store`. Nunca devolve URL do Storage. OK.
- **Cliente**: `DocumentViewer`/`CertificacoesCard` só aceitam `https://` ou `/api/agente-corban/documento?` como href/src. OK.
- MENOR: `agente` não é validado como UUID antes de `.eq('id', ...)` (`route.ts:24-26`); o erro do PostgREST vira 404 — funciona, mas validar antes evita a consulta.

## Recomendação de ordem

1. I-1, I-2 (cobertura do monitor) e I-3 (senha em claro) antes de aplicar a migration em produção.
2. I-4 e I-5 junto com a ligação dos ganchos do M04.
3. MENORES conforme o M06 avança (M-4, M-5 são contrato do dispatcher).
