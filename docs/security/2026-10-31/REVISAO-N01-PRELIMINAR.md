# Revisão preliminar N01 — Codex

Ainda não libera produção. Pontos antes do aceite:

1. Remover TODAS as políticas fora da lista pode excluir políticas RESTRICTIVE legítimas. Preservar políticas restritivas e retirar somente permissivas comprovadamente vulneráveis; se aparecer política permissiva desconhecida, abortar com diagnóstico para revisão explícita, sem substituição silenciosa. Nomes documentados das políticas RH vulneráveis: acesso_total e acesso medidas. Não reconstituir legado apenas por inferência de migrations.
2. Também considerar privilégios herdados de PUBLIC. Revogar de anon não remove privilégio dado a PUBLIC; TRUNCATE ignora RLS. Nas três tabelas sem consumidor público, revogar de PUBLIC e anon; manter somente DML pertinente para authenticated, preservando service_role.
3. Ausência das tabelas-alvo não deve aparentar correção bem-sucedida. Preflight deve falhar explicitamente se faltar tabela/função esperada e preservar atomicidade do pacote inteiro.
4. Codex confirmou por inspeção que coeficiente global é histórico append-only no consumidor; restrição de UPDATE/DELETE é coerente. Upsert de regras IF exige checar perfis edit-only: relatório deve informar necessidade de ajuste de consumidor, não ampliar can_include implicitamente.
5. Testes de revisão independentes criados pelo Codex em local-review-assertions.sql. Schema local mínimo representativo, não validação do schema completo implantado. Antes da mudança, repro confirmou leitura RH por authenticated sem perfil, regras globais por anon e criação automática admin.

Aguardar relatório completo e resultados de teste antes de fechar revisão.
