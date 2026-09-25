# Roteiro — Fatia 3 (Certificações): telas para o Sonnet

Base (Fable, 25/09/2026) já no ar ou nesta branch: migration `20260925131339_certificacoes.sql`
(catálogos, lançamentos, bucket público `certificacoes`, permissão `workspace-certificacoes`,
RPCs de correção aceitando o item de certificações), regras em `src/lib/certificacoes.ts`,
ações em `src/app/(dashboard)/agente-corban/certificacoes/actions.ts` e o card da Análise
(`_components/CertificacoesCard.tsx`). Plano geral: `docs/PLANO-CADASTROS-RECEBIDOS-V2-2026-09-25.md`.

**Proibido:** migrations, `src/lib/auth/`, `src/lib/supabase/`, `proxy.ts`. Nada de texto de
mensagem ao parceiro no código além do que já existe (Templates de Mensagens vem na fatia 5).

## A. Workspace — tela `/agente-corban/certificacoes` (substituir a versão só-leitura)

Arquivo: `src/app/(dashboard)/agente-corban/certificacoes/page.tsx` (+ um client component).
Padrão visual: `.data-table`, `.btn-acao`, modais `modal-backdrop/modal/modal-header/modal-body/modal-footer`
(ver `ProcessoOnboardingClient.tsx`). Quatro abas:

1. **Certificadoras** — tabela (logotipo, nome, site, situação) + Novo/Editar (modal: nome, site com
   http(s), ativa). Upload de logotipo por linha (`uploadLogotipoCertificadora(id, formData)`,
   PNG/JPG/SVG/WebP até 2 MB; exibir a imagem com altura fixa ~28 px). O Bruno sobe os logotipos
   feitos no Canva — não inventar logotipo.
2. **Tipos** — tabela (nome, obrigatório, situação) + Novo/Editar (`salvarTipoCertificacao`).
   Deixar claro no rótulo: desmarcar "obrigatório" NÃO apaga lançamentos, só deixa de exigir em
   análises novas.
3. **Certificações** — tabela (certificadora, nome, tipos que cobre, situação) + Novo/Editar
   (`salvarCertificacao`: certificadora select, nome, checkboxes dos tipos ativos; pelo menos 1).
4. **Vencimentos** — `listarVencimentos(dias)` com seletor 30/60/90/180 dias; colunas pessoa, CPF,
   certificação, validade, dias (vermelho vencida, laranja ≤ 60), parceiro (link para
   `/agente-corban/cadastros-recebidos/<processo_id>` quando houver).

Ações já prontas em `./actions.ts` (todas devolvem `{ success, error? }`). Permissão da rota já
registrada (regra dos 4 pontos feita).

## B. Portal — item de certificações na correção (`/correcao/[token]`)

Hoje `page.tsx` filtra `item.tipo !== 'analise'`. Passar a INCLUIR itens cuja `chave` começa com
`analise:certificacoes:cpf:` (a RPC `validar_correcao` agora devolve `valor` = `{ cpf, nome, papel }`).
No `CorrecaoClient.tsx`, renderizar para esse item um bloco por pessoa:

- Cabeçalho: "Certificações de <nome> (CPF formatado)" + motivo/instruções do operador.
- Escolha: **Possuo certificação** / **Não possuo**.
  - Possuo: certificadora (select), certificação (select filtrado pela certificadora), número,
    data do exame, validade, upload da imagem/PDF do certificado (reusar `CampoArquivo`, até 3).
    Catálogo: buscar via server action nova no portal lendo `certificadoras` + `certificacoes` ativas
    (service role, só leitura). Pode informar mais de uma certificação (lista com "adicionar outra").
  - Não possuo: justificativa obrigatória (texto).
- Envio: dentro de `respostas[chave]` mandar
  `{ possui: boolean, certificacoes?: [{ certificadora, certificacao, certificacao_id, numero, data_exame, data_validade, arquivos: [{fileName,url}] }], justificativa?: string }`.
  A RPC grava isso em `item.valor.resposta_parceiro` e marca o item `corrigido`; o operador confere no
  CRCP e lança (`CertificacoesCard` já lê `resposta_parceiro` — se vier lista, mostrar a primeira e
  contar as demais; ajustar o card para iterar a lista é bem-vindo).
- Validação cliente + servidor (`submeterCorrecao` do portal): "possuo" exige certificação e validade;
  "não possuo" exige justificativa.

## C. Aceite

- Bruno cadastra as certificações da FEBRABAN/ANEPS/ACREFI/ASSBAN pela aba Certificações e sobe os
  logotipos.
- Na Análise da Bem Digital: abrir CRCP, anexar print, lançar ANEC Completa com validade, aprovar o
  item; concluir a Análise passa. Remover o lançamento → concluir bloqueia com a lista de tipos
  obrigatórios faltantes.
- Reprovar o item de certificações → "Correções a solicitar" → enviar → parceiro responde pelo portal
  ("possuo" com PDF) → item volta "Corrigido" com a resposta no card → "Usar na lançada" → conferir →
  aprovar.
- Vencimentos: lançamento com validade daqui a 20 dias aparece na aba com 20 dias.
