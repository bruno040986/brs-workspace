'use client'

/**
 * Detalhe do projeto: cabeçalho com fluxo de status, e abas Visão geral,
 * Chat, Fórum, Tarefas, Commits e Decisões. As IAs escrevem via MCP; aqui Bruno
 * acompanha, conversa, cria/edita tarefas e avança o fluxo.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Archive, ArchiveRestore, ArrowLeft, ChevronRight, Pencil, Plus } from 'lucide-react'
import {
  atualizarProjeto,
  atualizarProjetoStatus,
  atualizarTarefa,
  criarTarefa,
  enviarMensagem,
  lerProjeto,
  listarAgentes,
} from '@/lib/projetos/actions'
import { avisoEscritaAlterada, ehChat, temEscritaTecnica } from '@/lib/projetos/puro'
import {
  PROJETO_STATUS_LABEL,
  PROJETO_STATUS_ORDEM,
  TAREFA_PRIORIDADE_LABEL,
  TAREFA_STATUS_LABEL,
  type Agente,
  type ProjetoDetalhe,
  type ProjetoStatus,
  type Tarefa,
  type TarefaPrioridade,
  type TarefaStatus,
} from '@/lib/projetos/tipos'
import {
  AgenteChips,
  Aviso,
  CamposProjeto,
  Carregando,
  FormMensagem,
  Modal,
  PrioridadeBadge,
  ProjetoStatusBadge,
  Rotulo,
  TarefaStatusBadge,
  Timeline,
  dataFmt,
  erroMsg,
  prazoFmt,
  type FormProjeto,
} from '../_components/ui'
import { ChatPainel, useChat } from '../_components/chat'

type Aba = 'geral' | 'chat' | 'forum' | 'tarefas' | 'commits' | 'decisoes'
const ABAS: Array<{ id: Aba; label: string }> = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'chat', label: 'Chat' },
  { id: 'forum', label: 'Fórum' },
  { id: 'tarefas', label: 'Tarefas' },
  { id: 'commits', label: 'Commits' },
  { id: 'decisoes', label: 'Decisões' },
]
const FLUXO: ProjetoStatus[] = PROJETO_STATUS_ORDEM.filter((s) => s !== 'arquivado')

type FormTarefa = { titulo: string; descricao: string; responsavelAgenteId: string; prioridade: TarefaPrioridade; prazo: string; status: TarefaStatus }
const TAREFA_VAZIA: FormTarefa = { titulo: '', descricao: '', responsavelAgenteId: '', prioridade: 'media', prazo: '', status: 'pendente' }

/** Lança Error se a action falhou; assim todo handler cai no mesmo catch. */
function ok<T>(res: { success: true; data: T } | { success: false; error: string }): T {
  if (!res.success) throw new Error(res.error)
  return res.data
}

