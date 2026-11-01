# Relatório N01 — correções locais iniciais de autorização

ACEITO — 2026-10-31. Executor: Claude (nova sessão local via CLI, coordenada pelo Codex; não é a sessão anterior do VS Code).
Escopo: somente MISSAO-N01.md. Sem Bash, rede, MCP, push ou alteração remota. Nenhum arquivo de app (UI/TS), AGENTS.md/CLAUDE.md, migration histórica, .env ou evidência bruta foi lido para escrita ou alterado.

## Arquivos

| Arquivo | Situação |
|---|---|
| `supabase/migrations/20261101010000_security_initial_rls_hardening.sql` | novo, local, não aplicado |
| `supabase/tests/security_initial_rls_hardening.sql` | novo, **não executado** |
| `docs/security/2026-10-31/RELATORIO-N01.md` | este relatório |

Paths confirmados antes de escrever: as migrations reais ficam em `supabase/migrations/` (última existente: `20261009140733_chat_conversa_troca_instancia_manual.sql`, então `20261101010000` fica por último na ordem). O único teste SQL existente é `supabase/tests/esteira_migrations_check.sql`; o novo teste segue o mesmo padrão (transação, `RAISE EXCEPTION`, `ROLLBACK`).

## Evidência local usada

- `app_private.has_permission(resource, action)` (`20260601132916_harden_permissions_rls.sql:6`): lê `public.users` com `id = auth.uid()` e `COALESCE(active, true) = true`, permissão direta antes da de perfil. Não tem bypass por `role`. O cálculo do app (`src/lib/auth/effectivePermissions.ts`) segue a mesma regra e também não usa `role`.
- **disciplinary_records**: as quatro políticas de RH legítimas estão em `20260601132916...sql:288-292`. Nenhuma política aberta aparece nas migrations, mas a REVISAO-01A mostrou 3 linhas visíveis na simulação autenticada. `20260601153000_cleanup_legacy_rls_policies.sql` removeu as políticas legadas das outras tabelas de RH, mas **não desta**. Conclusão: existe uma política legada criada fora do repositório, com nome desconhecido.
- **regras_portabilidade_ifs/globais**: `20260922220000_simulador_portabilidade_regras.sql:59-77` cria `USING (true)` sem `TO`, ou seja, para PUBLIC (inclui anon), em SELECT e em `FOR ALL`.
- O recurso `operacional-simulador-portabilidade` foi confirmado em `src/lib/auth/permissions.ts:143,255`, `src/lib/nav/divisoes.ts:172` e `src/app/(dashboard)/usuarios/page.tsx:82`. As subrotas regras-ifs e coeficiente-global usam o mesmo recurso.
- Consumidores da portabilidade (`src/app/(dashboard)/simulador-portabilidade/actions.ts`): SELECT nas duas tabelas; `upsert` em ifs com `onConflict institution_id,convenio_codigo`; DELETE em ifs; só INSERT em globais (histórico, a leitura pega o `updated_at` mais recente). Todos usam o cliente com sessão e **nenhum** chama `requirePermission`.
- **handle_new_user**: a versão vigente (`20260831160000_users_espelho_so_internos.sql`) insere `role 'admin'` para qualquer `auth.users` com e-mail `@brspromotora.com.br` que não seja de parceiro nem `external`. O cadastro legítimo (`saveUserDirectly`, `src/app/(dashboard)/usuarios/actions.ts:252,364-397`) exige `sistema-usuarios-cadastro` e faz upsert completo em `public.users` (role, profile_id, active, etc.) com `onConflict: 'id'`. Por isso ele não depende do trigger. O provisionamento de parceiro (`agente-corban/actions.ts:146`) usa o domínio de parceiro, que o trigger já ignorava.
- Nenhum código ou política deste repositório autoriza por `users.role = 'admin'`.

## Mudanças (migration)

1. **disciplinary_records**: remove toda política fora da lista das 4 de RH (`*_select_rh`, `*_insert_rh`, `*_update_rh`, `*_delete_rh`). Cada política removida é registrada por `RAISE NOTICE` com cmd/roles/using/check. As 4 de RH são recriadas iguais às de `20260601132916`. Também: `REVOKE ALL FROM anon` e `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM authenticated` (TRUNCATE ignora RLS).
2. **regras_portabilidade_ifs**: remove as políticas abertas (e qualquer outra fora da lista). Cria políticas por operação sobre `operacional-simulador-portabilidade`: SELECT `can_view`, INSERT `can_include`, UPDATE `can_edit` (USING e CHECK), DELETE `can_delete`. Os mesmos revokes do item 1.
3. **regras_portabilidade_globais**: SELECT `can_view`, INSERT `can_edit`. Gravar o coeficiente é a ação de edição da tela, mas tecnicamente é um insert. Não há política de UPDATE/DELETE, e `UPDATE, DELETE, TRUNCATE, ...` foram revogados de authenticated (sem consumidor). Anon revogado.
4. **handle_new_user**: a função passa a só `return new`. Sem espelho automático e sem promoção a admin. Ficam `SET search_path = public` e `REVOKE ALL ... FROM public, anon, authenticated`. O trigger em `auth.users` foi mantido, porque o nome dele não está versionado no repo.
5. Não há rollback automático. Reverter não significa reabrir `USING (true)`.

## Testes criados — NÃO EXECUTADOS

