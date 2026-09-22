/**
 * Importa o "Relatório de Fatores PRICE" em PDF direto para `coeficientes`
 * (coeficiente = 1/Fator), um registro por dia coberto pelo relatório —
 * decisão 26/08/2026 (ver docs/SPEC-COEFICIENTES-SANTANDER.md).
 *
 * A instituição escolhida define o LEITOR (Santander nos dois layouts, Daycoval);
 * cada leitor devolve N tabelas (`ArquivoFatores`), e cada tabela é resolvida
 * pelo código do banco em `tabelas_comissao.codigo_tabela_banco` (Regra no
 * Santander, "Convênio" no Daycoval) dentro da instituição × convênio
 * selecionados. O campo Tabela manual só vale pra PDF de tabela única.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { parseFatoresSantander } from '@/lib/comissionamento/importar-fatores-santander'
import { parseFatoresDaycoval } from '@/lib/comissionamento/importar-fatores-daycoval'
import { dataBrIso, type ArquivoFatores } from '@/lib/comissionamento/importar-fatores-comum'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const LEITORES: Array<{ instituicao: RegExp; parse: (buffer: Buffer) => Promise<ArquivoFatores> }> = [
  { instituicao: /santander/i, parse: parseFatoresSantander },
  { instituicao: /daycoval/i, parse: parseFatoresDaycoval },
]

/** Um PDF do Santander em intervalo dá ~1.700 linhas (21 dias × 80 prazos) — upsert em lotes. */
const LOTE_UPSERT = 500

function cleanDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

type ResultadoArquivo = { arquivo: string; ok: boolean; parcial?: boolean; mensagem: string; gravados?: number }

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

    const leitor = LEITORES.find((l) => l.instituicao.test(String(instituicao.name || '')))
    if (!leitor) {
      return NextResponse.json(
        { error: `Importador de PDF ainda não implementado para "${instituicao.name}" — por enquanto só Banco Santander e Banco Daycoval têm leitor pronto.` },
        { status: 400 },
      )
    }

    const resultados: ResultadoArquivo[] = []

    for (const file of files) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const arquivo = await leitor.parse(buffer)

        if (arquivo.convenioCodigo && convenio.codigo && cleanDigits(convenio.codigo) !== cleanDigits(arquivo.convenioCodigo)) {
          resultados.push({
            arquivo: file.name,
            ok: false,
            mensagem: `O PDF é do convênio ${arquivo.convenioCodigo} - ${arquivo.convenioNome}, mas você selecionou "${convenio.nome}" (código ${convenio.codigo}). Confira antes de importar.`,
          })
          continue
        }

        const linhasMsg: string[] = []
        let gravados = 0
        let tabelasOk = 0
        let tabelasFalha = 0

        for (const tabela of arquivo.tabelas) {
          const rotulo = `${tabela.codigoTabelaBanco} · ${tabela.nomeTabela}`
          if (tabela.bloqueio) {
            linhasMsg.push(`✕ ${rotulo}: ${tabela.bloqueio}`)
            tabelasFalha += 1
            continue
          }

          const { data: tabelaDb, error: tabelaError } = await admin
            .from('tabelas_comissao')
            .select('id, nome, codigo_tabela_banco, taxa_juros')
            .eq('institution_id', instituicaoId)
            .eq('convenio_id', convenioId)
            .eq('codigo_tabela_banco', tabela.codigoTabelaBanco)
            .eq('is_active', true)
            .is('deleted_at', null)
            .maybeSingle()

          if (tabelaError) {
            linhasMsg.push(
              `✕ ${rotulo}: ${
                tabelaError.code === 'PGRST116'
                  ? 'existe mais de uma Tabela de Comissão ativa com esse código para a instituição/convênio — desative ou exclua a duplicata antes de importar.'
                  : `erro ao resolver a Tabela de Comissão (${tabelaError.message}).`
              }`,
            )
            tabelasFalha += 1
            continue
          }

          // Campo Tabela manual só faz sentido quando o PDF traz UMA tabela.
          const tabelaId = tabelaDb?.id || (arquivo.tabelas.length === 1 ? tabelaIdManual : null)
          if (!tabelaId) {
            linhasMsg.push(
              `✕ ${rotulo}: nenhuma Tabela de Comissão ativa com esse código para a instituição/convênio${
                arquivo.tabelas.length > 1 ? ' (cadastre a tabela com esse código no campo "código no banco")' : ''
              }.`,
            )
            tabelasFalha += 1
            continue
          }

          if (tabelaDb?.taxa_juros != null && tabela.taxaPercentual != null && Math.abs(Number(tabelaDb.taxa_juros) - tabela.taxaPercentual) > 0.001) {
            linhasMsg.push(`✕ ${rotulo}: taxa do PDF (${tabela.taxaPercentual}%) diverge da cadastrada em "${tabelaDb.nome}" (${tabelaDb.taxa_juros}%) — confira antes de importar.`)
            tabelasFalha += 1
            continue
          }

          const rows = tabela.linhas.flatMap((linha) =>
            tabela.prazos
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

          for (let i = 0; i < rows.length; i += LOTE_UPSERT) {
            const { error: upsertError } = await admin
              .from('coeficientes')
              .upsert(rows.slice(i, i + LOTE_UPSERT), { onConflict: 'tabela_comissao_id,prazo,vigencia_inicio' })
            if (upsertError) throw upsertError
          }

          gravados += rows.length
          tabelasOk += 1
          linhasMsg.push(
            `✔ ${tabelaDb?.nome || tabela.nomeTabela}: ${rows.length} coeficiente(s), ${dataBrIso(tabela.dataInicio)} a ${dataBrIso(tabela.dataFinal)}, prazos ${tabela.prazos[0]} a ${tabela.prazos[tabela.prazos.length - 1]} (${tabela.prazos.length}).`,
          )
          for (const aviso of tabela.avisos) linhasMsg.push(`   ⚠ ${aviso}`)
        }

        resultados.push({
          arquivo: file.name,
          ok: tabelasOk > 0,
          parcial: tabelasOk > 0 && tabelasFalha > 0,
          gravados,
          mensagem: [`${arquivo.formato} — ${arquivo.tabelas.length} tabela(s) no PDF, ${tabelasOk} gravada(s).`, ...linhasMsg].join('\n'),
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
