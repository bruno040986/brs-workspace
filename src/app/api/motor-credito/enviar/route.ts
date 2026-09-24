/**
 * Envio ao WeSales das linhas APROVADAS da staging da API Kaizom (D7):
 * in-request, máx. 2000 por chamada, marca `enviando` antes e
 * `enviada`/`erro_envio` por linha — timeout no meio é retomável reenviando
 * o que ficou. 1 `crm_imports` (tipo margem) por lote×convênio, rastreio
 * igual ao do Excel. A gravação em si é o núcleo compartilhado
 * `gravarFotoMargemWesales()` (D8).
 *
 * Body: { ids?: string[]; tarefaId?: number } — um dos dois.
 * Exige alvoconsig-motor-credito (can_include).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { gravarFotoMargemWesales, numeradorImportacaoHoje, slugSegmento, type LinhaMargem } from '@/lib/alvoconsig/margem-wesales'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_POR_ENVIO = 2000

type Linha = {
  id: string
  tarefa_id: number | null
  cpf: string
  nome: string | null
  matricula: string | null
  convenio_id: string
  margem_novo_disp: number | null
  margem_rmc_disp: number | null
  margem_rcc_disp: number | null
  consultado_em: string | null
}

/** D3: data da foto = dia de `consultado_em` em Brasília; sem carimbo, hoje. */
function dataDaFoto(consultadoEm: string | null, hojeBr: string): string {
  if (!consultadoEm) return hojeBr
  const d = new Date(consultadoEm)
  return Number.isNaN(d.getTime()) ? hojeBr : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    if (!(await hasPermissionForUser(user.id, 'alvoconsig-motor-credito', 'can_include'))) {
      return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
    }

    let body: { ids?: unknown; tarefaId?: unknown } = {}
    try { body = await request.json() } catch { /* body vazio */ }
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))] : []
    const tarefaId = typeof body.tarefaId === 'number' && Number.isInteger(body.tarefaId) ? body.tarefaId : null
    if (!ids.length && tarefaId === null) return NextResponse.json({ error: 'Informe as linhas (ids) ou o lote (tarefaId).' }, { status: 400 })

    const admin = await createAdminClient()
    let q = admin
      .from('motor_credito_consultas')
      .select('id, tarefa_id, cpf, nome, matricula, convenio_id, margem_novo_disp, margem_rmc_disp, margem_rcc_disp, consultado_em')
      .eq('status', 'aprovada')
      .not('convenio_id', 'is', null)
      .not('cpf', 'is', null)
      .order('mysql_id', { ascending: true })
      .limit(MAX_POR_ENVIO)
    q = ids.length ? q.in('id', ids) : q.eq('tarefa_id', tarefaId as number)
    const { data: selecionadas, error: selErr } = await q
    if (selErr) throw selErr
    const linhas = (selecionadas || []) as Linha[]
    if (!linhas.length) return NextResponse.json({ error: 'Nenhuma linha aprovada (com convênio) na seleção.' }, { status: 400 })

    // Reserva: só quem AINDA está aprovada vira enviando (duas pessoas
    // clicando ao mesmo tempo não enviam a mesma linha duas vezes).
    const { data: reservadas, error: resErr } = await admin
      .from('motor_credito_consultas')
      .update({ status: 'enviando', erro_envio: null })
      .in('id', linhas.map((l) => l.id))
      .eq('status', 'aprovada')
      .select('id')
    if (resErr) throw resErr
    const reservadasIds = new Set((reservadas || []).map((r: { id: string }) => r.id))
    const paraEnviar = linhas.filter((l) => reservadasIds.has(l.id))

    // 1 crm_imports por lote × convênio (um lote é de um convênio só, mas a seleção pode cruzar lotes).
    const grupos = new Map<string, Linha[]>()
    for (const l of paraEnviar) {
      const chave = `${l.convenio_id}|${l.tarefa_id ?? 'x'}`
      grupos.set(chave, [...(grupos.get(chave) || []), l])
    }

    let enviadas = 0
    let comErro = 0
    const importIds: string[] = []
    for (const grupo of grupos.values()) {
      const convenioId = grupo[0].convenio_id
      const tarefa = grupo[0].tarefa_id
      const { data: convenio } = await admin
        .from('convenios')
        .select('id, nome, nome_reduzido, codigo_sistema, cnpj, razao_social, cidade, uf, cep, wesales_business_id')
        .eq('id', convenioId)
        .maybeSingle()
      if (!convenio) {
        await admin.from('motor_credito_consultas').update({ status: 'erro_envio', erro_envio: 'Convênio não encontrado.' }).in('id', grupo.map((l) => l.id))
        comErro += grupo.length
        continue
      }

      const { hojeBr, dataTag, numerador } = await numeradorImportacaoHoje(admin, 'margem', convenioId)
      const baseTagSlug = `margem-${slugSegmento(convenio.nome_reduzido || convenio.nome)}-${dataTag}-${numerador}`
      const { data: importRow, error: importError } = await admin
        .from('crm_imports')
        .insert({
          tipo: 'margem',
          arquivo_nome: `API Kaizom — tarefa ${tarefa ?? '?'}`,
          mapeamento: { _base_tag: baseTagSlug, origem: 'kaizom', tarefa_id: tarefa },
          convenio_id: convenioId,
          total_linhas: grupo.length,
          criado_por: user.id,
        })
        .select('id')
        .single()
      if (importError || !importRow) {
        await admin.from('motor_credito_consultas').update({ status: 'erro_envio', erro_envio: 'Falha ao registrar a importação.' }).in('id', grupo.map((l) => l.id))
        comErro += grupo.length
        continue
      }
      importIds.push(importRow.id)

      // 1 foto por CPF: repetido no mesmo envio fica como erro visível.
      const vistos = new Set<string>()
      const unicas: Linha[] = []
      const repetidas: Linha[] = []
      for (const l of grupo) (vistos.has(l.cpf) ? repetidas : (vistos.add(l.cpf), unicas)).push(l)

      const entrada: LinhaMargem[] = unicas.map((l) => ({
        cpf: l.cpf,
        nome: l.nome,
        matricula: l.matricula,
        margens: { novo: l.margem_novo_disp, rmc: l.margem_rmc_disp, rcc: l.margem_rcc_disp },
        data: dataDaFoto(l.consultado_em, hojeBr),
      }))
      const r = await gravarFotoMargemWesales({ admin, convenio: { ...convenio, codigo_sistema: convenio.codigo_sistema as string }, linhas: entrada, baseTagSlug, source: 'AlvoConsig — API Kaizom' })

      const agora = new Date().toISOString()
      await Promise.all([
        ...r.resultados.map((res, i) =>
          admin
            .from('motor_credito_consultas')
            .update(res.contactId
              ? { status: 'enviada', wesales_contact_id: res.contactId, crm_import_id: importRow.id, erro_envio: null, revisado_em: agora }
              : { status: 'erro_envio', erro_envio: res.erro || 'Falha desconhecida', crm_import_id: importRow.id })
            .eq('id', unicas[i].id),
        ),
        ...(repetidas.length
          ? [admin.from('motor_credito_consultas').update({ status: 'erro_envio', erro_envio: 'CPF repetido no mesmo envio — outra linha já gravou a foto.', crm_import_id: importRow.id }).in('id', repetidas.map((l) => l.id))]
          : []),
      ])
      enviadas += r.importadas
      comErro += r.erros.length + repetidas.length

      await admin
        .from('crm_imports')
        .update({
          status: r.erros.length > 0 && r.importadas === 0 ? 'erro' : 'concluido',
          importadas: r.importadas,
          descartadas: r.erros.length + repetidas.length,
          erro: r.erros.length ? r.erros.slice(0, 20).join(' | ') : null,
          concluido_em: agora,
        })
        .eq('id', importRow.id)
    }

    return NextResponse.json({ ok: true, enviadas, comErro, naoReservadas: linhas.length - paraEnviar.length, importIds })
  } catch (error) {
    console.error('Erro no envio API Kaizom → WeSales:', error)
    return NextResponse.json({ error: 'Erro inesperado ao enviar ao WeSales.' }, { status: 500 })
  }
}