`supabase/tests/security_initial_rls_hardening.sql` (o Codex vai executar em banco descartável, depois da migration):

- Estrutura: nenhuma política sem restrição nem fora de `authenticated` nas 3 tabelas; contagem exata de políticas (4/4/2); RLS ligado; anon sem privilégio; sem TRUNCATE; globais sem UPDATE/DELETE; `handle_new_user` sem INSERT.
- Fixtures próprias (UUIDs `00000001-0000-4000-8000-…`). A linha de base confirma que o superusuário vê 2/2/1 antes de cada negação, para nenhum teste passar só por falta de dados.
- **anon**: SELECT nas 3 tabelas, INSERT em ifs e UPDATE em globais retornam `insufficient_privilege`.
- **Negados** (sem perfil; parceiro sem linha em `public.users`; signup corporativo; **desativado com perfil RH**; provisionado sem permissão): 0 linhas visíveis, UPDATE/DELETE com 0 linhas afetadas, INSERT rejeitado e `has_permission` falso. Depois, como superusuário, confirma que nada mudou.
- **RH** (`rh-medidas-disciplinares` completo): vê 2 linhas, insere, altera e exclui; não vê portabilidade.
- **Portabilidade completa**: vê; faz upsert pelos caminhos de INSERT e de UPDATE (mesmo formato da action); exclui; grava coeficiente global; UPDATE em globais é negado; não vê RH.
- **Portabilidade só leitura**: vê; não altera, não exclui, não insere.
- **Signup corporativo**: INSERT em `auth.users` com `@brspromotora.com.br` não cria nenhuma linha em `public.users`, nem admin. **Provisionamento administrativo simulado** (upsert como `saveUserDirectly`) cria o espelho com o role definido pelo servidor.

Limites do teste: `employees`, `disciplinary_reasons`, `disciplinary_records`, `users`, `access_profiles` e `profile_permissions` foram criadas fora das migrations. As colunas das fixtures seguem o que o app grava. Se o esqueleto local exigir outra coluna NOT NULL, ajuste só a fixture. O INSERT em `auth.users` usa colunas mínimas. O teste não cobre PostgREST/HTTP nem o GoTrue real (signup desativado no Auth é outra etapa).

## Riscos e impactos legítimos

1. **Remoção por lista de permitidas em disciplinary_records**: se a política legada desconhecida for legítima (por exemplo, o colaborador ver as próprias medidas), ela será removida. **Antes de aplicar em qualquer ambiente**, o Codex deve listar `pg_policies` dessas 3 tabelas no ambiente-alvo e conferir com os NOTICEs.
2. **Consumidores de RH que dependiam da política aberta** (as políticas de RH não foram ampliadas, porque isso seria inventar permissão):
   - `rh/colaboradores/[id]/page.tsx:94`: quem tem só `rh-colaboradores`, ou o próprio colaborador, deixa de ver o histórico disciplinar.
   - `rh/page.tsx:64-67`: o ramo "próprio colaborador" deixa de ver as próprias medidas.
   - `rh/medidas-disciplinares/nova/page-client.tsx:50-52`: as contagens de reincidência (cliente do navegador) exigem `rh-medidas-disciplinares can_view`, mas a rota exige só `can_include`. Um perfil com include sem view recebe 0, e a numeração de reincidência sai errada. **Decisão de negócio pendente** (Bruno): o colaborador vê as próprias medidas? `rh-colaboradores` dá acesso ao histórico?
3. **Portabilidade**: editar uma regra existente via upsert exige `can_include` + `can_edit` + `can_view`. O coeficiente global exige `can_edit`. Perfis que hoje só têm `can_view` perdem a escrita, que antes estava aberta a qualquer um, inclusive anon. As actions continuam sem `requirePermission`: depois desta migration, a RLS é a única barreira. Adicionar a checagem no servidor é uma mudança TS, fora desta missão.
4. **handle_new_user**: as linhas `role='admin'` já criadas pelo trigger continuam lá. `saveUserDirectly` aceita `role` vindo do cliente (`'admin'` está entre os valores válidos em `usuarios/page.tsx:892`). Neste repo `role` não autoriza nada, mas **Portal e CRM não foram verificados**. Se o upsert de `saveUserDirectly` falhar depois do `createUser`, sobra um Auth órfão sem espelho (antes sobrava um admin; agora fica sem acesso).
5. A senha fixa de fallback (`usuarios/actions.ts:366`, REVISAO-01A item 6) **não** foi tratada, porque é mudança TS fora do escopo N01.
6. O trigger em `auth.users` não está versionado. Se não existir em algum ambiente, o item 4 da migration não tem efeito ali, o que não é um problema.

## Dependências / pendências

- Executar a migration e o teste em banco descartável (Codex).
- Antes de qualquer aplicação remota: inventário de `pg_policies`/grants das 3 tabelas e da definição atual de `handle_new_user` no ambiente-alvo, e autorização explícita do Bruno.
- Decisões de negócio do risco 2.
- Pacotes seguintes: `requirePermission` nas actions do simulador, a senha de fallback, a restrição de `role` no servidor e a verificação de `users.role` em Portal/CRM. Isso exige ler os guias Next (AGENTS) antes de mexer no código do app.
- Signup público do Auth, OTP/magic link e provedores externos ficam para a etapa de provisionamento. Esta migration não os desativa.

ENTREGUE PARA REVISAO
