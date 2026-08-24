/**
 * Cálculo de ofertas (Novo / Cartão RMC / Cartão RCC / Refin) na MONTAGEM da
 * campanha — grava o resultado em `crm_contatos.ofertas` para leitura
 * instantânea no atendimento (nunca recalcula na hora da ligação).
 *
 * Fórmula igual à do painel do lead no CRM (brs-alvoconsig/lib/crm/actions.ts
 * calcularOfertasInterno), portada aqui pois o Workspace tem o próprio client
 * admin do mesmo Supabase — mesma tabela `coeficientes`, mesma lógica.
 */

export type AdminClient = { from: (table: string) => any }

export type OfertaCalculada = {
  produto: string
  instituicao: string
  tabela: string
  comSeguro: boolean
  prazo: number
  coeficiente: number
  margem: number
  valorLiberado: number
}

/** Uma oferta de REFIN "crua", como veio do slot no WeSales (ver refin-slots.ts). */
export type RawRefinSlot = {
  slot: number
  troco: number | null
  parcela: number | null
  prazo: number | null
  taxa: string | null
  tabelaCodigo: string | null
  instituicaoId: string | null
}

/** Oferta de REFIN já casada (quando possível) com a tabela de comissão cadastrada. */
export type RefinOferta = RawRefinSlot & {
  tabelaComissaoId: string | null
  tabelaNome: string | null
  instituicaoNome: string | null
}

export type OfertasContato = {
  novo: OfertaCalculada[]
  cartao_rmc: OfertaCalculada[]
  cartao_rcc: OfertaCalculada[]
  refin: RefinOferta[]
  calculado_em: string
}

function digitsOuTexto(value: string | null | undefined): string {
  const texto = String(value || '').trim()
  const digitos = texto.replace(/\D/g, '')
  return digitos || texto
}

/**
 * Casa cada slot de REFIN com a tabela de comissão cadastrada (mesma
 * instituição + código do banco, dentro do convênio da campanha). Sem
 * migration: uma única query em lote, não N+1 por slot.
 */
export async function resolverOfertasRefin(admin: AdminClient, slots: RawRefinSlot[], convenioId: string | null): Promise<RefinOferta[]> {
  if (!slots.length) return []
  const instituicaoIds = [...new Set(slots.map((s) => s.instituicaoId).filter(Boolean))] as string[]
  if (!convenioId || !instituicaoIds.length) {
    return slots.map((s) => ({ ...s, tabelaComissaoId: null, tabelaNome: null, instituicaoNome: null }))
  }

  const { data: tabelas, error } = await admin
    .from('tabelas_comissao')
    .select('id, codigo_tabela_banco, nome, institution_id, financial_institutions ( name )')
    .eq('convenio_id', convenioId)
    .in('institution_id', instituicaoIds)
    .is('deleted_at', null)
  if (error) {
    console.error('Erro ao resolver tabelas de REFIN:', error)
    return slots.map((s) => ({ ...s, tabelaComissaoId: null, tabelaNome: null, instituicaoNome: null }))
  }

  const porChave = new Map<string, { id: string; nome: string; instituicaoNome: string }>()
  for (const t of (tabelas || []) as any[]) {
    if (!t.codigo_tabela_banco) continue
    porChave.set(`${t.institution_id}|${digitsOuTexto(t.codigo_tabela_banco)}`, { id: t.id, nome: t.nome, instituicaoNome: t.financial_institutions?.name || '' })
  }

  return slots.map((s) => {
    const chave = s.instituicaoId && s.tabelaCodigo ? `${s.instituicaoId}|${digitsOuTexto(s.tabelaCodigo)}` : ''
    const match = chave ? porChave.get(chave) : null
    return { ...s, tabelaComissaoId: match?.id ?? null, tabelaNome: match?.nome ?? null, instituicaoNome: match?.instituicaoNome ?? null }
  })
}

export async function calcularOfertas(
  admin: AdminClient,
  convenioId: string | null,
  margens: { novo?: number | null; cartao_rmc?: number | null; cartao_rcc?: number | null },
  refin?: RefinOferta[],
): Promise<OfertasContato> {
  const vazio: OfertasContato = { novo: [], cartao_rmc: [], cartao_rcc: [], refin: refin ?? [], calculado_em: new Date().toISOString() }
  if (!convenioId) return vazio

  const temAlgumaMargem = Object.values(margens).some((v) => typeof v === 'number' && v > 0)
  if (!temAlgumaMargem) return vazio

  const hoje = new Date().toISOString().slice(0, 10)
  const { data: coeficientes, error } = await admin
    .from('coeficientes')
    .select(
      'prazo, coeficiente, vigencia_inicio, vigencia_fim, ' +
        'tabelas_comissao!inner ( id, nome, com_seguro, is_active, convenio_id, ' +
        'formas_contrato!inner ( id, nome, origem_margem ), ' +
        'financial_institutions!inner ( id, name, is_active ) )',
    )
    .eq('tabelas_comissao.convenio_id', convenioId)
    .lte('vigencia_inicio', hoje)
    .or(`vigencia_fim.is.null,vigencia_fim.gte.${hoje}`)
  if (error) {
    console.error('Erro ao buscar coeficientes:', error)
    return vazio
  }

  const porOrigem: Record<'novo' | 'cartao_rmc' | 'cartao_rcc', OfertaCalculada[]> = { novo: [], cartao_rmc: [], cartao_rcc: [] }
  for (const linha of (coeficientes || []) as any[]) {
    const tabela = linha.tabelas_comissao as any
    if (!tabela?.is_active || !tabela?.financial_institutions?.is_active) continue
    const origemMargem = String(tabela?.formas_contrato?.origem_margem || 'nenhuma') as 'novo' | 'cartao_rmc' | 'cartao_rcc' | 'nenhuma'
    if (origemMargem === 'nenhuma') continue
    const margem = Number((margens as Record<string, number | null | undefined>)[origemMargem] || 0)
    if (margem <= 0) continue
    porOrigem[origemMargem].push({
      produto: String(tabela.formas_contrato?.nome || origemMargem),
      instituicao: String(tabela.financial_institutions.name),
      tabela: String(tabela.nome),
      comSeguro: tabela.com_seguro === true,
      prazo: Number(linha.prazo),
      coeficiente: Number(linha.coeficiente),
      margem,
      valorLiberado: Math.round(margem * Number(linha.coeficiente) * 100) / 100,
    })
  }
  for (const key of Object.keys(porOrigem) as Array<keyof typeof porOrigem>) {
    porOrigem[key].sort((a, b) => b.valorLiberado - a.valorLiberado)
  }

  return { ...porOrigem, refin: refin ?? [], calculado_em: new Date().toISOString() }
}
