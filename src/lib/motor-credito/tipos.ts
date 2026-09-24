/**
 * Contrato entre o parser (`parser.ts`) e o leitor (`leitor.ts`) da API
 * Kaizom: uma linha de `bancobrs.consultas` já normalizada pro formato da
 * staging `motor_credito_consultas` (handoff Fase 2, §3.1 e D6).
 */
export type MargemProduto = { bruta: number | null; disp: number | null }

export type LinhaConsultaNormalizada = {
  mysqlId: number
  tarefaId: number | null
  /** `consultas.convenio` cru (nome como aparece no higienizador da Kaizom); null enquanto a coluna não existir. */
  convenioExterno: string | null
  /** 11 dígitos, validado; null quando inválido (a linha entra como falha). */
  cpf: string | null
  nome: string | null
  matricula: string | null
  orgao: string | null
  lotacao: string | null
  vinculo: string | null
  cargo: string | null
  /** AAAA-MM-DD */
  admissao: string | null
  /** "mm/aaaa" — competência; fica só na staging (D3). */
  mesReferencia: string | null
  proxFolha: string | null
  margens: { novo: MargemProduto; rmc: MargemProduto; rcc: MargemProduto }
  valorMargem: number | null
  valorDisponivel: number | null
  sucesso: boolean
  observacao: string | null
  /** ISO com fuso; a Kaizom grava em horário de Brasília (ver `parser.ts`). */
  consultadoEm: string | null
  dadosExtras: unknown
}
