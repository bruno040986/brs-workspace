'use client'

/**
 * Projetos: Bruno cria o projeto, escolhe as IAs participantes e a redatora
 * técnica; as IAs trabalham via MCP. Esta tela lista e cria projetos.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bot, FolderKanban, Plus, Search } from 'lucide-react'
import { criarProjeto, listarAgentes, listarProjetos } from '@/lib/projetos/actions'
import { PROJETO_STATUS_LABEL, PROJETO_STATUS_ORDEM, type Agente, type ProjetoResumo, type ProjetoStatus } from '@/lib/projetos/tipos'
import { AgenteChips, Aviso, Carregando, CamposProjeto, Modal, ProjetoStatusBadge, dataFmt, erroMsg, type FormProjeto } from './_components/ui'

const FORM_VAZIO: FormProjeto = { titulo: '', objetivo: '', ideiaPrincipal: '', participanteIds: [], redatorAgenteId: '' }
const TODOS_STATUS = [...PROJETO_STATUS_ORDEM.filter((s) => s !== 'arquivado'), 'arquivado'] as ProjetoStatus[]

export default function ProjetosPage() {
  const router = useRouter()
  const [projetos, setProjetos] = useState<ProjetoResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<ProjetoStatus | ''>('')
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState<FormProjeto | null>(null)
  const [agentes, setAgentes] = useState<Agente[]>([])
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    try {
      const res = await listarProjetos()
      if (!res.success) throw new Error(res.error)
      setProjetos(res.data)
      setErro('')
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao carregar projetos.'))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // carga inicial fora do corpo síncrono do efeito (react-hooks/set-state-in-effect)
    void Promise.resolve().then(carregar)
    const t = window.setInterval(carregar, 60_000)
    return () => window.clearInterval(t)
  }, [])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return projetos.filter(
      (p) =>
        (filtroStatus ? p.status === filtroStatus : p.status !== 'arquivado') &&
        (!q || `${p.codigo} ${p.titulo} ${p.redator?.nome ?? ''} ${p.participantes.map((a) => a.nome).join(' ')}`.toLowerCase().includes(q)),
    )
  }, [projetos, filtroStatus, busca])

  async function abrirCriar() {
    setForm({ ...FORM_VAZIO })
    const res = await listarAgentes()
    if (res.success) setAgentes(res.data)
    else setErro(res.error)
  }

  async function salvar(iniciar: boolean) {
    if (!form || salvando) return
    if (!form.titulo.trim()) return setErro('Dê um título ao projeto.')
    if (!form.objetivo.trim()) return setErro('Preencha o objetivo do projeto.')
    if (!form.ideiaPrincipal.trim()) return setErro('Preencha a ideia principal.')
    setSalvando(true)
    setErro('')
    try {
      const res = await criarProjeto({
        titulo: form.titulo.trim(),
        objetivo: form.objetivo.trim(),
        ideiaPrincipal: form.ideiaPrincipal.trim(),
        redatorAgenteId: form.redatorAgenteId || null,
        participanteIds: form.participanteIds,
        iniciar,
      })
      if (!res.success) throw new Error(res.error)
      router.push(`/projetos/${res.data.codigo}`)
    } catch (err) {
      setErro(erroMsg(err, 'Erro ao criar projeto.'))
      setSalvando(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderKanban size={22} /> Projetos
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/projetos/agentes" className="btn btn-outline">
            <Bot size={16} /> Agentes de IA
          </Link>
          <button className="btn btn-primary" onClick={abrirCriar}>
            <Plus size={16} /> Criar novo projeto
          </button>
        </div>
      </div>

      {!form && <Aviso erro={erro} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--brs-gray-400)' }} />
          <input className="form-control" style={{ paddingLeft: 32 }} placeholder="Buscar por código, título ou IA…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select className="form-control" style={{ width: 'auto' }} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as ProjetoStatus | '')}>
          <option value="">Todos (exceto arquivados)</option>
          {TODOS_STATUS.map((s) => (
            <option key={s} value={s}>{PROJETO_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {carregando ? (
        <Carregando />
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Título</th>
                <th>Status</th>
                <th>Redator</th>
                <th>Participantes</th>
                <th>Tarefas</th>
                <th>Atualizado em</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/projetos/${p.codigo}`)}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <Link href={`/projetos/${p.codigo}`} onClick={(e) => e.stopPropagation()}>{p.codigo}</Link>
                  </td>
                  <td>{p.titulo}</td>
                  <td><ProjetoStatusBadge status={p.status} /></td>
                  <td>{p.redator?.nome ?? '—'}</td>
                  <td><AgenteChips agentes={p.participantes} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.tarefasConcluidas}/{p.totalTarefas}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dataFmt(p.updatedAt)}</td>
                </tr>
              ))}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--brs-gray-400)', padding: '1.5rem' }}>Nenhum projeto encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal
          titulo="Criar novo projeto"
          largura={640}
          onFechar={() => !salvando && setForm(null)}
          rodape={
            <>
              <button className="btn btn-outline" onClick={() => setForm(null)} disabled={salvando}>Cancelar</button>
              <button className="btn btn-outline" onClick={() => salvar(false)} disabled={salvando}>Salvar rascunho</button>
              <button
                className="btn btn-primary"
                onClick={() => salvar(true)}
                disabled={salvando || !form.redatorAgenteId}
                title={form.redatorAgenteId ? '' : 'Escolha a IA redatora técnica para iniciar'}
              >
                {salvando ? 'Salvando…' : 'Iniciar'}
              </button>
            </>
          }
        >
          <Aviso erro={erro} />
          <CamposProjeto form={form} setForm={setForm} agentes={agentes} />
        </Modal>
      )}
    </div>
  )
}
