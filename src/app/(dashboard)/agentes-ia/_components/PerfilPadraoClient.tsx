'use client'

/**
 * Agentes de IA › editor do perfil padrão (spec §6.3/§7). Edita o JSON do perfil
 * por blocos; "Publicar" grava nova versão; histórico com "Restaurar".
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { History, RotateCcw, Save } from 'lucide-react'
import { INTENCOES, mesclarPerfil, montarPrompt, validarPerfil, type CampoColeta, type PerfilQualificacao, type SecaoBC } from '@/lib/ia/perfis'
import { listarVersoesPerfil, publicarPerfilPadrao, restaurarVersaoPerfil, type VersaoPerfil } from '../actions'

const linhas = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.75rem' }}>
      <div style={{ fontWeight: 800, color: 'var(--brs-gray-900)' }}>{titulo}</div>
      {children}
    </div>
  )
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--brs-gray-700)' }}>
      {rotulo}
      {children}
      {dica && <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>{dica}</span>}
    </label>
  )
}

const grade = { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } as const

export default function PerfilPadraoClient({ tipo, nome, perfilInicial, versaoInicial, versoesIniciais, bc, podeEditar }: {
  tipo: string; nome: string; perfilInicial: PerfilQualificacao; versaoInicial: number; versoesIniciais: VersaoPerfil[]; bc: SecaoBC[]; podeEditar: boolean
}) {
  const [perfil, setPerfil] = useState(perfilInicial)
  const [base, setBase] = useState(perfilInicial)
  const [versao, setVersao] = useState(versaoInicial)
  const [versoes, setVersoes] = useState(versoesIniciais)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [verPrompt, setVerPrompt] = useState(false)
  const alterado = JSON.stringify(perfil) !== JSON.stringify(base)
  const erros = useMemo(() => validarPerfil(perfil), [perfil])
  const prompt = useMemo(() => (verPrompt ? montarPrompt(perfil, bc) : ''), [verPrompt, perfil, bc])

  const set = (caminho: string, valor: unknown) => setPerfil((p) => mesclarPerfil(p, { [caminho]: valor }))
  const num = (caminho: string) => (e: React.ChangeEvent<HTMLInputElement>) => set(caminho, e.target.value === '' ? 0 : Number(e.target.value))
  const txt = (caminho: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(caminho, e.target.value)
  const ro = !podeEditar

  async function depois(r: { success: true; versao: number } | { success: false; error: string }, perfilNovo?: PerfilQualificacao) {
    if (!r.success) { setMsg({ ok: false, texto: r.error }); return }
    setVersao(r.versao)
    if (perfilNovo) { setPerfil(perfilNovo); setBase(perfilNovo) } else setBase(perfil)
    const v = await listarVersoesPerfil(tipo)
    if (v.success) setVersoes(v.versoes)
    setMsg({ ok: true, texto: `Publicado como versão ${r.versao}.` })
  }

  async function publicar() {
    if (ocupado || erros.length) return
    setOcupado(true)
    try { await depois(await publicarPerfilPadrao(tipo, perfil, versao)) } finally { setOcupado(false) }
  }

  async function restaurar(v: VersaoPerfil) {
    if (ocupado || !window.confirm(`Restaurar o conteúdo da versão ${v.versao}? Ele será publicado como uma versão nova.`)) return
    setOcupado(true)
    try { await depois(await restaurarVersaoPerfil(tipo, v.versao, versao), v.perfil) } finally { setOcupado(false) }
  }

  function moverCampo(i: number, d: -1 | 1) {
    const l = [...perfil.coleta]
    const j = i + d
    if (j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j], l[i]]
    set('coleta', l.map((c, k) => ({ ...c, ordem: k + 1 })))
  }
  const editarCampo = (i: number, parte: Partial<CampoColeta>) => set('coleta', perfil.coleta.map((c, k) => (k === i ? { ...c, ...parte } : c)))

  const ff = perfil.modelos.fallback_gratuito
  const inp = { className: 'form-control', disabled: ro } as const

  return (
    <div className="page-content" style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <Link href="/agentes-ia/perfis" style={{ fontSize: '0.75rem', color: 'var(--brs-gray-500)' }}>← Tipos de agente</Link>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brs-gray-900)', margin: 0 }}>{nome} — perfil padrão (v{versao})</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline" onClick={() => setVerPrompt((v) => !v)}>{verPrompt ? 'Ocultar prévia do prompt' : 'Prévia do prompt'}</button>
          {podeEditar && <button type="button" className="btn btn-primary" disabled={!alterado || ocupado || erros.length > 0} onClick={publicar}><Save size={14} /> Publicar nova versão</button>}
        </div>
      </div>
      {msg && <div role="status" className="card" style={{ padding: '0.7rem 1rem', color: msg.ok ? '#065F46' : '#991B1B', whiteSpace: 'pre-line' }}>{msg.texto}</div>}
      {alterado && erros.length > 0 && <div className="card" style={{ padding: '0.7rem 1rem', color: '#991B1B', whiteSpace: 'pre-line' }}>{erros.join('\n')}</div>}
      {verPrompt && <pre className="card" style={{ padding: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.78rem', margin: 0 }}>{prompt}</pre>}

      <Bloco titulo="Identidade, tom e objetivo">
        <Campo rotulo="Nome da assistente" dica="Padrão: Lia. Vale em todos os canais; o parceiro pode trocar.">
          <input {...inp} value={perfil.identidade.nome_assistente} onChange={txt('identidade.nome_assistente')} />
        </Campo>
        <Campo rotulo="Tom"><textarea {...inp} rows={2} value={perfil.tom} onChange={txt('tom')} /></Campo>
        <Campo rotulo="Objetivo"><textarea {...inp} rows={2} value={perfil.objetivo} onChange={txt('objetivo')} /></Campo>
      </Bloco>

      <Bloco titulo="Limites">
        <div style={grade}>
          <Campo rotulo="Máximo de turnos"><input {...inp} type="number" min={1} max={50} value={perfil.limites.max_turnos} onChange={num('limites.max_turnos')} /></Campo>
          <Campo rotulo="Teto de gasto por dia (US$)"><input {...inp} type="number" min={0} step="0.5" value={perfil.limites.gasto_dia_max_usd} onChange={num('limites.gasto_dia_max_usd')} /></Campo>
          <Campo rotulo="Máx. msgs — API Oficial"><input {...inp} type="number" min={1} value={perfil.limites.max_msgs_agente.ycloud} onChange={num('limites.max_msgs_agente.ycloud')} /></Campo>
          <Campo rotulo="Máx. msgs — Baileys"><input {...inp} type="number" min={1} value={perfil.limites.max_msgs_agente.baileys} onChange={num('limites.max_msgs_agente.baileys')} /></Campo>
          <Campo rotulo="Máx. msgs — Z-API"><input {...inp} type="number" min={1} value={perfil.limites.max_msgs_agente.zapi} onChange={num('limites.max_msgs_agente.zapi')} /></Campo>
        </div>
        <Campo rotulo="Proibições (uma por linha)">
          <textarea {...inp} rows={6} value={perfil.limites.proibicoes.join('\n')} onChange={(e) => set('limites.proibicoes', linhas(e.target.value))} />
        </Campo>
      </Bloco>

      <Bloco titulo="Campos a coletar (na ordem)">
        {perfil.coleta.map((c, i) => (
          <div key={i} style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'auto minmax(120px,1fr) minmax(0,2fr) auto auto', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{c.ordem}</span>
            <input {...inp} aria-label="Campo" value={c.campo} onChange={(e) => editarCampo(i, { campo: e.target.value })} />
            <input {...inp} aria-label="Pergunta ou descrição" placeholder="Pergunta / descrição" value={c.pergunta ?? c.descricao ?? ''} onChange={(e) => editarCampo(i, c.descricao !== undefined && c.pergunta === undefined ? { descricao: e.target.value } : { pergunta: e.target.value })} />
            <label style={{ fontSize: '0.75rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input type="checkbox" disabled={ro} checked={c.obrigatorio} onChange={(e) => editarCampo(i, { obrigatorio: e.target.checked })} /> obrigatório
            </label>
            {podeEditar && (
              <span style={{ display: 'flex', gap: '0.25rem' }}>
                <button type="button" className="btn btn-outline btn-sm" aria-label="Subir" onClick={() => moverCampo(i, -1)}>↑</button>
                <button type="button" className="btn btn-outline btn-sm" aria-label="Descer" onClick={() => moverCampo(i, 1)}>↓</button>
                <button type="button" className="btn btn-outline btn-sm" aria-label="Remover" onClick={() => set('coleta', perfil.coleta.filter((_, k) => k !== i).map((x, k) => ({ ...x, ordem: k + 1 })))}>✕</button>
              </span>
            )}
          </div>
        ))}
        {podeEditar && <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: 'start' }} onClick={() => set('coleta', [...perfil.coleta, { ordem: perfil.coleta.length + 1, campo: '', obrigatorio: false }])}>+ Adicionar campo</button>}
        <span style={{ fontSize: '0.72rem', color: 'var(--brs-gray-500)' }}>Regras especiais do CPF (só se quer simulação, nunca no 1º turno, validar dígito) e as opções de produto seguem o padrão de fábrica e são preservadas.</span>
      </Bloco>

      <Bloco titulo="Pós-qualificação (mensagens fixas)">
        {([['mensagem_transferencia', 'Transferência ({nome}, {atendente})'], ['mensagem_espera', 'Fila de espera ({nome})'], ['mensagem_fora_expediente', 'Fora do expediente ({horario})'], ['mensagem_fallback_erro', 'Erro da IA'], ['mensagem_optout', 'Pedido de parar']] as const).map(([k, r]) => (
          <Campo key={k} rotulo={r}><textarea {...inp} rows={2} value={perfil.pos_qualificacao[k]} onChange={txt(`pos_qualificacao.${k}`)} /></Campo>
        ))}
        <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" disabled={ro} checked={perfil.pos_qualificacao.pedir_documento} onChange={(e) => set('pos_qualificacao.pedir_documento', e.target.checked)} /> Pedir documento ao final (Fase 1: só registrar se vier)
        </label>
      </Bloco>

      <Bloco titulo="Roteamento padrão">
        <div style={grade}>
          <Campo rotulo="Modo">
            <select {...inp} value={perfil.roteamento.modo} onChange={txt('roteamento.modo')}>
              <option value="rodizio">Rodízio</option><option value="master">Master</option><option value="atendente_fixo">Atendente fixo</option><option value="espera">Espera</option>
            </select>
          </Campo>
          <Campo rotulo="Máx. conversas abertas por atendente"><input {...inp} type="number" min={1} value={perfil.roteamento.max_abertas} onChange={num('roteamento.max_abertas')} /></Campo>
          <Campo rotulo="Espera até avisar o master (min)"><input {...inp} type="number" min={1} value={perfil.roteamento.espera_master_min} onChange={num('roteamento.espera_master_min')} /></Campo>
        </div>
        <div style={grade}>
          {INTENCOES.map((i) => (
            <Campo key={i} rotulo={i}>
              <select {...inp} value={perfil.roteamento.destinos[i] ?? 'equipe_humana'} onChange={txt(`roteamento.destinos.${i}`)}>
                <option value="equipe_humana">Equipe humana</option><option value="encerrar">Encerrar</option>
              </select>
            </Campo>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Modelos">
        <div style={grade}>
          <Campo rotulo="Provedor"><select {...inp} value={perfil.modelos.provedor} onChange={txt('modelos.provedor')}><option value="openrouter">OpenRouter</option><option value="groq">Groq</option></select></Campo>
          <Campo rotulo="Modelo principal"><input {...inp} value={perfil.modelos.principal} onChange={txt('modelos.principal')} /></Campo>
        </div>
        <Campo rotulo="Fallbacks (um por linha, em ordem)"><textarea {...inp} rows={3} value={perfil.modelos.fallbacks.join('\n')} onChange={(e) => set('modelos.fallbacks', linhas(e.target.value))} /></Campo>
        <div style={grade}>
          <Campo rotulo="Fallback gratuito — provedor">
            <select {...inp} value={ff?.provedor ?? ''} onChange={(e) => set('modelos.fallback_gratuito', e.target.value ? { provedor: e.target.value, modelo: ff?.modelo ?? '' } : null)}>
              <option value="">Nenhum (ao bater o teto, vai para a fila)</option><option value="openrouter">OpenRouter (:free)</option><option value="groq">Groq</option>
            </select>
          </Campo>
          {ff && <Campo rotulo="Fallback gratuito — modelo" dica="Atenção LGPD: modelo gratuito pode usar as conversas para treino."><input {...inp} value={ff.modelo} onChange={(e) => set('modelos.fallback_gratuito', { ...ff, modelo: e.target.value })} /></Campo>}
        </div>
      </Bloco>

      <Bloco titulo="Tempos e horário">
        <div style={grade}>
          <Campo rotulo="Agrupar msgs — Oficial (s)"><input {...inp} type="number" min={0} value={perfil.tempos.agrupar_s.ycloud} onChange={num('tempos.agrupar_s.ycloud')} /></Campo>
          <Campo rotulo="Agrupar msgs — Baileys (s)"><input {...inp} type="number" min={0} value={perfil.tempos.agrupar_s.baileys} onChange={num('tempos.agrupar_s.baileys')} /></Campo>
          <Campo rotulo="Agrupar msgs — Z-API (s)"><input {...inp} type="number" min={0} value={perfil.tempos.agrupar_s.zapi} onChange={num('tempos.agrupar_s.zapi')} /></Campo>
          <Campo rotulo="Digitação (ms/caractere)"><input {...inp} type="number" min={0} value={perfil.tempos.digitacao_ms_por_char} onChange={num('tempos.digitacao_ms_por_char')} /></Campo>
          <Campo rotulo="Digitação mín. (ms)"><input {...inp} type="number" min={0} value={perfil.tempos.digitacao_min_ms} onChange={num('tempos.digitacao_min_ms')} /></Campo>
          <Campo rotulo="Digitação máx. (ms)"><input {...inp} type="number" min={0} value={perfil.tempos.digitacao_max_ms} onChange={num('tempos.digitacao_max_ms')} /></Campo>
        </div>
        <label style={{ fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" disabled={ro} checked={!perfil.horario.janela} onChange={(e) => set('horario.janela', e.target.checked ? null : { inicio: '08:00', fim: '18:00' })} /> Atendimento 24h (sem janela de expediente)
        </label>
        {perfil.horario.janela && (
          <div style={grade}>
            <Campo rotulo="Início"><input {...inp} type="time" value={perfil.horario.janela.inicio} onChange={(e) => set('horario.janela', { ...perfil.horario.janela, inicio: e.target.value })} /></Campo>
            <Campo rotulo="Fim"><input {...inp} type="time" value={perfil.horario.janela.fim} onChange={(e) => set('horario.janela', { ...perfil.horario.janela, fim: e.target.value })} /></Campo>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Histórico de versões">
        {versoes.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--brs-gray-500)' }}>Sem versões.</span>}
        {versoes.map((v) => (
          <div key={v.versao} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem' }}>
            <span><History size={13} style={{ verticalAlign: -2 }} /> v{v.versao}{v.versao === versao ? ' (atual)' : ''} · {new Date(v.created_at).toLocaleString('pt-BR')} · {v.autor || 'sistema'}</span>
            {podeEditar && v.versao !== versao && <button type="button" className="btn btn-outline btn-sm" disabled={ocupado} onClick={() => restaurar(v)}><RotateCcw size={13} /> Restaurar</button>}
          </div>
        ))}
      </Bloco>
    </div>
  )
}
