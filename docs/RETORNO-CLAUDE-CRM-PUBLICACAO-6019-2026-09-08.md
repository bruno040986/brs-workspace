# Retorno ao Astra — publicação do hotfix e4c9301 (inbound 6019), 08/09/2026

Responde a `REVISAO-CORRECAO-INBOUND-6019-2026-09-08.md`. **Fundação durável
mantida desligada. Sem migrations. Nenhuma mensagem enviada por mim.**

## Correção registrada — diagnóstico do próximo teste

Anotado antes de prosseguir: se o erro se repetir no teste de Bruno, isso
**não** comprova por si só o problema do nono dígito. Comparar telefone
exato enviado, telefone armazenado e resposta real da busca; considerar
também a corrida entre duas primeiras mensagens simultâneas disputando a
criação (a correção atual não trata isso explicitamente). Buscar só por
sufixo **não** é o próximo passo automático — pode confundir DDDs diferentes
e vincular ao contato errado. Registrado para não repetir esse erro de
raciocínio caso o teste falhe.

## Integração e checks

- `main` local e remoto coincidiam em `99e82b0` antes do merge (sem
  divergência). Fast-forward de `crm/investigacao-inbound-6019` — só o
  commit `e4c9301`, 3 arquivos.
- Checado no resultado integrado: `npm run typecheck` 0 erros; `npm test`
  77/77; flags no Railway reconfirmadas ausentes imediatamente antes do
  push (mesma leitura remota de sempre, não inferência local).

## Push e deploys

`git push origin main`: fast-forward `99e82b0..e4c9301`.

| Serviço | Deploy ID | Commit implantado | Estado |
|---|---|---|---|
| CRM (Vercel) | `dpl_7iKzMrra85V1UScrGGecTFnocqYx` | `e4c930135b9de3c672b50b7a41e7684828e93239` | READY |
| Engine (Railway) | `178b54b4-a31c-4fca-8f88-1c4ff89c8416` | `e4c930135b9de3c672b50b7a41e7684828e93239` | SUCCESS |

## Saúde e confirmação das flags (evidência do processo em produção)

```
engine no ar                       port=3000
processamento durável              duravel=false contasSelecionadas=0
reconectando instâncias com sessão salva   total=4
instância conectada  instId=5576d3fc-... numero=556131991641
instância conectada  instId=906d9c33-... numero=556198882537
instância conectada  instId=99ed05f3-... numero=556181617033
instância conectada  instId=4e6f7ba0-... numero=556185156019   ← "final 6019"
```

`GET /health` → `{"ok":true,"instancias_ativas":4}`. A própria instância que
falhava está entre as 4 reconectadas com sessão salva, sem erro na subida.

## Pendente — teste de Bruno

Deploy confirmado nos dois serviços, mesmo SHA, fundação desligada. Pronto
para Bruno mandar uma nova mensagem do mesmo telefone para o final 6019. Eu
não enviei nem vou enviar essa mensagem. Assim que ele testar, confirmo os
três pontos do critério de aceite (contato reaproveitado, conversa
espelhada, mensagem única no Atendimento do DF3) e devolvo o resultado.
