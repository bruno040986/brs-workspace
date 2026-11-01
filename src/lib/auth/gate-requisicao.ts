// Puro (sem alias/IO) para ser testado em node. M04 B1: o header `next-action` e forjavel por qualquer
// cliente; Server Actions reais sao POST em rotas de pagina, nunca em /api. Em /api ele NAO isenta o gate.
export function isServerActionRequest(pathname: string, temHeaderNextAction: boolean): boolean {
  return temHeaderNextAction && !pathname.startsWith('/api/')
}
