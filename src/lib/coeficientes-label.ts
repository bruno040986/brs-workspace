/** Rótulo do seletor de tabela: código sempre primeiro (nomes se repetem), descrição depois. */
export function rotuloTabelaCoeficiente(codigo: string | null | undefined, descricao: string): string {
  return `${codigo?.trim() || 'sem código'} · ${descricao}`
}