export default function ProjetoDetalhePage() {
  const { codigo } = useParams<{ codigo: string }>()
  const [projeto, setProjeto] = useState<ProjetoDetalhe | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<Aba>('geral')
  const [ocupado, setOcupado] = useState(false)
  const [incluirTarefas, setIncluirTarefas] = useState(false)
  const [edicao, setEdicao] = useState<FormProjeto | null>(null)
  const [agentes, setAgentes] = useState<Agente[]>([])
  const [novaTarefa, setNovaTarefa] = useState<FormTarefa | null>(null)
  const [tarefaAberta, setTarefaAberta] = useState<number | null>(null)
  const chat = useChat(codigo, aba === 'chat')

  async function carregar() {
    try {
      setProjeto(ok(await lerProjeto(codigo)))
      setErro('')
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao carregar o projeto.'))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // carga inicial fora do corpo síncrono do efeito (react-hooks/set-state-in-effect)
    void Promise.resolve().then(carregar)
    const t = window.setInterval(carregar, 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo])

  /** Roda uma ação, recarrega e devolve true se deu certo (erro vai para o aviso do topo). */
  async function executar(acao: () => Promise<unknown>, padrao: string) {
    if (ocupado) return false
    setOcupado(true)
    setErro('')
    try {
      await acao()
      await carregar()
      return true
    } catch (err) {
      setErro(erroMsg(err, padrao))
      return false
    } finally {
      setOcupado(false)
    }
  }

  const mensagensForum = useMemo(() => (projeto ? projeto.mensagens.filter((m) => !ehChat(m) && (incluirTarefas || m.tarefaId == null)) : []), [projeto, incluirTarefas])
  const decisoes = useMemo(
    () => (projeto ? projeto.mensagens.filter((m) => m.tipo === 'decisao' || m.tipo === 'registro_direto').sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []),
    [projeto],
  )

  if (carregando) return <Carregando />
  if (!projeto)
    return (
      <div>
        <Link href="/projetos" className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> Projetos</Link>
        <div style={{ marginTop: '1rem' }}><Aviso erro={erro || 'Projeto não encontrado.'} /></div>
      </div>
    )

  const p = projeto
  const idx = FLUXO.indexOf(p.status)
  const proximo = idx >= 0 && idx < FLUXO.length - 1 ? FLUXO[idx + 1] : null
  const tarefa = p.tarefas.find((t) => t.numero === tarefaAberta) ?? null
  const bloqueioAvanco = proximo === 'planejamento' && !temEscritaTecnica(p.escritaTecnica) ? 'Registre a escrita técnica antes de avançar para Planejamento.' : ''
  const escritaAlterada = avisoEscritaAlterada(p)

  function avancar() {
    if (!proximo || !window.confirm(`Avançar ${p.codigo} para "${PROJETO_STATUS_LABEL[proximo]}"?`)) return
    executar(async () => ok(await atualizarProjetoStatus(p.codigo, proximo)), 'Erro ao avançar o status.')
  }
  function arquivar() {
    if (!window.confirm(`Arquivar ${p.codigo}? Ele some da lista padrão.`)) return
    executar(async () => ok(await atualizarProjetoStatus(p.codigo, 'arquivado')), 'Erro ao arquivar.')
  }

  function reabrir() {
    if (!window.confirm(`Reabrir ${p.codigo}? Ele volta para "${PROJETO_STATUS_LABEL.execucao}".`)) return
    executar(async () => ok(await atualizarProjetoStatus(p.codigo, 'execucao')), 'Erro ao reabrir.')
  }

  async function abrirEdicao() {
    setEdicao({
      titulo: p.titulo,
      objetivo: p.objetivo,
      ideiaPrincipal: p.ideiaPrincipal,
      participanteIds: p.participantes.map((a) => a.id),
      redatorAgenteId: p.redator?.id ?? '',
    })
    const res = await listarAgentes()
    if (res.success) setAgentes(res.data)
    else setErro(res.error)
  }
  async function salvarEdicao() {
    if (!edicao) return
    if (!edicao.titulo.trim()) return setErro('Dê um título ao projeto.')
    if (!edicao.objetivo.trim()) return setErro('Preencha o objetivo do projeto.')
    if (!edicao.ideiaPrincipal.trim()) return setErro('Preencha a ideia principal.')
    const feito = await executar(
      async () =>
        ok(
          await atualizarProjeto(p.codigo, {
            titulo: edicao.titulo.trim(),
            objetivo: edicao.objetivo.trim(),
            ideiaPrincipal: edicao.ideiaPrincipal.trim(),
            participanteIds: edicao.participanteIds,
            redatorAgenteId: edicao.redatorAgenteId || null,
          }),
        ),
      'Erro ao salvar o projeto.',
    )
    if (feito) setEdicao(null)
  }

  async function salvarNovaTarefa() {
    if (!novaTarefa) return
    if (!novaTarefa.titulo.trim()) return setErro('Dê um título à tarefa.')
    const feito = await executar(
      async () =>
        ok(
          await criarTarefa({
            codigo: p.codigo,
            titulo: novaTarefa.titulo.trim(),
            descricao: novaTarefa.descricao.trim(),
            responsavelAgenteId: novaTarefa.responsavelAgenteId || null,
            prioridade: novaTarefa.prioridade,
            prazo: novaTarefa.prazo || null,
          }),
        ),
      'Erro ao criar a tarefa.',
    )
    if (feito) setNovaTarefa(null)
  }

  const enviarNoForum = async (tipo: 'mensagem' | 'decisao', conteudo: string) => {
    ok(await enviarMensagem({ codigo: p.codigo, tipo, conteudo }))
    await carregar()
  }

  return (
    <div>
      {/* cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <Link href="/projetos" className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> Projetos</Link>
        <span className="badge badge-navy">{p.codigo}</span>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>{p.titulo}</h1>
        <ProjetoStatusBadge status={p.status} />
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--brs-gray-600)', marginBottom: '0.9rem', alignItems: 'center' }}>
        <span>Redator: <strong>{p.redator?.nome ?? '—'}</strong></span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Participantes: <AgenteChips agentes={p.participantes} /></span>
        <span>Criado por {p.criadoPorNome} em {dataFmt(p.createdAt)}</span>
        {p.aprovadoEm && (
          <span className="badge badge-success">
            Aprovado por {p.aprovadoPorNome ?? '—'} em {new Date(p.aprovadoEm).toLocaleDateString('pt-BR')} (v{p.versaoEscritaAprovada ?? '?'})
          </span>
        )}
      </div>
      {escritaAlterada && (
        <div className="alert alert-warning" style={{ marginBottom: '0.9rem' }}>
          {escritaAlterada}
        </div>
      )}

      {/* barra de fluxo */}
      <div className="card" style={{ padding: '0.7rem 0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {FLUXO.map((s, i) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <ChevronRight size={14} style={{ color: 'var(--brs-gray-400)' }} />}
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: 99,
                  fontWeight: s === p.status ? 800 : 500,
                  background: s === p.status ? 'var(--brs-navy)' : i < idx ? 'var(--brs-gray-100)' : 'transparent',
                  color: s === p.status ? '#fff' : i < idx ? 'var(--brs-gray-600)' : 'var(--brs-gray-400)',
                }}
              >
                {PROJETO_STATUS_LABEL[s]}
              </span>
            </span>
          ))}
          {p.status === 'arquivado' && <span className="badge badge-gray" style={{ marginLeft: 8 }}>Arquivado</span>}
        </div>
        {proximo && (
          // title no span: botão desabilitado não mostra tooltip em todo navegador
          <span title={bloqueioAvanco || undefined}>
            <button className="btn btn-primary btn-sm" onClick={avancar} disabled={ocupado || Boolean(bloqueioAvanco)}>
              Avançar para {PROJETO_STATUS_LABEL[proximo]} <ChevronRight size={14} />
            </button>
          </span>
        )}
        {p.status === 'arquivado' && (
          <button className="btn btn-outline btn-sm" onClick={reabrir} disabled={ocupado}>
            <ArchiveRestore size={14} /> Reabrir
          </button>
        )}
        {p.status !== 'arquivado' && (
          <button className="btn btn-outline btn-sm" onClick={arquivar} disabled={ocupado}>
            <Archive size={14} /> Arquivar
          </button>
        )}
      </div>

      <Aviso erro={erro} />

      <div className="tabs-list" style={{ overflowX: 'auto' }}>
        {ABAS.map((a) => (
          <button
            key={a.id}
            className={`tab-btn${aba === a.id ? ' active' : ''}`}
            onClick={() => {
              setAba(a.id)
              if (a.id === 'chat') chat.zerarNaoLidas()
            }}
          >
            {a.label}
            {a.id === 'chat' && aba !== 'chat' && chat.naoLidas > 0 && (
              <span className="badge badge-danger" style={{ marginLeft: 6 }}>{chat.naoLidas > 99 ? '99+' : chat.naoLidas}</span>
            )}
            {a.id === 'tarefas' && ` (${p.tarefasConcluidas}/${p.totalTarefas})`}
            {a.id === 'commits' && ` (${p.commits.length})`}
          </button>
        ))}
      </div>

      {aba === 'geral' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={abrirEdicao}><Pencil size={14} /> Editar</button>
          </div>
          {(
            [
              ['Objetivo / Finalidade', p.objetivo],
              ['Ideia principal', p.ideiaPrincipal],
            ] as const
          ).map(([titulo, texto]) => (
            <div key={titulo} className="card">
              <div className="card-header"><h3 className="card-title">{titulo}</h3></div>
              <div className="card-body" style={{ whiteSpace: 'pre-wrap', fontSize: '0.86rem', lineHeight: 1.55 }}>{texto || '(vazio)'}</div>
            </div>
          ))}
          <div className="card">
            <div className="card-header"><h3 className="card-title">Escrita técnica</h3></div>
            {/* ponytail: texto puro (sem lib de markdown instalada); renderizar markdown se adicionarem uma */}
            <div className="card-body" style={{ whiteSpace: 'pre-wrap', fontSize: '0.86rem', lineHeight: 1.55 }}>
              {p.escritaTecnica || (
                <span style={{ color: 'var(--brs-gray-400)' }}>
                  {p.redator ? `Aguardando ${p.redator.nome} escrever a escrita técnica.` : 'Nenhuma IA redatora definida. Use "Editar" para escolher uma.'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {aba === 'chat' && <ChatPainel mensagens={chat.mensagens} erro={chat.erro} enviar={chat.enviar} />}

      {aba === 'forum' && (
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginBottom: '0.7rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={incluirTarefas} onChange={(e) => setIncluirTarefas(e.target.checked)} />
            Incluir mensagens das tarefas
          </label>
          <Timeline mensagens={mensagensForum} mostrarTarefa />
          <FormMensagem onEnviar={enviarNoForum} />
        </div>
      )}

      {aba === 'tarefas' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.7rem' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setNovaTarefa({ ...TAREFA_VAZIA })}><Plus size={14} /> Nova tarefa</button>
          </div>
          <div className="card table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Título</th>
                  <th>Responsável</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th>Prazo</th>
                  <th>Atualizada em</th>
                </tr>
              </thead>
              <tbody>
                {p.tarefas.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setTarefaAberta(t.numero)}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>T-{t.numero}</td>
                    <td>{t.titulo}</td>
                    <td>{t.responsavel?.nome ?? '—'}</td>
                    <td><PrioridadeBadge prioridade={t.prioridade} /></td>
                    <td><TarefaStatusBadge status={t.status} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{prazoFmt(t.prazo) || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataFmt(t.updatedAt)}</td>
                  </tr>
                ))}
                {p.tarefas.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>Nenhuma tarefa ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'commits' && (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Repo</th>
                <th>Branch</th>
                <th>SHA</th>
                <th>Autor</th>
                <th>Mensagem</th>
                <th>Tarefa</th>
              </tr>
            </thead>
            <tbody>
              {p.commits.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dataFmt(c.commitEm)}</td>
                  <td>{c.repo}</td>
                  <td><code>{c.branch}</code></td>
                  <td>
                    {c.url.startsWith('https://') ? (
                      <a href={c.url} target="_blank" rel="noreferrer"><code>{c.sha.slice(0, 7)}</code></a>
                    ) : (
                      <code>{c.sha.slice(0, 7)}</code>
                    )}
                  </td>
                  <td>{c.autor}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{c.mensagem.split('\n')[0]}</td>
                  <td>
                    {c.tarefaNumero != null ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setTarefaAberta(c.tarefaNumero)}>T-{c.tarefaNumero}</button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {p.commits.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>Nenhum commit recebido.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'decisoes' && <Timeline mensagens={decisoes} mostrarTarefa vazio="Nenhuma decisão registrada." />}

      {edicao && (
        <Modal
          titulo={`Editar ${p.codigo}`}
          largura={640}
          onFechar={() => !ocupado && setEdicao(null)}
          rodape={
            <>
              <button className="btn btn-outline" onClick={() => setEdicao(null)} disabled={ocupado}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarEdicao} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
            </>
          }
        >
          <Aviso erro={erro} />
          <CamposProjeto form={edicao} setForm={setEdicao} agentes={agentes} />
        </Modal>
      )}

      {novaTarefa && (
        <Modal
          titulo="Nova tarefa"
          onFechar={() => !ocupado && setNovaTarefa(null)}
          rodape={
            <>
              <button className="btn btn-outline" onClick={() => setNovaTarefa(null)} disabled={ocupado}>Cancelar</button>
              <button className="btn btn-primary" onClick={salvarNovaTarefa} disabled={ocupado}>{ocupado ? 'Criando…' : 'Criar tarefa'}</button>
            </>
          }
        >
          <Aviso erro={erro} />
          <CamposTarefa form={novaTarefa} setForm={setNovaTarefa} participantes={p.participantes} />
        </Modal>
      )}

      {tarefa && (
        <TarefaModal
          key={tarefa.numero}
          projeto={p}
          tarefa={tarefa}
          onFechar={() => setTarefaAberta(null)}
          onMudou={carregar}
        />
      )}
    </div>
  )
}

function CamposTarefa({ form, setForm, participantes, comStatus = false }: { form: FormTarefa; setForm: (f: FormTarefa) => void; participantes: Agente[]; comStatus?: boolean }) {
  return (
    <>
      <Rotulo>Título *</Rotulo>
      <input className="form-control" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
      <Rotulo>Descrição</Rotulo>
      <textarea className="form-control" rows={4} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 0.7rem' }}>
        <div>
          <Rotulo>Responsável</Rotulo>
          <select className="form-control" value={form.responsavelAgenteId} onChange={(e) => setForm({ ...form, responsavelAgenteId: e.target.value })}>
            <option value="">— Ninguém —</option>
            {participantes.map((a) => (
              <option key={a.id} value={a.id}>{a.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <Rotulo>Prioridade</Rotulo>
          <select className="form-control" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as TarefaPrioridade })}>
            {(Object.keys(TAREFA_PRIORIDADE_LABEL) as TarefaPrioridade[]).map((k) => (
              <option key={k} value={k}>{TAREFA_PRIORIDADE_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <Rotulo>Prazo</Rotulo>
          <input type="date" className="form-control" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
        </div>
        {comStatus && (
          <div>
            <Rotulo>Status</Rotulo>
            <select className="form-control" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TarefaStatus })}>
              {(Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[]).map((k) => (
                <option key={k} value={k}>{TAREFA_STATUS_LABEL[k]}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </>
  )
}

/** Modal da tarefa: o form nasce dos dados ao abrir e não é sobrescrito pelo polling. */
function TarefaModal({ projeto, tarefa, onFechar, onMudou }: { projeto: ProjetoDetalhe; tarefa: Tarefa; onFechar: () => void; onMudou: () => Promise<void> }) {
  const [form, setForm] = useState<FormTarefa>({
    titulo: tarefa.titulo,
    descricao: tarefa.descricao,
    responsavelAgenteId: tarefa.responsavel?.id ?? '',
    prioridade: tarefa.prioridade,
    prazo: tarefa.prazo?.slice(0, 10) ?? '',
    status: tarefa.status,
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const mensagens = projeto.mensagens.filter((m) => m.tarefaId === tarefa.id)
  // responsável atual pode ter saído do projeto: mantém no select para não sumir silenciosamente
  const opcoes = tarefa.responsavel && !projeto.participantes.some((a) => a.id === tarefa.responsavel?.id) ? [...projeto.participantes, tarefa.responsavel] : projeto.participantes

  async function salvar() {
    if (!form.titulo.trim()) return setErro('Dê um título à tarefa.')
    setSalvando(true)
    setErro('')
    try {
      ok(
        await atualizarTarefa({
          codigo: projeto.codigo,
          numero: tarefa.numero,
          titulo: form.titulo.trim(),
          descricao: form.descricao.trim(),
          responsavelAgenteId: form.responsavelAgenteId || null,
          prioridade: form.prioridade,
          prazo: form.prazo || null,
          status: form.status,
        }),
      )
      await onMudou()
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao salvar a tarefa.'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={`T-${tarefa.numero} · ${tarefa.titulo}`}
      largura={760}
      onFechar={onFechar}
    >
      <Aviso erro={erro} />
      <div style={{ fontSize: '0.75rem', color: 'var(--brs-gray-400)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <TarefaStatusBadge status={tarefa.status} />
        <span>criada em {dataFmt(tarefa.createdAt)}</span>
        <span>· atualizada em {dataFmt(tarefa.updatedAt)}</span>
        {tarefa.concluidaEm && <span>· concluída em {dataFmt(tarefa.concluidaEm)}</span>}
      </div>
      <CamposTarefa form={form} setForm={setForm} participantes={opcoes} comStatus />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>

      <h4 style={{ margin: '1.3rem 0 0.6rem', fontSize: '0.9rem' }}>Histórico</h4>
      <Timeline mensagens={mensagens} vazio="Nenhuma mensagem nesta tarefa." />
      <FormMensagem
        onEnviar={async (tipo, conteudo) => {
          ok(await enviarMensagem({ codigo: projeto.codigo, tarefaNumero: tarefa.numero, tipo, conteudo }))
          await onMudou()
        }}
      />
    </Modal>
  )
}
