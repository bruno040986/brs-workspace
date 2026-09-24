/**
 * Envio ao WeSales das linhas APROVADAS da staging da API Kaizom (D7):
 * in-request, máx. 2000 por chamada, marca `enviando` antes e
 * `enviada`/`erro_envio` por linha — timeout no meio é retomável reenviando
 * o que ficou. 1 `crm_imports` (tipo margem) por lote×convênio, rastreio
 * igual ao do Excel. A gravação em si é o núcleo compartilhado
 * `gravarFotoMargemWesales()` (D8).
 *
 * Só grava margem em quem JÁ é contato no WeSales (decisão do Bruno
 * 24/09/2026: NVTI é ação orientada, não automática). Linha aprovada cujo
 * CPF não existe vira `sem_cadastro` — o operador resolve pelo Cadastro de
 * Leads (grátis, com a exportação do CRM da Kaizom) ou submetendo à NVTI
 * pelo botão da tela (custo explícito). Nunca cria contato "nu".
 *
 * Body: { ids?: string[]; tarefaId?: number } — um dos dois.
 * Exige alvoconsig-motor-credito (can_include).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasPermissionForUser } from '@/lib/auth/server'
import { comConcorrenciaLimitada, CONCORRENCIA_WESALES, gravarFotoMargemWesales, numeradorImportacaoHoje, slugSegmento, type LinhaMargem } from '@/lib/alvoconsig/margem-wesales'
import { findContactByCpf } from '@/lib/wesales/client'

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
  wesales_contact_id: string | null
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
      .select('id, tarefa_id, cpf, nome, matricula, convenio_id, wesales_contact_id, margem_novo_disp, margem_rmc_disp, margem_rcc_disp, consultado_em')
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

      // Resolve o contato: id já verificado na tela ou busca por CPF agora. Sem contato → sem_cadastro (nunca cria).
      const resolvidos = await comConcorrenciaLimitada(
        unicas.map((l) => async (): Promise<{ linha: Linha; contactId?: string; erro?: string }> => {
          try {
            const existente = l.wesales_contact_id ? { id: l.wesales_contact_id } : await findContactByCpf(l.cpf)
            return existente ? { linha: l, contactId: existente.id } : { linha: l, erro: 'CPF ainda não é contato no WeSales — cadastre pelo Cadastro de Leads ou submeta à NVTI.' }
          } catch (error: any) {
            return { linha: l, erro: error?.message || String(error) }
          }
        }),
        CONCORRENCIA_WESALES,
      )
      const semContato = resolvidos.filter((r) => !r.contactId)
      if (semContato.length) {
        await Promise.all(semContato.map((r) => admin.from('motor_credito_consultas').update({ status: 'sem_cadastro', erro_envio: r.erro || 'Sem contato no WeSales.', wesales_contact_id: null, wesales_verificado_em: new Date().toISOString(), crm_import_id: importRow.id }).eq('id', r.linha.id)))
      }
      const comContato = resolvidos.filter((r): r is { linha: Linha; contactId: string } => Boolean(r.contactId))

      const entrada: LinhaMargem[] = comContato.map(({ linha: l, contactId }) => ({
        cpf: l.cpf,
        nome: l.nome,
        matricula: l.matricula,
        margens: { novo: l.margem_novo_disp, rmc: l.margem_rmc_disp, rcc: l.margem_rcc_disp },
        data: dataDaFoto(l.consultado_em, hojeBr),
        contactId,
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
            .eq('id', comContato[i].linha.id),
        ),
        ...(repetidas.length
          ? [admin.from('motor_credito_consultas').update({ status: 'erro_envio', erro_envio: 'CPF repetido no mesmo envio — outra linha já gravou a foto.', crm_import_id: importRow.id }).in('id', repetidas.map((l) => l.id))]
          : []),
      ])
      enviadas += r.importadas
      comErro += r.erros.length + repetidas.length + semContato.length

      await admin
        .from('crm_imports')
        .update({
          status: r.importadas === 0 && (r.erros.length + semContato.length) > 0 ? 'erro' : 'concluido',
          importadas: r.importadas,
          descartadas: r.erros.length + repetidas.length + semContato.length,
          erro: [...semContato.map((x) => `CPF ${x.linha.cpf}: ${x.erro}`), ...r.erros].slice(0, 20).join(' | ') || null,
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
