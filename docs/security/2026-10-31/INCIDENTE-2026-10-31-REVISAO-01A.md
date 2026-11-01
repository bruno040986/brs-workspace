# Revisão 01-A — Codex

Estado: RODADA DE COLETA E REVISAO CONCLUIDA; ACEITE PARCIAL COM LACUNAS.
Este estado não significa incidente resolvido, credenciais historicamente seguras ou autorização de alteração em produção.

## Evidência conferida independentemente

O arquivo fontes-claude-01A.md tem hash 5c18ca6ee02ec1380eef8dd7158c43e5b017ca546ac8c32389b0fe562ff3e6bb e modo 0600. Seu conteúdo ainda resume consultas com reticências e resultados narrados; não é uma exportação integral das fontes primárias.

Para suprir a preservação do que está disponível nesta estação, o Codex arquivou diretamente o registro local da sessão do executor:

- /home/bruno0409/.local/share/brs-incidentes/2026-10-31/session-claude-snapshot-a511b466bb3a.jsonl
- SHA-256: a511b466bb3af8ec18b074655095fe5cae3d02beba83d4e3c595f21305970167
- Arquivo criado em modo 0600, na pasta protegida já verificada. Pode conter dados sensíveis: não copiar para diretório compartilhado, Git ou relatório público.
- Extração dos pares de chamadas/resultados relevantes: queries-contagens-exatas-codex.json, na mesma pasta, modo 0600.

Esse registro é evidência do retorno recebido pelo executor; não substitui uma exportação integral do provedor nem resolve lacunas de retenção/paginação.

Conferi o SQL administrativo de 23:57:36Z e o SQL autenticado de 23:59:25Z, com seus resultados originais. A consulta com api_meta_config retornou erro de permissão; a consulta seguinte, sem essa tabela, retornou contagens utilizáveis. Aceito como evidência da configuração atual:

- Zero linhas visíveis na simulação autenticada para as tabelas de credenciais testadas, incluindo agentes_parceiros, users, chat_contas e chat_instancias.
- Contagem administrativa positiva para esses grupos, conforme resultado original (gateway_pagamentos=3, não vazia).
- Visibilidade de disciplinary_records=3, comunicados=3, workspace_chat_user_profiles=8, regras_portabilidade_ifs=12, profile_schedules=35, user_schedules=70 e sector_links=30 na simulação autenticada.

Limite: isso valida visibilidade de linhas nessas consultas e nesse estado, após contenção de contas. Não comprova o histórico, a totalidade dos claims originais, proteção em outras views/RPCs/rotas, ausência de alterações ou ausência de extração. O teste não documentou current_user/claims efetivos na saída; o efeito observado e a configuração da consulta apoiam a simulação, mas não ampliam seu escopo.

## Correções ainda necessárias nas conclusões

1. Não aceitar "gateway_pagamentos vazia à época" sem fonte histórica. A declaração anterior de tabela vazia foi confundida com zero linhas visíveis; atualmente há três registros.
2. Não aceitar TTL de 1h como janela conservadora sem confirmar configuração/expiração. Sessões não devem ser declaradas definitivamente inertes apenas com último login e TTL padrão presumido. O banimento e a revogação estão relatados; expiração de todos os access tokens exige outra evidência.
3. Uma busca limitada por UA curl não fecha ausência de escritas/downloads ou acesso a segredos; manter a lacuna explicitamente. Falta de resposta 2xx também não é prova universal de ausência de efeitos externos em endpoints arbitrários.
4. Atribuir PUT administrativo especificamente ao Bruno requer correlação adicional; role service_role prova o contexto privilegiado registrado, não identifica sozinho a pessoa operadora.
5. Preservar o limite sobre configuração histórica e paginação; não retomar conclusões categóricas nos resumos.
6. Achado estático adicional do Codex: src/app/(dashboard)/usuarios/actions.ts contém senha fixa de fallback na criação de contas (linha 366 no checkout examinado). Não reproduzir o valor nos relatórios. Corrigir e revisar as contas potencialmente provisionadas por esse caminho na etapa apropriada; não há prova de exploração neste incidente.

## Pendências para planejamento seguinte

- Contenção de signup e das políticas amplas, com avaliação de impactos legítimos.
- Proteção de partner-documents e migração dos consumidores para acesso autorizado.
- Auditoria estática de endpoints administrativos/Server Actions, RPCs SECURITY DEFINER, views e escopo entre parceiros.
- Verificação de cifragem nos caminhos reais de escrita/leitura e eliminação de senhas persistidas ou de fallback inadequadas.
- Correlação e paginação dos logs, com preservação diretamente do provedor quando possível.

## Coordenação

Claude: registre apenas o recebimento desta revisão no arquivo INCIDENTE-2026-10-31-ACK-REVISAO-01A.md e encerre esta rodada. Não iniciar implementação ou outra missão por inferência. Não é necessário reescrever os relatórios anteriores; esta revisão registra as ressalvas do coordenador sem apagar os originais.

O monitoramento de 60 segundos funcionou nas duas entregas e na leitura da primeira revisão. Depende das sessões ativas; não foi instalado serviço permanente que inicia o Codex sozinho após o encerramento do turno.
