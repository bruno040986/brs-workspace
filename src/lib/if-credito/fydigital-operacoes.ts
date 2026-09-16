/**
 * Metadados das operações de descoberta da FyDigital (rótulo, nome da
 * operação na API deles, payload-modelo, dica). Módulo separado (sem
 * "use server") porque um arquivo "use server" só pode exportar funções
 * async — um objeto/const aqui quebra o bundle inteiro da página que o
 * importa (achado em produção 15/09/2026). fydigital-actions.ts e
 * FyDigitalCard.tsx importam daqui.
 */
export type OperacaoDescobertaFyDigital = 'simular-operacao' | 'cancelar-proposta' | 'alterar-operacao'

export const OPERACOES_FYDIGITAL: Record<OperacaoDescobertaFyDigital, { rotulo: string; operacaoApi: string; payloadModelo: string; dica: string }> = {
  'simular-operacao': {
    rotulo: 'Simular Operação',
    operacaoApi: 'Consig.simularOperacao',
    payloadModelo: JSON.stringify(
      {
        bancarizadora: 3,
        cliente: '00000000000',
        simulacao: {
          id_empregador: 0,
          id_orgao: 0,
          id_tabela_fin: 0,
          id_produto: 0,
          tipo_proposta: 'CartaoMaisSaqueParcelado',
          valor_sol_total: 1000,
          valor_sol_parcela: 0,
          num_parcelas: 12,
        },
      },
      null,
      2
    ),
    dica: 'Resposta síncrona costuma ser só um ack — o resultado real (id_simulacao, taxas, parcela) chega pelos webhooks "identificador" e depois "simular_operacao"/"erro_simulacao". Os ids de empregador/órgão/tabela/produto ainda dependem do catálogo que o suporte da FyDigital vai confirmar.',
  },
  'cancelar-proposta': {
    rotulo: 'Cancelar Proposta',
    operacaoApi: 'Consig.cancelarOperacao',
    payloadModelo: JSON.stringify({ proposta: '' }, null, 2),
    dica: '"proposta" é o id devolvido no webhook "criar_proposta". Sem resultado síncrono — confirmação chega no webhook "operacao_cancelada".',
  },
  'alterar-operacao': {
    rotulo: 'Alterar Operação',
    operacaoApi: 'Consig.editOperacao',
    payloadModelo: JSON.stringify({ proposta: { id_proposta_consignado: 0, matricula: null, token: null }, financeiro: null, documento: null }, null, 2),
    dica: 'Só o bloco que você quer alterar vai preenchido; os demais precisam ir null (é assim que a doc deles distingue "não mexe" de "limpa o campo"). Único obrigatório: proposta.id_proposta_consignado.',
  },
}
