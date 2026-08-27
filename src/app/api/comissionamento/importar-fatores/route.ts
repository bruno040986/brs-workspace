/**
 * Importa o "Relatório de Fatores PRICE" em PDF direto para `coeficientes`
 * (coeficiente = 1/Fator), um registro por dia coberto pelo relatório —
 * decisão 26/08/2026 (ver docs/SPEC-COEFICIENTES-SANTANDER.md). Hoje só o
 * formato do Santander tem parser; outras instituições ficam com a opção
 * de tabela manual pronta na tela, aguardando o parser próprio.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { parseFatoresSantander } from '@/lib/comissionamento/importar-fatores-santander'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function cleanDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

type ResultadoArquivo = { arquivo: string; ok: boolean; mensagem: string; gravados?: number }

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const allowed = await hasPermissionForUser(user.id, 'sistema-config-credito', 'can_include')
    if (!allowed) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

    const formData = await request.formData()
    const instituicaoId = String(formData.get('instituicao_id') || '').trim()
    const convenioId = String(formData.get('convenio_id') || '').trim()
    const tabelaIdManual = String(formData.get('tabela_comissao_id') || '').trim() || null
    const files = formData.getAll('files').filter((f): f is File => f instanceof File)

    if (!instituicaoId) return NextResponse.json({ error: 'Selecione a instituição financeira.' }, { status: 400 })
    if (!convenioId) return NextResponse.json({ error: 'Selecione o convênio.' }, { status: 400 })
    if (!files.length) return NextResponse.json({ error: 'Envie ao menos um PDF.' }, { status: 400 })

    const admin = await createAdminClient()

    const { data: instituicao } = await admin.from('financial_institutions').select('id, name').eq('id', instituicaoId).maybeSingle()
    if (!instituicao) return NextResponse.json({ error: 'Instituição financeira não encontrada.' }, { status: 400 })

    const { data: convenio } = await admin.from('convenios').select('id, nome, codigo').eq('id', convenioId).maybeSingle()
    if (!convenio) return NextResponse.json({ error: 'Convênio não encontrado.' }, { status: 400 })

    const ehSantander = /santander/i.test(String(instituicao.name || ''))
    if (!ehSantander) {
      return NextResponse.json(
        { error: `Importador de PDF ainda não implementado para "${instituicao.name}" — por enquanto só o Banco Santander tem leitor pronto.` },
        { status: 400 },
      )
    }

    const resultados: ResultadoArquivo[] = []

    for (const file of files) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const parsed = await parseFatoresSantander(buffer)

        if (convenio.codigo && cleanDigits(convenio.codigo) !== cleanDigits(parsed.convenioCodigo)) {
          resultados.push({
            arquivo: file.name,
            ok: false,
            mensagem: `O PDF é do convênio ${parsed.convenioCodigo} - ${parsed.convenioNome}, mas você selecionou "${convenio.nome}" (código ${convenio.codigo}). Confira antes de importar.`,
          })
          continue
        }

        const { data: tabela, error: tabelaError } = await admin
          .from('tabelas_comissao')
          .select('id, nome, codigo_tabela_banco, taxa_juros')
          .eq('institution_id', instituicaoId)
          .eq('convenio_id', convenioId)
          .eq('codigo_tabela_banco', parsed.regraCodigo)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle()

        if (tabelaError) {
          resultados.push({
            arquivo: file.name,
            ok: false,
            mensagem:
              tabelaError.code === 'PGRST116'
                ? `Existe mais de uma Tabela de Comissão ativa com o código "${parsed.regraCodigo}" para essa instituição/convênio — corrija o cadastro (desative/exclua a duplicata) antes de importar.`
                : `Erro ao resolver a Tabela de Comissão: ${tabelaError.message}`,
          })
          continue
        }

        const tabelaId = tabela?.id || tabelaIdManual
        if (!tabelaId) {
          resultados.push({
            arquivo: file.name,
            ok: false,
            mensagem: `Nenhuma Tabela de Comissão com código "${parsed.regraCodigo}" encontrada para essa instituição/convênio.`,
          })
          continue
        }

        if (tabela?.taxa_juros != null && Math.abs(Number(tabela.taxa_juros) - parsed.taxaPercentual) > 0.001) {
          resultados.push({
            arquivo: file.name,
            ok: false,
            mensagem: `Taxa do PDF (${parsed.taxaPercentual}%) diverge da taxa cadastrada na tabela "${tabela.nome}" (${tabela.taxa_juros}%) — confira antes de importar.`,
          })
          continue
        }

        const rows = parsed.linhas.flatMap((linha) =>
          parsed.prazos
            .filter((prazo) => linha.fatoresPorPrazo[prazo] > 0)
            .map((prazo) => ({
              tabela_comissao_id: tabelaId,
              prazo,
              coeficiente: 1 / linha.fatoresPorPrazo[prazo],
              vigencia_inicio: linha.data,
              vigencia_fim: linha.data,
              created_by: user.id,
            })),
        )

        const { error: upsertError } = await admin
          .from('coeficientes')
          .upsert(rows, { onConflict: 'tabela_comissao_id,prazo,vigencia_inicio' })
        if (upsertError) throw upsertError

        resultados.push({
          arquivo: file.name,
          ok: true,
          mensagem: `Tabela "${tabela?.nome || parsed.regraNome}" — ${rows.length} coeficiente(s) gravado(s) (${parsed.dataInicio} a ${parsed.dataFinal}).`,
          gravados: rows.length,
        })
      } catch (error: any) {
        resultados.push({ arquivo: file.name, ok: false, mensagem: error?.message || 'Erro ao processar o PDF.' })
      }
    }

    return NextResponse.json({ resultados })
  } catch (error: any) {
    console.error('Erro ao importar fatores em PDF:', error)
    return NextResponse.json({ error: 'Erro inesperado ao importar o PDF.' }, { status: 500 })
  }
}
