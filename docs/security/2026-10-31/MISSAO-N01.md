# N01 — correções locais iniciais de autorização

Você é o Claude executor de uma nova sessão local, coordenado pelo Codex. Leia AUTORIZACAO-NOTURNA.md e os dois documentos anexos neste diretório. Usuário autorizou programação local, sem publicação. Não afirme ser a sessão anterior.

Objetivo único: preparar migration LOCAL para fechar políticas permissivas conhecidas de disciplinary_records e regras_portabilidade_ifs/globais, e remover promoção automática por domínio no handle_new_user sem quebrar provisionamento administrativo legítimo. Investigue definições locais e consumidores; não invente permissões ou políticas. O recurso de portabilidade identificado é operacional-simulador-portabilidade, validar no código. Não basta TO authenticated. Preserve políticas legítimas de RH e isolamento de parceiros.

Ferramentas deliberadamente limitadas a Read/Glob/Grep/Edit/Write. Sem Bash, rede ou MCP. Não tente obter permissões adicionais. Não ler .env, segredos, credenciais, settings ou evidências brutas. Não alterar AGENTS.md/CLAUDE.md, configurações de ferramentas ou arquivos fora deste worktree. Nenhuma mudança remota, publicação, push ou envio de mensagem. Você pode ler código/migrations deste worktree. Não faça alterações UI/TS nesta missão; AGENTS exige guias Next antes de código app.

Escrita permitida: nova migration supabase/migrations/20261101010000_security_initial_rls_hardening.sql, SQL de testes sob supabase/tests/security_initial_rls_hardening.sql e documentos neste diretório. Não editar migrations históricas. Antes de escrever, confirme paths de migrations reais.

Entregue teste SQL transacional com fixtures e rollback: anon negado, authenticated sem perfil negado, perfil RH autorizado nas operações pertinentes, perfil portabilidade autorizado, usuário desativado negado, signup corporativo nunca cria admin. Evite assertions que passam só porque não há dados. Se contrato desconhecido, pare apenas esse ponto e documente evidência necessária. Não escreva rollback automático que reabre políticas públicas.

Registre ACEITO em RELATORIO-N01.md ao iniciar. Termine relatório com arquivos, mudanças, riscos, testes criados mas NÃO executados (Codex executará), dependências e ENTREGUE PARA REVISAO. Pare após N01; próximo pacote só após revisão do Codex.
